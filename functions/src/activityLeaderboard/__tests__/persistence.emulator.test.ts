/* eslint-disable max-len, require-jsdoc, brace-style, block-spacing */
import assert from "node:assert/strict";
import {after, before, beforeEach, test} from "node:test";
import * as admin from "firebase-admin";
import {MANUAL_DUPLICATE_DECISION_VERSION} from "../config";
import {duplicateGroupFingerprint} from "../duplicateResolution";
import {normalizeMatchHistory} from "../normalization";
import {normalizeAndPersistMatchHistoryWrite, storedActivityEvent} from "../persistence";
import {MatchHistorySource} from "../types";

if (!process.env.FIRESTORE_EMULATOR_HOST) throw new Error("FIRESTORE_EMULATOR_HOST is required; production fallback is forbidden");
const app = admin.initializeApp({projectId: "demo-tennismate-persistence"}, `activity-${Date.now()}`);
const db = app.firestore();
const base = (overrides: MatchHistorySource = {}): MatchHistorySource => ({players: ["player-a", "player-b"], completed: true, playedDate: "2026-07-08", ...overrides});
async function clear(): Promise<void> { for (const collection of await db.listCollections()) await db.recursiveDelete(collection); }
async function events() { return (await db.collection("activity_match_events").get()).docs.map((doc) => storedActivityEvent(doc.data())).sort((a, b) => a.sourcePath.localeCompare(b.sourcePath)); }
async function handle(id: string, beforeData: MatchHistorySource | null, afterData: MatchHistorySource | null) { return normalizeAndPersistMatchHistoryWrite(db, {sourceDocumentId: id, before: beforeData, after: afterData}); }
before(async () => clear());
beforeEach(async () => clear());
after(async () => { await clear(); await app.delete(); });

test("concurrent same-source normalization is deterministic and deduplicated", async () => {
  await Promise.all([handle("same", null, base()), handle("same", null, base())]);
  const stored = await events();
  assert.equal(stored.length, 1); assert.equal(stored[0].sourcePath, "match_history/same"); assert.equal(stored[0].eligibleForScoring, true); assert.deepEqual(stored[0].conflictingSourcePaths, []);
  const dirty = (await db.doc("activity_recalculation_requests/2026-07").get()).data();
  assert.equal(new Set(dirty?.sourceEventIds).size, dirty?.sourceEventIds.length);
  assert.equal((await db.collection("activity_duplicate_reviews").get()).size, 0);
});

test("concurrent canonical collision quarantines without replacement and is retry stable", async () => {
  const july = base({matchRequestId: "shared"});
  const june = base({matchRequestId: "shared", playedDate: "2026-06-30"});
  await Promise.all([handle("original", null, july), handle("collision", null, june)]);
  const first = await events(); assert.equal(first.length, 1); assert.equal(first[0].eligible, false); assert.equal(first[0].eligibleForScoring, false); assert.ok(first[0].ineligibilityReasons.includes("CANONICAL_SOURCE_CONFLICT")); assert.equal(new Set(first[0].conflictingSourcePaths).size, first[0].conflictingSourcePaths.length);
  assert.equal((await db.doc("activity_recalculation_requests/2026-06").get()).exists, true); assert.equal((await db.doc("activity_recalculation_requests/2026-07").get()).exists, true);
  const fingerprint = JSON.stringify({paths: first[0].conflictingSourcePaths, reasons: first[0].ineligibilityReasons});
  await Promise.all([handle("original", null, july), handle("collision", null, june)]);
  const retried = await events(); assert.equal(JSON.stringify({paths: retried[0].conflictingSourcePaths, reasons: retried[0].ineligibilityReasons}), fingerprint);
});

async function confirmed(order: string[]) {
  const sources: Record<string, MatchHistorySource> = {rich: base({matchRequestId: "rich-request", inviteId: "shared-invite", conversationId: "conversation", score: "6-4"}), plain: base({matchRequestId: "plain-request", inviteId: "shared-invite"})};
  for (const id of order) await handle(id, null, sources[id]);
  return {stored: await events(), review: (await db.collection("activity_duplicate_reviews").limit(1).get()).docs[0].data(), sources};
}
test("confirmed survivor is insertion-order independent, retry-safe, and reselected after deletion", async () => {
  const forward = await confirmed(["plain", "rich"]); const survivor = forward.review.survivorEventId;
  assert.equal(forward.stored.filter((event) => event.eligibleForScoring).length, 1); assert.equal(forward.review.status, "AUTO_RESOLVED"); assert.equal(forward.review.excludedEventIds.length, 1);
  await clear(); const reverse = await confirmed(["rich", "plain"]); assert.equal(reverse.review.survivorEventId, survivor);
  await handle("rich", reverse.sources.rich, reverse.sources.rich); assert.equal((await db.collection("activity_duplicate_reviews").limit(1).get()).docs[0].data().survivorEventId, survivor);
  await handle("rich", reverse.sources.rich, null); const remaining = await events(); assert.equal(remaining.length, 1); assert.equal(remaining[0].eligibleForScoring, true); assert.equal(remaining[0].duplicateResolutionRole, "NOT_APPLICABLE"); assert.equal((await db.collection("activity_duplicate_reviews").get()).size, 0);
  await handle("rich", reverse.sources.rich, null); assert.equal((await events()).length, 1);
});

test("survivor modification recalculates precedence without stale roles", async () => {
  const state = await confirmed(["plain", "rich"]); assert.equal(state.review.survivorEventId, normalizeMatchHistory("rich", state.sources.rich).canonicalMatchId);
  const reduced = base({matchRequestId: "rich-request", inviteId: "shared-invite"});
  await handle("rich", state.sources.rich, reduced); const stored = await events(); const review = (await db.collection("activity_duplicate_reviews").limit(1).get()).docs[0].data();
  assert.equal(stored.filter((event) => event.eligibleForScoring).length, 1); assert.equal(stored.filter((event) => event.duplicateResolutionRole === "EXCLUDED_DUPLICATE").length, 1); assert.equal(review.survivorEventId, normalizeMatchHistory("plain", state.sources.plain).canonicalMatchId);
});

test("manual duplicate and distinct decisions override automatic or pending state", async () => {
  const possibleA = base(); const possibleB = base({score: "6-4"});
  await handle("manual-a", null, possibleA); await handle("manual-b", null, possibleB);
  let stored = await events(); const reviewSnap = (await db.collection("activity_duplicate_reviews").limit(1).get()).docs[0]; const groupKey = reviewSnap.id;
  const manualSurvivor = stored[0].canonicalMatchId;
  await db.doc(`activity_duplicate_resolutions/${groupKey}`).set({duplicateGroupKey: groupKey, groupFingerprint: duplicateGroupFingerprint(stored), decision: "CONFIRMED_DUPLICATE", survivorEventId: manualSurvivor, decisionReasonCode: "MANUAL_SOURCE_REVIEW", decisionVersion: MANUAL_DUPLICATE_DECISION_VERSION, source: "ADMIN_SCRIPT"});
  await handle("manual-b", possibleB, possibleB); stored = await events(); assert.equal(stored.find((event) => event.eligibleForScoring)?.canonicalMatchId, manualSurvivor);
  await db.doc(`activity_duplicate_resolutions/${groupKey}`).set({duplicateGroupKey: groupKey, groupFingerprint: duplicateGroupFingerprint(stored), decision: "CONFIRMED_DISTINCT", survivorEventId: null, decisionReasonCode: "MANUAL_SOURCE_REVIEW", decisionVersion: MANUAL_DUPLICATE_DECISION_VERSION, source: "ADMIN_SCRIPT"});
  await handle("manual-b", possibleB, possibleB); stored = await events(); assert.ok(stored.every((event) => event.eligibleForScoring)); assert.equal((await db.doc(`activity_duplicate_reviews/${groupKey}`).get()).data()?.status, "MANUALLY_CONFIRMED_DISTINCT");
});

test("stale manual fingerprint fails closed with inspectable status", async () => {
  const a = base(); const b = base(); await handle("stale-a", null, a); await handle("stale-b", null, b);
  const review = (await db.collection("activity_duplicate_reviews").limit(1).get()).docs[0];
  await db.doc(`activity_duplicate_resolutions/${review.id}`).set({duplicateGroupKey: review.id, groupFingerprint: "stale", decision: "CONFIRMED_DISTINCT", survivorEventId: null, decisionReasonCode: "MANUAL_SOURCE_REVIEW", decisionVersion: MANUAL_DUPLICATE_DECISION_VERSION, source: "ADMIN_SCRIPT"});
  await handle("stale-b", b, b); assert.ok((await events()).every((event) => !event.eligibleForScoring)); const data = (await review.ref.get()).data(); assert.equal(data?.staleManualResolution, true); assert.equal(data?.manualResolutionStatus, "STALE_OR_REJECTED");
});

test("deleting a manually selected survivor invalidates the decision without substitution", async () => {
  const a = base(); const b = base({score: "6-4"}); await handle("delete-manual-a", null, a); await handle("delete-manual-b", null, b);
  const stored = await events(); const review = (await db.collection("activity_duplicate_reviews").limit(1).get()).docs[0]; const survivor = stored[0];
  await db.doc(`activity_duplicate_resolutions/${review.id}`).set({duplicateGroupKey: review.id, groupFingerprint: duplicateGroupFingerprint(stored), decision: "CONFIRMED_DUPLICATE", survivorEventId: survivor.canonicalMatchId, decisionReasonCode: "MANUAL_SOURCE_REVIEW", decisionVersion: MANUAL_DUPLICATE_DECISION_VERSION, source: "ADMIN_SCRIPT"});
  await handle("delete-manual-b", b, b); const chosen = (await events()).find((event) => event.canonicalMatchId === survivor.canonicalMatchId); assert.equal(chosen?.eligibleForScoring, true);
  const survivorId = survivor.sourceDocumentId; await handle(survivorId, survivorId === "delete-manual-a" ? a : b, null); const remaining = await events(); assert.equal(remaining.length, 1); assert.equal(remaining[0].eligibleForScoring, false); const reviewData = (await review.ref.get()).data(); assert.equal(reviewData?.manualResolutionStatus, "STALE_OR_REJECTED"); assert.equal(reviewData?.survivorEventId, null);
});

test("possible duplicates remain pending while distinct rematches score", async () => {
  await handle("possible-a", null, base()); await handle("possible-b", null, base()); assert.ok((await events()).every((event) => !event.eligibleForScoring)); assert.equal((await db.collection("activity_duplicate_reviews").limit(1).get()).docs[0].data().status, "PENDING");
  await clear(); await handle("rematch-a", null, base({matchRequestId: "request-a", score: "6-0", conversationId: "one"})); await handle("rematch-b", null, base({matchRequestId: "request-b", score: "7-5", conversationId: "two"})); assert.ok((await events()).every((event) => event.eligibleForScoring));
});

test("trigger-compatible create update ineligible transition and delete dirty exact months", async () => {
  const july = base(); const august = base({playedDate: "2026-08-02"});
  assert.equal((await handle("lifecycle", null, july)).operation, "create"); assert.equal((await handle("lifecycle", july, august)).operation, "update");
  assert.equal((await db.doc("activity_recalculation_requests/2026-07").get()).exists, true); assert.equal((await db.doc("activity_recalculation_requests/2026-08").get()).exists, true); assert.equal((await db.collection("activity_recalculation_requests").get()).size, 2);
  const notPlayed = {...august, completed: false, status: "not_played", outcome: "not_played"}; await handle("lifecycle", august, notPlayed); assert.equal((await events())[0].eligibleForScoring, false); assert.equal((await events())[0].eligible, false);
  assert.equal((await handle("lifecycle", notPlayed, null)).operation, "delete"); assert.equal((await events()).length, 0);
});

test("collision and dirty diagnostics remain bounded and deduplicated", async () => {
  for (let index = 0; index < 23; index += 1) await handle(`bounded-${index}`, null, base({matchRequestId: "bounded-shared", playedDate: index % 2 ? "2026-06-30" : "2026-07-08"}));
  const event = (await events())[0]; assert.ok(event.conflictingSourcePaths.length <= 20); assert.ok(event.conflictingSourceFingerprints.length <= 20); assert.equal(new Set(event.conflictingSourcePaths).size, event.conflictingSourcePaths.length); assert.equal(new Set(event.conflictingSourceFingerprints).size, event.conflictingSourceFingerprints.length);
  for (const month of ["2026-06", "2026-07"]) { const dirty = (await db.doc(`activity_recalculation_requests/${month}`).get()).data(); assert.ok(dirty?.sourceEventIds.length <= 20); assert.equal(new Set(dirty?.sourceEventIds).size, dirty?.sourceEventIds.length); }
});
