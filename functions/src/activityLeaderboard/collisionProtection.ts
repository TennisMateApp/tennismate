/* eslint-disable max-len, require-jsdoc */
import {DUPLICATE_REVIEW_ARRAY_LIMIT} from "./config";
import {NormalizedActivityEvent} from "./types";

function boundedUnique(values: string[]): string[] {
  return Array.from(new Set(values.filter(Boolean))).sort().slice(0, DUPLICATE_REVIEW_ARRAY_LIMIT);
}

export function canonicalConflictAffectedMonths(
  existing: NormalizedActivityEvent,
  incoming: NormalizedActivityEvent
): string[] {
  return boundedUnique([existing.monthKey || "", incoming.monthKey || ""]);
}

export function hasCanonicalSourceConflict(existing: NormalizedActivityEvent, incoming: NormalizedActivityEvent): boolean {
  return existing.canonicalMatchId === incoming.canonicalMatchId &&
    (existing.sourcePath !== incoming.sourcePath || existing.sourceDocumentId !== incoming.sourceDocumentId);
}

export function applyCanonicalSourceConflict(
  existing: NormalizedActivityEvent,
  incoming: NormalizedActivityEvent
): NormalizedActivityEvent {
  const reasons = Array.from(new Set([
    ...existing.ineligibilityReasons,
    "CANONICAL_SOURCE_CONFLICT" as const,
  ]));
  return {
    ...existing,
    eligible: false,
    eligibleForScoring: false,
    ineligibilityReasons: reasons,
    duplicateClassification: "CONFIRMED_SAME_MATCH",
    duplicateReviewStatus: "PENDING",
    duplicateResolutionRole: "PENDING_REVIEW",
    duplicateSurvivorEventId: null,
    duplicateEvidenceCodes: Array.from(new Set([
      ...existing.duplicateEvidenceCodes,
      "CANONICAL_SOURCE_CONFLICT" as const,
    ])),
    conflictingSourcePaths: boundedUnique([
      ...(existing.conflictingSourcePaths || []),
      existing.sourcePath,
      incoming.sourcePath,
    ]),
    conflictingSourceFingerprints: boundedUnique([
      ...(existing.conflictingSourceFingerprints || []),
      existing.sourceFingerprint,
      incoming.sourceFingerprint,
    ]),
  };
}
