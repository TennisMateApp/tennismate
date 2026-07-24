/* eslint-disable max-len, require-jsdoc */
import assert from "node:assert/strict";
import test from "node:test";
import {MANUAL_DUPLICATE_DECISION_VERSION} from "../config";
import {applyManualDuplicateResolution, duplicateGroupFingerprint, ManualDuplicateResolution} from "../duplicateResolution";
import {normalizeMatchHistory} from "../normalization";

const events = ["one", "two"].map((id) => normalizeMatchHistory(id, {players: ["a", "b"], completed: true, playedDate: "2026-07-08"}));
function decision(overrides: Partial<ManualDuplicateResolution> = {}): ManualDuplicateResolution {
  return {duplicateGroupKey: events[0].duplicateGroupKey as string, groupFingerprint: duplicateGroupFingerprint(events), decision: "CONFIRMED_DUPLICATE", survivorEventId: events[0].canonicalMatchId, decisionReasonCode: "MANUAL_SOURCE_REVIEW", decisionVersion: MANUAL_DUPLICATE_DECISION_VERSION, source: "ADMIN_SCRIPT", ...overrides};
}
test("valid manual duplicate selects the named member idempotently", () => {
  const first = applyManualDuplicateResolution(events, decision());
  assert.equal(first.status, "MANUALLY_CONFIRMED_DUPLICATE");
  assert.equal(first.events.filter((event) => event.eligibleForScoring).length, 1);
  assert.deepEqual(applyManualDuplicateResolution(events, decision()), first);
});
test("manual distinct leaves all structurally eligible members scoring", () => {
  const result = applyManualDuplicateResolution(events, decision({decision: "CONFIRMED_DISTINCT", survivorEventId: null}));
  assert.ok(result.events.every((event) => event.eligibleForScoring));
});
test("stale fingerprint or invalid survivor fails closed", () => {
  assert.equal(applyManualDuplicateResolution(events, decision({groupFingerprint: "stale"})).status, "PENDING");
  assert.equal(applyManualDuplicateResolution(events, decision({survivorEventId: "missing"})).status, "PENDING");
});
