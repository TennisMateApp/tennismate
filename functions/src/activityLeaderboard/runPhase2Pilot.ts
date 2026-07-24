/* eslint-disable max-len, no-console, require-jsdoc, curly, brace-style, block-spacing */
import {createInterface} from "readline/promises";
import {stdin as input, stdout as output} from "process";
import {admin} from "./adminSdk";
import {calculateMonthlyActivity} from "./monthlyCalculation";
import {assertPhase2PilotSafeguards, isExactPhase2PilotAutomationConfirmation, parsePhase2PilotOptions, phase2PilotConfirmation, PHASE2_PRODUCTION_PROJECT} from "./pilotCli";
import {recalculateActivityMonth} from "./monthlyRecalculation";
import {storedActivityEvent} from "./persistence";

async function confirm(calculation: ReturnType<typeof calculateMonthlyActivity>): Promise<void> {
  console.log(JSON.stringify({mode: "PRODUCTION_WRITE_PENDING_CONFIRMATION", projectId: PHASE2_PRODUCTION_PROJECT, monthKey: calculation.monthKey, sourceEventCount: calculation.sourceEventCount, scoringEventCount: calculation.scoringEventCount, aggregatePlayerCount: calculation.aggregates.length, rankingCount: calculation.rankings.length, sourceChecksum: calculation.sourceChecksum, generationId: calculation.generationId}, null, 2));
  const expected = phase2PilotConfirmation(calculation.monthKey);
  if (!input.isTTY || !output.isTTY) {
    if (isExactPhase2PilotAutomationConfirmation(process.env.ACTIVITY_PHASE2_PILOT_CONFIRMATION, calculation.monthKey)) return;
    throw new Error("Production pilot requires an interactive terminal or the exact guarded automation confirmation");
  }
  const reader = createInterface({input, output});
  try {const answer = await reader.question(`Type ${expected} to continue: `); if (answer !== expected) throw new Error("Interactive production confirmation failed");} finally {reader.close();}
}

async function main(): Promise<void> {
  const options = parsePhase2PilotOptions(process.argv.slice(2));
  if (admin.apps.length === 0) admin.initializeApp({projectId: PHASE2_PRODUCTION_PROJECT}); const db = admin.firestore();
  const month = options.month || ""; const eventSnapshot = await db.collection("activity_match_events").where("monthKey", "==", month).get(); const events = eventSnapshot.docs.map((document) => storedActivityEvent(document.data())); const calculation = calculateMonthlyActivity(events, month);
  assertPhase2PilotSafeguards(options, calculation.sourceChecksum, process.env);
  const approved: Record<string, {sources: number; scoring: number; rows: number; pending: number; excluded: number}> = {"2025-12": {sources: 1, scoring: 1, rows: 2, pending: 0, excluded: 0}, "2026-02": {sources: 2, scoring: 2, rows: 3, pending: 0, excluded: 0}, "2026-03": {sources: 11, scoring: 9, rows: 12, pending: 0, excluded: 2}, "2026-04": {sources: 8, scoring: 5, rows: 10, pending: 2, excluded: 1}, "2026-07": {sources: 3, scoring: 1, rows: 2, pending: 2, excluded: 0}}; const expected = approved[month];
  if (!expected || calculation.sourceEventCount !== expected.sources || calculation.scoringEventCount !== expected.scoring || calculation.aggregates.length !== expected.rows || calculation.rankings.length !== expected.rows) throw new Error("Pilot calculation does not match the approved controlled counts");
  const pendingDuplicates = events.filter((event) => event.duplicateResolutionRole === "PENDING_REVIEW").length; const confirmedExclusions = events.filter((event) => event.duplicateResolutionRole === "EXCLUDED_DUPLICATE").length; const canonicalConflicts = events.filter((event) => event.ineligibilityReasons.includes("CANONICAL_SOURCE_CONFLICT")).length;
  if (pendingDuplicates !== expected.pending || confirmedExclusions !== expected.excluded || canonicalConflicts !== 0 || calculation.rejectedMalformedCount !== 0) throw new Error("Pilot calculation does not match the approved controlled data-quality counts");
  const [request, monthParent, leaderboardParent, existingRuns] = await Promise.all([db.doc(`activity_recalculation_requests/${month}`).get(), db.doc(`activity_months/${month}`).get(), db.doc(`activity_leaderboards/${month}`).get(), db.collection("activity_phase2_runs").where("month", "==", month).get()]);
  if (!request.exists || request.data()?.status !== "pending" || Number(request.data()?.attempts || 0) !== 0) throw new Error("Pilot recalculation request must be pending at attempt zero");
  if (monthParent.exists || leaderboardParent.exists || !existingRuns.empty) throw new Error("Pilot month already has generated or run-audit state");
  console.log(JSON.stringify({mode: "READ_ONLY_VALIDATION_COMPLETE", monthKey: month, sourceEventCount: calculation.sourceEventCount, scoringEventCount: calculation.scoringEventCount, aggregatePlayerCount: calculation.aggregates.length, rankingCount: calculation.rankings.length, sourceChecksum: calculation.sourceChecksum, generationId: calculation.generationId}, null, 2));
  await confirm(calculation);
  const runId = `phase2-pilot-${month}-${Date.now()}`;
  const result = await recalculateActivityMonth(db, month, {runId, triggerType: "pilot", expectedSourceChecksum: calculation.sourceChecksum, hooks: {afterClaim: async () => {const audit = await db.doc(`activity_phase2_runs/${runId}`).get(); if (!audit.exists || audit.data()?.status !== "RUNNING") throw new Error("Phase 2 audit did not enter RUNNING before processing"); console.log(JSON.stringify({runId, observedAuditStatus: "RUNNING"}));}}});
  console.log(JSON.stringify({status: "COMPLETED", runId, monthKey: month, generationId: result.generationId, sourceChecksum: result.sourceChecksum, aggregatePlayerCount: result.aggregates.length, rankingCount: result.rankings.length}, null, 2));
}

main().catch((error) => {console.error(JSON.stringify({script: "runPhase2Pilot", errorCategory: error instanceof Error ? error.name : "UNKNOWN", message: error instanceof Error ? error.message : String(error)})); process.exitCode = 1;});
