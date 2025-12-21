import { setGlobalOptions } from "firebase-functions/v2";
import * as admin from "firebase-admin";
import { onDocumentCreated, onDocumentUpdated } from "firebase-functions/v2/firestore";
import { sendEventRemindersV2 } from "./eventReminders";
import { onRequest } from "firebase-functions/v2/https";
import * as crypto from "crypto";
import { onSchedule } from "firebase-functions/v2/scheduler";


// ✅ Set correct region for Firestore: australia-southeast2
setGlobalOptions({ maxInstances: 10, region: "australia-southeast2" });

if (admin.apps.length === 0) {
  admin.initializeApp();
}
const db = admin.firestore();

// --- Route helper (handles absolute URLs and relative paths) ---
function toRoute(input?: unknown): string {
  if (typeof input !== "string" || !input) return "/";
  if (input.startsWith("/")) return input; // already a route
  try {
    return new URL(input).pathname || "/";
  } catch {
    return "/";
  }
}


// ---------- PUSH HELPERS (native first, web fallback) ----------
// Use fcmToken field when present; fall back to doc id.
async function getAndroidTokensForUser(uid: string): Promise<string[]> {
  // 👇 still named "Android", but now returns ALL native (android + ios) tokens
  const snap = await db.collection("users").doc(uid).collection("devices").get();
  const tokens: string[] = [];

  snap.forEach((d) => {
    const platform = (d.get("platform") as string) || "web";

    // ✅ include both android AND ios, skip web / other
    if (platform !== "android" && platform !== "ios") return;

    const tokenInDoc = d.get("fcmToken") as string | undefined;
    const token = tokenInDoc || d.id;
    if (token) tokens.push(token);
  });

  console.log("[PushFn] native tokens for user", uid, tokens);
  return tokens;
}


/**
 * True if user has at least one Android device doc with a valid token and push not disabled.
 * Expects device docs at users/{uid}/devices/{deviceId} with fields:
 *   platform: "android" | "web"
 *   fcmToken?: string
 *   notificationsEnabled?: boolean
 *   pushOptOut?: boolean
 *   revoked?: boolean
 */
async function hasActiveAndroidPush(uid: string): Promise<boolean> {
  // 👇 now really "hasActiveNativePush": android OR ios
  const snap = await db
    .collection("users")
    .doc(uid)
    .collection("devices")
    .get();

  if (snap.empty) return false;

  for (const d of snap.docs) {
    const platform = (d.get("platform") as string) || "web";

    // ✅ only treat android + ios as "native push"
    if (platform !== "android" && platform !== "ios") continue;

    const disabled =
      d.get("notificationsEnabled") === false || d.get("pushOptOut") === true;
    const revoked = d.get("revoked") === true;
    const tokenInDoc = d.get("fcmToken") as string | undefined;
    const token = tokenInDoc || d.id;

    if (token && !disabled && !revoked) {
      console.log("[PushFn] hasActiveNativePush = true for", uid, {
        platform,
        deviceId: d.id,
      });
      return true;
    }
  }

  console.log("[PushFn] hasActiveNativePush = false for", uid);
  return false;
}


/** Convenience: returns true only if we SHOULD send email. */
async function shouldEmailUser(uid: string): Promise<boolean> {
  const androidActive = await hasActiveAndroidPush(uid);
  return !androidActive; // email only when Android push is NOT active
}


async function sendAndroidPushToUser(
  uid: string,
  payload: { title: string; body: string; route?: string; type?: string }
): Promise<boolean> {
  const tokens = await getAndroidTokensForUser(uid);
  if (!tokens.length) return false;

  const message: admin.messaging.MulticastMessage = {
    tokens,
    // Top-level notification (for older clients / general fallback)
    notification: {
      title: payload.title,
      body: payload.body,
    },
    // Data your app reads for deep links & meta
    data: {
      ...(payload.route ? { route: payload.route } : {}),
      ...(payload.type ? { type: payload.type } : {}),
    },
    // Android-specific polish
android: {
  priority: "high",
  collapseKey: payload.type || "general",
  notification: {
    channelId: "messages",
    icon: "ic_stat_tm",
    color: "#10B981",
    sound: "tennis_ball_hit",   // <-- plays res/raw/tennis_ball_hit.ogg
    visibility: "public",
  },
},

 apns: {
      payload: {
        aps: {
          sound: "tennis_ball_hit.wav", // 👈 EXACT filename in Xcode
          // badge, alert, etc. can also go here if you want later
        },
      },
    },
  };

  const res = await admin.messaging().sendEachForMulticast(message);

  // Clean up invalid tokens to keep lists healthy
  await Promise.all(
    res.responses.map(async (r, i) => {
      if (!r.success) {
        const code = (r as any).error?.code as string | undefined;
        if (
          code === "messaging/registration-token-not-registered" ||
          code === "messaging/invalid-registration-token"
        ) {
          const bad = tokens[i];
          try {
            await db.collection("users").doc(uid).collection("devices").doc(bad).delete();
            console.log("🧹 Removed invalid Android token", { uid, token: bad });
          } catch {}
        }
      }
    })
  );

  return true;
}


/** If you already have VAPID web push, call it here. Otherwise this can be a no-op. */
async function sendWebPushToUser(
  uid: string,
  payload: { title: string; body: string; route?: string; type?: string }
): Promise<boolean> {
  // TODO: hook into your existing web-push code if applicable.
  // Return true if a web push was sent.
  return false;
}


// ---------- EMAIL HELPERS (Trigger Email extension) ----------
const MAIL_COLLECTION = "mail"; // extension watches this

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


async function enqueueEmail(
  to: string,
  subject: string,
  html: string,
  text?: string,
  meta?: Record<string, any> // allows tagging emails for debugging
) {
  await db.collection(MAIL_COLLECTION).add({
    to,
    message: {
      subject,
      html,
      text: text ?? html.replace(/<[^>]+>/g, " "),
    },
    ...meta,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
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

// ✋ Suppress email if host has active Android push
const emailAllowed = await shouldEmailUser(hostId);
if (!emailAllowed) {
  console.log("📭 Suppressing host email (active Android push).", { hostId });
  await db
    .collection("events")
    .doc(eventId)
    .collection("join_requests")
    .doc(reqId)
    .set({ emailHostNotified: true }, { merge: true });
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

    console.log(`📧 Emailing host ${hostEmail} about join request for event ${eventId}`);


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

// ✋ Suppress email if requester has active Android push
const emailAllowed = await shouldEmailUser(requesterId);
if (!emailAllowed) {
  console.log("📭 Suppressing requester email (active Android push).", { requesterId });
  await db
    .collection("events")
    .doc(eventId)
    .collection("join_requests")
    .doc(reqId)
    .set({ emailAcceptedNotified: true }, { merge: true });
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

export const nudgePendingMatchRequests = onSchedule("every 60 minutes", async () => {
  const now = Date.now();
  const cutoff = new Date(now - 48 * 60 * 60 * 1000); // 48 hours ago

  console.log("[Nudge] Running. Cutoff:", cutoff.toISOString());

  // Only look at still-pending requests.
  // (Adjust if your pending status is different.)
  const snap = await db
    .collection("match_requests")
    .where("status", "==", "unread")
    .get();

  if (snap.empty) {
    console.log("[Nudge] No pending match requests found.");
    return;
  }

  // Filter in-memory because timestamp comparisons can be tricky if some docs have null timestamps.
  const candidates = snap.docs
    .map((d) => ({ id: d.id, ...d.data() } as any))
    .filter((r) => {
      if (r.nudgeSent === true) return false;
      const ts = r.timestamp?.toDate?.() ? r.timestamp.toDate() : null;
      if (!ts) return false; // no timestamp = skip
      return ts <= cutoff;
    });

  console.log(`[Nudge] Candidates: ${candidates.length}`);

  for (const req of candidates) {
    const matchId = req.id;
    const toUserId = req.toUserId as string | undefined;
    const fromName = (req.fromName as string | undefined) ?? "Someone";

    if (!toUserId) {
      console.log("[Nudge] Skipping (missing toUserId):", matchId);
      continue;
    }

    const reqRef = db.collection("match_requests").doc(matchId);

    // Transaction makes this idempotent even if the scheduler overlaps / retries.
    await db.runTransaction(async (tx) => {
      const fresh = await tx.get(reqRef);
      if (!fresh.exists) return;

      const data = fresh.data() as any;

      // Stop if user already responded or we already nudged
      if (data.nudgeSent === true) return;
      if (data.status !== "unread") return;

      const freshTs = data.timestamp?.toDate?.() ? data.timestamp.toDate() : null;
      if (!freshTs || freshTs > cutoff) return;

      // ✅ Send push (your helper sends to native devices)
      const sent = await sendAndroidPushToUser(toUserId, {
        title: "Reminder",
        body: `${fromName} is waiting for your reply 👀`,
        route: "/messages",          // <-- change if you have a better route for match requests
        type: "match_request_nudge", // helps you debug/segment later
      });

      console.log("[Nudge] Push sent?", sent, { matchId, toUserId });

      // Mark as nudged so it never repeats
      tx.set(
        reqRef,
        {
          nudgeSent: true,
          nudgeSentAt: admin.firestore.FieldValue.serverTimestamp(),
        },
        { merge: true }
      );
    });
  }

  console.log("[Nudge] Done.");
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
    const notifId = event.params.notifId;
    const n = event.data?.data() || {};
    console.log(`[MR_BELL_CONSUMER] push start`, { notifId, type: n.type, source: n.source, runId: n.runId });

const notifData = n;
if (!notifData) return;

// ✅ Hard stop: allows us to suppress push per-notification doc
if (notifData.pushDisabled === true) {
  console.log(`[MR_BELL_CONSUMER] pushDisabled=true, skipping push`, { notifId });
  return;
}

if (notifData.type === "message") {
  console.log(
    `[MR_BELL_CONSUMER] skipping push for message notif ${notifId} (handled by notifyOnNewMessage).`
  );
  return;
}


    if (notifData.recipientId && notifData.fromUserId && notifData.recipientId === notifData.fromUserId) {
      console.log("🛑 Ignoring self-targeted notification doc.");
      return;
    }

    const recipientId = notifData.recipientId as string | undefined;
    if (!recipientId) {
      console.log("❌ Missing recipientId");
      return;
    }

    const title = (notifData.title || notifData.message || "🎾 TennisMate").toString();
    const body = (notifData.body || "You have a new notification").toString();
  const route =
  (typeof notifData.route === "string" && notifData.route)
    ? notifData.route
    : toRoute(notifData.url);


    // 1) Try native Android first
    const nativeSent = await sendAndroidPushToUser(recipientId, {
      title, body, route, type: notifData.type || "general",
    });

    // 2) Fallback to web push if no Android devices
    if (!nativeSent) {
      await sendWebPushToUser(recipientId, {
        title, body, route, type: notifData.type || "general",
      });
    }

    console.log(`✅ sendPushNotification complete (native=${nativeSent}) for ${recipientId}`);
  }
);



export const emailOnNewMessageNotification = onDocumentCreated(
  "notifications/{notifId}",
  async (event) => {
    const notifId = event.params.notifId;
    const n = event.data?.data() || {};
    console.log(`[MR_BELL_CONSUMER] email start`, { notifId, type: n.type, source: n.source, runId: n.runId });

    const notif = n;
    if (!notif) return;

const recipientId = notif.recipientId as string | undefined;
if (!recipientId) return;

const userSnap = await db.collection("users").doc(recipientId).get();
const toEmail = userSnap.exists ? userSnap.get("email") : null;
if (!toEmail) {
  console.log(`❌ No email found for recipient ${recipientId}`);
  return;
}

// ✋ Global gate: suppress all notification emails if Android push is active
const emailAllowed = await shouldEmailUser(recipientId);
if (!emailAllowed) {
  console.log("📭 Suppressing notification email (active Android push).", {
    recipientId,
    type: notif.type
  });
  return;
}


    if (notif.type === "message") {
      const fromName = notif.fromUserId ? await getPlayerName(notif.fromUserId) : "A player";

      const conversationId = notif.conversationId;
      const body = (notif.body || notif.message || "").toString();
      const snippet = body.length > 200 ? body.slice(0, 200) + "…" : body;

      const subject = `New message from ${fromName} 🎾`;
      const html = `
        <p>${fromName} sent you a message:</p>
        <blockquote>${snippet}</blockquote>
        <p><a href="https://tennismate.vercel.app/messages/${conversationId}">Open your conversation</a></p>
        <p style="font-size:12px;color:#777">This is an automated TennisMate message alert.</p>
      `;

      await enqueueEmail(toEmail, subject, html, snippet, {
        category: "msg_direct_notify",
        conversationId,
        fromUserId: notif.fromUserId || "",
        recipientId,
      });
      console.log(`✅ Email sent (message) to ${toEmail}`);
      return;
    }

    if (notif.type === "match_request") {
      const fromName = notif.fromUserId ? await getPlayerName(notif.fromUserId) : "A player";
      const subject = `${fromName} challenged you to a match 🎾`;
      const html = `
        <p>${fromName} has challenged you to a match.</p>
        <p><a href="${notif.url || "https://tennismate.vercel.app/matches"}">Review the match request</a></p>
        <p style="font-size:12px;color:#777">This is an automated TennisMate alert.</p>
      `;
      await enqueueEmail(toEmail, subject, html, undefined, {
        category: "match_request_notify",
        matchId: notif.matchId || "",
        fromUserId: notif.fromUserId || "",
        recipientId,
      });
      console.log(`✅ Email sent (match_request) to ${toEmail}`);
      return;
    }

    if (notif.type === "match_accepted") {
      const subject = `Your match request was accepted 🎉`;
      const html = `
        <p>${notif.message || "Your match request was accepted!"}</p>
        <p><a href="${notif.url || "https://tennismate.vercel.app/matches"}">Open matches</a></p>
        <p style="font-size:12px;color:#777">This is an automated TennisMate alert.</p>
      `;
      await enqueueEmail(toEmail, subject, html, undefined, {
        category: "match_accepted_notify",
        matchId: notif.matchId || "",
        recipientId,
      });
      console.log(`✅ Email sent (match_accepted) to ${toEmail}`);
      return;
    }
  }
);


export const notifyOnNewMessage = onDocumentCreated(
  "conversations/{conversationId}/messages/{messageId}",
  async (event) => {
    const message = event.data?.data();
    const { conversationId, messageId } = event.params;
    if (!message) return;

    const senderId = message.senderId as string;
    const recipientId = message.recipientId as string | null;
    const text = (message.text as string) || "";
    const read = message.read === true;

    if (!recipientId) return;
    if (recipientId === senderId) return;
    if (!text || read) return;

    try {
      // Avoid push if recipient is actively viewing this conversation
      const userSnap = await db.collection("users").doc(recipientId).get();
      const activeConversationId = userSnap.exists ? userSnap.get("activeConversationId") : undefined;
      if (activeConversationId === conversationId) {
        console.log("👀 User is viewing this conversation. No push sent.");
      } else {
        const senderDoc = await db.collection("players").doc(senderId).get();
        const senderName = (senderDoc.exists ? senderDoc.get("name") : "") || "A player";
        const body = text.length > 60 ? text.slice(0, 60) + "…" : text;

        // 1) Try native Android first
        const nativeSent = await sendAndroidPushToUser(recipientId, {
          title: `New message from ${senderName}`,
          body,
          route: `/messages/${conversationId}`,
          type: "new_message",
        });

        // 2) Fallback to web push if no Android devices
        if (!nativeSent) {
          await sendWebPushToUser(recipientId, {
            title: `New message from ${senderName}`,
            body,
            route: `/messages/${conversationId}`,
            type: "new_message",
          });
        }
        console.log(`✅ Push path executed (native=${nativeSent}) for ${recipientId}`);
      }
    } catch (error) {
      console.error("❌ Failed to send push notification:", error);
    }

    // In-app bell doc (drives your email function)
    try {
      const notifId = `msg_${conversationId}_${messageId}_${recipientId}`;
await db.collection("notifications").doc(notifId).set({
  recipientId,
  type: "message",
  conversationId,
  messageId,

  // Keep these for in-app display + email
  title: "New message",
  body: text.length > 100 ? text.slice(0, 100) + "…" : text,
  url: `https://tennismate.vercel.app/messages/${conversationId}`,

  fromUserId: senderId,
  timestamp: admin.firestore.FieldValue.serverTimestamp(),
  read: false,

  // ✅ IMPORTANT: ensure no push is ever sent from a "notifications" watcher for this doc
  pushDisabled: true,
  source: "cf:notifyOnNewMessage",
}, { merge: true });

      console.log(`✅ Bell notification created for ${recipientId}`);
    } catch (err) {
      console.error("❌ Failed to create bell notification:", err);
    }
  }
);


export const sendMatchRequestNotification = onDocumentCreated(
  "match_requests/{matchId}",
  async (event) => {
    const runId = crypto.randomUUID?.() || Math.random().toString(36).slice(2);
    const data = event.data?.data();
    const matchId = event.params.matchId as string;

    console.log(`[MR_BELL][${runId}] trigger start`, {
      fn: "sendMatchRequestNotification",
      matchId,
      region: process.env.GCLOUD_PROJECT ? undefined : "australia-southeast2",
      eventParams: event.params,
      hasData: !!data,
    });

    if (!data) {
      console.log(`[MR_BELL][${runId}] no data → stop`);
      return;
    }

    const { toUserId, fromUserId, bellNotified } = data;
    if (!toUserId || !fromUserId) {
      console.log(`[MR_BELL][${runId}] missing to/from → stop`, { toUserId, fromUserId });
      return;
    }

    const notifId = `matchRequest_${matchId}_${toUserId}`;
    const matchRef = db.collection("match_requests").doc(matchId);
    const notifRef = db.collection("notifications").doc(notifId);

    // Preflight: list any existing bells for this match/recipient
    const dupSnap = await db.collection("notifications")
      .where("type", "==", "match_request")
      .where("matchId", "==", matchId)
      .where("recipientId", "==", toUserId)
      .get();

    console.log(`[MR_BELL][${runId}] preflight`, {
      found: dupSnap.size,
      ids: dupSnap.docs.map(d => d.id),
      bellNotified,
    });

    // If we already see the canonical doc, just mark and exit
    if (dupSnap.docs.some(d => d.id === notifId)) {
      console.log(`[MR_BELL][${runId}] canonical exists → mark source + stop`);
      await matchRef.set({ bellNotified: true }, { merge: true });
      return;
    }

    // If we see non-canonical dupes, log them (don’t delete yet; we want to SEE them first)
    if (dupSnap.size > 0) {
      console.log(`[MR_BELL][${runId}] non-canonical duplicates detected`, {
        nonCanonical: dupSnap.docs.filter(d => d.id !== notifId).map(d => ({
          id: d.id,
          fields: d.data(),
        })),
      });
    }

    // Short-circuit on flag
    if (bellNotified === true) {
      console.log(`[MR_BELL][${runId}] bellNotified flag true → stop`);
      return;
    }

    // Resolve sender name (best effort)
    let senderName = "A player";
    try {
      const s = await db.collection("players").doc(fromUserId).get();
      senderName = s.exists ? (s.get("name") || "A player") : "A player";
    } catch (e) {
      console.log(`[MR_BELL][${runId}] name lookup failed`, { error: String(e) });
    }

    // Transaction: write canonical + mark source
    await db.runTransaction(async (tx) => {
      const [mSnap, nSnap] = await Promise.all([tx.get(matchRef), tx.get(notifRef)]);
      const alreadyFlagged = mSnap.exists && mSnap.get("bellNotified") === true;

      console.log(`[MR_BELL][${runId}] txn read`, {
        alreadyFlagged,
        canonicalExists: nSnap.exists,
      });

      if (alreadyFlagged && nSnap.exists) {
        console.log(`[MR_BELL][${runId}] nothing to do → stop`);
        return;
      }

      tx.set(notifRef, {
        recipientId: toUserId,
        type: "match_request",
        matchId,
        fromUserId,
        title: "New match request",
        body: `${senderName} has challenged you to a match.`,
        message: `${senderName} has challenged you to a match.`,
        url: "https://tennismate.vercel.app/matches",
        source: "cf:sendMatchRequestNotification",
        runId, // 👈 for correlation
        timestamp: admin.firestore.FieldValue.serverTimestamp(),
        read: false,
      }, { merge: true });

      tx.set(matchRef, { bellNotified: true }, { merge: true });
    });

    console.log(`[MR_BELL][${runId}] canonical write complete`, { notifId });

    // --- Post-write hard de-dupe (best-effort sweep) ---
try {
  const extras = await db.collection("notifications")
    .where("type", "==", "match_request")
    .where("matchId", "==", matchId)
    .where("recipientId", "==", toUserId)
    .get();

  if (!extras.empty) {
    const batch = db.batch();
    let deleted = 0;

    extras.docs.forEach((d) => {
      if (d.id !== notifId) {
        batch.delete(d.ref);
        deleted++;
      }
    });

    if (deleted > 0) {
      await batch.commit();
      console.log(`[MR_BELL][${runId}] dedupe deleted ${deleted} extra bell(s)`, { kept: notifId });
    } else {
      console.log(`[MR_BELL][${runId}] dedupe found no extras to delete`, { kept: notifId });
    }
  } else {
    console.log(`[MR_BELL][${runId}] dedupe found none`, { kept: notifId });
  }
} catch (e) {
  console.warn(`[MR_BELL][${runId}] dedupe sweep failed`, { error: String(e) });
}
// --- end dedupe ---

  }
);




export { sendEventRemindersV2 };


