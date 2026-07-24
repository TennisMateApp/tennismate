/* eslint-disable max-len, no-console, require-jsdoc, curly, brace-style, block-spacing */
import {createHash} from "crypto";
import {readFileSync, writeFileSync} from "fs";
import {resolve} from "path";
import {admin, Timestamp} from "./adminSdk";
import {ACTIVITY_PHASE2_RUNS_COLLECTION, PHASE2_JUNE_PILOT_CHECKSUM, PHASE2_JUNE_PILOT_MONTH} from "./phase2RunAudit";
import {PHASE2_PRODUCTION_PROJECT} from "./pilotCli";

const RUN_ID = "phase2-pilot-2026-06-1784436876993";
const GENERATION_ID = "v1-70ffe0d27bb85de3c7b2";
const TARGET_PATH = `${ACTIVITY_PHASE2_RUNS_COLLECTION}/${RUN_ID}`;
const AUDIT_FIELDS = ["aggregatesCreated", "aggregatesUpdated", "attemptCount", "calculationVersion", "completedAt", "errorCategory", "evidencePaths", "failureCount", "generationId", "month", "rankingsCreated", "rankingsUpdated", "recordOrigin", "reconstructedAt", "runId", "scoringEventCount", "scoringVersion", "sourceChecksum", "sourceEventCount", "staleRowsRemoved", "startedAt", "status", "triggerType"];

function stable(value: unknown): unknown {
  if (value instanceof Timestamp) return {timestamp: value.toDate().toISOString()};
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, stable(item)]));
  return value;
}
function hash(value: unknown): string {return createHash("sha256").update(JSON.stringify(stable(value))).digest("hex");}
function scope(records: Array<{path: string; data: FirebaseFirestore.DocumentData; updateTime: string | null}>, publicPaths: string[] = []) {return {documentCount: records.length, contentHash: hash(records.sort((a, b) => a.path.localeCompare(b.path))), publicPaths};}
async function flatCollection(db: FirebaseFirestore.Firestore, name: string) {const snapshot = await db.collection(name).get(); return snapshot.docs.map((doc) => ({path: doc.ref.path, data: doc.data(), updateTime: doc.updateTime?.toDate().toISOString() || null}));}
async function generatedScope(db: FirebaseFirestore.Firestore, root: "activity_months" | "activity_leaderboards") {
  const records = await flatCollection(db, root); const parentPaths = records.map((record) => record.path).sort();
  const parentSnapshot = await db.collection(root).get();
  for (const parent of parentSnapshot.docs) {
    const generations = await parent.ref.collection("generations").get();
    for (const generation of generations.docs) {
      records.push({path: generation.ref.path, data: generation.data(), updateTime: generation.updateTime?.toDate().toISOString() || null});
      const childName = root === "activity_months" ? "players" : "rankings"; const children = await generation.ref.collection(childName).get();
      children.docs.forEach((doc) => records.push({path: doc.ref.path, data: doc.data(), updateTime: doc.updateTime?.toDate().toISOString() || null}));
    }
  }
  return scope(records, parentPaths);
}
function valueStrings(value: unknown): string[] {if (typeof value === "string") return [value]; if (Array.isArray(value)) return value.flatMap(valueStrings); if (value && typeof value === "object") return Object.values(value as Record<string, unknown>).flatMap(valueStrings); return [];}

async function main(): Promise<void> {
  if (process.env.FIRESTORE_EMULATOR_HOST || process.env.GCLOUD_PROJECT && process.env.GCLOUD_PROJECT !== PHASE2_PRODUCTION_PROJECT) throw new Error("Isolation verifier requires the guarded production project");
  const outputArg = process.argv.find((arg) => arg.startsWith("--output=")); const baselineArg = process.argv.find((arg) => arg.startsWith("--baseline=")); if (!outputArg) throw new Error("--output is required");
  if (admin.apps.length === 0) admin.initializeApp({projectId: PHASE2_PRODUCTION_PROJECT}); const db = admin.firestore();
  const [requestRecords, eventRecords, monthScope, leaderboardScope, auditRecords] = await Promise.all([flatCollection(db, "activity_recalculation_requests"), flatCollection(db, "activity_match_events"), generatedScope(db, "activity_months"), generatedScope(db, "activity_leaderboards"), flatCollection(db, ACTIVITY_PHASE2_RUNS_COLLECTION)]);
  const target = await db.doc(TARGET_PATH).get(); const targetData = target.data() || {}; const playerIds = new Set((await db.collection("players").get()).docs.map((doc) => doc.id)); const eventIds = new Set(eventRecords.map((record) => record.path.split("/").pop() || "")); const leakedIdentifiers = valueStrings(targetData).filter((value) => playerIds.has(value) || eventIds.has(value));
  const forbiddenFields = Object.keys(targetData).filter((field) => !AUDIT_FIELDS.includes(field));
  const requestSummary = requestRecords.map((record) => ({path: record.path, status: record.data.status || null, attempts: record.data.attempts ?? 0, updateTime: record.updateTime, contentHash: hash(record.data)})).sort((a, b) => a.path.localeCompare(b.path));
  const manifest: Record<string, unknown> = {mode: "READ_ONLY_PHASE2_AUDIT_ISOLATION", generatedAt: new Date().toISOString(), projectId: PHASE2_PRODUCTION_PROJECT, targetPath: TARGET_PATH, requests: {scope: scope(requestRecords), documents: requestSummary}, activityMatchEvents: scope(eventRecords), activityMonths: monthScope, activityLeaderboards: leaderboardScope, phase2Runs: scope(auditRecords), targetAudit: {exists: target.exists, approvedFieldsOnly: forbiddenFields.length === 0, forbiddenFieldCount: forbiddenFields.length, rawPlayerOrEventIdentifierMatchCount: leakedIdentifiers.length, adminTimestamp: targetData.reconstructedAt instanceof Timestamp, record: target.exists ? Object.fromEntries(AUDIT_FIELDS.map((field) => [field, stable(targetData[field] ?? null)])) : null}};
  if (baselineArg) {
    const baseline = JSON.parse(readFileSync(resolve(baselineArg.slice("--baseline=".length)), "utf8")); const unchanged = {requests: hash(baseline.requests) === hash(manifest.requests), activityMatchEvents: hash(baseline.activityMatchEvents) === hash(manifest.activityMatchEvents), activityMonths: hash(baseline.activityMonths) === hash(manifest.activityMonths), activityLeaderboards: hash(baseline.activityLeaderboards) === hash(manifest.activityLeaderboards)};
    const targetMatches = target.exists && targetData.status === "COMPLETED" && targetData.recordOrigin === "RECONSTRUCTED" && targetData.month === PHASE2_JUNE_PILOT_MONTH && targetData.triggerType === "pilot" && targetData.runId === RUN_ID && targetData.generationId === GENERATION_ID && targetData.sourceChecksum === PHASE2_JUNE_PILOT_CHECKSUM && targetData.sourceEventCount === 1 && targetData.scoringEventCount === 1 && targetData.aggregatesCreated === null && targetData.aggregatesUpdated === null && targetData.rankingsCreated === null && targetData.rankingsUpdated === null && targetData.staleRowsRemoved === null && targetData.failureCount === null && targetData.reconstructedAt instanceof Timestamp && forbiddenFields.length === 0 && leakedIdentifiers.length === 0;
    manifest.comparison = {unchanged, onlyAuditCreated: Object.values(unchanged).every(Boolean) && baseline.phase2Runs.documentCount + 1 === auditRecords.length && targetMatches, targetMatches};
  }
  const outputPath = resolve(outputArg.slice("--output=".length)); writeFileSync(outputPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8"); console.log(JSON.stringify({mode: manifest.mode, generatedAt: manifest.generatedAt, targetPath: TARGET_PATH, targetExists: target.exists, requestStates: requestSummary.map(({path, status, attempts}) => ({path, status, attempts})), scopeCounts: {events: eventRecords.length, activityMonths: monthScope.documentCount, activityLeaderboards: leaderboardScope.documentCount, phase2Runs: auditRecords.length}, comparison: manifest.comparison || null, outputPath}, null, 2));
}

main().catch((error) => {console.error(JSON.stringify({script: "verifyPhase2AuditIsolation", errorCategory: error instanceof Error ? error.name : "UNKNOWN"})); process.exitCode = 1;});
