/* eslint-disable max-len */
import assert from "node:assert/strict";
import {after, beforeEach, test} from "node:test";
import * as admin from "firebase-admin";
import {MANUAL_DUPLICATE_DECISION_VERSION} from "../config";
import {duplicateGroupFingerprint, ManualDuplicateResolution} from "../duplicateResolution";
import {persistManualDuplicateResolution} from "../manualResolutionPersistence";
import {normalizeMatchHistory} from "../normalization";
import {activityEventPayload} from "../persistence";

if (!process.env.FIRESTORE_EMULATOR_HOST) throw new Error("FIRESTORE_EMULATOR_HOST is required; production fallback is forbidden");
const app = admin.initializeApp({projectId: "demo-tennismate-manual-resolution"}, `manual-resolution-${Date.now()}`);
const db = app.firestore();
async function clear() {for (const collection of await db.listCollections()) await db.recursiveDelete(collection);}
beforeEach(clear);
after(async () => {await clear(); await app.delete();});

async function seed(months = ["2026-07", "2026-07"]) {
  const events = months.map((month, index) => normalizeMatchHistory(`event-${index}`, {players: ["a", "b"], completed: true, playedDate: `${month}-08`, matchRequestId: `request-${index}`}));
  const group = "manual-group";
  await Promise.all(events.map((event) => db.doc(`activity_match_events/${event.canonicalMatchId}`).set(activityEventPayload({...event, duplicateGroupKey: group, duplicateClassification: "POSSIBLE_SAME_MATCH", duplicateReviewStatus: "PENDING", duplicateResolutionRole: "PENDING_REVIEW", eligibleForScoring: false}))));
  await db.doc(`activity_duplicate_reviews/${group}`).set({sourceEventIds: events.map((event) => event.canonicalMatchId), affectedMonthKeys: months, status: "PENDING"});
  return {events, group, fingerprint: duplicateGroupFingerprint(events)};
}
function resolution(group: string, fingerprint: string, survivorEventId: string | null, decision: "CONFIRMED_DUPLICATE" | "CONFIRMED_DISTINCT" = "CONFIRMED_DUPLICATE"): ManualDuplicateResolution {
  return {duplicateGroupKey: group, groupFingerprint: fingerprint, decision, survivorEventId, decisionReasonCode: "MANUAL_SOURCE_REVIEW", decisionVersion: MANUAL_DUPLICATE_DECISION_VERSION, source: "ADMIN_SCRIPT"};
}

test("manual duplicate resolution dirties every affected month and does not publish", async () => {
  const seeded = await seed(["2026-06", "2026-07"]);
  const result = await persistManualDuplicateResolution(db, resolution(seeded.group, seeded.fingerprint, seeded.events[0].canonicalMatchId));
  assert.deepEqual(result.affectedMonthKeys, ["2026-06", "2026-07"]);
  for (const month of result.affectedMonthKeys) assert.equal((await db.doc(`activity_recalculation_requests/${month}`).get()).data()?.status, "pending");
  assert.equal((await db.collection("activity_leaderboards").get()).empty, true);
  assert.equal((await db.collection("activity_months").get()).empty, true);
});

test("distinct, survivor changes and identical retries are handled idempotently", async () => {
  const seeded = await seed();
  const first = await persistManualDuplicateResolution(db, resolution(seeded.group, seeded.fingerprint, seeded.events[0].canonicalMatchId));
  assert.equal(first.alreadyApplied, false);
  const repeat = await persistManualDuplicateResolution(db, resolution(seeded.group, seeded.fingerprint, seeded.events[0].canonicalMatchId));
  assert.equal(repeat.alreadyApplied, true);
  const changed = await persistManualDuplicateResolution(db, resolution(seeded.group, seeded.fingerprint, seeded.events[1].canonicalMatchId));
  assert.equal(changed.alreadyApplied, false);
  assert.equal((await db.doc(`activity_duplicate_reviews/${seeded.group}`).get()).data()?.survivorEventId, seeded.events[1].canonicalMatchId);
  const distinct = await persistManualDuplicateResolution(db, resolution(seeded.group, seeded.fingerprint, null, "CONFIRMED_DISTINCT"));
  assert.equal(distinct.alreadyApplied, false);
  const stored = await Promise.all(seeded.events.map((event) => db.doc(`activity_match_events/${event.canonicalMatchId}`).get()));
  assert.ok(stored.every((snapshot) => snapshot.data()?.eligibleForScoring === true));
});

test("stale resolution is rejected without dirtying a month", async () => {
  const seeded = await seed();
  await assert.rejects(() => persistManualDuplicateResolution(db, resolution(seeded.group, "stale", seeded.events[0].canonicalMatchId)), /Group changed/);
  assert.equal((await db.collection("activity_recalculation_requests").get()).empty, true);
});
