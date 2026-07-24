/* eslint-disable max-len */
import assert from "node:assert/strict";
import test from "node:test";
import * as admin from "firebase-admin";
import {normalizeMatchHistory} from "../normalization";

const completedAt = admin.firestore.Timestamp.fromDate(new Date("2026-07-12T03:00:00Z"));
const base = {players: ["player-b", "player-a"], completed: true, completedAt};

test("normalizes a valid completed match", () => {
  const event = normalizeMatchHistory("history-1", base);
  assert.equal(event.eligible, true);
  assert.deepEqual(event.participantIds, ["player-a", "player-b"]);
  assert.equal(event.pairId, "player-a_player-b");
  assert.equal(event.monthKey, "2026-07");
});

test("accepts completion via status", () => {
  assert.equal(normalizeMatchHistory("id", {...base, completed: false, status: "completed"}).eligible, true);
});

test("marks incomplete and not-played matches ineligible", () => {
  assert.ok(normalizeMatchHistory("id", {...base, completed: false}).ineligibilityReasons.includes("NOT_COMPLETED"));
  const notPlayed = normalizeMatchHistory("id", {...base, status: "not_played", outcome: "not_played"});
  assert.ok(notPlayed.ineligibilityReasons.includes("NOT_PLAYED"));
});

test("reports missing activity date and invalid participants", () => {
  const event = normalizeMatchHistory("id", {completed: true, players: ["only"]});
  assert.ok(event.ineligibilityReasons.includes("MISSING_ACTIVITY_DATE"));
  assert.ok(event.ineligibilityReasons.includes("INVALID_PARTICIPANT_COUNT"));
});

test("prefers playedDate and falls back to completedAt", () => {
  const preferred = normalizeMatchHistory("id", {...base, playedDate: "2026-07-01"});
  assert.equal(preferred.activityDateSource, "playedDate");
  assert.equal(preferred.activityAt?.toISOString(), "2026-06-30T14:00:00.000Z");
  const fallback = normalizeMatchHistory("id", {...base, playedDate: "invalid"});
  assert.equal(fallback.activityDateSource, "completedAt");
});

test("builds deterministic, namespaced canonical IDs", () => {
  const requestA = normalizeMatchHistory("one", {...base, matchRequestId: " request/unsafe "});
  const requestB = normalizeMatchHistory("two", {...base, matchRequestId: "request/unsafe"});
  const invite = normalizeMatchHistory("one", {...base, inviteId: "request/unsafe"});
  assert.equal(requestA.canonicalMatchId, requestB.canonicalMatchId);
  assert.match(requestA.canonicalMatchId, /^request_[a-f0-9]{64}$/);
  assert.notEqual(requestA.canonicalMatchId, invite.canonicalMatchId);
});

test("leaderboard fingerprint is stable and ignores irrelevant fields", () => {
  const first = normalizeMatchHistory("id", {...base, updatedAt: new Date("2026-07-01")});
  const second = normalizeMatchHistory("id", {...base, updatedAt: new Date("2026-07-02")});
  assert.equal(first.leaderboardFingerprint, second.leaderboardFingerprint);
});

test("detects score presence but never confirms it", () => {
  const event = normalizeMatchHistory("id", {...base, score: "6-4, 6-4"});
  assert.equal(event.scorePresent, true);
  assert.equal(event.scoreConfirmedByBoth, false);
});

test("normal and structurally invalid events expose scoring eligibility", () => {
  assert.equal(normalizeMatchHistory("valid", base).eligibleForScoring, true);
  assert.equal(normalizeMatchHistory("invalid", {completed: true}).eligibleForScoring, false);
});

test("source fingerprint and duplicate defaults are deterministic", () => {
  const first = normalizeMatchHistory("id", base);
  const second = normalizeMatchHistory("id", base);
  assert.equal(first.sourceFingerprint, second.sourceFingerprint);
  assert.equal(first.duplicateClassification, "NONE");
  assert.equal(first.duplicateReviewStatus, "NOT_REQUIRED");
});
