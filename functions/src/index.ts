import { setGlobalOptions } from "firebase-functions/v2";
import { onDocumentUpdated } from "firebase-functions/v2/firestore";
import { onRequest } from "firebase-functions/v2/https";
import * as admin from "firebase-admin";
import { onDocumentCreated } from "firebase-functions/v2/firestore";
import { sendEventRemindersV2 } from "./eventReminders";


// ✅ Set correct region for Firestore: australia-southeast2
setGlobalOptions({ maxInstances: 10, region: "australia-southeast2" });

if (admin.apps.length === 0) {
  admin.initializeApp();
}
const db = admin.firestore();

// ---------- EMAIL HELPERS (Trigger Email extension) ----------
const MAIL_COLLECTION = "mail"; // change if your extension uses a different collection

async function getUserEmail(uid: string): Promise<string | null> {
  // Try Firestore "users" first
  try {
    const doc = await db.collection("users").doc(uid).get();
    const email = doc.exists ? (doc.get("email") as string | undefined) : undefined;
    if (email) return email;
  } catch {}

  // Fallback to Firebase Auth
  try {
    const rec = await admin.auth().getUser(uid);
    return rec.email ?? null;
  } catch {
    return null;
  }
}

async function getPlayerName(uid: string): Promise<string> {
  try {
    const s = await db.collection("players").doc(uid).get();
    const n = s.exists ? (s.get("name") as string | undefined) : undefined;
    return n || "Player";
  } catch {
    return "Player";
  }
}

async function getEventSummary(eventId: string): Promise<{
  title: string;
  location: string | null;
  startISO: string | null;
  hostId: string | null;
}> {
  const s = await db.collection("events").doc(eventId).get();
  const d = s.exists ? s.data() : undefined;
  return {
    title: (d?.title as string) || "Tennis Event",
    location: (d?.location as string) || null,
    startISO: (typeof d?.start === "string" ? d?.start : null) || null,
    hostId: (d?.hostId as string) || null,
  };
}

function formatLocal(iso?: string | null): string {
  if (!iso) return "";
  const dt = new Date(iso);
  return isNaN(dt.getTime()) ? "" : dt.toLocaleString();
}

async function enqueueEmail(to: string, subject: string, html: string, text?: string) {
  await db.collection(MAIL_COLLECTION).add({
    to,
    message: {
      subject,
      html,
      text: text ?? html.replace(/<[^>]+>/g, " "),
    },
  });
}

// Auto-sync calendar when a new event is created
export const syncCalendarOnEventCreate = onDocumentCreated("events/{eventId}", async (event) => {
  const snap = event.data;
  if (!snap) return;

  const data = snap.data() as {
    title?: string;
    location?: string;
    start?: string | null;
    end?: string | null;
    hostId?: string | null;
    participants?: string[];
  };

  const eventId = event.params.eventId as string;
  const hostId = data.hostId ?? null;
  if (!hostId) {
    console.log("❌ No hostId on event, skipping calendar sync.");
    return;
  }

  const title = data.title ?? "Tennis Event";
  const courtName = data.location ?? null;
  const startISO = typeof data.start === "string" ? data.start : null;
  const endISO = typeof data.end === "string" ? data.end : null;

  // Host + any initial participants
  const initialParticipants = Array.isArray(data.participants) ? data.participants.filter(Boolean) : [];
  const allIds = Array.from(new Set([hostId, ...initialParticipants]));

  console.log(`🗓️ Creating calendar entries for event ${eventId}:`, allIds);

  const batch = db.batch();
  for (const uid of allIds) {
    const ref = db.collection("calendar_events").doc(`${eventId}_${uid}`);
    batch.set(
      ref,
      {
        eventId,
        ownerId: uid,
        title,
        start: startISO,
        end: endISO,
        participants: allIds,
        status: "accepted",      // your calendar doc status
        visibility: "private",
        courtName,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
      },
      { merge: true }            // idempotent upsert
    );
  }

  await batch.commit();
  console.log(`✅ Calendar synced for event ${eventId}`);
});

// Auto-sync when hostId is added after initial creation
export const syncCalendarWhenHostIdAppears = onDocumentUpdated("events/{eventId}", async (event) => {
  const before = event.data?.before?.data() as any;
  const after = event.data?.after?.data() as any;
  if (!after) return;

  // Only run when hostId transitions from missing/empty -> set
  const hadHost = !!before?.hostId;
  const hasHost = !!after.hostId;
  if (hadHost || !hasHost) return;

  const eventId = event.params.eventId as string;
  const hostId: string = after.hostId;

  const title = after.title ?? "Tennis Event";
  const courtName = after.location ?? null;
  const startISO = typeof after.start === "string" ? after.start : null;
  const endISO = typeof after.end === "string" ? after.end : null;

  const initialParticipants: string[] = Array.isArray(after.participants)
    ? after.participants.filter(Boolean)
    : [];
  const allIds = Array.from(new Set([hostId, ...initialParticipants]));

  // Idempotent: only create host calendar doc if missing
  const calRef = db.collection("calendar_events").doc(`${eventId}_${hostId}`);
  const calSnap = await calRef.get();
  if (!calSnap.exists) {
    await calRef.set(
      {
        eventId,
        ownerId: hostId,
        title,
        start: startISO,
        end: endISO,
        participants: allIds,
        status: "accepted",
        visibility: "private",
        courtName,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
      },
      { merge: true }
    );
  }
});
// Email the host when a new join request is created
export const emailOnJoinRequestCreated = onDocumentCreated(
  "events/{eventId}/join_requests/{reqId}",
  async (event) => {
    const req = event.data?.data() as {
      userId?: string;
      status?: string;
      emailHostNotified?: boolean;
    } | undefined;
    if (!req) return;

    // Skip if we've already sent for this request (handles retries)
    if (req.emailHostNotified) {
      console.log("✋ Host already notified for this request.");
      return;
    }

    const { eventId, reqId } = event.params as { eventId: string; reqId: string };
    const { title, location, startISO, hostId } = await getEventSummary(eventId);
    if (!hostId) {
      console.log("❌ Event has no hostId; skipping email.");
      return;
    }

    const hostEmail = await getUserEmail(hostId);
    if (!hostEmail) {
      console.log("❌ No email for host; skipping.");
      return;
    }

    // 👇 NEW: build a friendly greeting name for the host
    const hostNameFromPlayers = await getPlayerName(hostId);
    const hostGreetingName =
      hostNameFromPlayers && hostNameFromPlayers !== "Player"
        ? hostNameFromPlayers
        : (hostEmail.split("@")[0] || "there");

    const requesterId = req.userId || "";
    const requesterName = await getPlayerName(requesterId);

    const when = formatLocal(startISO);
    const subject = `New Join Request TennisMate Event · ${title}`;
    const html = `
      <p>Hi ${hostGreetingName},</p>
      <p><strong>${requesterName}</strong> has requested to join your event <strong>${title}</strong>.</p>
      ${when || location ? `<p>${when ? `🕒 ${when}<br/>` : ""}${location ? `📍 ${location}` : ""}</p>` : ""}
      <p>
        Review requests here:<br/>
        <a href="https://tennismate.vercel.app/events/${eventId}">View event</a>
      </p>
    `;

    await enqueueEmail(hostEmail, subject, html);

    // Mark so we don't double-send on retries
    await db
      .collection("events")
      .doc(eventId)
      .collection("join_requests")
      .doc(reqId)
      .set({ emailHostNotified: true }, { merge: true });

    console.log(`✅ Emailed host (${hostEmail}) about join request.`);
  }
);


// Email the requester when their join request is accepted
export const emailOnJoinRequestAccepted = onDocumentUpdated(
  "events/{eventId}/join_requests/{reqId}",
  async (event) => {
    const before = event.data?.before?.data() as {
      status?: string;
      emailAcceptedNotified?: boolean;
    } | undefined;
    const after = event.data?.after?.data() as {
      status?: string;
      userId?: string;
      emailAcceptedNotified?: boolean;
    } | undefined;

    if (!before || !after) return;

    // Only when status transitions to "accepted"
    const becameAccepted = before.status !== "accepted" && after.status === "accepted";
    if (!becameAccepted) return;

    // Avoid duplicates
    if (after.emailAcceptedNotified) {
      console.log("✋ Requester already notified of acceptance.");
      return;
    }

    const { eventId, reqId } = event.params as { eventId: string; reqId: string };
    const { title, location, startISO } = await getEventSummary(eventId);

    const requesterId = after.userId || "";
    const requesterEmail = await getUserEmail(requesterId);
    if (!requesterEmail) {
      console.log("❌ No email for requester; skipping.");
      return;
    }

    // 👇 NEW: build a friendly greeting name for the requester
    const requesterNameFromPlayers = await getPlayerName(requesterId);
    const requesterGreetingName =
      requesterNameFromPlayers && requesterNameFromPlayers !== "Player"
        ? requesterNameFromPlayers
        : (requesterEmail.split("@")[0] || "there");

    const when = formatLocal(startISO);
    const subject = `You're in! TennisMate Event · ${title}`;
    const html = `
      <p>Hi ${requesterGreetingName},</p>
      <p>Your request to join <strong>${title}</strong> has been <strong>accepted</strong> 🎉</p>
      ${when || location ? `<p>${when ? `🕒 ${when}<br/>` : ""}${location ? `📍 ${location}` : ""}</p>` : ""}
      <p>
        See event details:<br/>
        <a href="https://tennismate.vercel.app/events/${eventId}">Open event</a>
      </p>
    `;

    await enqueueEmail(requesterEmail, subject, html);

    // Mark so we don't double-send on retries
    await db
      .collection("events")
      .doc(eventId)
      .collection("join_requests")
      .doc(reqId)
      .set({ emailAcceptedNotified: true }, { merge: true });

    console.log(`✅ Emailed requester (${requesterEmail}) about acceptance.`);
  }
);


// Auto-sync calendar for any participants newly added to the event
export const syncCalendarWhenParticipantsChange = onDocumentUpdated("events/{eventId}", async (event) => {
  const before = event.data?.before?.data() as any;
  const after = event.data?.after?.data() as any;
  if (!before || !after) return;

  const eventId = event.params.eventId as string;

  const beforeArr = Array.isArray(before.participants) ? before.participants.filter(Boolean) : [];
  const afterArr  = Array.isArray(after.participants)  ? after.participants.filter(Boolean)  : [];

  // Compute newly added UIDs
  const beforeSet = new Set<string>(beforeArr);
  const added = afterArr.filter((uid: string) => !beforeSet.has(uid));
  if (added.length === 0) return;

  const title = after.title ?? "Tennis Event";
  const courtName = after.location ?? null;
  const startISO = typeof after.start === "string" ? after.start : null;
  const endISO = typeof after.end === "string" ? after.end : null;

  // Use latest participant list in the calendar doc
  const participantsAll = Array.from(new Set(afterArr));

  const batch = db.batch();
  for (const uid of added) {
    const ref = db.collection("calendar_events").doc(`${eventId}_${uid}`);
    batch.set(
      ref,
      {
        eventId,
        ownerId: uid,
        title,
        start: startISO,
        end: endISO,
        participants: participantsAll,
        status: "accepted",
        visibility: "private",
        courtName,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
      },
      { merge: true } // idempotent
    );
  }
  await batch.commit();
});



interface Court {
  id: string;
  name: string;
  lat: number;
  lng: number;
}

function calculateDistance(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const R = 6371;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const lat1 = (a.lat * Math.PI) / 180;
  const lat2 = (b.lat * Math.PI) / 180;

  const hav =
    Math.sin(dLat / 2) ** 2 +
    Math.sin(dLng / 2) ** 2 * Math.cos(lat1) * Math.cos(lat2);
  const c = 2 * Math.atan2(Math.sqrt(hav), Math.sqrt(1 - hav));

  return R * c;
}

export const suggestCourtOnMatch = onDocumentUpdated("match_requests/{matchId}", async (event: any) => {
  const before = event.data?.before?.data();
  const after = event.data?.after?.data();
  const context = event.params;

  console.log("📌 Trigger fired for match:", context.matchId);

  if (!before || !after) {
    console.log("❌ Missing before or after data.");
    return;
  }

  if (before.status === "accepted") {
    console.log("❌ Match was already accepted before.");
    return;
  }

  if (after.status !== "accepted") {
    console.log("❌ Status is not 'accepted'. Current:", after.status);
    return;
  }

  if (after.suggestedCourtId) {
    console.log("❌ Court already suggested:", after.suggestedCourtId);
    return;
  }

  console.log("✅ Valid update — finding suggested court...");

  const [fromUserId, toUserId] = [after.fromUserId, after.toUserId];
  const [fromSnap, toSnap] = await Promise.all([
    db.collection("players").doc(fromUserId).get(),
    db.collection("players").doc(toUserId).get(),
  ]);

  if (!fromSnap.exists || !toSnap.exists) {
    console.log("❌ One or both player documents not found.");
    return;
  }

  const fromPostcode = fromSnap.data()?.postcode;
  const toPostcode = toSnap.data()?.postcode;

  const [fromCoordSnap, toCoordSnap] = await Promise.all([
    db.collection("postcodes").doc(fromPostcode).get(),
    db.collection("postcodes").doc(toPostcode).get(),
  ]);

  if (!fromCoordSnap.exists || !toCoordSnap.exists) {
    console.log("❌ One or both postcode documents not found.");
    return;
  }

  const fromCoords = fromCoordSnap.data();
  const toCoords = toCoordSnap.data();

  if (!fromCoords || !toCoords) {
    console.log("❌ Missing lat/lng in postcode data.");
    return;
  }

  const midpoint = {
    lat: (fromCoords.lat + toCoords.lat) / 2,
    lng: (fromCoords.lng + toCoords.lng) / 2,
  };

  console.log(`🧭 Midpoint: (${midpoint.lat}, ${midpoint.lng})`);

  const courtsSnap = await db.collection("courts").get();
  console.log(`🔎 Starting court loop. Total courts: ${courtsSnap.size}`);
  let nearestCourt: Court | null = null;
  let minDistance = Infinity;

  for (const doc of courtsSnap.docs) {
    const court = doc.data();
    const rawLat = court.lat;
    const rawLng = court.lng;
    const courtLat = typeof rawLat === "string" ? parseFloat(rawLat) : rawLat;
    const courtLng = typeof rawLng === "string" ? parseFloat(rawLng) : rawLng;

    console.log(`➡️ Evaluating court: ${court.name} (${doc.id})`);
    console.log(`   Raw lat/lng: lat=${rawLat}, lng=${rawLng} → Parsed lat=${courtLat}, lng=${courtLng}`);

    if (
      typeof courtLat !== "number" ||
      typeof courtLng !== "number" ||
      isNaN(courtLat) ||
      isNaN(courtLng)
    ) {
      console.log(`⚠️ Skipping court due to invalid coordinates`);
      continue;
    }

    const distance = calculateDistance(midpoint, { lat: courtLat, lng: courtLng });
    console.log(`📍 ${court.name} is ${distance.toFixed(2)} km from midpoint`);

    if (distance < minDistance) {
      console.log(`🎯 This is the new closest court so far`);
      minDistance = distance;
      nearestCourt = {
        id: doc.id,
        name: court.name,
        lat: courtLat,
        lng: courtLng,
      };
    }
  }

  if (!nearestCourt) {
    console.log("❌ No courts found or all are too far.");
    return;
  }

  console.log(`✅ Nearest court: ${nearestCourt.name} (${minDistance.toFixed(2)} km)`);

  await db.collection("match_requests").doc(context.matchId).update({
    suggestedCourtId: nearestCourt.id,
    suggestedCourtName: nearestCourt.name,
    suggestedCourtLat: nearestCourt.lat,
    suggestedCourtLng: nearestCourt.lng,
  });

  console.log(`🎯 Suggested court: ${nearestCourt.name}`);
});

export const testFirestore = onRequest({ region: "australia-southeast2" }, async (req: any, res: any) => {
  try {
    const snap = await db.collection("players").limit(1).get();
    res.send(`✅ Accessed players. Count: ${snap.size}`);
  } catch (err) {
    console.error("❌ Firestore read failed:", err);
    res.status(500).send("Firestore access failed");
  }
});
export const processCompletedMatch = onDocumentCreated(
  "completed_matches/{matchId}",
  async (event) => {
    const data = event.data?.data();
    if (!data) {
      console.log("❌ No match data found in event.");
      return;
    }

    const { winnerId, fromUserId, toUserId, matchId } = data;
    const loserId = winnerId === fromUserId ? toUserId : fromUserId;

    const winnerRef = db.collection("players").doc(winnerId);
    const loserRef = db.collection("players").doc(loserId);

    const [winnerSnap, loserSnap] = await Promise.all([
      winnerRef.get(),
      loserRef.get(),
    ]);

    const winnerData = winnerSnap.data() || {};
    const loserData = loserSnap.data() || {};

    // Update stats
    await Promise.all([
      winnerRef.update({
        matchesPlayed: (winnerData.matchesPlayed || 0) + 1,
        matchesWon: (winnerData.matchesWon || 0) + 1,
      }),
      loserRef.update({
        matchesPlayed: (loserData.matchesPlayed || 0) + 1,
      }),
    ]);

    // Award badges
    const badgeUpdates = [
      fromUserId,
      toUserId,
    ].map((uid) =>
      db.collection("players").doc(uid).set(
        {
          badges: admin.firestore.FieldValue.arrayUnion("firstMatchComplete"),
        },
        { merge: true }
      )
    );

    badgeUpdates.push(
      db
        .collection("players")
        .doc(winnerId)
        .set(
          {
            badges: admin.firestore.FieldValue.arrayUnion("firstWin"),
          },
          { merge: true }
        )
    );

    await Promise.all(badgeUpdates);

    console.log(`✅ Processed completed match: ${matchId}`);
  }
);
export const sendPushNotification = onDocumentCreated(
  "notifications/{notifId}",
  async (event) => {
    const notifData = event.data?.data();
    if (!notifData) {
      console.log("❌ Notification data missing");
      return;
    }

    const recipientId = notifData.recipientId;
    const tokenDoc = await db.collection("device_tokens").doc(recipientId).get();

    if (!tokenDoc.exists) {
      console.log(`❌ No device token found for user: ${recipientId}`);
      return;
    }

    const token = tokenDoc.data()?.token;
    if (!token) {
      console.log(`❌ Token field missing for user: ${recipientId}`);
      return;
    }

const payload = {
  data: {
    title: notifData.message || "🎾 TennisMate Notification",
    body: "You have a new notification",
    type: notifData.type || "general",
    fromUserId: notifData.fromUserId || "",
    url: notifData.url || "https://tennis-match.com.au",
  },
};

    try {
      console.log("📲 Sending push to token:", token);
      await admin.messaging().send({ token, ...payload });
      console.log(`✅ Notification sent to ${recipientId}`);
    } catch (error: any) {
      console.error("❌ Failed to send push notification:", error);

      if (
        error.code === "messaging/invalid-registration-token" ||
        error.code === "messaging/registration-token-not-registered"
      ) {
        await db.collection("device_tokens").doc(recipientId).delete();
        console.log(`🧹 Deleted invalid FCM token for ${recipientId}`);
      }
    }
  }
);
export const notifyOnNewMessage = onDocumentCreated(
  "conversations/{conversationId}/messages/{messageId}",
  async (event) => {
    const message = event.data?.data();
    const { conversationId } = event.params;

    if (!message) return;

    const senderId = message.senderId as string;
    const recipientId = message.recipientId as string;
    const text = message.text as string;
    const read = message.read as boolean;

    if (!recipientId || !text || read === true) return;

    // ✅ Get token from device_tokens
  const tokenQuery = await db
  .collection("device_tokens")
  .where("uid", "==", recipientId)
  .limit(1)
  .get();

  

const fcmToken = tokenQuery.empty ? null : tokenQuery.docs[0].get("token");
console.log(`📲 Retrieved token: ${fcmToken}`);
    if (!fcmToken) {
      console.log(`❌ No FCM token found for ${recipientId}`);
      return;
    }

    const userSnap = await db.collection("users").doc(recipientId).get();
    const activeConversationId = userSnap.get("activeConversationId");

    if (activeConversationId === conversationId) {
      console.log(`👀 User is viewing this conversation. No push sent.`);
      return;
    }

    const senderDoc = await db.collection("players").doc(senderId).get();
    const senderName = senderDoc.get("name") || "A player";

try {
  await admin.messaging().send({
    token: fcmToken,
    data: {
      title: `New message from ${senderName}`,
      body: text.length > 60 ? text.slice(0, 60) + "…" : text,
      url: "https://tennismate.vercel.app/messages",
      type: "new_message",
      conversationId,
      fromUserId: senderId,
    },
  });

  console.log(`✅ Push sent to ${recipientId}`);
} catch (error) {
  console.error("❌ Failed to send push notification:", error);
}

  }
);


export const sendMatchRequestNotification = onDocumentCreated(
  "match_requests/{matchId}",
  async (event) => {
    const data = event.data?.data();
    if (!data) return;

    const { toUserId, fromUserId } = data;

    // Get recipient's FCM token
    const tokenSnap = await db
      .collection("device_tokens")
      .where("uid", "==", toUserId)
      .limit(1)
      .get();

    const fcmToken = tokenSnap.empty ? null : tokenSnap.docs[0].get("token");

    if (!fcmToken) {
      console.log(`❌ No FCM token found for user ${toUserId}`);
      return;
    }

    // Get sender name
    const senderDoc = await db.collection("players").doc(fromUserId).get();
    const senderName = senderDoc.exists ? senderDoc.get("name") : "A player";

    try {
      // Send push notification
      await admin.messaging().send({
        token: fcmToken,
        data: {
          title: "New match request!",
          body: `${senderName} has challenged you to a match.`,
          url: "https://tennismate.vercel.app/matches",
          type: "match_request",
          matchId: event.params.matchId,
          fromUserId,
        },
      });

      console.log(`✅ Match request notification sent to ${toUserId}`);
    } catch (error) {
      console.error("❌ Failed to send match request push notification:", error);
    }
  }
);
export const notifyMatchAccepted = onDocumentUpdated(
  "match_requests/{matchId}",
  async (event) => {
    const before = event.data?.before?.data();
    const after = event.data?.after?.data();

    if (!before || !after) return;
    if (before.status === "accepted" || after.status !== "accepted") return;

    const { fromUserId } = after;
    const matchId = event.params.matchId;

    // Get recipient name
    const recipientSnap = await db.collection("players").doc(after.toUserId).get();
    const recipientName = recipientSnap.exists ? recipientSnap.get("name") : "A player";

    // ✅ Create Firestore notification (let sendPushNotification handle the push)
    await db.collection("notifications").add({
      recipientId: fromUserId,
      matchId,
      message: `${recipientName} accepted your match request!`,
      type: "match_accepted",
      url: "https://tennismate.vercel.app/matches",
      timestamp: admin.firestore.FieldValue.serverTimestamp(),
      read: false,
    });

    console.log(`✅ Match accepted notification created for ${fromUserId}`);
  }
);
exports.sendEventRemindersV2 = sendEventRemindersV2;