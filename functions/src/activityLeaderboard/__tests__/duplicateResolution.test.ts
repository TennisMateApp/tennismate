/* eslint-disable max-len, require-jsdoc */
import assert from "node:assert/strict";
import test from "node:test";
import {resolveConfirmedDuplicateGroup} from "../duplicateResolution";
import {normalizeMatchHistory} from "../normalization";

function event(id: string, overrides: Record<string, unknown> = {}) {
  return normalizeMatchHistory(id, {players: ["a", "b"], completed: true, completedAt: new Date("2026-07-08T01:00:00Z"), matchRequestId: `request-${id}`, inviteId: "shared", ...overrides});
}

test("confirmed duplicates select exactly one deterministic survivor", () => {
  const plain = event("z");
  const rich = event("a", {playedDate: "2026-07-08", conversationId: "conversation", score: "6-4 6-4"});
  const forward = resolveConfirmedDuplicateGroup([plain, rich]);
  const reverse = resolveConfirmedDuplicateGroup([rich, plain]);
  assert.equal(forward.status, "AUTO_RESOLVED");
  assert.equal(forward.survivorEventId, rich.canonicalMatchId);
  assert.deepEqual(forward, reverse);
  assert.equal(forward.events.filter((item) => item.eligibleForScoring).length, 1);
  assert.equal(forward.events.find((item) => item.canonicalMatchId === plain.canonicalMatchId)?.duplicateResolutionRole, "EXCLUDED_DUPLICATE");
});

test("retrying resolution is idempotent", () => {
  const resolved = resolveConfirmedDuplicateGroup([event("b"), event("a")]);
  assert.deepEqual(resolveConfirmedDuplicateGroup(resolved.events), resolved);
});

test("material conflicts remain pending and non-scoring", () => {
  const result = resolveConfirmedDuplicateGroup([event("a", {score: "6-0", winnerId: "a"}), event("b", {score: "7-5", winnerId: "b"})]);
  assert.equal(result.status, "PENDING");
  assert.ok(result.resolutionReasonCodes.includes("CONFLICTING_SCORES"));
  assert.ok(result.events.every((item) => !item.eligibleForScoring));
});

test("deleting the survivor selects the next member", () => {
  const first = event("a", {playedDate: "2026-07-08"});
  const second = event("b");
  assert.equal(resolveConfirmedDuplicateGroup([first, second]).survivorEventId, first.canonicalMatchId);
  const third = event("c");
  assert.equal(resolveConfirmedDuplicateGroup([second, third]).events.filter((item) => item.eligibleForScoring).length, 1);
});
