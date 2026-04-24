import { setGlobalOptions } from "firebase-functions/v2";
import * as admin from "firebase-admin";
import {
  onDocumentCreated,
  onDocumentUpdated,
  onDocumentWritten,
} from "firebase-functions/v2/firestore";
import { sendEventRemindersV2 } from "./eventReminders";
import { onRequest, onCall, HttpsError } from "firebase-functions/v2/https";
import * as crypto from "crypto";
import { pubsub } from "firebase-functions/v1";
import { fetchNearbyPlayersForUser } from "./nearbyPlayers";
import { fetchSuggestedCourtsForInvite } from "./suggestedCourtsForInvite";
import {
  affectedUserIdsFromCompletedMatch,
  affectedUserIdsFromMatchHistory,
  affectedUserIdsFromMatchRequest,
  recomputePlayerPublicStats,
} from "./playerPublicStats";
import {
  updateMessageNotificationStateForMessage,
} from "./messageNotifications";


// ✅ Set correct region for Firestore: australia-southeast2
setGlobalOptions({ maxInstances: 10, region: "australia-southeast2" });

if (admin.apps.length === 0) {
  admin.initializeApp();
}
const db = admin.firestore();

async function recomputePublicStatsForUids(
  uids: string[],
  source: string,
  context: Record<string, unknown> = {}
) {
  const uniqueUids = Array.from(new Set(uids.filter(Boolean)));
  if (!uniqueUids.length) return;

  await Promise.all(
    uniqueUids.map(async (uid) => {
      try {
        const stats = await recomputePlayerPublicStats(uid);
        console.log("[player_public_stats] recomputed", {
          source,
          uid,
          context,
          acceptedMatches: stats.acceptedMatches,
          completedMatches: stats.completedMatches,
          wins: stats.wins,
        });
      } catch (error) {
        console.error("[player_public_stats] recompute failed", {
          source,
          uid,
          context,
          error,
        });
      }
    })
  );
}

// -------------------- MATCH INVITE → CALENDAR SYNC HELPERS --------------------

function computeEndISO(startISO: string, durationMins: number): string {
  const start = new Date(startISO);
  if (isNaN(start.getTime())) return startISO; // keep as-is if invalid
  return new Date(start.getTime() + durationMins * 60 * 1000).toISOString();
}

function pickInviteFields(after: any): {
  startISO: string | null;
  endISO: string | null;
  durationMins: number | null;
  title: string;
  courtName: string | null;
} {
  const invite = after?.invite || {};

  const startISO =
    (typeof invite?.startISO === "string" && invite.startISO) ||
    (typeof after?.inviteStart === "string" && after.inviteStart) ||
    null;

  const durationMins =
    (typeof invite?.durationMins === "number" && invite.durationMins) ||
    (typeof after?.inviteDurationMins === "number" && after.inviteDurationMins) ||
    null;

  const endISO =
    (typeof invite?.endISO === "string" && invite.endISO) ||
    (typeof after?.inviteEnd === "string" && after.inviteEnd) ||
    (startISO && typeof durationMins === "number"
      ? computeEndISO(startISO, durationMins)
      : null);

  const title =
    (typeof invite?.title === "string" && invite.title) ||
    (typeof after?.inviteTitle === "string" && after.inviteTitle) ||
    "Match Invite";

    const courtName =
    (typeof invite?.courtName === "string" && invite.courtName) ||
    (typeof invite?.court?.name === "string" && invite.court.name) ||     // ✅ NEW (matches your UI)
    (typeof invite?.location === "string" && invite.location) ||           // ✅ fallback
    (typeof after?.courtName === "string" && after.courtName) ||
    null;

  return { startISO, endISO, durationMins, title, courtName };
}

// ---------- EVENT AUTO-DELETE (end time + 1 hour) ----------
function computeDeleteAfterFromEndISO(endISO: unknown): admin.firestore.Timestamp | null {
  if (typeof endISO !== "string" || !endISO) return null;
  const end = new Date(endISO);
  if (isNaN(end.getTime())) return null;

  // end + 1 hour
  return admin.firestore.Timestamp.fromDate(new Date(end.getTime() + 60 * 60 * 1000));
}

// Write deleteAfter when an event is created
export const setEventDeleteAfterOnCreate = onDocumentCreated("events/{eventId}", async (event) => {
  const snap = event.data;
  if (!snap) return;

  const data = snap.data() as any;
  const deleteAfter = computeDeleteAfterFromEndISO(data?.end);
  if (!deleteAfter) return;

  await snap.ref.set({ deleteAfter }, { merge: true });
});

// Update deleteAfter when an event is updated (if end changes)
export const setEventDeleteAfterOnUpdate = onDocumentUpdated("events/{eventId}", async (event) => {
  const after = event.data?.after?.data() as any;
  if (!after) return;

  const deleteAfter = computeDeleteAfterFromEndISO(after?.end);
  if (!deleteAfter) return;

  await event.data!.after.ref.set({ deleteAfter }, { merge: true });
});

// Scheduled cleanup: deletes events whose deleteAfter <= now (+ removes calendar entries + join requests)
export const cleanupExpiredEvents = pubsub
  .schedule("every 60 minutes")
  .timeZone("Australia/Melbourne")
  .onRun(async () => {
    const now = admin.firestore.Timestamp.now();

    const snap = await db
      .collection("events")
      .where("deleteAfter", "<=", now)
      .get();

    if (snap.empty) {
      console.log("[cleanupExpiredEvents] nothing to delete");
      return null;
    }

    console.log(`[cleanupExpiredEvents] events to delete: ${snap.size}`);

    for (const docSnap of snap.docs) {
      const eventId = docSnap.id;

      // delete related calendar entries
      const calSnap = await db.collection("calendar_events").where("eventId", "==", eventId).get();
      if (!calSnap.empty) {
        const b = db.batch();
        calSnap.docs.forEach((d) => b.delete(d.ref));
        await b.commit();
      }

      // delete join_requests subcollection docs
      const jrSnap = await db.collection("events").doc(eventId).collection("join_requests").get();
      if (!jrSnap.empty) {
        const b = db.batch();
        jrSnap.docs.forEach((d) => b.delete(d.ref));
        await b.commit();
      }

      // finally delete event doc
      await docSnap.ref.delete();
      console.log(`[cleanupExpiredEvents] deleted event ${eventId}`);
    }

    return null;
  });

export const deleteMyAccount = onCall(async (request) => {
  const runId =
    (crypto as any).randomUUID?.() || Math.random().toString(36).slice(2);

  try {
    const uid = request.auth?.uid;

    if (!uid) {
      console.log(`[DeleteAccount][${runId}] unauthenticated`);
      throw new HttpsError(
        "unauthenticated",
        "You must be logged in to delete your account.",
        { runId }
      );
    }

    console.log(`[DeleteAccount][${runId}] START`, {
      uid,
      hasAuth: !!request.auth,
      appCheck: (request as any).app?.appId ? "present" : "missing",
    });

  const usersRef = db.collection("users").doc(uid);
  const playersRef = db.collection("players").doc(uid);
  const devicesCol = usersRef.collection("devices");

  // ---- STEP 1: read some state (for debugging only) ----
  try {
    const [uSnap, pSnap, dSnap] = await Promise.all([
      usersRef.get().catch((e) => {
        console.warn("[DeleteAccount][%s] users read failed", runId, String(e));
        return null as any;
      }),
      playersRef.get().catch((e) => {
        console.warn("[DeleteAccount][%s] players read failed", runId, String(e));
        return null as any;
      }),
      devicesCol.get().catch((e) => {
        console.warn("[DeleteAccount][%s] devices read failed", runId, String(e));
        return null as any;
      }),
    ]);

    console.log("[DeleteAccount][%s] PRECHECK", runId, {
      usersDocExists: !!uSnap?.exists,
      playersDocExists: !!pSnap?.exists,
      devicesCount: dSnap?.size ?? null,
    });
  } catch (e: any) {
    console.warn("[DeleteAccount][%s] PRECHECK error (continuing)", runId, e?.message || String(e));
  }

  // ---- STEP 2: delete devices subcollection docs FIRST ----
  try {
    const devicesSnap = await devicesCol.get();
    console.log("[DeleteAccount][%s] devices found", runId, { count: devicesSnap.size });

    if (!devicesSnap.empty) {
      const b = db.batch();
      devicesSnap.docs.forEach((d) => b.delete(d.ref));
      await b.commit();
      console.log("[DeleteAccount][%s] devices deleted", runId, { count: devicesSnap.size });
    }
  } catch (e: any) {
    console.error("[DeleteAccount][%s] STEP devices delete FAILED", runId, e?.message || String(e));
    throw new HttpsError("internal", "Failed deleting device tokens.", {
      step: "delete_devices",
      runId,
      message: e?.message || String(e),
    });
  }

  // ---- STEP 3: delete main Firestore docs ----
  try {
    const batch = db.batch();
    batch.delete(usersRef);
    batch.delete(playersRef);
    await batch.commit();
    console.log("[DeleteAccount][%s] firestore docs deleted", runId);
  } catch (e: any) {
    console.error("[DeleteAccount][%s] STEP firestore delete FAILED", runId, e?.message || String(e));
    throw new HttpsError("internal", "Failed deleting Firestore documents.", {
      step: "delete_firestore_docs",
      runId,
      message: e?.message || String(e),
    });
  }

  // ---- STEP 4: delete Auth user ----
  try {
    await admin.auth().deleteUser(uid);
    console.log("[DeleteAccount][%s] auth user deleted", runId, { uid });
  } catch (e: any) {
    const code = e?.code || e?.errorInfo?.code;
    const msg = e?.message || String(e);

    // If the auth user is already gone, treat as success.
    if (code === "auth/user-not-found") {
      console.warn("[DeleteAccount][%s] auth user not found (already deleted)", runId, { uid });
    } else {
      console.error("[DeleteAccount][%s] STEP auth delete FAILED", runId, { code, msg });
      throw new HttpsError("internal", "Failed deleting authentication user.", {
        step: "delete_auth_user",
        runId,
        code,
        message: msg,
      });
    }
  }

  console.log("[DeleteAccount][%s] COMPLETE", runId, { uid });
  return { success: true, runId };

} catch (e: any) {
  console.error(`[DeleteAccount][${runId}] FAILED`, e?.message || String(e));
  throw new HttpsError("internal", "Delete account failed.", {
    runId,
    message: e?.message || String(e),
  });
}
});

export const getNearbyPlayers = onCall(async (request) => {
  const uid = request.auth?.uid;
  if (!uid) {
    throw new HttpsError("unauthenticated", "Authentication required.");
  }

  return fetchNearbyPlayersForUser(uid, (request.data || {}) as {
    radiusKm?: number;
    activeWithinHours?: number | null;
    limit?: number;
  });
});

export const getSuggestedCourtsForInvite = onCall(async (request) => {
  const uid = request.auth?.uid;
  if (!uid) {
    throw new HttpsError("unauthenticated", "Authentication required.");
  }

  return fetchSuggestedCourtsForInvite(uid, (request.data || {}) as {
    conversationId?: string;
    maxResults?: number;
    searchRadiusKm?: number;
  });
});

export const syncPlayerPublicStatsOnMatchRequestWrite = onDocumentWritten(
  "match_requests/{matchId}",
  async (event) => {
    const before = event.data?.before?.data();
    const after = event.data?.after?.data();
    const uids = [
      ...affectedUserIdsFromMatchRequest(before),
      ...affectedUserIdsFromMatchRequest(after),
    ];

    await recomputePublicStatsForUids(uids, "match_requests", {
      matchId: event.params.matchId,
    });
  }
);

export const syncPlayerPublicStatsOnMatchHistoryWrite = onDocumentWritten(
  "match_history/{historyId}",
  async (event) => {
    const before = event.data?.before?.data();
    const after = event.data?.after?.data();
    const uids = [
      ...affectedUserIdsFromMatchHistory(before),
      ...affectedUserIdsFromMatchHistory(after),
    ];

    await recomputePublicStatsForUids(uids, "match_history", {
      historyId: event.params.historyId,
    });
  }
);

export const syncPlayerPublicStatsOnCompletedMatchWrite = onDocumentWritten(
  "completed_matches/{docId}",
  async (event) => {
    const before = event.data?.before?.data();
    const after = event.data?.after?.data();
    const uids = [
      ...affectedUserIdsFromCompletedMatch(before),
      ...affectedUserIdsFromCompletedMatch(after),
    ];

    await recomputePublicStatsForUids(uids, "completed_matches", {
      docId: event.params.docId,
    });
  }
);

export const deleteMyCoachProfile = onCall(async (request) => {
  const runId =
    (crypto as any).randomUUID?.() || Math.random().toString(36).slice(2);

  try {
    const uid = request.auth?.uid;

    if (!uid) {
      console.log(`[DeleteCoach][${runId}] unauthenticated`);
      throw new HttpsError(
        "unauthenticated",
        "You must be logged in to delete your coach profile.",
        { runId }
      );
    }

    console.log(`[DeleteCoach][${runId}] START`, { uid });

    // 1) Delete Firestore coach doc
    const coachRef = db.collection("coaches").doc(uid);
    await coachRef.delete();
    console.log(`[DeleteCoach][${runId}] Firestore coach doc deleted`, { path: `coaches/${uid}` });

    // 2) Delete all Storage files under coaches/{uid}/
    // NOTE: This removes avatar + gallery + any nested paths.
    const bucket = admin.storage().bucket();
    await bucket.deleteFiles({ prefix: `coaches/${uid}/` });
    console.log(`[DeleteCoach][${runId}] Storage deleted`, { prefix: `coaches/${uid}/` });

    console.log(`[DeleteCoach][${runId}] COMPLETE`, { uid });
    return { success: true, runId };
  } catch (e: any) {
    console.error(`[DeleteCoach][${runId}] FAILED`, e?.message || String(e));
    throw new HttpsError("internal", "Delete coach profile failed.", {
      runId,
      message: e?.message || String(e),
    });
  }
});



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

// --- Log helpers (privacy-safe token + Melbourne timestamp) ---
function melNowISO(): string {
  try {
    return new Date()
      .toLocaleString("sv-SE", { timeZone: "Australia/Melbourne" })
      .replace(" ", "T");
  } catch {
    return new Date().toISOString();
  }
}

function safeToken(t: string): string {
  // Don’t log full tokens. Keep last 10 chars for correlation.
  if (!t) return "";
  return t.length <= 10 ? t : `…${t.slice(-10)}`;
}


// ---------- PUSH HELPERS (native first, web fallback) ----------
// Use fcmToken field when present; fall back to doc id.
type NativeDeviceToken = {
  token: string;
  deviceDocId: string;
  platform: string;
};

async function getNativeDeviceTokensForUser(uid: string): Promise<NativeDeviceToken[]> {
  const snap = await db.collection("users").doc(uid).collection("devices").get();
  const out: NativeDeviceToken[] = [];

  snap.forEach((d) => {
    const platform = (d.get("platform") as string) || "web";

    // ✅ Only native platforms
    if (platform !== "android" && platform !== "ios") return;

    const tokenInDoc = d.get("fcmToken") as string | undefined;
    const token = (tokenInDoc || d.id || "").trim();

    if (!token) return;

    out.push({
      token,
      deviceDocId: d.id,  // ✅ this is what we must delete later
      platform,
    });
  });

  console.log("[PushFn] native device tokens", {
    at: melNowISO(),
    uid,
    count: out.length,
    devices: out.map((x) => ({
      platform: x.platform,
      deviceDocId: x.deviceDocId,
      token: safeToken(x.token),
    })),
  });

  return out;
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
  const deviceTokens = await getNativeDeviceTokensForUser(uid);
  const tokens = deviceTokens.map((d) => d.token);
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
  // ✅ Log delivery result details (helps diagnose overnight failures)
const successCount = res.responses.filter((r) => r.success).length;
const failureCount = res.responses.length - successCount;

const failures = res.responses
  .map((r, i) => {
    if (r.success) return null;
    const code = (r as any).error?.code as string | undefined;
    const msg = (r as any).error?.message as string | undefined;
    return {
      i,
      token: safeToken(tokens[i]),
      code,
      msg,
    };
  })
  .filter(Boolean);

console.log("[PushFn] sendEachForMulticast result", {
  at: melNowISO(),
  uid,
  type: payload.type || "general",
  route: payload.route || null,
  tokenCount: tokens.length,
  successCount,
  failureCount,
  failures: failureCount ? failures : [],
});


  // Clean up invalid tokens to keep lists healthy
  await Promise.all(
    res.responses.map(async (r, i) => {
      if (!r.success) {
        const code = (r as any).error?.code as string | undefined;
        if (
          code === "messaging/registration-token-not-registered" ||
          code === "messaging/invalid-registration-token"
        ) {
         const bad = deviceTokens[i]; // ✅ has deviceDocId + token
try {
  await db
    .collection("users")
    .doc(uid)
    .collection("devices")
    .doc(bad.deviceDocId) // ✅ delete the device doc, not the token
    .delete();

  console.log("🧹 Removed invalid native token", {
    at: melNowISO(),
    uid,
    deviceDocId: bad.deviceDocId,
    platform: bad.platform,
    token: safeToken(bad.token),
  });
} catch (e) {
  console.warn("🧹 Failed to remove invalid native token", {
    at: melNowISO(),
    uid,
    deviceDocId: bad?.deviceDocId,
    token: safeToken(bad?.token || ""),
    error: String(e),
  });
}

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

const AVAILABILITY_ALERT_RADIUS_KM = 10;
const AVAILABILITY_ALERT_PUSH_COOLDOWN_MS = 7 * 24 * 60 * 60 * 1000;
const AVAILABILITY_ALERT_MAX_RECIPIENTS = 50;
const ACTIVE_MATCH_RELATIONSHIP_STATUSES = [
  "unread",
  "requested",
  "pending",
  "accepted",
  "confirmed",
];

function getAvailabilityProfileSlot(dateValue: unknown, timeSlotValue: unknown): string | null {
  if (typeof dateValue !== "string" || !dateValue) return null;

  const parsed = new Date(`${dateValue}T12:00:00`);
  if (Number.isNaN(parsed.getTime())) return null;

  const isWeekend = parsed.getDay() === 0 || parsed.getDay() === 6;
  const timeSlot = typeof timeSlotValue === "string" ? timeSlotValue : "evening";

  if (timeSlot === "morning") {
    return isWeekend ? "Weekends AM" : "Weekdays AM";
  }

  return isWeekend ? "Weekends PM" : "Weekdays PM";
}

function isWithinAvailabilityPushHours(now = new Date()): boolean {
  try {
    const hourText = new Intl.DateTimeFormat("en-AU", {
      timeZone: "Australia/Melbourne",
      hour: "2-digit",
      hour12: false,
    }).format(now);

    const hour = Number.parseInt(hourText, 10);
    return Number.isFinite(hour) && hour >= 9 && hour < 21;
  } catch {
    const hour = now.getHours();
    return hour >= 9 && hour < 21;
  }
}

function timestampToMillis(value: unknown): number | null {
  if (!value) return null;

  if (value instanceof admin.firestore.Timestamp) {
    return value.toMillis();
  }

  const maybeDate =
    value instanceof Date
      ? value
      : typeof (value as any)?.toDate === "function"
      ? (value as any).toDate()
      : null;

  if (maybeDate && !Number.isNaN(maybeDate.getTime())) {
    return maybeDate.getTime();
  }

  return null;
}

async function getActiveRelationshipUserIds(uid: string): Promise<Set<string>> {
  const out = new Set<string>();

  const [fromSnap, toSnap] = await Promise.all([
    db
      .collection("match_requests")
      .where("fromUserId", "==", uid)
      .where("status", "in", ACTIVE_MATCH_RELATIONSHIP_STATUSES)
      .get(),
    db
      .collection("match_requests")
      .where("toUserId", "==", uid)
      .where("status", "in", ACTIVE_MATCH_RELATIONSHIP_STATUSES)
      .get(),
  ]);

  fromSnap.forEach((docSnap) => {
    const other = docSnap.get("toUserId");
    if (typeof other === "string" && other.trim()) out.add(other.trim());
  });

  toSnap.forEach((docSnap) => {
    const other = docSnap.get("fromUserId");
    if (typeof other === "string" && other.trim()) out.add(other.trim());
  });

  return out;
}

type AvailabilityCandidate = {
  uid: string;
  data: FirebaseFirestore.DocumentData;
  distanceKm: number;
};

async function findNearbyAvailabilityCandidates(
  origin: { lat: number; lng: number },
  slot: string
): Promise<AvailabilityCandidate[]> {
  const latDelta = AVAILABILITY_ALERT_RADIUS_KM / 111;
  const lngDelta =
    AVAILABILITY_ALERT_RADIUS_KM /
    Math.max(1, 111 * Math.cos((origin.lat * Math.PI) / 180));

  const snap = await db
    .collection("players")
    .where("lat", ">=", origin.lat - latDelta)
    .where("lat", "<=", origin.lat + latDelta)
    .limit(400)
    .get();

  const out: AvailabilityCandidate[] = [];

  snap.forEach((docSnap) => {
    const data = docSnap.data() || {};
    const uid = docSnap.id;
    const lat = typeof data.lat === "number" ? data.lat : null;
    const lng = typeof data.lng === "number" ? data.lng : null;

    if (lat == null || lng == null) return;
    if (Math.abs(lng - origin.lng) > lngDelta) return;
    if (data.isMatchable === false) return;

    const availability = Array.isArray(data.availability)
      ? data.availability.map((value: unknown) => String(value).trim())
      : [];
    if (!availability.includes(slot)) return;

    const distanceKm = calculateDistance(origin, { lat, lng });
    if (distanceKm > AVAILABILITY_ALERT_RADIUS_KM) return;

    out.push({ uid, data, distanceKm });
  });

  out.sort((a, b) => a.distanceKm - b.distanceKm);
  return out.slice(0, AVAILABILITY_ALERT_MAX_RECIPIENTS);
}

async function createAvailabilityAlertsForOpenAvailability(
  availabilityId: string,
  data: FirebaseFirestore.DocumentData | undefined
): Promise<void> {
  if (!data) return;
  if (data.status !== "open") return;

  const creatorId =
    typeof data.userId === "string" && data.userId.trim()
      ? data.userId.trim()
      : availabilityId;
  const instanceId =
    typeof data.instanceId === "string" && data.instanceId.trim()
      ? data.instanceId.trim()
      : availabilityId;

  const lat = typeof data.lat === "number" ? data.lat : null;
  const lng = typeof data.lng === "number" ? data.lng : null;
  if (lat == null || lng == null) {
    console.log("[AvailabilityAlert] missing lat/lng; skipping", { availabilityId, creatorId });
    return;
  }

  const slot = getAvailabilityProfileSlot(data.date, data.timeSlot);
  if (!slot) {
    console.log("[AvailabilityAlert] could not map availability slot; skipping", {
      availabilityId,
      creatorId,
      date: data.date,
      timeSlot: data.timeSlot,
    });
    return;
  }

  const creatorName =
    typeof data.name === "string" && data.name.trim()
      ? data.name.trim()
      : await getPlayerName(creatorId);

  const activeRelationshipUserIds = await getActiveRelationshipUserIds(creatorId);
  activeRelationshipUserIds.add(creatorId);

  const nearby = await findNearbyAvailabilityCandidates({ lat, lng }, slot);
  const pushWindowOpen = isWithinAvailabilityPushHours();

  let createdCount = 0;
  let pushEnabledCount = 0;

  for (const candidate of nearby) {
    if (activeRelationshipUserIds.has(candidate.uid)) continue;

    const notifId = `availabilityAlert_${instanceId}_${candidate.uid}`;
    const notifRef = db.collection("notifications").doc(notifId);

    const userRef = db.collection("users").doc(candidate.uid);
    const userSnap = await userRef.get();
    const lastPushMs = timestampToMillis(userSnap.get("lastAvailabilityPushAt"));
    const pushCooldownActive =
      typeof lastPushMs === "number" &&
      Date.now() - lastPushMs < AVAILABILITY_ALERT_PUSH_COOLDOWN_MS;
    const pushDisabled = !pushWindowOpen || pushCooldownActive;

    try {
      await notifRef.create({
        recipientId: candidate.uid,
        fromUserId: creatorId,
        type: "availability_alert",
        availabilityId,
        availabilityInstanceId: instanceId,
        groupKey: `availability_alert_${instanceId}`,
        title: "New nearby availability",
        body: `${creatorName} is looking for a ${String(data.timeSlot || "match")} game nearby.`,
        message: `${creatorName} is looking for a ${String(data.timeSlot || "match")} game nearby.`,
        route: "/match?surface=availability",
        url: "https://tennismate.vercel.app/match?surface=availability",
        slot,
        distanceKm: Math.round(candidate.distanceKm * 10) / 10,
        pushDisabled,
        read: false,
        timestamp: admin.firestore.FieldValue.serverTimestamp(),
        source: "cf:availability_alert",
      });

      createdCount += 1;

      if (!pushDisabled) {
        pushEnabledCount += 1;
        await userRef.set(
          { lastAvailabilityPushAt: admin.firestore.FieldValue.serverTimestamp() },
          { merge: true }
        );
      }
    } catch (error: any) {
      if (error?.code === 6 || String(error?.message || "").includes("Already exists")) {
        continue;
      }
      console.error("[AvailabilityAlert] failed to create notification", {
        availabilityId,
        recipientId: candidate.uid,
        error: String(error?.message || error),
      });
    }
  }

  console.log("[AvailabilityAlert] complete", {
    availabilityId,
    creatorId,
    instanceId,
    slot,
    createdCount,
    pushEnabledCount,
    nearbyCandidates: nearby.length,
    pushWindowOpen,
  });
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

// ============================================================
// ✅ EVENT NOTIFICATIONS (Bell + Push)
// Requirement:
// 1) When a user requests to join -> notify host
// 2) When request accepted -> notify requester
// 3) When event cancelled -> notify participants + delete group chat
// ============================================================

// Helper: delete conversation + messages
async function deleteConversationDeep(conversationId: string) {
  const convoRef = db.collection("conversations").doc(conversationId);

  // 1) delete messages in batches
  const messagesRef = convoRef.collection("messages");
  while (true) {
    const batchSnap = await messagesRef.limit(400).get();
    if (batchSnap.empty) break;

    const batch = db.batch();
    batchSnap.docs.forEach((d) => batch.delete(d.ref));
    await batch.commit();
  }

  // 2) delete conversation doc
  await convoRef.delete().catch(() => {});
}

// 1) Join request CREATED -> notify host (bell + push)
export const notifyHostOnEventJoinRequestCreated = onDocumentCreated(
  "events/{eventId}/join_requests/{reqId}",
  async (event) => {
    const { eventId, reqId } = event.params as { eventId: string; reqId: string };
    const req = event.data?.data() as { userId?: string; status?: string } | undefined;
    if (!req?.userId) return;

    // only pending requests
    const status = (req.status || "pending").toString();
    if (status !== "pending") return;

    const evSnap = await db.collection("events").doc(eventId).get();
    if (!evSnap.exists) return;

    const ev = evSnap.data() as any;
    const hostId = ev?.hostId as string | undefined;
    if (!hostId) return;

    // don't notify self
    if (hostId === req.userId) return;

    const eventTitle = (ev?.title as string) || "Tennis Event";
    const requesterName = await getPlayerName(req.userId);

    // ✅ stable notification id prevents duplicates on retries
    const notifId = `eventJoinReq_${eventId}_${reqId}_${hostId}`;

    await db.collection("notifications").doc(notifId).set(
      {
        recipientId: hostId,
        type: "event_join_request",
        eventId,
        reqId,
        fromUserId: req.userId,

        title: "New join request",
        body: `${requesterName} requested to join: ${eventTitle}`,
        message: `${requesterName} requested to join: ${eventTitle}`,

        route: `/events/${eventId}`,
        url: `https://tennismate.vercel.app/events/${eventId}`,

        timestamp: admin.firestore.FieldValue.serverTimestamp(),
        read: false,

        source: "cf:notifyHostOnEventJoinRequestCreated",
      },
      { merge: true }
    );
  }
);

// 2) Join request UPDATED -> if accepted -> notify requester (bell + push)
export const notifyRequesterOnEventJoinRequestAccepted = onDocumentUpdated(
  "events/{eventId}/join_requests/{reqId}",
  async (event) => {
    const { eventId, reqId } = event.params as { eventId: string; reqId: string };
    const before = event.data?.before?.data() as { status?: string } | undefined;
    const after = event.data?.after?.data() as { status?: string; userId?: string } | undefined;
    if (!before || !after) return;

    const prevStatus = (before.status || "pending").toString();
    const nextStatus = (after.status || "pending").toString();

    // Only when status transitions to accepted
    if (prevStatus === "accepted" || nextStatus !== "accepted") return;

    const requesterId = after.userId;
    if (!requesterId) return;

    const evSnap = await db.collection("events").doc(eventId).get();
    const ev = evSnap.exists ? (evSnap.data() as any) : {};
    const eventTitle = (ev?.title as string) || "Tennis Event";

    const notifId = `eventJoinAccepted_${eventId}_${reqId}_${requesterId}`;

    await db.collection("notifications").doc(notifId).set(
      {
        recipientId: requesterId,
        type: "event_join_accepted",
        eventId,
        reqId,

        title: "Request accepted ✅",
        body: `You’ve been accepted into: ${eventTitle}`,
        message: `You’ve been accepted into: ${eventTitle}`,

        route: `/events/${eventId}`,
        url: `https://tennismate.vercel.app/events/${eventId}`,

        timestamp: admin.firestore.FieldValue.serverTimestamp(),
        read: false,

        source: "cf:notifyRequesterOnEventJoinRequestAccepted",
      },
      { merge: true }
    );
  }
);

// 3) Event UPDATED -> if cancelled -> notify participants + delete group chat
export const notifyOnEventCancelledAndDeleteChat = onDocumentUpdated(
  "events/{eventId}",
  async (event) => {
    const { eventId } = event.params as { eventId: string };
    const before = event.data?.before?.data() as any;
    const after = event.data?.after?.data() as any;
    if (!before || !after) return;

    const prevStatus = (before.status || "open").toString();
    const nextStatus = (after.status || "open").toString();

    // Only on transition to cancelled
    if (prevStatus === "cancelled" || nextStatus !== "cancelled") return;

    const eventTitle = (after.title as string) || "Tennis Event";
    const hostId = (after.hostId as string) || null;
    const participants: string[] = Array.isArray(after.participants)
      ? after.participants.filter(Boolean)
      : [];

    const conversationId: string | undefined =
      (after.conversationId as string | undefined) || undefined;

    // Notify all participants (exclude host if you want)
    const notifyUserIds = Array.from(
  new Set([...(participants || []), ...(hostId ? [hostId] : [])])
).filter(Boolean);

    await Promise.all(
      notifyUserIds.map(async (uid) => {
        const notifId = `eventCancelled_${eventId}_${uid}`;

        await db.collection("notifications").doc(notifId).set(
          {
            recipientId: uid,
            type: "event_cancelled",
            eventId,
            fromUserId: hostId,

            title: "Event cancelled",
            body: `${eventTitle} has been cancelled.`,
            message: `${eventTitle} has been cancelled.`,

            route: `/events/${eventId}`,
            url: `https://tennismate.vercel.app/events/${eventId}`,

            timestamp: admin.firestore.FieldValue.serverTimestamp(),
            read: false,

            source: "cf:notifyOnEventCancelledAndDeleteChat",
          },
          { merge: true }
        );
      })
    );

    // ✅ delete group chat thread (conversation + messages)
    if (conversationId) {
      await deleteConversationDeep(conversationId);

      // Optional cleanup: delete bell notifications for that conversation
const notifSnap = await db
  .collection("notifications")
  .where("conversationId", "==", conversationId)
  .get();

if (!notifSnap.empty) {
  const b = db.batch();
  notifSnap.docs.forEach((d) => b.delete(d.ref));
  await b.commit();
}

      // Optional but recommended: remove conversationId from event so UI doesn't link to a dead thread
      await db.collection("events").doc(eventId).set(
        {
          conversationId: admin.firestore.FieldValue.delete(),
        },
        { merge: true }
      );
    }
  }
);



// Auto-sync calendar for any participants newly added to the event
export const syncCalendarWhenParticipantsChange = onDocumentUpdated("events/{eventId}", async (event) => {
  const before = event.data?.before?.data() as any;
  const after = event.data?.after?.data() as any;
  if (!before || !after) return;

  // ✅ Only sync calendar when event is "open/active" and participants represent accepted users
// If you have an explicit event status, enforce it here.
if (after.status && (after.status === "cancelled" || after.status === "completed")) return;

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

export const nudgePendingMatchRequests = pubsub
  .schedule("every 60 minutes")
  .timeZone("Australia/Melbourne")
  .onRun(async () => {
    const melNow = new Date(
      new Date().toLocaleString("en-AU", { timeZone: "Australia/Melbourne" })
    );

    // only send at 6pm Melbourne time
    if (melNow.getHours() !== 18) {
      console.log("[Nudge] Skipping — only send at 6pm Melbourne time.");
      return null;
    }

    const now = Date.now();
    const cutoffMs = now - 24 * 60 * 60 * 1000; // ✅ 24 hours
    const cutoffDate = new Date(cutoffMs);
    console.log("[Nudge] Running. Cutoff:", cutoffDate.toISOString());

    const snap = await db
      .collection("match_requests")
      .where("status", "==", "unread")
      .get();

    if (snap.empty) {
      console.log("[Nudge] No pending match requests found.");
      return null;
    }

    const candidates = snap.docs
      .map((d) => ({ id: d.id, ref: d.ref, data: d.data() as any }))
      .filter(({ data }) => {
        if (data.nudgeSent === true) return false;
        const ts = data.timestamp?.toDate?.() ? data.timestamp.toDate() : null;
        if (!ts) return false;
        return ts.getTime() <= cutoffMs;
      });

    console.log(`[Nudge] Candidates: ${candidates.length}`);

    for (const c of candidates) {
      await db.runTransaction(async (tx) => {
        const fresh = await tx.get(c.ref);
        if (!fresh.exists) return;

        const data: any = fresh.data();
        if (data.nudgeSent === true) return;
        if (data.status !== "unread") return;

        const ts = data.timestamp?.toDate?.() ? data.timestamp.toDate() : null;
        if (!ts || ts.getTime() > cutoffMs) return;

        const toUserId = data.toUserId;
        const fromName = data.fromName ?? "Someone";
        if (!toUserId) return;

        const sent = await sendAndroidPushToUser(toUserId, {
          title: `${fromName} is waiting for your reply`,
          body: "You have a pending match request. Accept or decline to let them know.",
          route: "/match",
          type: "match_request_nudge_24h", // ✅ label updated
        });

        console.log("[Nudge] Push sent?", sent, { matchRequestId: fresh.id, toUserId });

        tx.set(
          c.ref,
          {
            nudgeSent: true,
            nudgeSentAt: admin.firestore.FieldValue.serverTimestamp(),
            nudgedCount: admin.firestore.FieldValue.increment(1),
          },
          { merge: true }
        );
      });
    }

    console.log("[Nudge] Done.");
    return null;
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

export const notifyNearbyPlayersOnAvailabilityCreate = onDocumentCreated(
  "availabilities/{availabilityId}",
  async (event) => {
    const availabilityId = event.params.availabilityId as string;
    await createAvailabilityAlertsForOpenAvailability(
      availabilityId,
      event.data?.data() as FirebaseFirestore.DocumentData | undefined
    );
  }
);

export const notifyNearbyPlayersOnAvailabilityReopen = onDocumentUpdated(
  "availabilities/{availabilityId}",
  async (event) => {
    const availabilityId = event.params.availabilityId as string;
    const before = event.data?.before?.data() as FirebaseFirestore.DocumentData | undefined;
    const after = event.data?.after?.data() as FirebaseFirestore.DocumentData | undefined;

    if (!after) return;

    const beforeStatus = typeof before?.status === "string" ? before.status : null;
    const afterStatus = typeof after.status === "string" ? after.status : null;

    if (afterStatus !== "open") return;
    if (beforeStatus === "open") return;

    await createAvailabilityAlertsForOpenAvailability(availabilityId, after);
  }
);

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
console.log(`[MR_BELL_CONSUMER] push attempt`, {
  at: melNowISO(),
  notifId,
  recipientId,
  type: notifData.type || "general",
  route,
  pushDisabled: notifData.pushDisabled === true,
});


    // 1) Try native Android first
    const nativeSent = await sendAndroidPushToUser(recipientId, {
      title, body, route, type: notifData.type || "general",
    });
    console.log(`[MR_BELL_CONSUMER] push result`, {
  at: melNowISO(),
  notifId,
  recipientId,
  type: notifData.type || "general",
  nativeSent,
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
      console.log(`[MR_BELL_CONSUMER] skipping DM email for notif ${notifId}; handled by notifyOnNewMessage cooldown state.`);
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
    try {
      const message = event.data?.data();
      const { conversationId, messageId } = event.params;
      if (!message) return;

      const senderId = message.senderId as string;
      const recipientId = message.recipientId as string | null;
      const text = (message.text as string) || "";

if (!text) return;
if (recipientId === senderId) return;

      // ✅ Resolve sender name (used for DM + group)
      let senderName = "A player";
      try {
        const senderDoc = await db.collection("players").doc(senderId).get();
        senderName =
          (senderDoc.exists ? (senderDoc.get("name") as string) : "") || "A player";
      } catch (e) {
        console.log("[notifyOnNewMessage] sender name lookup failed", String(e));
      }

      const body = text.length > 60 ? text.slice(0, 60) + "…" : text;

      // ============================================================
      // ✅ GROUP / EVENT MESSAGE PATH (recipientId is null)
      // ============================================================
      if (!recipientId) {
        // 1) Load conversation to get participants + context
        const convoSnap = await db.collection("conversations").doc(conversationId).get();
        const convo = convoSnap.exists ? (convoSnap.data() as any) : null;

        const participants: string[] = Array.isArray(convo?.participants)
          ? convo.participants.filter(Boolean)
          : [];

        const ctx = convo?.context || {};
        const isEvent = ctx?.type === "event";
        const title = (isEvent ? (ctx?.title || "Event Chat") : "Group Chat") as string;

        // If we can't determine recipients, stop
        if (!participants.length) return;

        // 2) Notify everyone except sender
        const recipients = participants.filter((uid) => uid !== senderId);

        await Promise.all(
          recipients.map(async (uid) => {
            // PUSH
            const nativeSent = await sendAndroidPushToUser(uid, {
              title: `${title}: ${senderName}`,
              body,
              route: `/messages/${conversationId}`,
              type: "group_message",
            });

            if (!nativeSent) {
              await sendWebPushToUser(uid, {
                title: `${title}: ${senderName}`,
                body,
                route: `/messages/${conversationId}`,
                type: "group_message",
              });
            }

            // IN-APP BELL DOC (optional, but recommended)
            // pushDisabled:true prevents double push via notifications watcher
            const notifId = `gmsg_${conversationId}_${messageId}_${uid}`;
            await db.collection("notifications").doc(notifId).set(
              {
                recipientId: uid,
                type: "group_message",
                conversationId,
                messageId,

                title: "New group message",
                body: text.length > 100 ? text.slice(0, 100) + "…" : text,
                url: `https://tennismate.vercel.app/messages`,

                fromUserId: senderId,
                timestamp: admin.firestore.FieldValue.serverTimestamp(),
                read: false,

                pushDisabled: true,
                source: "cf:notifyOnNewMessage:group",
              },
              { merge: true }
            );
          })
        );

        console.log("[notifyOnNewMessage] group push attempted", {
          conversationId,
          messageId,
          recipients: recipients.length,
        });

        return; // ✅ IMPORTANT: stop here; don’t run DM logic
      }

// ============================================================
// ✅ DIRECT MESSAGE PATH (recipientId exists)
// ============================================================
if (recipientId === senderId) return;

const read = message.read === true;
if (read) return;

      const convoSnap = await db.collection("conversations").doc(conversationId).get();
      const convo = convoSnap.exists ? (convoSnap.data() as any) : null;
      const recipientLastReadAt = convo?.lastRead?.[recipientId];

      const messageNotifState = await updateMessageNotificationStateForMessage({
        conversationId,
        recipientId,
        messageId,
        conversationLastReadAt: recipientLastReadAt,
      });

      console.log("[notifyOnNewMessage] DM state updated", {
        conversationId,
        messageId,
        recipientId,
        stateId: messageNotifState.stateId,
        unreadCount: messageNotifState.unreadCount,
        activeInThread: messageNotifState.activeInThread,
        sendPush: messageNotifState.sendPush,
        sendEmail: messageNotifState.sendEmail,
      });

      if (messageNotifState.sendPush) {
        const nativeSent = await sendAndroidPushToUser(recipientId, {
          title: `New message from ${senderName}`,
          body,
          route: `/messages/${conversationId}`,
          type: "new_message",
        });

        if (!nativeSent) {
          await sendWebPushToUser(recipientId, {
            title: `New message from ${senderName}`,
            body,
            route: `/messages/${conversationId}`,
            type: "new_message",
          });
        }

        console.log(`[notifyOnNewMessage] push attempted (native=${nativeSent})`, {
          recipientId,
          conversationId,
          messageId,
          stateId: messageNotifState.stateId,
        });
      } else {
        console.log("[notifyOnNewMessage] push suppressed for DM", {
          recipientId,
          conversationId,
          messageId,
          stateId: messageNotifState.stateId,
          reason: messageNotifState.activeInThread ? "active_in_thread" : "push_cooldown",
        });
      }

      if (messageNotifState.sendEmail) {
        const toEmail = await getUserEmail(recipientId);
        if (!toEmail) {
          console.log(`[notifyOnNewMessage] no email found for recipient ${recipientId}`);
        } else {
          const emailAllowed = await shouldEmailUser(recipientId);
          if (!emailAllowed) {
            console.log("[notifyOnNewMessage] suppressing DM email (active native push)", {
              recipientId,
              conversationId,
              messageId,
            });
          } else {
            const subject = "You have new messages on TennisMate";
            const html = `
              <p>You have new messages on TennisMate.</p>
              <p><a href="https://tennismate.vercel.app/messages/${conversationId}">Open your conversation</a></p>
              <p style="font-size:12px;color:#777">This is an automated TennisMate message alert.</p>
            `;

            await enqueueEmail(toEmail, subject, html, "You have new messages on TennisMate.", {
              category: "msg_direct_digest",
              conversationId,
              fromUserId: senderId,
              recipientId,
              messageId,
              stateId: messageNotifState.stateId,
            });

            console.log("[notifyOnNewMessage] DM email queued", {
              recipientId,
              conversationId,
              messageId,
              stateId: messageNotifState.stateId,
            });
          }
        }
      } else {
        console.log("[notifyOnNewMessage] email suppressed for DM", {
          recipientId,
          conversationId,
          messageId,
          stateId: messageNotifState.stateId,
          reason: messageNotifState.activeInThread ? "active_in_thread" : "email_cooldown",
        });
      }

      // ✅ In-app bell doc for DM (drives list + email), never triggers push watcher
      const notifId = `msg_${conversationId}_${messageId}_${recipientId}`;
      await db.collection("notifications").doc(notifId).set(
        {
          recipientId,
          type: "message",
          conversationId,
          messageId,

          title: "New message",
          body: text.length > 100 ? text.slice(0, 100) + "…" : text,
          url: `https://tennismate.vercel.app/messages`,

          fromUserId: senderId,
          timestamp: admin.firestore.FieldValue.serverTimestamp(),
          read: false,

          pushDisabled: true,
          source: "cf:notifyOnNewMessage",
        },
        { merge: true }
      );

      console.log(`[notifyOnNewMessage] bell notification created for ${recipientId}`);

    } catch (error) {
      console.error("[notifyOnNewMessage] ERROR:", error);
    }
  }
);

export const notifyOnMatchInviteCreated = onDocumentCreated(
  "match_invites/{inviteId}",
  async (event) => {
    const runId = crypto.randomUUID?.() || Math.random().toString(36).slice(2);
    const inviteId = event.params.inviteId as string;
    const data = event.data?.data() as any;

    console.log(`[INVITE_PUSH][${runId}] trigger start`, { inviteId });

    if (!data) return;

    const toUserId = (data.toUserId as string) || null;
    const fromUserId = (data.fromUserId as string) || null;
    const conversationId = (data.conversationId as string) || null;

    if (!toUserId || !fromUserId) {
      console.log(`[INVITE_PUSH][${runId}] missing to/from`, { toUserId, fromUserId });
      return;
    }

    // Avoid self-push edge case
    if (toUserId === fromUserId) {
      console.log(`[INVITE_PUSH][${runId}] self invite, skipping`, { toUserId });
      return;
    }

    // Pull invite details
    const inv = data.invite || {};
    const courtName =
      inv?.court?.name ||
      inv?.location ||
      data.courtName ||
      "Court TBA";

    const startISO = typeof inv?.startISO === "string" ? inv.startISO : null;
    const when =
      startISO && !isNaN(new Date(startISO).getTime())
        ? new Date(startISO).toLocaleString("en-AU", {
            timeZone: "Australia/Melbourne",
            weekday: "short",
            month: "short",
            day: "numeric",
            hour: "2-digit",
            minute: "2-digit",
          })
        : "Time TBD";

    // Sender name
    const fromName = await getPlayerName(fromUserId);

    const title = "🎾 New Match Invite";
    const body = `${fromName} invited you • ${courtName} • ${when}`;

// ✅ Destination: always go to Messages home
const route = "/messages";
const url = "https://tennismate.vercel.app/messages";

    // 1) Send native push (android/ios via your helper)
    const nativeSent = await sendAndroidPushToUser(toUserId, {
      title,
      body,
      route,
      type: "match_invite",
    });

    // 2) Web push fallback (if you wire it up later)
    if (!nativeSent) {
      await sendWebPushToUser(toUserId, {
        title,
        body,
        route,
        type: "match_invite",
      });
    }

    console.log(`[INVITE_PUSH][${runId}] push attempted`, {
      inviteId,
      toUserId,
      fromUserId,
      nativeSent,
      route,
    });

    // OPTIONAL (recommended): create an in-app bell notification doc
    // pushDisabled:true ensures your sendPushNotification watcher won't double-send.
    const notifId = `invite_${inviteId}_${toUserId}`;
    await db.collection("notifications").doc(notifId).set(
      {
        recipientId: toUserId,
        type: "match_invite",
        inviteId,
        ...(conversationId ? { conversationId } : {}),
        fromUserId,

        title: "New match invite",
        body,
        message: body,
        route,
        url,

        timestamp: admin.firestore.FieldValue.serverTimestamp(),
        read: false,

        pushDisabled: true,
        source: "cf:notifyOnMatchInviteCreated",
        runId,
      },
      { merge: true }
    );

    console.log(`[INVITE_PUSH][${runId}] bell notification written`, { notifId });
  }
);

export const syncCalendarOnInviteAccepted = onDocumentUpdated(
  "conversations/{conversationId}/messages/{messageId}",
  async (event) => {
    try {
      console.log("🔥 [InviteCal] TRIGGERED", event.params);
      const after = event.data?.after?.data() as any;

      if (!after) {
        console.log("❌ [InviteCal] Missing after snapshot");
        return;
      }

      const { conversationId, messageId } = event.params as {
        conversationId: string;
        messageId: string;
      };

      // Only for invite messages
      const isInvite = after.type === "invite" || typeof after.invite === "object";
      if (!isInvite) {
        console.log("❌ [InviteCal] Not an invite message");
        return;
      }

      const status =
        after.inviteStatus ||
        after?.invite?.inviteStatus ||
        "pending";

      console.log("✅ [InviteCal] status:", status, "calendarSynced:", after.calendarSynced === true);

      // Only act when accepted (NO transition requirement)
      if (status !== "accepted") {
        console.log("❌ [InviteCal] Status is not accepted; skipping");
        return;
      }

      // participants: prefer message sender/recipient
      const senderId = typeof after.senderId === "string" ? after.senderId : null;
      const recipientId = typeof after.recipientId === "string" ? after.recipientId : null;

      let participants: string[] = [];
      if (senderId && recipientId) {
        participants = [senderId, recipientId];
      } else {
        // fallback to conversation participants
        const convoSnap = await db.collection("conversations").doc(conversationId).get();
        const convo = convoSnap.exists ? (convoSnap.data() as any) : null;
        participants = Array.isArray(convo?.participants)
          ? convo.participants.filter(Boolean)
          : [];
      }

      participants = Array.from(new Set(participants)).slice(0, 2);

      if (participants.length < 2) {
        console.log("❌ [InviteCal] Missing participants", { senderId, recipientId, participants });
        return;
      }

      // Invite fields
      const invite = pickInviteFields(after);
      console.log("✅ [InviteCal] invite fields:", invite);

      if (!invite.startISO) {
        console.log("❌ [InviteCal] Missing startISO; skipping");
        return;
      }

      const inviteId = messageId;                 // ✅ inviteId === messageId
const inviteEventId = `invite_${inviteId}`; // ✅ calendar "eventId" label for invite type

      // ---------------------------
      // ✅ REPAIR MODE:
      // If calendarSynced=true but calendar docs don't exist, we still create them.
      // We'll check one expected doc (sender) existence.
      // ---------------------------
      const primaryUid = participants[0];
      const primaryCalDocId = `${inviteId}_${primaryUid}`;
      const primarySnap = await db.collection("calendar_events").doc(primaryCalDocId).get();

      if (after.calendarSynced === true && primarySnap.exists) {
        console.log("✅ [InviteCal] Already synced AND calendar doc exists; skipping", {
          primaryCalDocId,
        });
        return;
      }

      console.log("🛠️ [InviteCal] Creating/repairing calendar docs", {
        inviteEventId,
        participants,
        primaryCalDocId,
        primaryExists: primarySnap.exists,
      });

      // courtName: prefer explicit field, else invite.court.name, else top-level courtName
      const courtName =
        invite.courtName ||
        (typeof after?.invite?.court?.name === "string" ? after.invite.court.name : null) ||
        (typeof after?.courtName === "string" ? after.courtName : null) ||
        null;

      // idempotent upsert
      const batch = db.batch();

for (const uid of participants) {
  // ✅ predictable calendar doc id so we can delete later without storing calendarEventId
  const calDocId = `${inviteId}_${uid}`;
  const ref = db.collection("calendar_events").doc(calDocId);

  console.log("🗓️ [InviteCal] Upserting calendar doc:", calDocId);

  batch.set(
    ref,
    {
      // ✅ keep "eventId" as a label (distinct from real events)
      eventId: inviteEventId,

      // ✅ NEW: store inviteId for debugging/optional queries later
      inviteId,

      ownerId: uid,
      title: invite.title,
      start: invite.startISO,
      end: invite.endISO,
      participants,
      status: "accepted",
      visibility: "private",
      courtName,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      source: "cf:syncCalendarOnInviteAccepted",
      conversationId,
      messageId,
    },
    { merge: true }
  );
}

      // mark message as synced (always)
      batch.set(
        db.collection("conversations").doc(conversationId).collection("messages").doc(messageId),
        {
          calendarSynced: true,
          calendarSyncedAt: admin.firestore.FieldValue.serverTimestamp(),
          calendarSyncedVersion: 2, // helpful for future debugging
        },
        { merge: true }
      );

      await batch.commit();

    console.log("✅ [InviteCal] Calendar sync COMPLETE", {
  inviteId,
  inviteEventId,
  participants,
});

    } catch (err) {
      console.error("❌ [InviteCal] ERROR:", err);
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
        route: "/matches", // ✅ ADD
url: "https://tennismate.vercel.app/matches",
        source: "cf:sendMatchRequestNotification",
        runId, // 👈 for correlation
        timestamp: admin.firestore.FieldValue.serverTimestamp(),
        read: false,
      }, { merge: true });

      tx.set(matchRef, { bellNotified: true }, { merge: true });
    });

    console.log(`[MR_BELL][${runId}] canonical write complete`, { notifId });
    console.log(`[MR_BELL][${runId}] created bell notif doc`, {
  at: melNowISO(),
  notifId,
  matchId,
  toUserId,
  fromUserId,
});


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
