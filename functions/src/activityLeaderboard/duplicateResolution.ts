/* eslint-disable max-len, require-jsdoc, valid-jsdoc */
import {createHash} from "crypto";
import {DUPLICATE_CLASSIFICATION_VERSION, DUPLICATE_RESOLUTION_VERSION, MANUAL_DUPLICATE_DECISION_VERSION} from "./config";
import {DuplicateEvidenceCode, DuplicateReviewStatus, NormalizedActivityEvent} from "./types";

export type DuplicateResolutionReason =
  | "CONFIRMED_AUTHORITATIVE_LINK"
  | "PREFERRED_PLAYED_DATE"
  | "PREFERRED_LIFECYCLE_DATA"
  | "PREFERRED_SCORE_DATA"
  | "EARLIEST_ACTIVITY"
  | "EARLIEST_SOURCE_COMPLETION"
  | "LEXICOGRAPHIC_SOURCE_PATH"
  | "CONFLICTING_PARTICIPANTS"
  | "CONFLICTING_PLAYED_DATES"
  | "CONFLICTING_SCORES"
  | "MISSING_SHARED_AUTHORITY";

export interface DuplicateGroupResolution {
  status: DuplicateReviewStatus;
  survivorEventId: string | null;
  excludedEventIds: string[];
  resolutionReasonCodes: DuplicateResolutionReason[];
  resolutionVersion: number | null;
  events: NormalizedActivityEvent[];
}

export type ManualDuplicateDecision = "CONFIRMED_DUPLICATE" | "CONFIRMED_DISTINCT";
export interface ManualDuplicateResolution {
  duplicateGroupKey: string;
  groupFingerprint: string;
  decision: ManualDuplicateDecision;
  survivorEventId: string | null;
  decisionReasonCode: string;
  decisionVersion: number;
  source: "ADMIN_SCRIPT";
}

export function duplicateGroupFingerprint(events: NormalizedActivityEvent[]): string {
  const identities = [...events].map((event) => `${event.canonicalMatchId}:${event.sourceFingerprint}`).sort();
  return createHash("sha256").update(JSON.stringify({classificationVersion: DUPLICATE_CLASSIFICATION_VERSION, resolutionVersion: DUPLICATE_RESOLUTION_VERSION, identities})).digest("hex");
}

export function applyManualDuplicateResolution(
  input: NormalizedActivityEvent[], resolution: ManualDuplicateResolution
): DuplicateGroupResolution {
  const events = [...input].sort((a, b) => a.sourcePath.localeCompare(b.sourcePath));
  const stale = resolution.decisionVersion !== MANUAL_DUPLICATE_DECISION_VERSION ||
    resolution.groupFingerprint !== duplicateGroupFingerprint(events);
  const survivorValid = resolution.decision === "CONFIRMED_DUPLICATE" &&
    resolution.survivorEventId !== null && events.some((event) => event.canonicalMatchId === resolution.survivorEventId);
  const distinctValid = resolution.decision === "CONFIRMED_DISTINCT" && resolution.survivorEventId === null;
  if (stale || (!survivorValid && !distinctValid) || events.some((event) => !event.eligible || event.ineligibilityReasons.includes("CANONICAL_SOURCE_CONFLICT"))) {
    return {status: "PENDING", survivorEventId: null, excludedEventIds: [], resolutionReasonCodes: [], resolutionVersion: null, events: holdPossibleDuplicateGroup(events)};
  }
  if (resolution.decision === "CONFIRMED_DISTINCT") {
    return {status: "MANUALLY_CONFIRMED_DISTINCT", survivorEventId: null, excludedEventIds: [], resolutionReasonCodes: [], resolutionVersion: resolution.decisionVersion, events: events.map((event) => ({...event, duplicateReviewStatus: "MANUALLY_CONFIRMED_DISTINCT", duplicateResolutionRole: "NOT_APPLICABLE", duplicateSurvivorEventId: null, eligibleForScoring: event.eligible}))};
  }
  return {status: "MANUALLY_CONFIRMED_DUPLICATE", survivorEventId: resolution.survivorEventId, excludedEventIds: events.filter((event) => event.canonicalMatchId !== resolution.survivorEventId).map((event) => event.canonicalMatchId).sort(), resolutionReasonCodes: [], resolutionVersion: resolution.decisionVersion, events: events.map((event) => ({...event, duplicateReviewStatus: "MANUALLY_CONFIRMED_DUPLICATE", duplicateResolutionRole: event.canonicalMatchId === resolution.survivorEventId ? "SURVIVOR" : "EXCLUDED_DUPLICATE", duplicateSurvivorEventId: event.canonicalMatchId === resolution.survivorEventId ? null : resolution.survivorEventId, eligibleForScoring: event.eligible && event.canonicalMatchId === resolution.survivorEventId}))};
}

function unique(values: Array<string | null>): string[] {
  return Array.from(new Set(values.filter((value): value is string => Boolean(value))));
}

function lifecycleRichness(event: NormalizedActivityEvent): number {
  return Number(Boolean(event.originalMatchRequestId)) +
    Number(Boolean(event.inviteId)) + Number(Boolean(event.conversationId));
}

function millis(value: Date | null): number {
  return value && !Number.isNaN(value.getTime()) ? value.getTime() : Number.MAX_SAFE_INTEGER;
}

/**
 * Stable survivor precedence uses only lifecycle/activity facts. playedDate is the
 * best evidence of when tennis occurred; authoritative IDs and conversation data
 * represent richer lifecycle provenance; score data preserves match detail;
 * timestamps preserve the earliest same-match record; source path is a total,
 * immutable tie-breaker. Profile fields and Firestore query order are never used.
 */
export function compareDuplicateSurvivors(a: NormalizedActivityEvent, b: NormalizedActivityEvent): number {
  const comparisons = [
    Number(b.activityDateSource === "playedDate") - Number(a.activityDateSource === "playedDate"),
    lifecycleRichness(b) - lifecycleRichness(a),
    Number(b.scorePresent) - Number(a.scorePresent),
    millis(a.activityAt) - millis(b.activityAt),
    millis(a.sourceCompletedAt) - millis(b.sourceCompletedAt),
  ];
  return comparisons.find((value) => value !== 0) || a.sourcePath.localeCompare(b.sourcePath);
}

function sharedAuthority(events: NormalizedActivityEvent[]): boolean {
  const requests = new Map<string, number>();
  const invites = new Map<string, number>();
  for (const event of events) {
    if (event.originalMatchRequestId) requests.set(event.originalMatchRequestId, (requests.get(event.originalMatchRequestId) || 0) + 1);
    if (event.inviteId) invites.set(event.inviteId, (invites.get(event.inviteId) || 0) + 1);
  }
  return [...requests.values(), ...invites.values()].some((count) => count === events.length);
}

export function resolveConfirmedDuplicateGroup(input: NormalizedActivityEvent[]): DuplicateGroupResolution {
  const events = [...input].sort((a, b) => a.sourcePath.localeCompare(b.sourcePath));
  const reasons: DuplicateResolutionReason[] = [];
  if (events.length < 2 || unique(events.map((event) => event.pairId)).length !== 1) reasons.push("CONFLICTING_PARTICIPANTS");
  const playedDates = unique(events.filter((event) => event.activityDateSource === "playedDate").map((event) => event.activityDateKey));
  if (playedDates.length > 1) reasons.push("CONFLICTING_PLAYED_DATES");
  const scores = unique(events.map((event) => event.scoreFingerprint));
  const winners = unique(events.map((event) => event.winnerFingerprint));
  // A score fingerprint can differ solely because one lifecycle copied a score
  // string while another copied structured sets. Treat it as material only when
  // independently accompanied by contradictory winner facts.
  if (scores.length > 1 && winners.length > 1) reasons.push("CONFLICTING_SCORES");
  if (!sharedAuthority(events)) reasons.push("MISSING_SHARED_AUTHORITY");
  if (reasons.length > 0) {
    return {
      status: "PENDING", survivorEventId: null, excludedEventIds: [],
      resolutionReasonCodes: reasons, resolutionVersion: null,
      events: events.map((event) => ({...event, duplicateReviewStatus: "PENDING", duplicateResolutionRole: "PENDING_REVIEW", duplicateSurvivorEventId: null, eligibleForScoring: false})),
    };
  }
  const ranked = [...events].sort(compareDuplicateSurvivors);
  const survivor = ranked[0];
  const excluded = ranked.slice(1);
  const winnerReasons: DuplicateResolutionReason[] = ["CONFIRMED_AUTHORITATIVE_LINK"];
  if (survivor.activityDateSource === "playedDate" && events.some((event) => event.activityDateSource !== "playedDate")) winnerReasons.push("PREFERRED_PLAYED_DATE");
  if (events.some((event) => lifecycleRichness(event) < lifecycleRichness(survivor))) winnerReasons.push("PREFERRED_LIFECYCLE_DATA");
  if (survivor.scorePresent && events.some((event) => !event.scorePresent)) winnerReasons.push("PREFERRED_SCORE_DATA");
  winnerReasons.push("EARLIEST_ACTIVITY", "EARLIEST_SOURCE_COMPLETION", "LEXICOGRAPHIC_SOURCE_PATH");
  return {
    status: "AUTO_RESOLVED", survivorEventId: survivor.canonicalMatchId,
    excludedEventIds: excluded.map((event) => event.canonicalMatchId).sort(),
    resolutionReasonCodes: winnerReasons, resolutionVersion: DUPLICATE_RESOLUTION_VERSION,
    events: ranked.map((event) => ({
      ...event,
      duplicateReviewStatus: "AUTO_RESOLVED",
      duplicateResolutionRole: event.canonicalMatchId === survivor.canonicalMatchId ? "SURVIVOR" : "EXCLUDED_DUPLICATE",
      duplicateSurvivorEventId: event.canonicalMatchId === survivor.canonicalMatchId ? null : survivor.canonicalMatchId,
      eligibleForScoring: event.eligible && event.canonicalMatchId === survivor.canonicalMatchId,
    })),
  };
}

export function holdPossibleDuplicateGroup(input: NormalizedActivityEvent[]): NormalizedActivityEvent[] {
  return [...input].sort((a, b) => a.sourcePath.localeCompare(b.sourcePath)).map((event) => ({
    ...event, duplicateReviewStatus: "PENDING", duplicateResolutionRole: "PENDING_REVIEW",
    duplicateSurvivorEventId: null, eligibleForScoring: false,
  }));
}

export function evidenceCodesForResolution(events: NormalizedActivityEvent[]): DuplicateEvidenceCode[] {
  return Array.from(new Set(events.flatMap((event) => event.duplicateEvidenceCodes))).sort();
}
