/* eslint-disable max-len, require-jsdoc, curly, brace-style, block-spacing */
import {randomUUID} from "crypto";
import {FieldValue, Timestamp} from "./adminSdk";
import {ACTIVITY_CALCULATION_VERSION, ACTIVITY_SCORING_VERSION, calculateMonthlyActivity} from "./monthlyCalculation";
import {MonthlyCalculation, PublicProfileSnapshot} from "./phase2Types";
import {storedActivityEvent} from "./persistence";
import {ACTIVITY_PHASE2_RUNS_COLLECTION, Phase2RunCounts, Phase2RunTriggerType, runningPhase2RunPayload} from "./phase2RunAudit";

export const ACTIVITY_RECALCULATION_BATCH_SIZE = 400;
export const ACTIVITY_RECALCULATION_LEASE_MS = 5 * 60 * 1000;
export const ACTIVITY_RETIRED_GENERATION_MS = 30 * 24 * 60 * 60 * 1000;
const MAX_BATCH_ATTEMPTS = 3;

export class ActivityMonthLeaseConflictError extends Error { constructor() { super("Activity month is leased by another worker"); this.name = "ActivityMonthLeaseConflictError"; } }
export class ActivityMonthPublishConflictError extends Error { constructor() { super("Activity month lease changed before publication"); this.name = "ActivityMonthPublishConflictError"; } }

export interface RecalculationHooks {afterClaim?: () => Promise<void>; afterStage?: () => Promise<void>; beforeCompleteAuditWrite?: () => Promise<void>}
export interface RecalculationOptions {runId?: string; triggerType?: Phase2RunTriggerType; now?: () => Date; expectedSourceChecksum?: string; hooks?: RecalculationHooks}

function aggregatePayload(aggregate: MonthlyCalculation["aggregates"][number]) {
  return {...aggregate, lastActivityAt: Timestamp.fromDate(aggregate.lastActivityAt), updatedAt: FieldValue.serverTimestamp()};
}
function rankingPayload(ranking: MonthlyCalculation["rankings"][number]) {
  return {playerId: ranking.playerId, displayName: ranking.displayName, avatarUrl: ranking.avatarUrl, rank: ranking.rank, points: ranking.activityPoints, eligibleActivityCount: ranking.eligibleActivityCount, scoringActivityCount: ranking.cappedActivityCount, distinctOpponentCount: ranking.distinctOpponentCount};
}
async function commitWithRetry(batchFactory: () => FirebaseFirestore.WriteBatch): Promise<void> {
  let last: unknown;
  for (let attempt = 1; attempt <= MAX_BATCH_ATTEMPTS; attempt += 1) {
    try { await batchFactory().commit(); return; } catch (error) { last = error; if (attempt === MAX_BATCH_ATTEMPTS) throw error; await new Promise((resolve) => setTimeout(resolve, 100 * attempt)); }
  }
  throw last;
}
interface StagedWrite {ref: FirebaseFirestore.DocumentReference; data?: FirebaseFirestore.DocumentData; delete?: boolean}
async function writeChunks(db: FirebaseFirestore.Firestore, writes: StagedWrite[]): Promise<void> {
  for (let offset = 0; offset < writes.length; offset += ACTIVITY_RECALCULATION_BATCH_SIZE) {
    const chunk = writes.slice(offset, offset + ACTIVITY_RECALCULATION_BATCH_SIZE);
    await commitWithRetry(() => {const batch = db.batch(); chunk.forEach((write) => {if (write.delete) batch.delete(write.ref); else batch.set(write.ref, write.data || {}, {merge: false});}); return batch;});
  }
}
async function publicProfiles(db: FirebaseFirestore.Firestore, playerIds: string[]): Promise<Map<string, PublicProfileSnapshot>> {
  // Current-month recalculation refreshes the latest profile snapshot. A
  // historical month is queued only when its persisted avatar is unavailable;
  // ordinary profile updates never dirty historical months.
  const result = new Map<string, PublicProfileSnapshot>();
  for (let offset = 0; offset < playerIds.length; offset += 100) {
    const refs = playerIds.slice(offset, offset + 100).map((id) => db.collection("players").doc(id));
    const snapshots = refs.length ? await db.getAll(...refs) : [];
    snapshots.forEach((snapshot) => {const data = snapshot.data() || {}; result.set(snapshot.id, {displayName: typeof data.name === "string" && data.name.trim() ? data.name.trim().slice(0, 80) : null, avatarUrl: typeof data.photoThumbURL === "string" ? data.photoThumbURL : typeof data.photoURL === "string" ? data.photoURL : typeof data.avatar === "string" ? data.avatar : null});});
  }
  return result;
}

export async function recalculateActivityMonth(db: FirebaseFirestore.Firestore, monthKey: string, options: RecalculationOptions = {}): Promise<MonthlyCalculation> {
  const runId = options.runId || randomUUID(); const triggerType = options.triggerType || "scheduled"; const now = options.now || (() => new Date()); const requestRef = db.collection("activity_recalculation_requests").doc(monthKey); const runRef = db.collection(ACTIVITY_PHASE2_RUNS_COLLECTION).doc(runId); const startedAt = now(); let completedAudit: FirebaseFirestore.DocumentData | null = null;
  await db.runTransaction(async (transaction) => {
    const [snapshot, runSnapshot] = await Promise.all([transaction.get(requestRef), transaction.get(runRef)]); const request = snapshot.data() || {}; const leaseExpiresAt = request.leaseExpiresAt?.toDate?.() as Date | undefined;
    if (runSnapshot.exists) {
      const run = runSnapshot.data() || {};
      if (run.month !== monthKey || run.triggerType !== triggerType) throw new ActivityMonthPublishConflictError();
      if (run.status === "COMPLETED") {completedAudit = run; return;}
      if (run.status !== "RUNNING" || request.leaseOwner !== runId) throw new ActivityMonthPublishConflictError();
      return;
    }
    if (request.status === "running" && request.leaseOwner !== runId && leaseExpiresAt && leaseExpiresAt.getTime() > startedAt.getTime()) throw new ActivityMonthLeaseConflictError();
    if (Number(request.calculationVersion || 0) > ACTIVITY_CALCULATION_VERSION || Number(request.scoringVersion || 0) > ACTIVITY_SCORING_VERSION) throw new ActivityMonthPublishConflictError();
    const attemptCount = Number(request.attempts || 0) + 1;
    transaction.create(runRef, runningPhase2RunPayload({runId, month: monthKey, triggerType, attemptCount}));
    transaction.set(requestRef, {...request, monthKey, status: "running", leaseOwner: runId, leaseExpiresAt: Timestamp.fromDate(new Date(startedAt.getTime() + ACTIVITY_RECALCULATION_LEASE_MS)), calculationVersion: ACTIVITY_CALCULATION_VERSION, scoringVersion: ACTIVITY_SCORING_VERSION, attempts: attemptCount, startedAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp(), completedAt: null, errorCategory: null}, {merge: false});
  });
  try {
    await options.hooks?.afterClaim?.();
    const eventSnapshot = await db.collection("activity_match_events").where("monthKey", "==", monthKey).get(); const events = eventSnapshot.docs.map((doc) => storedActivityEvent(doc.data()));
    const provisional = calculateMonthlyActivity(events, monthKey);
    if (options.expectedSourceChecksum && provisional.sourceChecksum !== options.expectedSourceChecksum) throw new ActivityMonthPublishConflictError();
    const profiles = await publicProfiles(db, provisional.aggregates.map((aggregate) => aggregate.playerId)); const calculation = calculateMonthlyActivity(events, monthKey, profiles);
    if (completedAudit) {
      const audit = completedAudit as FirebaseFirestore.DocumentData;
      if (audit.generationId !== calculation.generationId || audit.sourceChecksum !== calculation.sourceChecksum) throw new ActivityMonthPublishConflictError();
      return calculation;
    }
    const monthGenerationRef = db.doc(`activity_months/${monthKey}/generations/${calculation.generationId}`); const leaderboardGenerationRef = db.doc(`activity_leaderboards/${monthKey}/generations/${calculation.generationId}`);
    const [existingAggregates, existingRankings] = await Promise.all([monthGenerationRef.collection("players").get(), leaderboardGenerationRef.collection("rankings").get()]);
    const aggregateIds = new Set(calculation.aggregates.map((aggregate) => aggregate.playerId)); const rankingIds = new Set(calculation.rankings.map((ranking) => ranking.playerId));
    const counts: Phase2RunCounts = {
      aggregatesCreated: calculation.aggregates.filter((aggregate) => !existingAggregates.docs.some((doc) => doc.id === aggregate.playerId)).length,
      aggregatesUpdated: calculation.aggregates.filter((aggregate) => existingAggregates.docs.some((doc) => doc.id === aggregate.playerId)).length,
      rankingsCreated: calculation.rankings.filter((ranking) => !existingRankings.docs.some((doc) => doc.id === ranking.playerId)).length,
      rankingsUpdated: calculation.rankings.filter((ranking) => existingRankings.docs.some((doc) => doc.id === ranking.playerId)).length,
      staleRowsRemoved: existingAggregates.docs.filter((doc) => !aggregateIds.has(doc.id)).length + existingRankings.docs.filter((doc) => !rankingIds.has(doc.id)).length,
    };
    const writes: StagedWrite[] = [
      ...calculation.aggregates.map((aggregate) => ({ref: monthGenerationRef.collection("players").doc(aggregate.playerId), data: aggregatePayload(aggregate)})),
      ...calculation.rankings.map((ranking) => ({ref: leaderboardGenerationRef.collection("rankings").doc(ranking.playerId), data: rankingPayload(ranking)})),
      ...existingAggregates.docs.filter((doc) => !aggregateIds.has(doc.id)).map((doc) => ({ref: doc.ref, delete: true})),
      ...existingRankings.docs.filter((doc) => !rankingIds.has(doc.id)).map((doc) => ({ref: doc.ref, delete: true})),
    ];
    await writeChunks(db, writes); await options.hooks?.afterStage?.();
    await db.runTransaction(async (transaction) => {
      const [requestSnapshot, runSnapshot, previousMonthSnapshot, previousLeaderboardSnapshot] = await Promise.all([transaction.get(requestRef), transaction.get(runRef), transaction.get(db.doc(`activity_months/${monthKey}`)), transaction.get(db.doc(`activity_leaderboards/${monthKey}`))]);
      const request = requestSnapshot.data() || {};
      const currentRun = runSnapshot.data() || {};
      if (request.status !== "running" || request.leaseOwner !== runId || currentRun.status !== "RUNNING") throw new ActivityMonthPublishConflictError();
      await options.hooks?.beforeCompleteAuditWrite?.();
      const published = {monthKey, generationId: calculation.generationId, sourceChecksum: calculation.sourceChecksum, calculationVersion: ACTIVITY_CALCULATION_VERSION, scoringVersion: ACTIVITY_SCORING_VERSION, sourceEventCount: calculation.sourceEventCount, scoringEventCount: calculation.scoringEventCount, playerCount: calculation.aggregates.length, rankingCount: calculation.rankings.length, status: "published", runId, generatedAt: FieldValue.serverTimestamp()};
      const retirement = {status: "retired", retiredAt: FieldValue.serverTimestamp(), deleteAfter: Timestamp.fromDate(new Date(now().getTime() + ACTIVITY_RETIRED_GENERATION_MS))};
      const previousMonthGeneration = previousMonthSnapshot.data()?.publishedGenerationId; const previousLeaderboardGeneration = previousLeaderboardSnapshot.data()?.publishedGenerationId;
      if (previousMonthGeneration && previousMonthGeneration !== calculation.generationId) transaction.set(db.doc(`activity_months/${monthKey}/generations/${previousMonthGeneration}`), retirement, {merge: true});
      if (previousLeaderboardGeneration && previousLeaderboardGeneration !== calculation.generationId) transaction.set(db.doc(`activity_leaderboards/${monthKey}/generations/${previousLeaderboardGeneration}`), retirement, {merge: true});
      transaction.set(monthGenerationRef, published, {merge: false}); transaction.set(leaderboardGenerationRef, published, {merge: false});
      transaction.set(db.doc(`activity_months/${monthKey}`), {...published, publishedGenerationId: calculation.generationId}, {merge: false});
      transaction.set(db.doc(`activity_leaderboards/${monthKey}`), {...published, publishedGenerationId: calculation.generationId, visibility: "signed_in"}, {merge: false});
      transaction.set(requestRef, {...request, status: "completed", leaseOwner: null, leaseExpiresAt: null, publishedGenerationId: calculation.generationId, actualChecksum: calculation.sourceChecksum, processedEventCount: calculation.sourceEventCount, aggregateCount: calculation.aggregates.length, rankingCount: calculation.rankings.length, completedAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp(), errorCategory: null}, {merge: false});
      transaction.set(runRef, {runId, month: monthKey, triggerType, status: "COMPLETED", startedAt: currentRun.startedAt || FieldValue.serverTimestamp(), completedAt: FieldValue.serverTimestamp(), sourceChecksum: calculation.sourceChecksum, generationId: calculation.generationId, sourceEventCount: calculation.sourceEventCount, scoringEventCount: calculation.scoringEventCount, ...counts, attemptCount: Number(request.attempts || 1), failureCount: 0, errorCategory: null, calculationVersion: ACTIVITY_CALCULATION_VERSION, scoringVersion: ACTIVITY_SCORING_VERSION, recordOrigin: "LIVE"}, {merge: false});
    });
    return calculation;
  } catch (error) {
    await db.runTransaction(async (transaction) => {const [snapshot, runSnapshot] = await Promise.all([transaction.get(requestRef), transaction.get(runRef)]); const request = snapshot.data() || {}; const run = runSnapshot.data() || {}; if (request.status === "running" && request.leaseOwner === runId && run.status === "RUNNING") {const errorCategory = error instanceof Error ? error.name : "UNKNOWN"; transaction.set(requestRef, {...request, status: "failed", leaseOwner: null, leaseExpiresAt: null, errorCategory, updatedAt: FieldValue.serverTimestamp()}, {merge: false}); transaction.set(runRef, {...run, status: "FAILED", completedAt: FieldValue.serverTimestamp(), failureCount: 1, errorCategory}, {merge: false});}});
    throw error;
  }
}

export async function cleanupRetiredActivityGenerations(db: FirebaseFirestore.Firestore, currentTime = new Date()): Promise<number> {
  let deleted = 0; const cutoff = Timestamp.fromDate(currentTime);
  for (const rootName of ["activity_months", "activity_leaderboards"]) {
    const parents = await db.collection(rootName).limit(100).get();
    for (const parent of parents.docs) {
      const currentGeneration = parent.data().publishedGenerationId;
      const expired = await parent.ref.collection("generations").where("deleteAfter", "<=", cutoff).limit(20).get();
      for (const generation of expired.docs) {if (generation.data().status !== "retired" || generation.id === currentGeneration) continue; await db.recursiveDelete(generation.ref); deleted += 1;}
    }
  }
  return deleted;
}

export async function processPendingActivityMonths(db: FirebaseFirestore.Firestore, limit = 3): Promise<Array<{monthKey: string; status: "completed" | "skipped" | "failed"; errorCategory: string | null}>> {
  const snapshot = await db.collection("activity_recalculation_requests").where("status", "==", "pending").limit(limit).get(); const results = [];
  for (const doc of [...snapshot.docs].sort((a, b) => a.id.localeCompare(b.id))) {
    try {const attempt = Number(doc.data().attempts || 0) + 1; await recalculateActivityMonth(db, doc.id, {runId: `scheduled-${doc.id}-${attempt}`, triggerType: "scheduled"}); results.push({monthKey: doc.id, status: "completed" as const, errorCategory: null});}
    catch (error) {results.push({monthKey: doc.id, status: error instanceof ActivityMonthLeaseConflictError ? "skipped" as const : "failed" as const, errorCategory: error instanceof Error ? error.name : "UNKNOWN"});}
  }
  return results;
}
