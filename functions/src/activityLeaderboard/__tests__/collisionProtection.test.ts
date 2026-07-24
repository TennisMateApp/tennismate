/* eslint-disable max-len, require-jsdoc */
import assert from "node:assert/strict";
import test from "node:test";
import {
  applyCanonicalSourceConflict,
  canonicalConflictAffectedMonths,
  hasCanonicalSourceConflict,
} from "../collisionProtection";
import {normalizeMatchHistory} from "../normalization";

function source(id: string, requestId = "shared") {
  return normalizeMatchHistory(id, {
    players: ["a", "b"],
    matchRequestId: requestId,
    completed: true,
    playedDate: id === "old" ? "2026-06-30" : "2026-07-01",
  });
}

test("same canonical ID and source path is idempotent", () => {
  const existing = source("old");
  assert.equal(hasCanonicalSourceConflict(existing, existing), false);
});

test("different source path creates bounded conflict state", () => {
  const existing = source("old");
  const incoming = source("new");
  assert.equal(hasCanonicalSourceConflict(existing, incoming), true);
  const conflict = applyCanonicalSourceConflict(existing, incoming);
  assert.equal(conflict.eligible, false);
  assert.equal(conflict.eligibleForScoring, false);
  assert.ok(conflict.ineligibilityReasons.includes("CANONICAL_SOURCE_CONFLICT"));
  assert.deepEqual(conflict.conflictingSourcePaths, ["match_history/new", "match_history/old"]);
});

test("repeated and concurrent-equivalent conflict handling is stable", () => {
  const existing = source("old");
  const incoming = source("new");
  const once = applyCanonicalSourceConflict(existing, incoming);
  const twice = applyCanonicalSourceConflict(once, incoming);
  assert.deepEqual(twice.conflictingSourcePaths, once.conflictingSourcePaths);
  assert.deepEqual(twice.conflictingSourceFingerprints, once.conflictingSourceFingerprints);
});

test("both affected months are marked for dirty processing", () => {
  assert.deepEqual(canonicalConflictAffectedMonths(source("old"), source("new")), ["2026-06", "2026-07"]);
});
