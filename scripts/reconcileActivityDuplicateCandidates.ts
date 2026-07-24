import * as admin from "firebase-admin";
import {promises as fs} from "fs";
import path from "path";
import {
  classifyDuplicateCandidates,
  strongestClassification,
} from "../functions/src/activityLeaderboard/duplicateClassifier";
import {normalizeMatchHistory} from "../functions/src/activityLeaderboard/normalization";
import {
  DuplicateClassification,
  DuplicateEvidenceCode,
  MatchHistorySource,
  NormalizedActivityEvent,
} from "../functions/src/activityLeaderboard/types";
import {parseActivityAuditOptions} from "./activityLeaderboardAuditCli";

function increment(record: Record<string, number>, key: string): void {
  record[key] = (record[key] || 0) + 1;
}

async function main(): Promise<void> {
  const options = parseActivityAuditOptions(process.argv.slice(2), process.env);
  if (process.argv.includes("--write")) {
    throw new Error("Write mode is not implemented. This reconciliation command is read-only.");
  }
  if (admin.apps.length === 0) admin.initializeApp();
  let query: FirebaseFirestore.Query = admin.firestore().collection("match_history");
  if (options.limit !== null) query = query.limit(options.limit);
  const snapshot = await query.get();
  const events = snapshot.docs
    .map((doc) => normalizeMatchHistory(doc.id, doc.data() as MatchHistorySource))
    .filter((event) => event.eligible)
    .filter((event) => !options.month || event.monthKey === options.month);

  const lookupBuckets = new Map<string, NormalizedActivityEvent[]>();
  for (const event of events) {
    for (const lookupKey of event.duplicateLookupKeys) {
      const members = lookupBuckets.get(lookupKey) || [];
      members.push(event);
      lookupBuckets.set(lookupKey, members);
    }
  }

  const classifiedGroups = new Map<string, {
    members: Map<string, NormalizedActivityEvent>;
    classifications: DuplicateClassification[];
    evidence: Set<DuplicateEvidenceCode>;
  }>();
  const comparedPairs = new Set<string>();
  for (const members of lookupBuckets.values()) {
    if (members.length < 2) continue;
    for (let left = 0; left < members.length; left += 1) {
      for (let right = left + 1; right < members.length; right += 1) {
        const pairKey = [members[left].sourceFingerprint, members[right].sourceFingerprint].sort().join("|");
        if (comparedPairs.has(pairKey)) continue;
        comparedPairs.add(pairKey);
        const result = classifyDuplicateCandidates(members[left], members[right]);
        if (result.classification === "NONE" || !result.duplicateGroupKey) continue;
        const group = classifiedGroups.get(result.duplicateGroupKey) || {
          members: new Map<string, NormalizedActivityEvent>(),
          classifications: [],
          evidence: new Set<DuplicateEvidenceCode>(),
        };
        group.members.set(members[left].sourceFingerprint, members[left]);
        group.members.set(members[right].sourceFingerprint, members[right]);
        group.classifications.push(result.classification);
        result.evidenceCodes.forEach((code) => group.evidence.add(code));
        classifiedGroups.set(result.duplicateGroupKey, group);
      }
    }
  }

  const classificationCounts: Record<string, number> = {};
  const evidenceCodeCounts: Record<string, number> = {};
  const affectedMonths: Record<string, number> = {};
  const duplicateGroups: Array<{
    anonymizedGroupKey: string;
    memberCount: number;
    classification: DuplicateClassification;
    evidenceCodes: DuplicateEvidenceCode[];
    affectedMonthKeys: string[];
    estimatedEventsExcludedFromScoring: number;
  }> = [];
  let estimatedEventsExcludedFromScoring = 0;

  for (const [groupKey, group] of classifiedGroups.entries()) {
    const members = Array.from(group.members.values());
    const classification = strongestClassification(group.classifications);
    const evidenceCodes = Array.from(group.evidence).sort();
    const monthKeys = Array.from(new Set(
      members.map((event) => event.monthKey).filter((month): month is string => Boolean(month))
    )).sort();
    const excluded = classification === "POSSIBLE_SAME_MATCH" ||
      classification === "CONFIRMED_SAME_MATCH" ? members.length : 0;
    estimatedEventsExcludedFromScoring += excluded;
    increment(classificationCounts, classification);
    evidenceCodes.forEach((code) => increment(evidenceCodeCounts, code));
    monthKeys.forEach((month) => increment(affectedMonths, month));
    duplicateGroups.push({
      anonymizedGroupKey: groupKey,
      memberCount: members.length,
      classification,
      evidenceCodes,
      affectedMonthKeys: monthKeys,
      estimatedEventsExcludedFromScoring: excluded,
    });
  }

  const report = {
    mode: "READ_ONLY",
    generatedAt: new Date().toISOString(),
    filters: options,
    sourceRecordsScanned: snapshot.size,
    eligibleEventsConsidered: events.length,
    duplicateGroupCount: duplicateGroups.length,
    classificationCounts,
    evidenceCodeCounts,
    affectedMonths,
    estimatedEventsExcludedFromScoring,
    duplicateGroups,
  };
  const output = JSON.stringify(report, null, 2);
  console.log(output);
  if (options.output) {
    const outputPath = path.resolve(options.output);
    await fs.mkdir(path.dirname(outputPath), {recursive: true});
    await fs.writeFile(outputPath, `${output}\n`, "utf8");
    console.log(JSON.stringify({reportWrittenTo: outputPath}));
  }
}

main().catch((error: unknown) => {
  console.error(JSON.stringify({
    script: "reconcileActivityDuplicateCandidates",
    errorCategory: error instanceof Error ? error.name : "UNKNOWN",
    message: error instanceof Error ? error.message : String(error),
  }));
  process.exitCode = 1;
});
