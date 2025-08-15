import { setGlobalOptions } from "firebase-functions/v2";
import { onDocumentCreated, onDocumentUpdated } from "firebase-functions/v2/firestore";
import { onRequest } from "firebase-functions/v2/https";
import * as admin from "firebase-admin";
import { onSchedule } from "firebase-functions/v2/scheduler";


// ✅ Cloud Functions v2 supports australia-southeast1 (Sydney)
setGlobalOptions({ maxInstances: 10, region: "australia-southeast1" });

admin.initializeApp();
const db = admin.firestore();
const APP_BASE_URL = "https://tennismate-s7vk.vercel.app";
const URLS = {
  messages: `${APP_BASE_URL}/messages`,
  matches:  `${APP_BASE_URL}/matches`,
};

const DEFAULT_AVATAR_URL = `${APP_BASE_URL}/images/default-avatar.jpg`;

// Send ONE email if a message stays unread for this long (minutes)
const UNREAD_EMAIL_DELAY_MINUTES =
  Number(process.env.UNREAD_EMAIL_DELAY_MINUTES) || 30;


interface Court {
  id: string;
  name: string;
  lat: number;
  lng: number;
}

type EmailPrefs = {
  matchRequest?: boolean;
  requestAccepted?: boolean;
  messageReceived?: boolean;
};



async function getUserProfile(uid: string) {
  const [userSnap, playerSnap] = await Promise.all([
    db.doc(`users/${uid}`).get(),
    db.doc(`players/${uid}`).get(),
  ]);

  const email = userSnap.get("email") as string | undefined;
  const prefs = (userSnap.get("emailPrefs") || {}) as EmailPrefs;
  const name =
    playerSnap.get("name") ||
    userSnap.get("name") ||
    userSnap.get("username") ||
    "a player";

  return { email, prefs, name };
}

export const queueTestEmail = onRequest({ region: "australia-southeast1" }, async (_req, res) => {
  const db = admin.firestore();
  await db.collection("mail").add({
    to: ["william.ray.bourke@gmail.com"], // change to your inbox for the test
    message: {
      subject: "TennisMate test (server)",
      text: "Hello from TennisMate via Trigger Email"
    }
  });
  res.send("Queued test email to /mail.");
});

async function queueEmail(to: string[], subject: string, html: string, text?: string) {
  await db.collection("mail").add({
    to,
    message: {
      subject,
      html,
      text: text || html.replace(/<[^>]+>/g, " "),
    },
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
  });
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

/* =========================
 *  COURT SUGGESTION (OK)
 * ========================= */
export const suggestCourtOnMatch = onDocumentUpdated("match_requests/{matchId}", async (event) => {
  const before = event.data?.before?.data();
  const after = event.data?.after?.data();
  const context = event.params;

  console.log("📌 Trigger fired for match:", context.matchId);

  if (!before || !after) return;
  if (before.status === "accepted") return;
  if (after.status !== "accepted") return;
  if (after.suggestedCourtId) return;

  console.log("✅ Valid update — finding suggested court...");

  const [fromUserId, toUserId] = [after.fromUserId, after.toUserId];
  const [fromSnap, toSnap] = await Promise.all([
    db.collection("players").doc(fromUserId).get(),
    db.collection("players").doc(toUserId).get(),
  ]);
  if (!fromSnap.exists || !toSnap.exists) return;

  const fromPostcode = fromSnap.data()?.postcode;
  const toPostcode = toSnap.data()?.postcode;

  const [fromCoordSnap, toCoordSnap] = await Promise.all([
    db.collection("postcodes").doc(fromPostcode).get(),
    db.collection("postcodes").doc(toPostcode).get(),
  ]);
  if (!fromCoordSnap.exists || !toCoordSnap.exists) return;

  const fromCoords = fromCoordSnap.data();
  const toCoords = toCoordSnap.data();
  if (!fromCoords || !toCoords) return;

  const midpoint = {
    lat: (fromCoords.lat + toCoords.lat) / 2,
    lng: (fromCoords.lng + toCoords.lng) / 2,
  };

  const courtsSnap = await db.collection("courts").get();
  let nearestCourt: Court | null = null;
  let minDistance = Infinity;

  for (const doc of courtsSnap.docs) {
    const court = doc.data();
    const rawLat = court.lat;
    const rawLng = court.lng;
    const courtLat = typeof rawLat === "string" ? parseFloat(rawLat) : rawLat;
    const courtLng = typeof rawLng === "string" ? parseFloat(rawLng) : rawLng;

    if (
      typeof courtLat !== "number" ||
      typeof courtLng !== "number" ||
      isNaN(courtLat) ||
      isNaN(courtLng)
    ) {
      continue;
    }

    const distance = calculateDistance(midpoint, { lat: courtLat, lng: courtLng });
    if (distance < minDistance) {
      minDistance = distance;
      nearestCourt = { id: doc.id, name: court.name, lat: courtLat, lng: courtLng };
    }
  }

  if (!nearestCourt) return;

  await db.collection("match_requests").doc(context.matchId).update({
    suggestedCourtId: nearestCourt.id,
    suggestedCourtName: nearestCourt.name,
    suggestedCourtLat: nearestCourt.lat,
    suggestedCourtLng: nearestCourt.lng,
  });

  console.log(`🎯 Suggested court: ${nearestCourt.name} (${minDistance.toFixed(2)} km)`);
});

/* =========================
 *  SIMPLE HTTP TEST (fix region)
 * ========================= */
export const testFirestore = onRequest({ region: "australia-southeast1" }, async (_req, res) => {
  try {
    const snap = await db.collection("players").limit(1).get();
    res.send(`✅ Accessed players. Count: ${snap.size}`);
  } catch (err) {
    console.error("❌ Firestore read failed:", err);
    res.status(500).send("Firestore access failed");
  }
});

// Set default avatar when a new player doc is created (if missing)
export const setDefaultAvatarOnPlayerCreate = onDocumentCreated(
  "players/{uid}",
  async (event) => {
    const snap = event.data;
    if (!snap) return;
    const data = snap.data() || {};
    const photoURL = (data.photoURL ?? "").toString().trim();
    if (!photoURL) {
      await snap.ref.set({ photoURL: DEFAULT_AVATAR_URL }, { merge: true });
      console.log(`🖼️ set default avatar on players/${event.params.uid}`);
    }
  }
);

// Set default avatar when a new user doc is created (if missing)
export const setDefaultAvatarOnUserCreate = onDocumentCreated(
  "users/{uid}",
  async (event) => {
    const snap = event.data;
    if (!snap) return;
    const data = snap.data() || {};
    const photoURL = (data.photoURL ?? "").toString().trim();
    if (!photoURL) {
      await snap.ref.set({ photoURL: DEFAULT_AVATAR_URL }, { merge: true });
      console.log(`🖼️ set default avatar on users/${event.params.uid}`);
    }
  }
);

export const backfillDefaultAvatars = onRequest(
  { region: "australia-southeast1", timeoutSeconds: 540 },
  async (_req, res) => {
    let updatedPlayers = 0;
    let scannedPlayers = 0;
    let updatedUsers = 0;
    let scannedUsers = 0;

    // helper to scan a collection in pages and set default where missing/blank
    async function backfillCollection(colName: "players" | "users") {
      let updated = 0;
      let scanned = 0;
      const pageSize = 400;

      let lastDoc: FirebaseFirestore.QueryDocumentSnapshot | null = null;

      while (true) {
        let q = db.collection(colName)
          .orderBy(admin.firestore.FieldPath.documentId())
          .limit(pageSize);
        if (lastDoc) q = q.startAfter(lastDoc);

        const snap = await q.get();
        if (snap.empty) break;

        const batch = db.batch();
        let writes = 0;

        for (const docSnap of snap.docs) {
          scanned++;
          const data = docSnap.data() || {};
          const url = (data.photoURL ?? "").toString().trim();
          if (!url) {
            batch.set(docSnap.ref, { photoURL: DEFAULT_AVATAR_URL }, { merge: true });
            updated++;
            writes++;
          }
        }

        if (writes > 0) await batch.commit();
        lastDoc = snap.docs[snap.docs.length - 1];

        // simple yield
        await new Promise((r) => setTimeout(r, 50));
      }

      return { updated, scanned };
    }

    try {
      const p = await backfillCollection("players");
      updatedPlayers = p.updated;
      scannedPlayers = p.scanned;

      const u = await backfillCollection("users");
      updatedUsers = u.updated;
      scannedUsers = u.scanned;

      res.status(200).send(
        `✅ Backfill done.
Players: scanned=${scannedPlayers}, updated=${updatedPlayers}
Users:   scanned=${scannedUsers}, updated=${updatedUsers}
Default URL: ${DEFAULT_AVATAR_URL}`
      );
    } catch (e) {
      console.error("Backfill error:", e);
      res.status(500).send("Backfill failed. See logs.");
    }
  }
);


/* =========================
 *  MATCH COMPLETED (OK)
 * ========================= */
export const processCompletedMatch = onDocumentCreated(
  "completed_matches/{matchId}",
  async (event) => {
    const data = event.data?.data();
    if (!data) return;

    const { winnerId, fromUserId, toUserId, matchId } = data;
    const loserId = winnerId === fromUserId ? toUserId : fromUserId;

    const winnerRef = db.collection("players").doc(winnerId);
    const loserRef = db.collection("players").doc(loserId);

    const [winnerSnap, loserSnap] = await Promise.all([winnerRef.get(), loserRef.get()]);
    const winnerData = winnerSnap.data() || {};
    const loserData = loserSnap.data() || {};

    await Promise.all([
      winnerRef.update({
        matchesPlayed: (winnerData.matchesPlayed || 0) + 1,
        matchesWon: (winnerData.matchesWon || 0) + 1,
      }),
      loserRef.update({
        matchesPlayed: (loserData.matchesPlayed || 0) + 1,
      }),
    ]);

    const badgeUpdates = [fromUserId, toUserId].map((uid) =>
      db.collection("players").doc(uid).set(
        { badges: admin.firestore.FieldValue.arrayUnion("firstMatchComplete") },
        { merge: true }
      )
    );
    badgeUpdates.push(
      db.collection("players").doc(winnerId).set(
        { badges: admin.firestore.FieldValue.arrayUnion("firstWin") },
        { merge: true }
      )
    );

    await Promise.all(badgeUpdates);
    console.log(`✅ Processed completed match: ${matchId}`);
  }
);

/* =========================
 *  PUSH: GENERAL NOTIFICATION
 * ========================= */
export const sendPushNotification = onDocumentCreated(
  "notifications/{notifId}",
  async (event) => {
    const notifData = event.data?.data();
    if (!notifData) {
      console.log("❌ Notification data missing");
      return;
    }

    const recipientId = notifData.recipientId as string | undefined;
    if (!recipientId) {
      console.log("❌ Missing recipientId");
      return;
    }

    // Using query by uid to match other places
    const tokenSnap = await db.collection("device_tokens")
      .where("uid", "==", recipientId)
      .limit(1)
      .get();

    const fcmToken = tokenSnap.empty ? null : tokenSnap.docs[0].get("token");
    if (!fcmToken) {
      console.log(`❌ No FCM token found for user: ${recipientId}`);
      return;
    }

    const payload = {
      token: fcmToken,
      data: {
        title: (notifData.message as string) || "🎾 TennisMate Notification",
        body: "You have a new notification",
        type: (notifData.type as string) || "general",
        fromUserId: (notifData.fromUserId as string) || "",
        url: (notifData.url as string) || "https://tennismate-s7vk.vercel.app/",
      },
    };

    try {
      console.log("📲 Sending push to token:", fcmToken);
      await admin.messaging().send(payload);
      console.log(`✅ Notification sent to ${recipientId}`);
    } catch (error: any) {
      console.error("❌ Failed to send push notification:", error);
      if (
        error.code === "messaging/invalid-registration-token" ||
        error.code === "messaging/registration-token-not-registered"
      ) {
        // Clean up bad token docs (adjust to your schema)
        const bad = tokenSnap.docs[0].ref;
        await bad.delete();
        console.log(`🧹 Deleted invalid FCM token for ${recipientId}`);
      }
    }
  }
);

/* =========================
 *  PUSH: NEW MESSAGE
 * ========================= */
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

    const tokenQuery = await db
      .collection("device_tokens")
      .where("uid", "==", recipientId)
      .limit(1)
      .get();

    const fcmToken = tokenQuery.empty ? null : tokenQuery.docs[0].get("token");
    console.log(`📲 Retrieved token: ${fcmToken}`);
    if (!fcmToken) return;

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
          url: "https://tennismate-s7vk.vercel.app/messages",
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

/* =========================
 *  PUSH: NEW MATCH REQUEST
 * ========================= */
export const sendMatchRequestNotification = onDocumentCreated(
  "match_requests/{matchId}",
  async (event) => {
    const data = event.data?.data();
    if (!data) return;

    const { toUserId, fromUserId } = data;

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

    const senderDoc = await db.collection("players").doc(fromUserId).get();
    const senderName = senderDoc.exists ? senderDoc.get("name") : "A player";

    try {
      await admin.messaging().send({
        token: fcmToken,
        data: {
          title: "New match request!",
          body: `${senderName} has challenged you to a match.`,
          url: "https://tennismate-s7vk.vercel.app/matches",
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

/* =========================
 *  EMAIL: NEW MATCH REQUEST
 * ========================= */
export const emailOnMatchRequestCreated = onDocumentCreated(
  "match_requests/{matchId}",
  async (event) => {
    const data = event.data?.data();
    if (!data) return;

    const { toUserId, fromUserId } = data;
    if (!toUserId || !fromUserId) return;

    const [to, from] = await Promise.all([
      getUserProfile(toUserId),
      getUserProfile(fromUserId),
    ]);
    if (!to.email || to.prefs.matchRequest === false) return;

    const matchRef = db.doc(`match_requests/${event.params.matchId}`);
    const matchSnap = await matchRef.get();
    if (matchSnap.get("emailFlags?.requestCreated")) return;

const subject = `🎾 New match request from ${from.name}`;
const url = URLS.matches;
const html = `
  <p>Hi ${to.name},</p>
  <p><b>${from.name}</b> sent you a match request on TennisMate.</p>
  <p><a href="${url}">Open matches</a></p>
  <p>— TennisMate</p>
`;
const text = `Hi ${to.name}, ${from.name} sent you a match request on TennisMate. Open matches: ${url} — TennisMate`;

console.log("✉️ emailOnMatchRequestCreated link:", url);
await queueEmail([to.email], subject, html, text);

    await matchRef.set({ emailFlags: { requestCreated: true } }, { merge: true });
  }
);

/* =========================
 *  EMAIL: MATCH ACCEPTED
 * ========================= */
export const emailOnMatchAccepted = onDocumentUpdated(
  "match_requests/{matchId}",
  async (event) => {
    const before = event.data?.before?.data();
    const after = event.data?.after?.data();
    if (!before || !after) return;

    if (before.status === "accepted" || after.status !== "accepted") return;

    const requesterId = after.fromUserId;
    const accepterId = after.toUserId;
    if (!requesterId || !accepterId) return;

    const [requester, accepter] = await Promise.all([
      getUserProfile(requesterId),
      getUserProfile(accepterId),
    ]);
    if (!requester.email || requester.prefs.requestAccepted === false) return;

    const matchRef = db.doc(`match_requests/${event.params.matchId}`);
    const matchSnap = await matchRef.get();
    if (matchSnap.get("emailFlags?.requestAccepted")) return;

const subject = `✅ ${accepter.name} accepted your match request`;
const url = URLS.matches;
const html = `
  <p>Hi ${requester.name},</p>
  <p><b>${accepter.name}</b> accepted your match request. Time to organise the details!</p>
  <p><a href="${url}">Open matches</a></p>
  <p>— TennisMate</p>
`;
const text = `Hi ${requester.name}, ${accepter.name} accepted your match request. Open matches: ${url} — TennisMate`;

console.log("✉️ emailOnMatchAccepted link:", url);
await queueEmail([requester.email], subject, html, text);

    await matchRef.set({ emailFlags: { requestAccepted: true } }, { merge: true });
  }
);

/* =========================
 *  EMAIL: NEW MESSAGE (10-min throttle)
 * ========================= */
/* =========================
 *  EMAIL: NEW MESSAGE (schedule single unread reminder)
 * ========================= */
export const emailOnNewMessage = onDocumentCreated(
  "conversations/{conversationId}/messages/{messageId}",
  async (event) => {
    const msg = event.data?.data();
    if (!msg) return;

    const { conversationId } = event.params;
    const senderId = msg.senderId as string;
    const text = (msg.text || "").toString();

    const convRef = db.doc(`conversations/${conversationId}`);
    const convSnap = await convRef.get();
    const participants: string[] = convSnap.get("participants") || [];

    const targets = participants.filter((u) => u !== senderId);

    // Resolve sender name (for subject/snippet)
    const senderName =
      (await db.doc(`players/${senderId}`).get()).get("name") || "a player";
    const preview = text.slice(0, 120);

    // For each recipient, anchor ONE reminder at first unread
    await Promise.all(
      targets.map(async (uid) => {
        // If user is actively viewing this conversation, skip & clear any pending reminder
        const userSnap = await db.doc(`users/${uid}`).get();
        const active = userSnap.get("activeConversationId");
        if (active === conversationId) {
          // best-effort cleanup + mark read
          await db
            .doc(`email_reminders/${uid}_${conversationId}`)
            .delete()
            .catch(() => {});

          return;
        }

        // Record first unread time for this user if not set
        if (!convSnap.exists || !convSnap.get(`firstUnreadAt.${uid}`)) {
        }

        // Create a reminder doc ONLY if not already scheduled
        const reminderRef = db.doc(`email_reminders/${uid}_${conversationId}`);
        await db.runTransaction(async (t) => {
          const r = await t.get(reminderRef);
          if (r.exists && r.get("sent") === false) return; // already scheduled

          const scheduledAt = admin.firestore.Timestamp.fromDate(
            new Date(Date.now() + UNREAD_EMAIL_DELAY_MINUTES * 60 * 1000)
          );

          t.set(reminderRef, {
            uid,
            conversationId,
            scheduledAt,
            createdAt: admin.firestore.FieldValue.serverTimestamp(),
            sent: false,
            // helpful context for the email
            lastMessageSnippet: preview,
            senderName,
          });
        });
      })
    );
  }
);

/* =========================
 *  CRON: deliver unread-message emails
 * ========================= */
export const deliverUnreadMessageEmails = onSchedule(
  {
    schedule: "every 5 minutes",
    timeZone: "Australia/Melbourne",
    region: "australia-southeast1",
  },
  async () => {
    const now = admin.firestore.Timestamp.now();

    // Due, unsent reminders
    const q = await db
      .collection("email_reminders")
      .where("sent", "==", false)
      .where("scheduledAt", "<=", now)
      .limit(50)
      .get();

    if (q.empty) return;

    for (const r of q.docs) {
      const { uid, conversationId, senderName, lastMessageSnippet } = r.data() as {
        uid: string;
        conversationId: string;
        senderName?: string;
        lastMessageSnippet?: string;
      };

      // Verify the conversation is still unread for this user
      const conv = await db.doc(`conversations/${conversationId}`).get();
      const lastMessageAt = conv.get("lastMessageAt");
      const lastReadAt = conv.get(`lastRead.${uid}`);

      const isRead =
        lastReadAt && lastMessageAt &&
        lastReadAt.toMillis() >= lastMessageAt.toMillis();

      if (isRead) {
        await r.ref.delete(); // cleanup: no email needed
        continue;
      }

      // Load recipient profile & prefs
      const { email, prefs, name } = await getUserProfile(uid);
      if (!email || prefs.messageReceived === false) {
        await r.ref.delete(); // don't retry forever if we can't/shouldn't email
        continue;
      }

      // Build and queue email (uses your Trigger Email /mail collection)
      const subject = `💬 New message from ${senderName || "a player"}`;
      const url = URLS.messages; // or `${URLS.messages}/${conversationId}` if you want deep-link
      const html = `
        <p>Hi ${name},</p>
        <p>You have an unread message.</p>
        ${lastMessageSnippet ? `<blockquote>${lastMessageSnippet}</blockquote>` : ""}
        <p><a href="${url}">Open messages</a></p>
        <p>— TennisMate</p>
      `;
      const text = `Hi ${name}, you have an unread message. Open messages: ${url} — TennisMate`;

      await queueEmail([email], subject, html, text);

      await r.ref.update({
        sent: true,
        sentAt: admin.firestore.FieldValue.serverTimestamp(),
      });
    }
  }
);


