// functions/src/matchEvents.ts (v2)
import { onDocumentCreated, onDocumentUpdated } from "firebase-functions/v2/firestore";
import * as admin from "firebase-admin";
admin.initializeApp();
const db = admin.firestore();

export const onEventCreated = onDocumentCreated("match_events/{eventId}", async (event) => {
  const data = event.data?.data();
  if (!data) return;
  const recipientIds = (data.participants || []).filter((id: string) => id !== data.proposerId);

  await Promise.all(recipientIds.map((rid: string) =>
    db.collection("notifications").add({
      recipientId: rid,
      message: `New time proposed: ${data.start.toDate().toLocaleString()}`,
      type: "event_proposed",
      read: false,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    })
  ));
});

export const onEventUpdated = onDocumentUpdated("match_events/{eventId}", async (event) => {
  const before = event.data?.before.data();
  const after = event.data?.after.data();
  if (!before || !after) return;

  if (before.state !== after.state) {
    const msg =
      after.state === "accepted" ? "Time accepted ✅"
      : after.state === "declined" ? "Time declined ❌"
      : after.state === "cancelled" ? "Time cancelled"
      : `Event ${after.state}`;

    await Promise.all((after.participants || []).map((rid: string) =>
      db.collection("notifications").add({
        recipientId: rid,
        message: msg,
        type: "event_state",
        read: false,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
      })
    ));
  }
});
