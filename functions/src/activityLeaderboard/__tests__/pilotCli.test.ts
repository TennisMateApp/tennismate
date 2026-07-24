/* eslint-disable max-len */
import assert from "node:assert/strict";
import test from "node:test";
import {assertPhase2PilotSafeguards, isExactPhase2PilotAutomationConfirmation, parsePhase2PilotOptions, PHASE2_PRODUCTION_PROJECT} from "../pilotCli";

const checksum = "a".repeat(64);

test("pilot parser accepts only explicit guarded options", () => {
  const parsed = parsePhase2PilotOptions(["--month=2025-12", "--write", `--confirm-project=${PHASE2_PRODUCTION_PROJECT}`, `--confirm-source-checksum=${checksum}`]);
  assert.deepEqual(parsed, {month: "2025-12", write: true, confirmProject: PHASE2_PRODUCTION_PROJECT, confirmSourceChecksum: checksum});
  assert.throws(() => parsePhase2PilotOptions(["2025-12"]), /ambiguous/);
  assert.throws(() => parsePhase2PilotOptions(["--force"]), /Unknown/);
});

test("pilot safeguards fail closed for month, project, checksum, and emulators", () => {
  const valid = parsePhase2PilotOptions(["--month=2025-12", "--write", `--confirm-project=${PHASE2_PRODUCTION_PROJECT}`, `--confirm-source-checksum=${checksum}`]); const env = {ACTIVITY_PHASE2_ENABLED: "false", ACTIVITY_PHASE2_PILOT_MONTH: "2025-12"};
  assert.doesNotThrow(() => assertPhase2PilotSafeguards(valid, checksum, env));
  assert.throws(() => assertPhase2PilotSafeguards({...valid, month: "2026-05"}, checksum, env), /not in the controlled/);
  assert.throws(() => assertPhase2PilotSafeguards({...valid, confirmProject: "wrong"}, checksum, env), /confirm-project/);
  assert.throws(() => assertPhase2PilotSafeguards(valid, "b".repeat(64), env), /checksum mismatch/);
  assert.throws(() => assertPhase2PilotSafeguards(valid, checksum, {...env, FIRESTORE_EMULATOR_HOST: "127.0.0.1:8188"}), /refuses emulator/);
  assert.throws(() => assertPhase2PilotSafeguards(valid, checksum, {}), /explicitly false/);
});

test("automation confirmation requires the exact approved month phrase", () => {
  assert.equal(isExactPhase2PilotAutomationConfirmation("tennismate-d8acb 2025-12 RECALCULATE", "2025-12"), true);
  assert.equal(isExactPhase2PilotAutomationConfirmation("tennismate-d8acb 2026-02 RECALCULATE", "2025-12"), false);
});
