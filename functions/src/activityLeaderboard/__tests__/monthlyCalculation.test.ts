/* eslint-disable max-len, require-jsdoc, brace-style, block-spacing */
import assert from "node:assert/strict";
import test from "node:test";
import {calculateMonthlyActivity, MalformedScoringEventError, MAX_POINT_BEARING_MATCHES_PER_OPPONENT} from "../monthlyCalculation";
import {normalizeMatchHistory} from "../normalization";
import {NormalizedActivityEvent} from "../types";

function event(id: string, players: [string, string], day: string, overrides: Partial<NormalizedActivityEvent> = {}): NormalizedActivityEvent { return {...normalizeMatchHistory(id, {players, completed: true, playedDate: day, matchRequestId: id}), ...overrides}; }

test("eligible events credit both participants once and ineligible events do not", () => {
  const eligible = event("one", ["a", "b"], "2026-07-01"); const ineligible = event("two", ["a", "c"], "2026-07-02", {eligible: false, eligibleForScoring: false}); const result = calculateMonthlyActivity([eligible, ineligible], "2026-07");
  assert.equal(result.scoringEventCount, 1); assert.deepEqual(result.aggregates.map((item) => [item.playerId, item.eligibleActivityCount]), [["a", 1], ["b", 1]]); assert.ok(result.aggregates.every((item) => item.activityPoints === 15));
});

test("canonical retries credit once while excluded and possible duplicates remain unscored", () => {
  const included = event("included", ["a", "b"], "2026-07-01"); const excluded = event("excluded", ["a", "b"], "2026-07-01", {duplicateResolutionRole: "EXCLUDED_DUPLICATE", eligibleForScoring: false}); const possible = event("possible", ["c", "d"], "2026-07-02", {duplicateResolutionRole: "PENDING_REVIEW", eligibleForScoring: false}); const result = calculateMonthlyActivity([included, {...included}, excluded, possible], "2026-07");
  assert.equal(result.sourceEventCount, 3); assert.equal(result.scoringEventCount, 1); assert.equal(result.aggregates.length, 2);
});

test("repeat-opponent scoring is capped while raw activity remains uncapped", () => {
  const matches = Array.from({length: 7}, (_, index) => event(`repeat-${index}`, ["a", "b"], `2026-07-${String(index + 1).padStart(2, "0")}`)); const result = calculateMonthlyActivity(matches, "2026-07"); const aggregate = result.aggregates.find((item) => item.playerId === "a");
  assert.equal(aggregate?.eligibleActivityCount, 7); assert.equal(aggregate?.cappedActivityCount, MAX_POINT_BEARING_MATCHES_PER_OPPONENT); assert.equal(aggregate?.distinctOpponentCount, 1); assert.equal(aggregate?.activityPoints, 45);
});

test("rank ties use competition rank and deterministic last-activity/player ordering", () => {
  const result = calculateMonthlyActivity([event("ab", ["a", "b"], "2026-07-01"), event("cd", ["c", "d"], "2026-07-02")], "2026-07");
  assert.deepEqual(result.rankings.map((item) => item.playerId), ["c", "d", "a", "b"]); assert.deepEqual(result.rankings.map((item) => item.rank), [1, 1, 1, 1]); assert.deepEqual(result.rankings.map((item) => item.position), [1, 2, 3, 4]);
});

test("month boundaries are isolated and last activity is deterministic", () => {
  const june = event("june", ["a", "b"], "2026-06-30"); const julyEarly = event("july-early", ["a", "c"], "2026-07-01"); const julyLate = event("july-late", ["a", "d"], "2026-07-31"); const result = calculateMonthlyActivity([june, julyLate, julyEarly], "2026-07");
  assert.equal(result.sourceEventCount, 2); assert.equal(result.aggregates.find((item) => item.playerId === "a")?.lastActivityAt.toISOString(), julyLate.activityAt?.toISOString());
});

test("reruns are identical and malformed scoring events fail closed", () => {
  const events = [event("one", ["a", "b"], "2026-07-01")]; const first = calculateMonthlyActivity(events, "2026-07"); const second = calculateMonthlyActivity([...events].reverse(), "2026-07"); assert.equal(first.generationId, second.generationId); assert.equal(first.sourceChecksum, second.sourceChecksum); assert.deepEqual(first.aggregates, second.aggregates);
  assert.throws(() => calculateMonthlyActivity([event("bad", ["a", "b"], "2026-07-01", {participantIds: ["a", "a"]})], "2026-07"), MalformedScoringEventError);
});

test("profile snapshot changes create a rollback-safe generation without changing scoring", () => {
  const events = [event("one", ["a", "b"], "2026-07-01")];
  const before = calculateMonthlyActivity(events, "2026-07", new Map([["a", {displayName: "A", avatarUrl: "old"}]]));
  const after = calculateMonthlyActivity(events, "2026-07", new Map([["a", {displayName: "A", avatarUrl: "new"}]]));
  assert.equal(before.sourceChecksum, after.sourceChecksum);
  assert.notEqual(before.generationId, after.generationId);
  assert.deepEqual(before.aggregates.map(({generationId, ...row}) => row), after.aggregates.map(({generationId, ...row}) => row));
  assert.deepEqual(before.rankings.map(({avatarUrl, generationId, ...row}) => row), after.rankings.map(({avatarUrl, generationId, ...row}) => row));
});
