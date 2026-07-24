/* eslint-disable max-len, no-console, require-jsdoc, curly, brace-style, block-spacing */
import {promises as fs} from "fs";
import path from "path";
import {createInterface} from "readline/promises";
import {stdin as input, stdout as output} from "process";
import {activityChecksum, planActivityBackfill, reconcileActivityBackfill, StoredBackfillState} from "../functions/src/activityLeaderboard/backfill";
import {admin, FieldValue} from "../functions/src/activityLeaderboard/adminSdk";
import {ACTIVITY_BACKFILL_FORMAT_VERSION, DUPLICATE_CLASSIFICATION_VERSION, DUPLICATE_RESOLUTION_VERSION, NORMALIZATION_VERSION} from "../functions/src/activityLeaderboard/config";
import {normalizeAndPersistMatchHistoryWrite, storedActivityEvent} from "../functions/src/activityLeaderboard/persistence";
import {privacySafeRefHash} from "../functions/src/activityLeaderboard/privacyLogging";
import {MatchHistorySource} from "../functions/src/activityLeaderboard/types";
import {activeProjectId, assertFreshChecksum, assertWriteSafeguards, parseActivityBackfillOptions, PRODUCTION_PROJECT_ID} from "./activityLeaderboardBackfillCli";

const MAX_ATTEMPTS = 3;
const transientCodes = new Set(["aborted", "cancelled", "deadline-exceeded", "internal", "resource-exhausted", "unavailable", "unknown"]);
function projectFromCredential(): string | null { return activeProjectId(admin.app().options, process.env); }
async function readSources(db: FirebaseFirestore.Firestore, month: string | null, limit: number | null) {
  let query: FirebaseFirestore.Query = db.collection("match_history").orderBy(admin.firestore.FieldPath.documentId()); if (limit !== null) query = query.limit(limit);
  const snapshot = await query.get(); return snapshot.docs.map((doc) => ({id: doc.id, data: doc.data() as MatchHistorySource}));
}
async function readStored(db: FirebaseFirestore.Firestore, month: string | null): Promise<StoredBackfillState> {
  let eventsQuery: FirebaseFirestore.Query = db.collection("activity_match_events"); if (month) eventsQuery = eventsQuery.where("monthKey", "==", month);
  let reviewsQuery: FirebaseFirestore.Query = db.collection("activity_duplicate_reviews"); if (month) reviewsQuery = reviewsQuery.where("affectedMonthKeys", "array-contains", month);
  const [events, reviews, resolutions, dirty] = await Promise.all([eventsQuery.get(), reviewsQuery.get(), db.collection("activity_duplicate_resolutions").get(), db.collection("activity_recalculation_requests").get()]);
  return {events: events.docs.map((doc) => storedActivityEvent(doc.data())), duplicateReviews: reviews.docs.map((doc) => ({id: doc.id, data: doc.data()})), duplicateResolutions: resolutions.docs.map((doc) => doc.data() as never), dirtyMonths: dirty.docs.map((doc) => doc.id).filter((key) => !month || key === month)};
}
function publicManifest(runId: string, mode: "PREVIEW" | "WRITE" | "RECONCILE", projectId: string, started: number, plan: ReturnType<typeof planActivityBackfill>, reconciliation?: ReturnType<typeof reconcileActivityBackfill>) {
  return {projectId, mode, runId, checksum: plan.report.deterministicOutputChecksum, generatedAt: new Date().toISOString(), sourceRecordCount: plan.report.sourceRecordsScanned, sourceWatermark: plan.sourceWatermark, normalizationVersion: NORMALIZATION_VERSION, duplicateClassificationVersion: DUPLICATE_CLASSIFICATION_VERSION, duplicateResolutionVersion: DUPLICATE_RESOLUTION_VERSION, backfillFormatVersion: ACTIVITY_BACKFILL_FORMAT_VERSION, planned: {creates: plan.report.documentChanges.wouldCreate, updates: plan.report.documentChanges.wouldUpdate, unchanged: plan.report.documentChanges.unchanged, noDeletes: true, potentialStaleOrOrphaned: plan.report.documentChanges.potentialStaleOrOrphaned}, counts: {structurallyEligible: plan.report.structurallyEligible, structurallyIneligible: plan.report.structurallyIneligible, duplicateReviewGroups: plan.report.duplicateReviewGroups, autoResolvedConfirmedGroups: plan.report.autoResolvedConfirmedGroups, possibleGroupsPending: plan.report.possibleGroupsPending, scoringSurvivors: plan.report.scoringSurvivors, excludedDuplicates: plan.report.excludedConfirmedDuplicates, pendingDuplicateEvents: plan.report.pendingPossibleDuplicateEvents, canonicalConflicts: plan.report.canonicalConflicts, monthlyEvents: plan.report.monthlyScoringEligibleCounts, dirtyMonths: plan.report.dirtyMonths}, failuresByCategory: plan.failures, processingDurationMs: Date.now() - started, reconciliation};
}
async function writeOutput(outputPath: string | null, manifest: unknown): Promise<void> { const text = `${JSON.stringify(manifest, null, 2)}\n`; console.log(text); if (outputPath) { const resolved = path.resolve(outputPath); await fs.mkdir(path.dirname(resolved), {recursive: true}); await fs.writeFile(resolved, text, "utf8"); } }
async function retry<T>(work: () => Promise<T>): Promise<T> { let last: unknown; for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) { try { return await work(); } catch (error) { last = error; const code = String((error as {code?: unknown}).code || "").replace(/^\d+\s*/, ""); if (!transientCodes.has(code) || attempt === MAX_ATTEMPTS) throw error; await new Promise((resolve) => setTimeout(resolve, attempt * 250)); } } throw last; }
async function confirmInteractively(summary: string): Promise<void> { if (!input.isTTY || !output.isTTY) throw new Error("Write mode requires an interactive terminal"); console.log(summary); const reader = createInterface({input, output}); try { const answer = await reader.question(`Type ${PRODUCTION_PROJECT_ID} WRITE to continue: `); if (answer !== `${PRODUCTION_PROJECT_ID} WRITE`) throw new Error("Interactive production confirmation failed"); } finally { reader.close(); } }

async function main(): Promise<void> {
  const started = Date.now(); const options = parseActivityBackfillOptions(process.argv.slice(2), process.env);
  if (admin.apps.length === 0) admin.initializeApp(); const db = admin.firestore(); const projectId = projectFromCredential();
  console.log(`MODE: ${options.write ? "WRITE" : options.reconcile ? "RECONCILE_READ_ONLY" : "READ_ONLY"}`); console.log(`ACTIVE PROJECT: ${projectId || "UNKNOWN"}`);
  if (options.write) { assertWriteSafeguards(options, projectId, process.env); const credential = admin.app().options.credential; if (!credential) throw new Error("Application Default Credentials are unavailable"); await credential.getAccessToken(); }
  const [records, stored] = await Promise.all([readSources(db, options.month, options.limit), readStored(db, options.month)]); const plan = planActivityBackfill(records, options.month, stored);
  const runId = `activity-${new Date().toISOString().replace(/[^0-9]/g, "").slice(0, 14)}-${plan.report.deterministicOutputChecksum.slice(0, 10)}`;
  if (options.reconcile) { await writeOutput(options.output, publicManifest(runId, "RECONCILE", projectId || "UNKNOWN", started, plan, reconcileActivityBackfill(plan, stored))); return; }
  if (!options.write) { await writeOutput(options.output, publicManifest(runId, "PREVIEW", projectId || "UNKNOWN", started, plan)); return; }
  if (plan.failures.length || plan.report.canonicalConflicts) throw new Error(`Write blocked by ${plan.failures.length ? "version failures" : "canonical conflicts"}`);
  // Freshness barrier: all source data is re-read and re-planned immediately before confirmation/checkpoint writes.
  const freshRecords = await readSources(db, options.month, options.limit); const freshStored = await readStored(db, options.month); const freshPlan = planActivityBackfill(freshRecords, options.month, freshStored);
  assertFreshChecksum(options.confirmChecksum, freshPlan.report.deterministicOutputChecksum);
  await confirmInteractively(`PRODUCTION WRITE PLAN: run ${runId}; ${freshRecords.length} sources; ${freshPlan.report.documentChanges.wouldCreate} creates; ${freshPlan.report.documentChanges.wouldUpdate} updates; ${freshPlan.report.documentChanges.unchanged} unchanged; checksum ${freshPlan.report.deterministicOutputChecksum}`);
  const runRef = db.collection("activity_backfill_runs").doc(runId); const versions = {normalizationVersion: NORMALIZATION_VERSION, duplicateClassificationVersion: DUPLICATE_CLASSIFICATION_VERSION, duplicateResolutionVersion: DUPLICATE_RESOLUTION_VERSION, backfillFormatVersion: ACTIVITY_BACKFILL_FORMAT_VERSION};
  await runRef.create({runId, mode: "WRITE", status: "RUNNING", projectId, month: options.month, expectedChecksum: options.confirmChecksum, actualChecksum: freshPlan.report.deterministicOutputChecksum, sourceRecordCount: freshRecords.length, processedCount: 0, createdCount: 0, updatedCount: 0, unchangedCount: 0, failedCount: 0, lastProcessedCursor: options.resumeFrom, ...versions, startedAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp(), completedAt: null, errorCategory: null, rollbackEntries: []});
  let processed = 0; let created = 0; let updated = 0; let unchanged = 0; const rollbackEntries: Array<Record<string, unknown>> = [];
  const includedSources = new Set(freshPlan.events.map((event) => event.sourceDocumentId));
  const remaining = freshRecords.filter((record) => includedSources.has(record.id) && (!options.resumeFrom || record.id.localeCompare(options.resumeFrom) > 0));
  try {
    for (let offset = 0; offset < remaining.length; offset += options.batchSize) for (const record of remaining.slice(offset, offset + options.batchSize)) {
      const expected = freshPlan.events.find((event) => event.sourceDocumentId === record.id); const existing = expected ? freshStored.events?.find((event) => event.canonicalMatchId === expected.canonicalMatchId) : undefined;
      const identical = Boolean(existing && expected && activityChecksum(existing) === activityChecksum(expected));
      if (!identical) await retry(() => normalizeAndPersistMatchHistoryWrite(db, {sourceDocumentId: record.id, before: null, after: record.data}));
      processed += 1; if (!existing) created += 1; else if (identical) unchanged += 1; else updated += 1;
      if (expected) rollbackEntries.push({eventRefHash: privacySafeRefHash(expected.canonicalMatchId), action: existing ? "RESTORE_REQUIRED" : "DELETE_CREATED", previousStateChecksum: existing ? activityChecksum(existing) : null});
      await runRef.update({processedCount: processed, createdCount: created, updatedCount: updated, unchangedCount: unchanged, lastProcessedCursor: record.id, rollbackEntries: rollbackEntries.slice(-100), updatedAt: FieldValue.serverTimestamp()});
    }
    await runRef.update({status: "COMPLETED", completedAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp()});
  } catch (error) { await runRef.update({status: "FAILED", failedCount: FieldValue.increment(1), errorCategory: error instanceof Error ? error.name : "UNKNOWN", updatedAt: FieldValue.serverTimestamp()}); throw error; }
  await writeOutput(options.output, {...publicManifest(runId, "WRITE", projectId as string, started, freshPlan), actual: {processed, created, updated, unchanged}, rollbackPreparation: rollbackEntries});
}

main().catch((error: unknown) => { console.error(JSON.stringify({script: "backfillActivityMatchEvents", errorCategory: error instanceof Error ? error.name : "UNKNOWN", message: error instanceof Error ? error.message : String(error)})); process.exitCode = 1; });
