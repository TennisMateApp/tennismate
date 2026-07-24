import * as admin from "firebase-admin";
import { promises as fs } from "fs";
import path from "path";
import { normalizeMatchHistory } from "../functions/src/activityLeaderboard/normalization";
import { activityDateMonthDisagreement } from "../functions/src/activityLeaderboard/dateUtils";
import { MatchHistorySource } from "../functions/src/activityLeaderboard/types";
import {
  expectedAuditArgumentsWereLost,
  parseActivityAuditOptions,
} from "./activityLeaderboardAuditCli";

function increment(record: Record<string, number>, key: string): void {
  record[key] = (record[key] || 0) + 1;
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const options = parseActivityAuditOptions(argv, process.env);
  if (expectedAuditArgumentsWereLost(argv, process.env, options)) {
    console.error("Expected audit CLI options were present in npm's original command but were not forwarded to the script.");
    process.exitCode = 2;
    return;
  }
  if (process.env.ACTIVITY_AUDIT_PARSE_ONLY === "1") {
    console.log(JSON.stringify({
      mode: "PARSE_ONLY",
      argv,
      filters: options,
    }, null, 2));
    return;
  }
  if (admin.apps.length === 0) admin.initializeApp();
  let query: FirebaseFirestore.Query = admin.firestore().collection("match_history");
  if (options.limit !== null) query = query.limit(options.limit);
  const snapshot = await query.get();

  const report = {
    mode: "READ_ONLY",
    generatedAt: new Date().toISOString(),
    filters: options,
    totalRecordsScanned: 0,
    recordsIncluded: 0,
    eligibleRecords: 0,
    ineligibleRecords: 0,
    ineligibleByReason: {} as Record<string, number>,
    recordsUsingPlayedDate: 0,
    recordsUsingCompletedAt: 0,
    missingActivityDates: 0,
    invalidActivityDates: 0,
    invalidParticipantCounts: 0,
    selfMatches: 0,
    completedRecordsMarkedNotPlayed: 0,
    playedDateCompletedAtMonthDisagreements: 0,
    dateMonthDisagreementsByTransition: {} as Record<string, number>,
    duplicateCanonicalEventIds: 0,
    duplicateCandidateLogicalMatches: 0,
    monthlyCounts: {} as Record<string, number>,
    earliestActivityAt: null as string | null,
    latestActivityAt: null as string | null,
  };
  const canonicalIds = new Set<string>();
  const logicalCandidates = new Set<string>();
  let earliest: Date | null = null;
  let latest: Date | null = null;

  for (const document of snapshot.docs) {
    report.totalRecordsScanned += 1;
    const source = document.data() as MatchHistorySource;
    const event = normalizeMatchHistory(document.id, source);
    if (options.month && event.monthKey !== options.month) continue;
    report.recordsIncluded += 1;

    if (event.eligible) report.eligibleRecords += 1;
    else report.ineligibleRecords += 1;
    for (const reason of event.ineligibilityReasons) increment(report.ineligibleByReason, reason);
    if (event.activityDateSource === "playedDate") report.recordsUsingPlayedDate += 1;
    if (event.activityDateSource === "completedAt") report.recordsUsingCompletedAt += 1;
    if (event.ineligibilityReasons.includes("MISSING_ACTIVITY_DATE")) report.missingActivityDates += 1;
    if (event.ineligibilityReasons.includes("INVALID_ACTIVITY_DATE")) report.invalidActivityDates += 1;
    if (event.ineligibilityReasons.includes("INVALID_PARTICIPANT_COUNT")) report.invalidParticipantCounts += 1;
    if (event.ineligibilityReasons.includes("SELF_MATCH")) report.selfMatches += 1;
    const completed = source.completed === true || source.status === "completed";
    if (completed && (source.outcome === "not_played" || source.status === "not_played")) {
      report.completedRecordsMarkedNotPlayed += 1;
    }
    const disagreement = activityDateMonthDisagreement(source.playedDate, source.completedAt);
    if (disagreement) {
      report.playedDateCompletedAtMonthDisagreements += 1;
      increment(
        report.dateMonthDisagreementsByTransition,
        `${disagreement.playedDateMonth}->${disagreement.completedAtMonth}`
      );
    }
    if (canonicalIds.has(event.canonicalMatchId)) report.duplicateCanonicalEventIds += 1;
    canonicalIds.add(event.canonicalMatchId);

    if (event.pairId && event.activityAt) {
      const candidate = `${event.pairId}|${event.activityAt.toISOString()}`;
      if (logicalCandidates.has(candidate)) report.duplicateCandidateLogicalMatches += 1;
      logicalCandidates.add(candidate);
    }
    if (event.eligible && event.monthKey) increment(report.monthlyCounts, event.monthKey);
    if (event.eligible && event.activityAt) {
      if (!earliest || event.activityAt < earliest) earliest = event.activityAt;
      if (!latest || event.activityAt > latest) latest = event.activityAt;
    }
  }

  report.earliestActivityAt = earliest ? (earliest as Date).toISOString() : null;
  report.latestActivityAt = latest ? (latest as Date).toISOString() : null;
  const output = JSON.stringify(report, null, 2);
  console.log(output);
  if (options.output) {
    const outputPath = path.resolve(options.output);
    await fs.mkdir(path.dirname(outputPath), { recursive: true });
    await fs.writeFile(outputPath, `${output}\n`, "utf8");
    console.log(JSON.stringify({ reportWrittenTo: outputPath }));
  }
}

main().catch((error: unknown) => {
  console.error(JSON.stringify({
    script: "auditActivityLeaderboardSources",
    errorCategory: error instanceof Error ? error.name : "UNKNOWN",
    message: error instanceof Error ? error.message : String(error),
  }));
  process.exitCode = 1;
});
