// functions/src/referralOnMatchAccepted.ts
import * as admin from "firebase-admin";
import { onDocumentUpdated } from "firebase-functions/v2/firestore";

try { admin.app(); } catch { admin.initializeApp(); }
const db = admin.firestore();

export const referralOnMatchAccepted = onDocumentUpdated(
  { region: "australia-southeast1", document: "match_requests/{matchId}" },
  async (event) => {
    const before = event.data?.before?.data();
    const after  = event.data?.after?.data();
    if (!before || !after) return;

    // Only act when status flips to 'accepted'
    if (before.status === "accepted" || after.status !== "accepted") return;

    const fromUserId = String(after.fromUserId || "");
    const toUserId   = String(after.toUserId || "");
    if (!fromUserId || !toUserId) return;

    // Stamp only; no credits here
    await Promise.all([
      stampFirstAccepted(fromUserId),
      stampFirstAccepted(toUserId),
    ]);
  }
);

async function stampFirstAccepted(uid: string) {
  const userRef = db.doc(`users/${uid}`);
  await db.runTransaction(async (tx) => {
    const snap = await tx.get(userRef);
    if (!snap.exists || !snap.data()?.firstMatchAcceptedAt) {
      tx.set(
        userRef,
        { firstMatchAcceptedAt: admin.firestore.FieldValue.serverTimestamp() },
        { merge: true }
      );
    }
  });
}
