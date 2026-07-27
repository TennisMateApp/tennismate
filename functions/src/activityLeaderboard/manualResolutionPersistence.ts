import * as admin from "firebase-admin";
import {applyManualDuplicateResolution, duplicateGroupFingerprint, ManualDuplicateResolution} from "./duplicateResolution";
import {markActivityMonthsDirty, storedActivityEvent} from "./persistence";

function resolutionMatches(data: FirebaseFirestore.DocumentData | undefined, resolution: ManualDuplicateResolution): boolean {
  return Boolean(data) && data?.groupFingerprint === resolution.groupFingerprint && data?.decision === resolution.decision && (data?.survivorEventId || null) === (resolution.survivorEventId || null) && data?.decisionVersion === resolution.decisionVersion;
}

export async function persistManualDuplicateResolution(
  db: FirebaseFirestore.Firestore,
  resolution: ManualDuplicateResolution
): Promise<{alreadyApplied: boolean; affectedMonthKeys: string[]}> {
  const group = resolution.duplicateGroupKey;
  return db.runTransaction(async (transaction) => {
    const reviewRef = db.collection("activity_duplicate_reviews").doc(group);
    const resolutionRef = db.collection("activity_duplicate_resolutions").doc(group);
    const [reviewSnap, storedResolutionSnap] = await Promise.all([transaction.get(reviewRef), transaction.get(resolutionRef)]);
    if (!reviewSnap.exists) throw new Error("Duplicate review group does not exist");
    const ids = Array.isArray(reviewSnap.data()?.sourceEventIds) ? reviewSnap.data()?.sourceEventIds.filter((id: unknown): id is string => typeof id === "string") : [];
    const refs = ids.map((id: string) => db.collection("activity_match_events").doc(id));
    const snapshots = await Promise.all(refs.map((ref: FirebaseFirestore.DocumentReference) => transaction.get(ref)));
    const events = snapshots.filter((snap) => snap.exists).map((snap) => storedActivityEvent(snap.data() || {}));
    if (duplicateGroupFingerprint(events) !== resolution.groupFingerprint) throw new Error("Group changed during resolution; retry preview");
    const applied = applyManualDuplicateResolution(events, resolution);
    if (applied.status === "PENDING") throw new Error("Resolution became invalid");
    const affectedMonthKeys = [...new Set([
      ...events.map((event) => event.monthKey),
      ...(Array.isArray(reviewSnap.data()?.affectedMonthKeys) ? reviewSnap.data()?.affectedMonthKeys : []),
    ].filter((month): month is string => typeof month === "string" && /^\d{4}-\d{2}$/.test(month)))].sort();
    if (storedResolutionSnap.exists && resolutionMatches(storedResolutionSnap.data(), resolution)) return {alreadyApplied: true, affectedMonthKeys};
    await markActivityMonthsDirty(db, transaction, affectedMonthKeys, "MANUAL_DUPLICATE_RESOLUTION", group);
    transaction.set(resolutionRef, {...resolution, decidedAt: admin.firestore.FieldValue.serverTimestamp()}, {merge: false});
    for (const event of applied.events) transaction.set(db.collection("activity_match_events").doc(event.canonicalMatchId), {duplicateReviewStatus: event.duplicateReviewStatus, duplicateResolutionRole: event.duplicateResolutionRole, duplicateSurvivorEventId: event.duplicateSurvivorEventId, eligibleForScoring: event.eligibleForScoring, normalizedAt: admin.firestore.FieldValue.serverTimestamp()}, {merge: true});
    transaction.set(reviewRef, {status: applied.status, survivorEventId: applied.survivorEventId, excludedEventIds: applied.excludedEventIds, groupFingerprint: resolution.groupFingerprint, resolutionVersion: resolution.decisionVersion, affectedMonthKeys, resolvedAt: admin.firestore.FieldValue.serverTimestamp()}, {merge: true});
    return {alreadyApplied: false, affectedMonthKeys};
  });
}
