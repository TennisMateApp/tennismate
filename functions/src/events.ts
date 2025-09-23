import * as admin from "firebase-admin";
import { onCall } from "firebase-functions/v2/https";
import { onSchedule } from "firebase-functions/v2/scheduler";

const db = admin.firestore();

type Action = "PROPOSE" | "ACCEPT" | "DECLINE" | "CANCEL";

// Client normally creates "proposed" directly. Keep this in case you want server-create.
export const proposeEvent = onCall(async (req) => {
  const uid = req.auth?.uid;
  if (!uid) throw new Error("Unauthenticated");

  const {
    title, start, end, timeZone,
    participants, conversationId, location, notes
  } = req.data as {
    title: string;
    start: string; // ISO
    end: string;   // ISO
    timeZone: string;
    participants: string[];
    conversationId?: string;
    location?: string;
    notes?: string;
  };

  if (!participants?.includes(uid)) throw new Error("You must be a participant");
  if (new Date(start) >= new Date(end)) throw new Error("Invalid time range");

  const ref = db.collection("calendar_events").doc();
  await ref.set({
    title,
    start: admin.firestore.Timestamp.fromDate(new Date(start)),
    end: admin.firestore.Timestamp.fromDate(new Date(end)),
    timeZone,
    createdBy: uid,
    participants,
    status: "proposed",
    conversationId: conversationId || null,
    location: location || "",
    notes: notes || "",
    lastActionBy: uid,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  });

  return { ok: true, id: ref.id };
});

/**
 * Accept/Decline/Cancel with conflict-check on ACCEPT
 */
export const updateEvent = onCall(async (req) => {
  const uid = req.auth?.uid;
  if (!uid) throw new Error("Unauthenticated");

  const { eventId, action } = req.data as { eventId: string; action: Action };

  return await db.runTransaction(async (tx) => {
    const ref = db.collection("calendar_events").doc(eventId);
    const snap = await tx.get(ref);
    if (!snap.exists) throw new Error("Event not found");
    const ev = snap.data()!;

    if (!ev.participants?.includes(uid)) throw new Error("Not a participant");

    const current: string = ev.status;
    const next =
      action === "ACCEPT" ? "accepted" :
      action === "DECLINE" ? "declined" :
      action === "CANCEL" ? "cancelled" :
      "proposed";

    const valid =
      (current === next) ||
      (current === "proposed" && (next === "accepted" || next === "declined" || next === "cancelled")) ||
      (current === "accepted" && next === "cancelled");

    if (!valid) throw new Error("Invalid status transition");

    // Conflict check for ACCEPT (no overlapping accepted events for the actor)
    if (action === "ACCEPT") {
      const q = db.collection("calendar_events")
        .where("participants", "array-contains", uid)
        .where("status", "==", "accepted");
      const existing = await tx.get(q);
      const startMs = ev.start.toMillis();
      const endMs = ev.end.toMillis();
      const overlaps = existing.docs.some(d => {
        const e = d.data();
        const s = e.start.toMillis();
        const n = e.end.toMillis();
        return !(endMs <= s || startMs >= n);
      });
      if (overlaps) throw new Error("Time conflict");
    }

    tx.update(ref, {
      status: next,
      lastActionBy: uid,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    return { ok: true, status: next };
  });
});

/** Auto-cancel stale proposals older than 72h */
export const expireProposals = onSchedule("every 6 hours", async () => {
  const cutoff = admin.firestore.Timestamp.fromDate(new Date(Date.now() - 72 * 60 * 60 * 1000));
  const q = db.collection("calendar_events")
    .where("status", "==", "proposed")
    .where("createdAt", "<", cutoff);

  const batch = db.batch();
  const snaps = await q.get();
  snaps.forEach(doc => {
    batch.update(doc.ref, {
      status: "cancelled",
      lastActionBy: "system",
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    });
  });
  if (!snaps.empty) await batch.commit();
});
