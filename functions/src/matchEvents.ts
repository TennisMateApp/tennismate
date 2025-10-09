// functions/src/matchEvents.ts (v2)
import { onDocumentCreated, onDocumentUpdated } from "firebase-functions/v2/firestore";
import * as admin from "firebase-admin";

if (!admin.apps.length) {
  admin.initializeApp();
}
const db = admin.firestore();

type MatchEventDoc = {
  title?: string;
  location?: string;
  start?: any; // Firestore Timestamp | string | Date
  end?: any;
  hostId?: string | null;
  participants?: string[];
  createdBy?: string | null; // if present, we'll exclude from notifications
  proposerId?: string | null; // alias some schemas use
  state?: "proposed" | "accepted" | "declined" | "cancelled" | string;
};

function toJSDate(v: any): Date | null {
  try {
    if (!v) return null;
    if (typeof v?.toDate === "function") return v.toDate();
    if (typeof v === "string" || typeof v === "number") return new Date(v);
    if (v instanceof Date) return v;
  } catch {}
  return null;
}

export const onEventCreated = onDocumentCreated("match_events/{eventId}", async (event) => {
  const data = (event.data?.data?.() ?? event.data?.data?.()) as MatchEventDoc | undefined;
  if (!data) return;

  // recipients = host + participants (unique), minus creator/proposer if available
  const hostId = data.hostId ?? null;
  const participants = Array.isArray(data.participants) ? data.participants : [];
  const maybeCreator = data.createdBy ?? data.proposerId ?? null;

  let recipientIds = Array.from(new Set([hostId, ...participants].filter(Boolean) as string[]));
  if (maybeCreator) {
    recipientIds = recipientIds.filter((id) => id !== maybeCreator);
  }
  if (recipientIds.length === 0) return;

  const startDate = toJSDate(data.start);
  const when = startDate ? startDate.toLocaleString() : "a new time";

  await Promise.all(
    recipientIds.map((rid) =>
      db.collection("notifications").add({
        recipientId: rid,
        message: `New time proposed: ${when}`,
        type: "event_proposed",
        read: false,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
      })
    )
  );
});

export const onEventUpdated = onDocumentUpdated("match_events/{eventId}", async (event) => {
  const before = (event.data?.before.data?.() ?? event.data?.before.data?.()) as MatchEventDoc | undefined;
  const after = (event.data?.after.data?.() ?? event.data?.after.data?.()) as MatchEventDoc | undefined;
  if (!before || !after) return;

  // Only notify if the state changed
  if (before.state === after.state) return;

  const msg =
    after.state === "accepted"
      ? "Time accepted ✅"
      : after.state === "declined"
      ? "Time declined ❌"
      : after.state === "cancelled"
      ? "Time cancelled"
      : `Event ${after.state}`;

  const recipients = Array.isArray(after.participants) ? after.participants : [];
  if (recipients.length === 0) return;

  await Promise.all(
    recipients.map((rid) =>
      db.collection("notifications").add({
        recipientId: rid,
        message: msg,
        type: "event_state",
        read: false,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
      })
    )
  );
});
