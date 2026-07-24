/* eslint-disable max-len, no-console, require-jsdoc, curly, brace-style, block-spacing */
import {createInterface} from "readline/promises";
import {stdin as input, stdout as output} from "process";
import {admin} from "./adminSdk";
import {assertPhase2AuditReconstructionSafeguards, isExactPhase2AuditAutomationConfirmation, parsePhase2AuditReconstructionOptions, PHASE2_AUDIT_RECONSTRUCTION_CONFIRMATION} from "./phase2RunAuditCli";
import {PHASE2_JUNE_PILOT_CHECKSUM, reconstructHistoricalJunePilotAudit} from "./phase2RunAudit";
import {PHASE2_PRODUCTION_PROJECT} from "./pilotCli";

async function confirm(): Promise<void> {
  const expected = PHASE2_AUDIT_RECONSTRUCTION_CONFIRMATION;
  if (!input.isTTY || !output.isTTY) {
    if (isExactPhase2AuditAutomationConfirmation(process.env.ACTIVITY_PHASE2_AUDIT_RECONSTRUCTION_CONFIRMATION)) return;
    throw new Error("Production audit reconstruction requires an interactive terminal or the exact guarded automation confirmation");
  }
  const reader = createInterface({input, output});
  try {const answer = await reader.question(`Type ${expected} to continue: `); if (answer !== expected) throw new Error("Interactive production confirmation failed");} finally {reader.close();}
}

async function main(): Promise<void> {
  const options = parsePhase2AuditReconstructionOptions(process.argv.slice(2));
  assertPhase2AuditReconstructionSafeguards(options, process.env);
  if (admin.apps.length === 0) admin.initializeApp({projectId: PHASE2_PRODUCTION_PROJECT});
  const db = admin.firestore();
  const preview = await reconstructHistoricalJunePilotAudit(db, {expectedChecksum: options.confirmSourceChecksum || PHASE2_JUNE_PILOT_CHECKSUM, write: false});
  console.log(JSON.stringify({mode: options.write ? "PRODUCTION_WRITE_PENDING_CONFIRMATION" : "READ_ONLY_PREVIEW", projectId: PHASE2_PRODUCTION_PROJECT, month: preview.record.month, runId: preview.record.runId, path: preview.path, status: preview.record.status, generationId: preview.record.generationId, sourceChecksum: preview.record.sourceChecksum, sourceEventCount: preview.record.sourceEventCount, scoringEventCount: preview.record.scoringEventCount, wouldCreate: preview.wouldCreate}, null, 2));
  if (!options.write) return;
  await confirm();
  const result = await reconstructHistoricalJunePilotAudit(db, {expectedChecksum: options.confirmSourceChecksum || "", write: true});
  console.log(JSON.stringify({status: result.wouldCreate ? "CREATED" : "ALREADY_EXISTS", path: result.path, recordOrigin: result.record.recordOrigin}, null, 2));
}

main().catch((error) => {console.error(JSON.stringify({script: "reconstructPhase2JuneAudit", errorCategory: error instanceof Error ? error.name : "UNKNOWN"})); process.exitCode = 1;});
