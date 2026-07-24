export type ActivityDateSource = "playedDate" | "completedAt" | null;

export type IneligibilityReason =
  | "NOT_COMPLETED"
  | "NOT_PLAYED"
  | "INVALID_PARTICIPANT_COUNT"
  | "SELF_MATCH"
  | "MISSING_ACTIVITY_DATE"
  | "INVALID_ACTIVITY_DATE"
  | "CANONICAL_SOURCE_CONFLICT";

export type DuplicateClassification =
  | "NONE"
  | "CONFIRMED_SAME_MATCH"
  | "POSSIBLE_SAME_MATCH"
  | "LIKELY_DISTINCT_REMATCH";

export type DuplicateReviewStatus =
  | "NOT_REQUIRED"
  | "PENDING"
  | "AUTO_RESOLVED"
  | "MANUALLY_CONFIRMED_DUPLICATE"
  | "MANUALLY_CONFIRMED_DISTINCT";

export type DuplicateResolutionRole =
  | "NOT_APPLICABLE"
  | "SURVIVOR"
  | "EXCLUDED_DUPLICATE"
  | "PENDING_REVIEW";

export type DuplicateEvidenceCode =
  | "SAME_MATCH_REQUEST"
  | "SAME_INVITE"
  | "SAME_PAIR_AND_DATE"
  | "SAME_SCORE"
  | "DIFFERENT_SCORE"
  | "SAME_CONVERSATION"
  | "DIFFERENT_CONVERSATION"
  | "SAME_LOCATION"
  | "DIFFERENT_LOCATION"
  | "DISTINCT_REQUESTS"
  | "DISTINCT_INVITES"
  | "CLOSE_COMPLETION_TIME"
  | "SEPARATED_COMPLETION_TIME"
  | "CANONICAL_SOURCE_CONFLICT";

export interface MatchHistorySource {
  players?: unknown;
  fromUserId?: unknown;
  toUserId?: unknown;
  completed?: unknown;
  status?: unknown;
  outcome?: unknown;
  playedDate?: unknown;
  completedAt?: unknown;
  updatedAt?: unknown;
  matchRequestId?: unknown;
  inviteId?: unknown;
  conversationId?: unknown;
  score?: unknown;
  sets?: unknown;
  winnerId?: unknown;
  court?: unknown;
  location?: unknown;
  completedFrom?: unknown;
}

export interface NormalizedActivityEvent {
  canonicalMatchId: string;
  sourceCollection: "match_history";
  sourceDocumentId: string;
  sourcePath: string;
  participantIds: [string, string] | [];
  pairId: string | null;
  activityAt: Date | null;
  activityDateSource: ActivityDateSource;
  monthKey: string | null;
  weekKey: string | null;
  timeZone: "Australia/Melbourne";
  eligible: boolean;
  ineligibilityReasons: IneligibilityReason[];
  originalMatchRequestId: string | null;
  inviteId: string | null;
  conversationId: string | null;
  scorePresent: boolean;
  scoreConfirmedByBoth: false;
  normalizationVersion: 2;
  sourceUpdatedAt: Date | null;
  leaderboardFingerprint: string;
  sourceFingerprint: string;
  activityDateKey: string | null;
  sourceCompletedAt: Date | null;
  scoreFingerprint: string | null;
  conversationFingerprint: string | null;
  locationFingerprint: string | null;
  winnerFingerprint: string | null;
  sourceCompletionPath: string | null;
  duplicateClassification: DuplicateClassification;
  duplicateGroupKey: string | null;
  duplicateLookupKeys: string[];
  duplicateEvidenceCodes: DuplicateEvidenceCode[];
  duplicateReviewStatus: DuplicateReviewStatus;
  duplicateResolutionRole: DuplicateResolutionRole;
  duplicateSurvivorEventId: string | null;
  eligibleForScoring: boolean;
  conflictingSourcePaths: string[];
  conflictingSourceFingerprints: string[];
}
