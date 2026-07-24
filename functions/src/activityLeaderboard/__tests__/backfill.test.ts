/* eslint-disable max-len */
import assert from "node:assert/strict";
import test from "node:test";
import {buildActivityBackfill, planActivityBackfill, reconcileActivityBackfill} from "../backfill";
import {normalizeMatchHistory} from "../normalization";

const records = [
  {id: "one", data: {players: ["a", "b"], completed: true, playedDate: "2026-07-08", matchRequestId: "one", inviteId: "shared"}},
  {id: "two", data: {players: ["b", "a"], completed: true, playedDate: "2026-07-08", matchRequestId: "two", inviteId: "shared"}},
  {id: "three", data: {players: ["c", "d"], completed: true, playedDate: "2026-07-09"}},
  {id: "four", data: {players: ["d", "c"], completed: true, playedDate: "2026-07-09"}},
];

test("backfill resolves confirmed groups and holds possible groups", () => {
  const report = buildActivityBackfill(records);
  assert.equal(report.autoResolvedConfirmedGroups, 1);
  assert.equal(report.possibleGroupsPending, 1);
  assert.equal(report.expectedScoringEligibleEventCount, 1);
  assert.equal(report.expectedPlayerMatchContributions, 2);
});

test("backfill checksum is independent of source query order", () => {
  assert.equal(buildActivityBackfill(records).deterministicOutputChecksum, buildActivityBackfill([...records].reverse()).deterministicOutputChecksum);
});

test("planning compares stored events without deletes and rejects newer versions", () => {
  const event = normalizeMatchHistory("three", records[2].data); const identical = planActivityBackfill([records[2]], null, {events: [event]}); assert.equal(identical.report.documentChanges.unchanged, 1); assert.equal(identical.report.documentChanges.wouldDelete, 0);
  const changed = {...event, eligibleForScoring: false}; assert.equal(planActivityBackfill([records[2]], null, {events: [changed]}).report.documentChanges.wouldUpdate, 1);
  const newer = {...event, normalizationVersion: 99 as never}; assert.equal(planActivityBackfill([records[2]], null, {events: [newer]}).failures[0].category, "UNSUPPORTED_NEWER_VERSION");
});

test("reconciliation detects exact, missing, unexpected, and eligibility mismatch", () => {
  const plan = planActivityBackfill([records[2]]); const exact = reconcileActivityBackfill(plan, {events: plan.events, duplicateReviews: plan.duplicateReviews, dirtyMonths: plan.report.dirtyMonths}); assert.equal(exact.matches, true);
  assert.equal(reconcileActivityBackfill(plan, {events: [], duplicateReviews: [], dirtyMonths: plan.report.dirtyMonths}).missingRecordsCount, 1);
  const mismatch = {...plan.events[0], eligibleForScoring: false}; assert.equal(reconcileActivityBackfill(plan, {events: [mismatch], duplicateReviews: [], dirtyMonths: plan.report.dirtyMonths}).scoringEligibilityMismatches, 1);
  const extra = normalizeMatchHistory("extra", {players: ["x", "y"], completed: true, playedDate: "2026-07-10"}); assert.equal(reconcileActivityBackfill(plan, {events: [...plan.events, extra], duplicateReviews: [], dirtyMonths: plan.report.dirtyMonths}).unexpectedRecordsCount, 1);
});
