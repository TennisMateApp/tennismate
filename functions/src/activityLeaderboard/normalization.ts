/* eslint-disable max-len, require-jsdoc */
import {createHash} from "crypto";
import {ACTIVITY_TIME_ZONE, NORMALIZATION_VERSION} from "./config";
import {monthKeyFor, parseActivityDate, weekKeyFor} from "./dateUtils";
import {buildPairId, extractParticipants} from "./pairUtils";
import {buildDuplicateGroupKey, buildDuplicateLookupKeys} from "./duplicateClassifier";
import {IneligibilityReason, MatchHistorySource, NormalizedActivityEvent} from "./types";

function cleanString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const cleaned = value.trim();
  return cleaned.length > 0 ? cleaned : null;
}

function hash(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === "object" && !(value instanceof Date)) {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, stableValue(item)])
    );
  }
  return value;
}

function stableStringify(value: unknown): string {
  return JSON.stringify(stableValue(value));
}

export function buildCanonicalEventId(sourceDocumentId: string, source: MatchHistorySource): string {
  const requestId = cleanString(source.matchRequestId);
  const inviteId = cleanString(source.inviteId);
  const namespace = requestId ? "request" : inviteId ? "invite" : "history";
  const identifier = requestId || inviteId || sourceDocumentId;
  return `${namespace}_${hash(`${namespace}:${identifier}`)}`;
}

function hasProvidedValue(value: unknown): boolean {
  return value !== null && value !== undefined && !(typeof value === "string" && value.trim() === "");
}

function scorePresent(source: MatchHistorySource): boolean {
  if (typeof source.score === "string" && source.score.trim().length > 0) return true;
  return Array.isArray(source.sets) && source.sets.length > 0;
}

function hashValue(value: unknown): string | null {
  if (value === null || value === undefined || value === "") return null;
  return hash(stableStringify(value));
}

function locationAuditValue(source: MatchHistorySource): unknown {
  const court = source.court && typeof source.court === "object" ?
    source.court as Record<string, unknown> : {};
  return {
    courtId: cleanString(court.id),
    courtName: cleanString(court.name),
    location: cleanString(source.location),
  };
}

function activityDateKey(activityAt: Date | null): string | null {
  if (!activityAt) return null;
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: ACTIVITY_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(activityAt);
}

export function normalizeMatchHistory(sourceDocumentId: string, source: MatchHistorySource): NormalizedActivityEvent {
  const canonicalMatchId = buildCanonicalEventId(sourceDocumentId, source);
  const participants = extractParticipants(source);
  const reasons: IneligibilityReason[] = [];
  const completed = source.completed === true || source.status === "completed";
  const notPlayed = source.outcome === "not_played" || source.status === "not_played";
  if (!completed) reasons.push("NOT_COMPLETED");
  if (notPlayed) reasons.push("NOT_PLAYED");
  if (participants.validUidCount !== 2) reasons.push("INVALID_PARTICIPANT_COUNT");
  if (participants.selfMatch) reasons.push("SELF_MATCH");

  const playedDate = parseActivityDate(source.playedDate, true);
  const completedAt = parseActivityDate(source.completedAt);
  const activityAt = playedDate || completedAt;
  const activityDateSource = playedDate ? "playedDate" : completedAt ? "completedAt" : null;
  if (!activityAt) {
    const dateWasProvided = hasProvidedValue(source.playedDate) || hasProvidedValue(source.completedAt);
    reasons.push(dateWasProvided ? "INVALID_ACTIVITY_DATE" : "MISSING_ACTIVITY_DATE");
  }

  const participantIds = participants.participantIds;
  const pairId = participantIds.length === 2 ? buildPairId(participantIds) : null;
  const monthKey = activityAt ? monthKeyFor(activityAt) : null;
  const weekKey = activityAt ? weekKeyFor(activityAt) : null;
  const presentScore = scorePresent(source);
  const eligible = reasons.length === 0;
  const dateKey = activityDateKey(activityAt);
  const scoreFingerprint = presentScore ? hashValue({score: source.score || null, sets: source.sets || []}) : null;
  const conversationFingerprint = hashValue(cleanString(source.conversationId));
  const locationFingerprint = Object.values(locationAuditValue(source) as Record<string, unknown>).some(Boolean) ?
    hashValue(locationAuditValue(source)) : null;
  const winnerFingerprint = hashValue(cleanString(source.winnerId));
  const sourceCompletedAt = parseActivityDate(source.completedAt);
  const duplicateGroupKey = buildDuplicateGroupKey(pairId, dateKey);
  const duplicateLookupKeys = buildDuplicateLookupKeys({
    duplicateGroupKey,
    matchRequestId: cleanString(source.matchRequestId),
    inviteId: cleanString(source.inviteId),
  });
  const fingerprintPayload = {
    participantIds,
    pairId,
    activityAt: activityAt?.toISOString() || null,
    monthKey,
    weekKey,
    eligible,
    reasons,
    scorePresent: presentScore,
    originalMatchRequestId: cleanString(source.matchRequestId),
    inviteId: cleanString(source.inviteId),
    conversationId: cleanString(source.conversationId),
    sourceCompletionPath: cleanString(source.completedFrom),
  };
  const sourceFingerprint = hash(stableStringify({
    ...fingerprintPayload,
    sourceDocumentId,
    scoreFingerprint,
    conversationFingerprint,
    locationFingerprint,
    winnerFingerprint,
    sourceCompletedAt: sourceCompletedAt?.toISOString() || null,
  }));

  return {
    canonicalMatchId,
    sourceCollection: "match_history",
    sourceDocumentId,
    sourcePath: `match_history/${sourceDocumentId}`,
    participantIds,
    pairId,
    activityAt,
    activityDateSource,
    monthKey,
    weekKey,
    timeZone: ACTIVITY_TIME_ZONE,
    eligible,
    ineligibilityReasons: reasons,
    originalMatchRequestId: cleanString(source.matchRequestId),
    inviteId: cleanString(source.inviteId),
    conversationId: cleanString(source.conversationId),
    scorePresent: presentScore,
    scoreConfirmedByBoth: false,
    normalizationVersion: NORMALIZATION_VERSION,
    sourceUpdatedAt: parseActivityDate(source.updatedAt),
    leaderboardFingerprint: hash(stableStringify(fingerprintPayload)),
    sourceFingerprint,
    activityDateKey: dateKey,
    sourceCompletedAt,
    scoreFingerprint,
    conversationFingerprint,
    locationFingerprint,
    winnerFingerprint,
    sourceCompletionPath: cleanString(source.completedFrom),
    duplicateClassification: "NONE",
    duplicateGroupKey,
    duplicateLookupKeys,
    duplicateEvidenceCodes: [],
    duplicateReviewStatus: "NOT_REQUIRED",
    duplicateResolutionRole: "NOT_APPLICABLE",
    duplicateSurvivorEventId: null,
    eligibleForScoring: eligible,
    conflictingSourcePaths: [],
    conflictingSourceFingerprints: [],
  };
}
