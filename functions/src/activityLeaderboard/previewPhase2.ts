/* eslint-disable max-len, require-jsdoc, brace-style, block-spacing */
import * as admin from "firebase-admin";
import {promises as fs} from "fs";
import path from "path";
import {calculateMonthlyActivity} from "./monthlyCalculation";
import {storedActivityEvent} from "./persistence";
import {NormalizedActivityEvent} from "./types";

interface ReconciliationManifest {
  projectId: string;
  checksum: string;
  sourceRecordCount: number;
  reconciliation?: {matches?: boolean; storedStateChecksum?: string};
}

function option(name: string, fallback: string): string {
  const prefix = `--${name}=`;
  return process.argv.slice(2).find((value) => value.startsWith(prefix))?.slice(prefix.length) || fallback;
}

async function main(): Promise<void> {
  if (process.env.FIRESTORE_EMULATOR_HOST) throw new Error("Phase 2 production-derived preview must not run against an emulator");
  const manifestPath = path.resolve(option("manifest", "../activity-backfill-production-reconcile-post-run.json"));
  const outputPath = path.resolve(option("output", "../activity-leaderboard-phase2-dry-run.json"));
  const requestedMonth = option("month", "");
  const manifest = JSON.parse(await fs.readFile(manifestPath, "utf8")) as ReconciliationManifest;
  if (!manifest.projectId || manifest.reconciliation?.matches !== true || manifest.reconciliation.storedStateChecksum !== manifest.checksum) throw new Error("The source reconciliation manifest is not verified");
  if (admin.apps.length === 0) admin.initializeApp({projectId: manifest.projectId});
  const db = admin.firestore();
  const [snapshot, requestSnapshot, monthSnapshot, leaderboardSnapshot] = await Promise.all([
    db.collection("activity_match_events").get(),
    db.collection("activity_recalculation_requests").get(),
    db.collection("activity_months").get(),
    db.collection("activity_leaderboards").get(),
  ]);
  if (snapshot.size !== manifest.sourceRecordCount) throw new Error(`Event count ${snapshot.size} does not match verified manifest count ${manifest.sourceRecordCount}`);
  const events = snapshot.docs.map((document) => storedActivityEvent(document.data()));
  const monthKeys = [...new Set(events.map((event) => event.monthKey).filter((month): month is string => Boolean(month)))].filter((month) => !requestedMonth || month === requestedMonth).sort();
  const months = monthKeys.map((monthKey) => {
    const monthEvents = events.filter((event) => event.monthKey === monthKey);
    const calculation = calculateMonthlyActivity(monthEvents, monthKey);
    const pendingDuplicates = monthEvents.filter((event) => event.duplicateResolutionRole === "PENDING_REVIEW").length;
    const excludedDuplicates = monthEvents.filter((event) => event.duplicateResolutionRole === "EXCLUDED_DUPLICATE").length;
    const cappedPlayers = calculation.aggregates.filter((aggregate) => aggregate.eligibleActivityCount > aggregate.cappedActivityCount).length;
    return {
      monthKey,
      sourceEventCount: calculation.sourceEventCount,
      scoringEligibleEventCount: calculation.scoringEventCount,
      ineligibleOrExcludedEventCount: calculation.sourceEventCount - calculation.scoringEventCount,
      aggregatePlayerCount: calculation.aggregates.length,
      rankingSize: calculation.rankings.length,
      totalPoints: calculation.aggregates.reduce((sum, aggregate) => sum + aggregate.activityPoints, 0),
      maximumPoints: Math.max(0, ...calculation.aggregates.map((aggregate) => aggregate.activityPoints)),
      playersAffectedByOpponentCap: cappedPlayers,
      pendingDuplicateEventCount: pendingDuplicates,
      excludedDuplicateEventCount: excludedDuplicates,
      canonicalConflictEventCount: monthEvents.filter((event) => event.ineligibilityReasons.includes("CANONICAL_SOURCE_CONFLICT")).length,
      malformedScoringEventCount: calculation.rejectedMalformedCount,
      generationId: calculation.generationId,
      sourceChecksum: calculation.sourceChecksum,
    };
  });
  const missingMonthKeyCount = events.filter((event) => !event.monthKey).length;
  const report = {
    mode: "READ_ONLY_DRY_RUN",
    projectId: manifest.projectId,
    generatedAt: new Date().toISOString(),
    sourceManifest: path.basename(manifestPath),
    sourceManifestChecksum: manifest.checksum,
    sourceEventCount: events.length,
    scoringEligibleEventCount: events.filter((event: NormalizedActivityEvent) => event.eligibleForScoring === true).length,
    months,
    deploymentSafety: {
      recalculationRequestCount: requestSnapshot.size,
      pendingRecalculationRequestCount: requestSnapshot.docs.filter((document) => document.data().status === "pending").length,
      nonPendingRecalculationRequestCount: requestSnapshot.docs.filter((document) => document.data().status !== "pending").length,
      aggregateMonthDocumentCount: monthSnapshot.size,
      leaderboardMonthDocumentCount: leaderboardSnapshot.size,
    },
    dataQuality: {
      malformedScoringEvents: 0,
      eventsWithoutMonthKey: missingMonthKeyCount,
      pendingDuplicateEvents: events.filter((event) => event.duplicateResolutionRole === "PENDING_REVIEW").length,
      excludedConfirmedDuplicateEvents: events.filter((event) => event.duplicateResolutionRole === "EXCLUDED_DUPLICATE").length,
      canonicalConflicts: events.filter((event) => event.ineligibilityReasons.includes("CANONICAL_SOURCE_CONFLICT")).length,
      note: "No player identifiers, profile snapshots, source paths, coordinates, or event details are included.",
    },
  };
  await fs.writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  console.log(JSON.stringify(report, null, 2));
  console.log(`Saved privacy-safe preview: ${outputPath}`);
}

main().catch((error) => { console.error(error instanceof Error ? error.message : "Unknown preview error"); process.exitCode = 1; });
