/* eslint-disable max-len */
import * as admin from "firebase-admin";
import {MANUAL_DUPLICATE_DECISION_VERSION} from "../functions/src/activityLeaderboard/config";
import {applyManualDuplicateResolution, duplicateGroupFingerprint, ManualDuplicateDecision, ManualDuplicateResolution} from "../functions/src/activityLeaderboard/duplicateResolution";
import {NormalizedActivityEvent} from "../functions/src/activityLeaderboard/types";

const EXPECTED_PROJECT = "tennismate-d8acb";
function option(name: string): string | null {
  const prefix = `--${name}=`;
  return process.argv.find((value) => value.startsWith(prefix))?.slice(prefix.length) || null;
}
function stored(data: FirebaseFirestore.DocumentData): NormalizedActivityEvent {
  const date = (value: unknown): Date | null => value && typeof (value as {toDate?: () => Date}).toDate === "function" ? (value as {toDate: () => Date}).toDate() : null;
  return {...data, activityAt: date(data.activityAt), sourceCompletedAt: date(data.sourceCompletedAt), sourceUpdatedAt: date(data.sourceUpdatedAt)} as NormalizedActivityEvent;
}

async function main(): Promise<void> {
  const group = option("group");
  const decision = option("decision") as ManualDuplicateDecision | null;
  const survivor = option("survivor");
  const reason = option("reason");
  const write = process.argv.includes("--write");
  if (!group || !reason || !["CONFIRMED_DUPLICATE", "CONFIRMED_DISTINCT"].includes(decision || "")) throw new Error("Required: --group, --decision and --reason");
  if (decision === "CONFIRMED_DUPLICATE" && !survivor) throw new Error("CONFIRMED_DUPLICATE requires --survivor");
  if (decision === "CONFIRMED_DISTINCT" && survivor) throw new Error("CONFIRMED_DISTINCT must not specify --survivor");
  if (admin.apps.length === 0) admin.initializeApp();
  const db = admin.firestore();
  const projectId = admin.app().options.projectId || process.env.GCLOUD_PROJECT || "UNKNOWN";
  console.log(JSON.stringify({mode: write ? "WRITE_REQUESTED" : "PREVIEW", projectId, group}));
  const reviewRef = db.collection("activity_duplicate_reviews").doc(group);
  const review = await reviewRef.get();
  if (!review.exists) throw new Error("Duplicate review group does not exist");
  const ids = Array.isArray(review.data()?.sourceEventIds) ? review.data()?.sourceEventIds.filter((id: unknown): id is string => typeof id === "string") : [];
  const refs = ids.map((id: string) => db.collection("activity_match_events").doc(id));
  const snapshots = await Promise.all(refs.map((ref: FirebaseFirestore.DocumentReference) => ref.get()));
  const events = snapshots.filter((snap) => snap.exists).map((snap) => stored(snap.data() || {}));
  const resolution: ManualDuplicateResolution = {duplicateGroupKey: group, groupFingerprint: duplicateGroupFingerprint(events), decision: decision as ManualDuplicateDecision, survivorEventId: survivor, decisionReasonCode: reason, decisionVersion: MANUAL_DUPLICATE_DECISION_VERSION, source: "ADMIN_SCRIPT"};
  const proposed = applyManualDuplicateResolution(events, resolution);
  console.log(JSON.stringify({memberCount: events.length, currentStatus: review.data()?.status || null, proposedStatus: proposed.status, excludedCount: proposed.excludedEventIds.length, monthKeys: [...new Set(events.map((event) => event.monthKey).filter(Boolean))].sort(), groupFingerprint: resolution.groupFingerprint}));
  if (!write) return;
  if (process.env.FIRESTORE_EMULATOR_HOST) throw new Error("Write mode refuses emulator configuration");
  if (projectId !== EXPECTED_PROJECT) throw new Error(`Write mode denied for project ${projectId}`);
  if (option("confirm") !== group) throw new Error("Write mode requires --confirm=<duplicateGroupKey>");
  if (proposed.status === "PENDING") throw new Error("Resolution is invalid or stale");
  await db.runTransaction(async (transaction) => {
    const current = await Promise.all(refs.map((ref: FirebaseFirestore.DocumentReference) => transaction.get(ref)));
    const currentEvents = current.filter((snap) => snap.exists).map((snap) => stored(snap.data() || {}));
    if (duplicateGroupFingerprint(currentEvents) !== resolution.groupFingerprint) throw new Error("Group changed during resolution; retry preview");
    const applied = applyManualDuplicateResolution(currentEvents, resolution);
    if (applied.status === "PENDING") throw new Error("Resolution became invalid");
    transaction.set(db.collection("activity_duplicate_resolutions").doc(group), {...resolution, decidedAt: admin.firestore.FieldValue.serverTimestamp()}, {merge: false});
    for (const event of applied.events) transaction.set(db.collection("activity_match_events").doc(event.canonicalMatchId), {duplicateReviewStatus: event.duplicateReviewStatus, duplicateResolutionRole: event.duplicateResolutionRole, duplicateSurvivorEventId: event.duplicateSurvivorEventId, eligibleForScoring: event.eligibleForScoring, normalizedAt: admin.firestore.FieldValue.serverTimestamp()}, {merge: true});
    transaction.set(reviewRef, {status: applied.status, survivorEventId: applied.survivorEventId, excludedEventIds: applied.excludedEventIds, groupFingerprint: resolution.groupFingerprint, resolutionVersion: resolution.decisionVersion, resolvedAt: admin.firestore.FieldValue.serverTimestamp()}, {merge: true});
  });
}
main().catch((error: unknown) => { console.error(JSON.stringify({script: "setActivityDuplicateResolution", error: error instanceof Error ? error.message : String(error)})); process.exitCode = 1; });
