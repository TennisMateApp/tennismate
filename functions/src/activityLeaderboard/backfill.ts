/* eslint-disable max-len, require-jsdoc, curly, brace-style, block-spacing */
import {createHash} from "crypto";
import {ACTIVITY_BACKFILL_FORMAT_VERSION, DUPLICATE_CLASSIFICATION_VERSION, DUPLICATE_RESOLUTION_VERSION, NORMALIZATION_VERSION} from "./config";
import {classifyDuplicateCandidates, strongestClassification} from "./duplicateClassifier";
import {applyManualDuplicateResolution, duplicateGroupFingerprint, holdPossibleDuplicateGroup, ManualDuplicateResolution, resolveConfirmedDuplicateGroup} from "./duplicateResolution";
import {MatchHistorySource, NormalizedActivityEvent} from "./types";
import {normalizeMatchHistory} from "./normalization";

export interface BackfillSourceRecord {id: string; data: MatchHistorySource}
export interface StoredBackfillState {
  events?: NormalizedActivityEvent[];
  duplicateReviews?: Array<{id: string; data: Record<string, unknown>}>;
  duplicateResolutions?: ManualDuplicateResolution[];
  dirtyMonths?: string[];
}
export interface PlannedDuplicateReview {id: string; data: Record<string, unknown>}
export interface ActivityBackfillPlan {
  report: ActivityBackfillReport;
  events: NormalizedActivityEvent[];
  duplicateReviews: PlannedDuplicateReview[];
  sourceWatermark: string | null;
  failures: Array<{category: string; count: number}>;
}
export interface ActivityBackfillReport {
  mode: "DRY_RUN";
  versions: {normalization: number; duplicateClassification: number; duplicateResolution: number; format: number};
  sourceRecordsScanned: number; recordsIncluded: number; structurallyEligible: number; structurallyIneligible: number;
  canonicalEventsGenerated: number; canonicalConflicts: number; duplicateReviewGroups: number; autoResolvedConfirmedGroups: number;
  possibleGroupsPending: number; scoringSurvivors: number; excludedConfirmedDuplicates: number; pendingPossibleDuplicateEvents: number;
  expectedScoringEligibleEventCount: number; expectedPlayerMatchContributions: number; monthlyScoringEligibleCounts: Record<string, number>;
  dirtyMonths: string[]; documentChanges: {wouldCreate: number; wouldUpdate: number; unchanged: number; wouldExclude: number; wouldDelete: 0; potentialStaleOrOrphaned: number};
  duplicateGroups: Array<Record<string, unknown>>; deterministicOutputChecksum: string;
}

export function stable(value: unknown): unknown {
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value as Record<string, unknown>).filter(([key]) => !["normalizedAt", "updatedAt", "requestedAt"].includes(key)).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, stable(item)]));
  return value;
}

export function activityChecksum(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(stable(value))).digest("hex");
}

function minuteSeparation(events: NormalizedActivityEvent[]): number | null {
  const values = events.map((event) => event.sourceCompletedAt?.getTime()).filter((value): value is number => value !== undefined).sort((a, b) => a - b);
  return values.length > 1 ? Math.round((values[values.length - 1] - values[0]) / 60000) : null;
}

function comparableEvent(event: NormalizedActivityEvent): unknown { return stable(event); }

function versionProblem(event: NormalizedActivityEvent): boolean { return Number(event.normalizationVersion || 0) > NORMALIZATION_VERSION; }

export function planActivityBackfill(recordsInput: BackfillSourceRecord[], month: string | null = null, stored: StoredBackfillState = {}): ActivityBackfillPlan {
  const records = [...recordsInput].sort((a, b) => a.id.localeCompare(b.id));
  const normalized = records.map(({id, data}) => normalizeMatchHistory(id, data));
  const events = normalized.filter((event) => !month || event.monthKey === month);
  const collisions = new Map<string, NormalizedActivityEvent[]>();
  for (const event of events) collisions.set(event.canonicalMatchId, [...(collisions.get(event.canonicalMatchId) || []), event]);
  const canonicalConflicts = [...collisions.values()].filter((items) => new Set(items.map((item) => item.sourcePath)).size > 1);
  const storedConflictIds = new Set((stored.events || []).filter((event) => event.ineligibilityReasons.includes("CANONICAL_SOURCE_CONFLICT")).map((event) => event.canonicalMatchId));
  const canonicalConflictCount = new Set([...canonicalConflicts.map((items) => items[0].canonicalMatchId), ...storedConflictIds]).size;

  const buckets = new Map<string, NormalizedActivityEvent[]>();
  for (const event of events.filter((item) => item.eligible)) for (const key of event.duplicateLookupKeys) buckets.set(key, [...(buckets.get(key) || []), event]);
  const groups = new Map<string, {members: Map<string, NormalizedActivityEvent>; classifications: Array<NormalizedActivityEvent["duplicateClassification"]>; evidence: string[]} >();
  const compared = new Set<string>();
  for (const members of buckets.values()) for (let left = 0; left < members.length; left += 1) for (let right = left + 1; right < members.length; right += 1) {
    const pair = [members[left].sourcePath, members[right].sourcePath].sort().join("|");
    if (compared.has(pair)) continue;
    compared.add(pair);
    const result = classifyDuplicateCandidates(members[left], members[right]);
    if (result.classification === "NONE" || !result.duplicateGroupKey) continue;
    const group = groups.get(result.duplicateGroupKey) || {members: new Map<string, NormalizedActivityEvent>(), classifications: [], evidence: []};
    group.members.set(members[left].sourcePath, members[left]); group.members.set(members[right].sourcePath, members[right]);
    group.classifications.push(result.classification); group.evidence.push(...result.evidenceCodes);
    groups.set(result.duplicateGroupKey, group);
  }

  const manualByGroup = new Map((stored.duplicateResolutions || []).map((resolution) => [resolution.duplicateGroupKey, resolution]));
  const replacements = new Map<string, NormalizedActivityEvent>();
  const summaries: Array<Record<string, unknown>> = [];
  const reviews: PlannedDuplicateReview[] = [];
  let autoResolved = 0; let possible = 0; let excluded = 0;
  [...groups.entries()].sort(([a], [b]) => a.localeCompare(b)).forEach(([groupKey, group], index) => {
    const members = [...group.members.values()].sort((a, b) => a.sourcePath.localeCompare(b.sourcePath));
    const classification = strongestClassification(group.classifications);
    const manual = manualByGroup.get(groupKey);
    let resolved = classification === "CONFIRMED_SAME_MATCH" ? resolveConfirmedDuplicateGroup(members) : {status: "PENDING" as const, survivorEventId: null, excludedEventIds: [], resolutionReasonCodes: [], resolutionVersion: null, events: holdPossibleDuplicateGroup(members)};
    let resolutionSource: "automatic" | "manual" | "pending" = classification === "CONFIRMED_SAME_MATCH" && resolved.status === "AUTO_RESOLVED" ? "automatic" : "pending";
    let staleManualResolution = false;
    if (manual) {
      const applied = applyManualDuplicateResolution(members, manual);
      if (applied.status === "PENDING") staleManualResolution = true;
      else { resolved = applied; resolutionSource = "manual"; }
    }
    resolved.events.map((event) => ({...event, duplicateClassification: classification, duplicateGroupKey: groupKey})).forEach((event) => replacements.set(event.sourcePath, event));
    if (resolved.status === "AUTO_RESOLVED") autoResolved += 1;
    if (classification === "POSSIBLE_SAME_MATCH") possible += 1;
    excluded += resolved.excludedEventIds.length;
    const affectedMonthKeys = [...new Set(members.map((item) => item.monthKey).filter((value): value is string => Boolean(value)))].sort();
    reviews.push({id: groupKey, data: {duplicateGroupKey: groupKey, groupFingerprint: duplicateGroupFingerprint(members), classification, status: resolved.status, staleManualResolution, manualResolutionStatus: staleManualResolution ? "STALE_OR_REJECTED" : resolutionSource === "manual" ? "APPLIED" : "NOT_APPLICABLE", survivorEventId: resolved.survivorEventId, excludedEventIds: [...resolved.excludedEventIds].sort(), sourceEventIds: members.map((item) => item.canonicalMatchId).sort(), sourcePaths: members.map((item) => item.sourcePath).sort(), sourceFingerprints: members.map((item) => item.sourceFingerprint).sort(), evidenceCodes: [...new Set(group.evidence)].sort(), affectedMonthKeys, normalizationVersion: NORMALIZATION_VERSION, resolutionVersion: resolved.status === "AUTO_RESOLVED" ? DUPLICATE_RESOLUTION_VERSION : null}});
    const baseSummary: Record<string, unknown> = classification === "POSSIBLE_SAME_MATCH" ? {groupNumber: index + 1, classification, memberCount: members.length, monthKeys: affectedMonthKeys} : {groupNumber: index + 1, classification, memberCount: members.length, status: resolved.status, monthKeys: affectedMonthKeys, reasonCodes: resolved.resolutionReasonCodes};
    if (classification === "POSSIBLE_SAME_MATCH") Object.assign(baseSummary, {activityTimestampsIdentical: new Set(members.map((item) => item.activityAt?.toISOString())).size === 1, completionTimeSeparationMinutes: minuteSeparation(members), playedDatesMatch: new Set(members.filter((item) => item.activityDateSource === "playedDate").map((item) => item.activityDateKey)).size <= 1, conversationIdentifiersMatch: new Set(members.map((item) => item.conversationFingerprint).filter(Boolean)).size === 1, scoreFingerprintsMatch: new Set(members.map((item) => item.scoreFingerprint).filter(Boolean)).size === 1, winnerIdentifiers: members.every((item) => !item.winnerFingerprint) ? "missing" : new Set(members.map((item) => item.winnerFingerprint).filter(Boolean)).size === 1 ? "match" : "different", locationFingerprintsMatch: new Set(members.map((item) => item.locationFingerprint).filter(Boolean)).size === 1, sourceCompletionPaths: new Set(members.map((item) => item.sourceCompletionPath).filter(Boolean)).size <= 1 ? "same_or_missing" : "different", anyRequestId: members.some((item) => Boolean(item.originalMatchRequestId)), anyInviteId: members.some((item) => Boolean(item.inviteId)), recommendedClassificationConfidence: "medium"});
    summaries.push(baseSummary);
  });
  const finalEvents = events.map((event) => replacements.get(event.sourcePath) || event).sort((a, b) => a.sourcePath.localeCompare(b.sourcePath));
  const scoring = finalEvents.filter((event) => event.eligibleForScoring);
  const monthly: Record<string, number> = {}; scoring.forEach((event) => { if (event.monthKey) monthly[event.monthKey] = (monthly[event.monthKey] || 0) + 1; });
  const dirtyMonths = [...new Set(finalEvents.map((event) => event.monthKey).filter((value): value is string => Boolean(value)))].sort();
  const versions = {normalization: NORMALIZATION_VERSION, duplicateClassification: DUPLICATE_CLASSIFICATION_VERSION, duplicateResolution: DUPLICATE_RESOLUTION_VERSION, format: ACTIVITY_BACKFILL_FORMAT_VERSION};
  const deterministic = {versions, eventStates: finalEvents.map((event) => ({sourceFingerprint: event.sourceFingerprint, canonicalMatchId: event.canonicalMatchId, eligible: event.eligible, eligibleForScoring: event.eligibleForScoring, role: event.duplicateResolutionRole, survivor: event.duplicateSurvivorEventId, monthKey: event.monthKey})), groups: summaries, dirtyMonths};
  const existing = new Map((stored.events || []).map((event) => [event.canonicalMatchId, event]));
  const failures: Array<{category: string; count: number}> = [];
  const newer = (stored.events || []).filter(versionProblem).length; if (newer) failures.push({category: "UNSUPPORTED_NEWER_VERSION", count: newer});
  const newerReviews = (stored.duplicateReviews || []).filter((review) => Number(review.data.normalizationVersion || 0) > NORMALIZATION_VERSION || Number(review.data.resolutionVersion || 0) > DUPLICATE_RESOLUTION_VERSION).length; if (newerReviews) failures.push({category: "UNSUPPORTED_NEWER_REVIEW_VERSION", count: newerReviews});
  let wouldCreate = 0; let wouldUpdate = 0; let unchanged = 0;
  for (const event of finalEvents) { const prior = existing.get(event.canonicalMatchId); if (!prior) wouldCreate += 1; else if (JSON.stringify(comparableEvent(prior)) === JSON.stringify(comparableEvent(event))) unchanged += 1; else wouldUpdate += 1; }
  const expectedIds = new Set(finalEvents.map((event) => event.canonicalMatchId));
  const potentialStaleOrOrphaned = (stored.events || []).filter((event) => !expectedIds.has(event.canonicalMatchId)).length;
  const report: ActivityBackfillReport = {mode: "DRY_RUN", versions, sourceRecordsScanned: records.length, recordsIncluded: events.length, structurallyEligible: events.filter((event) => event.eligible).length, structurallyIneligible: events.filter((event) => !event.eligible).length, canonicalEventsGenerated: finalEvents.length, canonicalConflicts: canonicalConflictCount, duplicateReviewGroups: groups.size, autoResolvedConfirmedGroups: autoResolved, possibleGroupsPending: possible, scoringSurvivors: scoring.length, excludedConfirmedDuplicates: excluded, pendingPossibleDuplicateEvents: finalEvents.filter((event) => event.duplicateResolutionRole === "PENDING_REVIEW").length, expectedScoringEligibleEventCount: scoring.length, expectedPlayerMatchContributions: scoring.length * 2, monthlyScoringEligibleCounts: Object.fromEntries(Object.entries(monthly).sort()), dirtyMonths, documentChanges: {wouldCreate, wouldUpdate, unchanged, wouldExclude: excluded + finalEvents.filter((event) => event.duplicateResolutionRole === "PENDING_REVIEW").length, wouldDelete: 0, potentialStaleOrOrphaned}, duplicateGroups: summaries, deterministicOutputChecksum: activityChecksum(deterministic)};
  const sourceWatermark = records.length ? activityChecksum(records.map((record, index) => ({cursor: index + 1, sourceFingerprint: normalizeMatchHistory(record.id, record.data).sourceFingerprint}))) : null;
  return {report, events: finalEvents, duplicateReviews: reviews, sourceWatermark, failures};
}

export function buildActivityBackfill(records: BackfillSourceRecord[], month: string | null = null): ActivityBackfillReport { return planActivityBackfill(records, month).report; }

export interface ReconciliationReport {exactMatchCount: number; missingRecordsCount: number; unexpectedRecordsCount: number; mismatchedRecordsCount: number; versionMismatches: number; scoringEligibilityMismatches: number; duplicateResolutionMismatches: number; dirtyMonthMismatches: number; expectedChecksum: string; storedStateChecksum: string; matches: boolean}
export function reconcileActivityBackfill(plan: ActivityBackfillPlan, stored: StoredBackfillState): ReconciliationReport {
  const expected = new Map(plan.events.map((event) => [event.canonicalMatchId, event])); const actual = new Map((stored.events || []).map((event) => [event.canonicalMatchId, event]));
  let exact = 0; let missing = 0; let mismatched = 0; let versions = 0; let eligibility = 0;
  for (const [id, event] of expected) { const value = actual.get(id); if (!value) { missing += 1; continue; } if (Number(value.normalizationVersion) !== NORMALIZATION_VERSION) versions += 1; if (value.eligibleForScoring !== event.eligibleForScoring) eligibility += 1; if (JSON.stringify(comparableEvent(value)) === JSON.stringify(comparableEvent(event))) exact += 1; else mismatched += 1; }
  const unexpected = [...actual.keys()].filter((id) => !expected.has(id)).length;
  const reviews = new Map((stored.duplicateReviews || []).map((review) => [review.id, stable(review.data)])); let duplicateMismatch = 0;
  for (const review of plan.duplicateReviews) if (JSON.stringify(reviews.get(review.id)) !== JSON.stringify(stable(review.data))) duplicateMismatch += 1;
  duplicateMismatch += [...reviews.keys()].filter((id) => !plan.duplicateReviews.some((review) => review.id === id)).length;
  const dirtyMismatch = [...new Set([...plan.report.dirtyMonths.filter((month) => !(stored.dirtyMonths || []).includes(month)), ...(stored.dirtyMonths || []).filter((month) => !plan.report.dirtyMonths.includes(month))])].length;
  const storedStateChecksum = activityChecksum({versions: plan.report.versions, eventStates: [...actual.values()].sort((a, b) => a.sourcePath.localeCompare(b.sourcePath)).map((event) => ({sourceFingerprint: event.sourceFingerprint, canonicalMatchId: event.canonicalMatchId, eligible: event.eligible, eligibleForScoring: event.eligibleForScoring, role: event.duplicateResolutionRole, survivor: event.duplicateSurvivorEventId, monthKey: event.monthKey})), groups: plan.report.duplicateGroups, dirtyMonths: [...(stored.dirtyMonths || [])].sort()});
  return {exactMatchCount: exact, missingRecordsCount: missing, unexpectedRecordsCount: unexpected, mismatchedRecordsCount: mismatched, versionMismatches: versions, scoringEligibilityMismatches: eligibility, duplicateResolutionMismatches: duplicateMismatch, dirtyMonthMismatches: dirtyMismatch, expectedChecksum: plan.report.deterministicOutputChecksum, storedStateChecksum, matches: missing + unexpected + mismatched + versions + eligibility + duplicateMismatch + dirtyMismatch === 0};
}
