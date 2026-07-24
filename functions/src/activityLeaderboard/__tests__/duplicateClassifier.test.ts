/* eslint-disable max-len, require-jsdoc */
import assert from "node:assert/strict";
import test from "node:test";
import {
  applyDuplicateClassification,
  classifyDuplicateCandidates,
} from "../duplicateClassifier";
import {normalizeMatchHistory} from "../normalization";

function event(id: string, overrides: Record<string, unknown> = {}) {
  return normalizeMatchHistory(id, {
    players: ["a", "b"],
    completed: true,
    playedDate: "2026-07-08",
    ...overrides,
  });
}

test("same request or invite confirms the same match", () => {
  assert.equal(classifyDuplicateCandidates(
    event("one", {matchRequestId: "request"}),
    event("two", {matchRequestId: "request"})
  ).classification, "CONFIRMED_SAME_MATCH");
  assert.equal(classifyDuplicateCandidates(
    event("one", {inviteId: "invite"}),
    event("two", {inviteId: "invite"})
  ).classification, "CONFIRMED_SAME_MATCH");
});

test("same pair and date alone is possible, not confirmed", () => {
  assert.equal(classifyDuplicateCandidates(event("one"), event("two")).classification, "POSSIBLE_SAME_MATCH");
});

test("matching score remains possible without authoritative lineage", () => {
  assert.equal(classifyDuplicateCandidates(
    event("one", {score: "6-4 6-4"}),
    event("two", {score: "6-4 6-4"})
  ).classification, "POSSIBLE_SAME_MATCH");
});

test("distinct requests make a same-day match a likely rematch", () => {
  assert.equal(classifyDuplicateCandidates(
    event("one", {matchRequestId: "request-one"}),
    event("two", {matchRequestId: "request-two"})
  ).classification, "LIKELY_DISTINCT_REMATCH");
});

test("materially different score, court, or conversation indicates rematch", () => {
  const first = event("one", {score: "6-4 6-4", court: {id: "court-one"}, conversationId: "chat-one"});
  const second = event("two", {score: "6-0 6-0", court: {id: "court-two"}, conversationId: "chat-two"});
  assert.equal(classifyDuplicateCandidates(first, second).classification, "LIKELY_DISTINCT_REMATCH");
});

test("different pair or date is not a duplicate candidate", () => {
  assert.equal(classifyDuplicateCandidates(event("one"), event("two", {players: ["a", "c"]})).classification, "NONE");
  assert.equal(classifyDuplicateCandidates(event("one"), event("two", {playedDate: "2026-07-09"})).classification, "NONE");
});

test("shared authoritative identifier confirms across different dates", () => {
  assert.equal(classifyDuplicateCandidates(
    event("one", {inviteId: "shared", playedDate: "2026-07-08"}),
    event("two", {inviteId: "shared", playedDate: "2026-07-09"})
  ).classification, "CONFIRMED_SAME_MATCH");
});

test("classification and group key are stable", () => {
  const first = classifyDuplicateCandidates(event("one"), event("two"));
  const second = classifyDuplicateCandidates(event("one"), event("two"));
  assert.deepEqual(first, second);
});

test("possible duplicates are excluded from scoring", () => {
  const classified = applyDuplicateClassification(
    event("one"),
    "POSSIBLE_SAME_MATCH",
    ["SAME_PAIR_AND_DATE"]
  );
  assert.equal(classified.eligible, true);
  assert.equal(classified.eligibleForScoring, false);
  assert.equal(classified.duplicateReviewStatus, "PENDING");
});

test("likely distinct rematches remain scoring eligible", () => {
  const classified = applyDuplicateClassification(
    event("one"),
    "LIKELY_DISTINCT_REMATCH",
    ["DISTINCT_REQUESTS"]
  );
  assert.equal(classified.eligibleForScoring, true);
  assert.equal(classified.duplicateReviewStatus, "AUTO_RESOLVED");
  assert.equal(classified.scoreConfirmedByBoth, false);
});

test("structurally invalid events remain excluded", () => {
  const invalid = normalizeMatchHistory("invalid", {completed: true});
  assert.equal(applyDuplicateClassification(
    invalid,
    "LIKELY_DISTINCT_REMATCH",
    []
  ).eligibleForScoring, false);
});
