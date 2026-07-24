/* eslint-disable max-len, require-jsdoc */
import assert from "node:assert/strict";
import test from "node:test";
import {assertPhase2AuditReconstructionSafeguards, isExactPhase2AuditAutomationConfirmation, parsePhase2AuditReconstructionOptions} from "../phase2RunAuditCli";
import {PHASE2_JUNE_PILOT_CHECKSUM} from "../phase2RunAudit";

test("historical audit CLI parser defaults to read-only", () => {
  const options = parsePhase2AuditReconstructionOptions([]);
  assert.equal(options.write, false); assert.equal(options.month, null);
  assert.doesNotThrow(() => assertPhase2AuditReconstructionSafeguards(options, {}));
});

test("historical audit write requires every production guard", () => {
  const options = parsePhase2AuditReconstructionOptions(["--month=2026-06", "--write", "--confirm-project=tennismate-d8acb", `--confirm-source-checksum=${PHASE2_JUNE_PILOT_CHECKSUM}`]);
  assert.throws(() => assertPhase2AuditReconstructionSafeguards(options, {}), /RECONSTRUCTION_ENABLED/);
  assert.doesNotThrow(() => assertPhase2AuditReconstructionSafeguards(options, {ACTIVITY_PHASE2_AUDIT_RECONSTRUCTION_ENABLED: "true"}));
  assert.throws(() => assertPhase2AuditReconstructionSafeguards({...options, month: "2026-07"}, {ACTIVITY_PHASE2_AUDIT_RECONSTRUCTION_ENABLED: "true"}), /month/);
  assert.throws(() => assertPhase2AuditReconstructionSafeguards(options, {ACTIVITY_PHASE2_AUDIT_RECONSTRUCTION_ENABLED: "true", FIRESTORE_EMULATOR_HOST: "127.0.0.1:8188"}), /refuses emulator/);
});

test("automation confirmation accepts only the exact approved phrase", () => {
  assert.equal(isExactPhase2AuditAutomationConfirmation("tennismate-d8acb 2026-06 RECONSTRUCT AUDIT"), true);
  assert.equal(isExactPhase2AuditAutomationConfirmation("tennismate-d8acb 2026-06 RECALCULATE"), false);
  assert.equal(isExactPhase2AuditAutomationConfirmation(undefined), false);
});
