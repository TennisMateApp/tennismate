import * as admin from "firebase-admin";
import { onSchedule } from "firebase-functions/v2/scheduler";

if (admin.apps.length === 0) {
  admin.initializeApp();
}

const db = admin.firestore();

const PROD_DELAY_MS = 30 * 60 * 1000;
const DEV_DELAY_MS = 3 * 60 * 1000;
const SCAN_EVERY_MINUTES = 10;
const SCAN_WINDOW_MS = (SCAN_EVERY_MINUTES + 2) * 60 * 1000;
const MAX_OVERDUE_MS = 6 * 60 * 60 * 1000;
const MAX_INVITE_AGE_MS = 7 * 24 * 60 * 60 * 1000;

type InviteDoc = {
  inviteStatus?: string | null;
  fromUserId?: string | null;
  toUserId?: string | null;
  conversationId?: string | null;
  invite?: {
    startISO?: string | null;
    endISO?: string | null;
    durationMins?: number | null;
    location?: string | null;
    court?: {
      name?: string | null;
    } | null;
  } | null;
  startISO?: string | null;
  endISO?: string | null;
  durationMins?: number | null;
  courtName?: string | null;
  debugPostMatchReminderMins?: number | null;
  postMatchReminderSentTo?: Record<string, unknown> | null;
};

function getStartISO(invite: InviteDoc): string | null {
  return (
    (typeof invite.invite?.startISO === "string" && invite.invite.startISO) ||
    (typeof invite.startISO === "string" && invite.startISO) ||
    null
  );
}

function getDurationMins(invite: InviteDoc): number | null {
  const value =
    typeof invite.invite?.durationMins === "number"
      ? invite.invite.durationMins
      : typeof invite.durationMins === "number"
      ? invite.durationMins
      : null;

  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : null;
}

function computeEndISO(invite: InviteDoc): string | null {
  const explicit =
    (typeof invite.invite?.endISO === "string" && invite.invite.endISO) ||
    (typeof invite.endISO === "string" && invite.endISO) ||
    null;
  if (explicit) return explicit;

  const startISO = getStartISO(invite);
  const durationMins = getDurationMins(invite);
  if (!startISO || typeof durationMins !== "number") return null;

  const startMs = Date.parse(startISO);
  if (!Number.isFinite(startMs)) return null;

  return new Date(startMs + durationMins * 60 * 1000).toISOString();
}

function getReminderDelayMs(invite: InviteDoc): number {
  const overrideMins = invite.debugPostMatchReminderMins;
  if (
    typeof overrideMins === "number" &&
    Number.isFinite(overrideMins) &&
    overrideMins >= 1 &&
    overrideMins <= 15
  ) {
    return overrideMins * 60 * 1000;
  }

  return process.env.FUNCTIONS_EMULATOR === "true" ? DEV_DELAY_MS : PROD_DELAY_MS;
}

function getReminderDueMs(invite: InviteDoc): number | null {
  const endISO = computeEndISO(invite);
  if (!endISO) return null;

  const endMs = Date.parse(endISO);
  if (!Number.isFinite(endMs)) return null;

  return endMs + getReminderDelayMs(invite);
}

function hasSentTo(map: Record<string, unknown> | null | undefined, uid: string): boolean {
  return !!(map && Object.prototype.hasOwnProperty.call(map, uid) && map[uid] != null);
}

async function getPlayerName(uid: string): Promise<string> {
  try {
    const snap = await db.collection("players").doc(uid).get();
    const name = snap.exists ? (snap.get("name") as string | undefined) : undefined;
    return name || "your opponent";
  } catch {
    return "your opponent";
  }
}

export const sendPostMatchRemindersV2 = onSchedule(
  {
    schedule: `every ${SCAN_EVERY_MINUTES} minutes`,
    timeZone: "Australia/Sydney",
    region: "australia-southeast1",
    memory: "256MiB",
  },
  async () => {
    const runId = Math.random().toString(36).slice(2);
    const nowMs = Date.now();

    console.log("[PostMatchReminder] scan start", {
      runId,
      nowIso: new Date(nowMs).toISOString(),
      scanWindowMs: SCAN_WINDOW_MS,
      maxOverdueMs: MAX_OVERDUE_MS,
      maxInviteAgeMs: MAX_INVITE_AGE_MS,
    });

    const snap = await db
      .collection("match_invites")
      .where("inviteStatus", "==", "accepted")
      .get();

    if (snap.empty) {
      console.log("[PostMatchReminder] no accepted invites", { runId });
      return;
    }

    let considered = 0;
    let queued = 0;

    for (const inviteSnap of snap.docs) {
      const inviteId = inviteSnap.id;
      const invite = (inviteSnap.data() || {}) as InviteDoc;
      const fromUserId = typeof invite.fromUserId === "string" ? invite.fromUserId : null;
      const toUserId = typeof invite.toUserId === "string" ? invite.toUserId : null;
      const conversationId =
        typeof invite.conversationId === "string" ? invite.conversationId : null;
      const startISO = getStartISO(invite);
      const endISO = computeEndISO(invite);
      const dueMs = getReminderDueMs(invite);

      if (!fromUserId || !toUserId || !conversationId || !startISO || dueMs === null) {
        console.log("[PostMatchReminder] skip malformed invite", {
          runId,
          inviteId,
          fromUserId,
          toUserId,
          conversationId,
          startISO,
          endISO,
          dueMs,
        });
        continue;
      }

      considered += 1;

      const startMs = Date.parse(startISO);
      if (!Number.isFinite(startMs) || nowMs - startMs > MAX_INVITE_AGE_MS) {
        continue;
      }

      const msUntilDue = dueMs - nowMs;
      const overdueMs = nowMs - dueMs;
      if (msUntilDue > 0 || overdueMs > MAX_OVERDUE_MS || overdueMs > SCAN_WINDOW_MS) {
        continue;
      }

      const convoSnap = await db.collection("conversations").doc(conversationId).get();
      const convo = convoSnap.exists ? (convoSnap.data() as any) : null;

      if (convo?.matchCheckInResolved === true || convo?.matchCheckInSuppressed === true) {
        console.log("[PostMatchReminder] skip resolved conversation", {
          runId,
          inviteId,
          conversationId,
          matchCheckInResolved: convo?.matchCheckInResolved === true,
          matchCheckInSuppressed: convo?.matchCheckInSuppressed === true,
        });
        continue;
      }

      const recipients = [fromUserId, toUserId];
      const opponentNames = await Promise.all([
        getPlayerName(toUserId),
        getPlayerName(fromUserId),
      ]);

      const batch = db.batch();
      let wroteAny = false;

      for (const [index, recipientId] of recipients.entries()) {
        if (hasSentTo(invite.postMatchReminderSentTo, recipientId)) {
          continue;
        }

        const notifId = `post_match_${inviteId}_${recipientId}`;
        const notifRef = db.collection("notifications").doc(notifId);
        const route = `/home?overlay=didPlayPrompt&conversationId=${encodeURIComponent(conversationId)}`;
        const body = `Did you and ${opponentNames[index]} end up having a game?`;

        batch.set(
          notifRef,
          {
            recipientId,
            fromUserId: recipients[index === 0 ? 1 : 0],
            type: "match_check_in",
            inviteId,
            conversationId,
            title: "Did you play your match?",
            body,
            message: body,
            route,
            url: `https://tennismate.vercel.app${route}`,
            read: false,
            timestamp: admin.firestore.FieldValue.serverTimestamp(),
            createdAt: admin.firestore.FieldValue.serverTimestamp(),
            source: "cf:postMatchReminder",
            runId,
          },
          { merge: true }
        );

        batch.set(
          inviteSnap.ref,
          {
            [`postMatchReminderSentTo.${recipientId}`]:
              admin.firestore.FieldValue.serverTimestamp(),
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          },
          { merge: true }
        );

        wroteAny = true;
        queued += 1;
      }

      if (!wroteAny) {
        continue;
      }

      await batch.commit();
      console.log("[PostMatchReminder] queued notifications", {
        runId,
        inviteId,
        conversationId,
        fromUserId,
        toUserId,
        startISO,
        endISO,
        dueIso: new Date(dueMs).toISOString(),
      });
    }

    console.log("[PostMatchReminder] scan complete", {
      runId,
      considered,
      queued,
    });
  }
);
