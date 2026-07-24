/* eslint-disable max-len, require-jsdoc, curly, brace-style, block-spacing */
import {FieldValue} from "./adminSdk";
import {ACTIVITY_CALCULATION_VERSION, ACTIVITY_SCORING_VERSION} from "./monthlyCalculation";

export const ACTIVITY_PHASE2_RUNS_COLLECTION = "activity_phase2_runs";
export const PHASE2_JUNE_PILOT_MONTH = "2026-06";
export const PHASE2_JUNE_PILOT_CHECKSUM = "70ffe0d27bb85de3c7b25ad3c56e180f0c21119cd8ea076b3b9f3d345c2a629a";

export type Phase2RunTriggerType = "pilot" | "scheduled";
export type Phase2RunStatus = "RUNNING" | "COMPLETED" | "FAILED";

export interface Phase2RunCounts {
  aggregatesCreated: number;
  aggregatesUpdated: number;
  rankingsCreated: number;
  rankingsUpdated: number;
  staleRowsRemoved: number;
}

export function assertSafePhase2RunId(runId: string): void {
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]{2,127}$/.test(runId)) throw new Error("Phase 2 runId must contain only safe opaque characters");
}

export function runningPhase2RunPayload(input: {runId: string; month: string; triggerType: Phase2RunTriggerType; attemptCount: number}): FirebaseFirestore.DocumentData {
  assertSafePhase2RunId(input.runId);
  return {
    runId: input.runId,
    month: input.month,
    triggerType: input.triggerType,
    status: "RUNNING" satisfies Phase2RunStatus,
    startedAt: FieldValue.serverTimestamp(),
    completedAt: null,
    sourceChecksum: null,
    generationId: null,
    sourceEventCount: null,
    scoringEventCount: null,
    aggregatesCreated: null,
    aggregatesUpdated: null,
    rankingsCreated: null,
    rankingsUpdated: null,
    staleRowsRemoved: null,
    attemptCount: input.attemptCount,
    failureCount: 0,
    errorCategory: null,
    calculationVersion: ACTIVITY_CALCULATION_VERSION,
    scoringVersion: ACTIVITY_SCORING_VERSION,
    recordOrigin: "LIVE",
  };
}

function requireMatchingValue(records: FirebaseFirestore.DocumentData[], field: string): unknown {
  const values = records.map((record) => record[field]);
  if (values.some((value) => value === undefined || value === null) || values.some((value) => value !== values[0])) throw new Error(`Historical Phase 2 evidence mismatch: ${field}`);
  return values[0];
}

export interface HistoricalAuditResult {
  path: string;
  record: FirebaseFirestore.DocumentData;
  wouldCreate: boolean;
}

export async function reconstructHistoricalJunePilotAudit(db: FirebaseFirestore.Firestore, options: {expectedChecksum: string; write: boolean}): Promise<HistoricalAuditResult> {
  if (options.expectedChecksum !== PHASE2_JUNE_PILOT_CHECKSUM) throw new Error("Historical June checksum guard failed");
  const month = PHASE2_JUNE_PILOT_MONTH;
  const requestPath = `activity_recalculation_requests/${month}`;
  const monthParentPath = `activity_months/${month}`;
  const leaderboardParentPath = `activity_leaderboards/${month}`;
  const [requestSnapshot, monthParentSnapshot, leaderboardParentSnapshot] = await Promise.all([db.doc(requestPath).get(), db.doc(monthParentPath).get(), db.doc(leaderboardParentPath).get()]);
  if (!requestSnapshot.exists || !monthParentSnapshot.exists || !leaderboardParentSnapshot.exists) throw new Error("Historical June evidence is incomplete");
  const request = requestSnapshot.data() || {}; const monthParent = monthParentSnapshot.data() || {}; const leaderboardParent = leaderboardParentSnapshot.data() || {};
  if (request.status !== "completed") throw new Error("Historical June request is not completed");
  const generationId = requireMatchingValue([request, monthParent, leaderboardParent], "publishedGenerationId") as string;
  const monthGenerationPath = `${monthParentPath}/generations/${generationId}`; const leaderboardGenerationPath = `${leaderboardParentPath}/generations/${generationId}`;
  const [monthGenerationSnapshot, leaderboardGenerationSnapshot] = await Promise.all([db.doc(monthGenerationPath).get(), db.doc(leaderboardGenerationPath).get()]);
  if (!monthGenerationSnapshot.exists || !leaderboardGenerationSnapshot.exists) throw new Error("Historical June generation evidence is incomplete");
  const monthGeneration = monthGenerationSnapshot.data() || {}; const leaderboardGeneration = leaderboardGenerationSnapshot.data() || {};
  const evidence = [monthGeneration, leaderboardGeneration];
  const runId = requireMatchingValue(evidence, "runId") as string; assertSafePhase2RunId(runId);
  const normalizedChecksum = request.actualChecksum as string;
  if (normalizedChecksum !== options.expectedChecksum || evidence.some((record) => record.sourceChecksum !== options.expectedChecksum)) throw new Error("Historical June source checksum does not match verified evidence");
  if (evidence.some((record) => record.status !== "published" || record.generationId !== generationId || record.monthKey !== month)) throw new Error("Historical June generation is not the published generation");
  const sourceEventCount = requireMatchingValue(evidence, "sourceEventCount") as number;
  const scoringEventCount = requireMatchingValue(evidence, "scoringEventCount") as number;
  const calculationVersion = requireMatchingValue(evidence, "calculationVersion") as number;
  const scoringVersion = requireMatchingValue(evidence, "scoringVersion") as number;
  const evidencePaths = [requestPath, monthParentPath, monthGenerationPath, leaderboardParentPath, leaderboardGenerationPath];
  const path = `${ACTIVITY_PHASE2_RUNS_COLLECTION}/${runId}`;
  const record = {
    runId,
    month,
    triggerType: "pilot" as const,
    status: "COMPLETED" satisfies Phase2RunStatus,
    startedAt: request.startedAt || null,
    completedAt: request.completedAt || null,
    sourceChecksum: options.expectedChecksum,
    generationId,
    sourceEventCount,
    scoringEventCount,
    aggregatesCreated: null,
    aggregatesUpdated: null,
    rankingsCreated: null,
    rankingsUpdated: null,
    staleRowsRemoved: null,
    attemptCount: typeof request.attempts === "number" ? request.attempts : null,
    failureCount: null,
    errorCategory: request.errorCategory ?? null,
    calculationVersion,
    scoringVersion,
    recordOrigin: "RECONSTRUCTED",
    reconstructedAt: options.write ? FieldValue.serverTimestamp() : null,
    evidencePaths,
  };
  const auditRef = db.doc(path); const existing = await auditRef.get();
  if (existing.exists) {
    const current = existing.data() || {};
    if (current.recordOrigin !== "RECONSTRUCTED" || current.month !== month || current.sourceChecksum !== options.expectedChecksum || current.generationId !== generationId) throw new Error("A conflicting Phase 2 run audit record already exists");
    return {path, record: current, wouldCreate: false};
  }
  if (!options.write) return {path, record, wouldCreate: true};
  let created = false; let persisted: FirebaseFirestore.DocumentData = record;
  await db.runTransaction(async (transaction) => {
    const currentSnapshot = await transaction.get(auditRef);
    if (currentSnapshot.exists) {
      const current = currentSnapshot.data() || {};
      if (current.recordOrigin !== "RECONSTRUCTED" || current.month !== month || current.sourceChecksum !== options.expectedChecksum || current.generationId !== generationId) throw new Error("A conflicting Phase 2 run audit record already exists");
      persisted = current; return;
    }
    transaction.create(auditRef, record); created = true;
  });
  return {path, record: persisted, wouldCreate: created};
}
