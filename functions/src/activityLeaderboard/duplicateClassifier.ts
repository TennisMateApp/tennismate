/* eslint-disable max-len, require-jsdoc */
import {createHash} from "crypto";
import {
  DuplicateClassification,
  DuplicateEvidenceCode,
  NormalizedActivityEvent,
} from "./types";

export interface DuplicateClassificationResult {
  classification: DuplicateClassification;
  evidenceCodes: DuplicateEvidenceCode[];
  duplicateGroupKey: string | null;
}

type ComparableEvent = Pick<NormalizedActivityEvent,
  "pairId" | "activityDateKey" | "originalMatchRequestId" | "inviteId" |
  "scoreFingerprint" | "conversationFingerprint" | "locationFingerprint" |
  "sourceCompletedAt" | "duplicateGroupKey" | "duplicateLookupKeys">;

function hash(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export function buildDuplicateGroupKey(pairId: string | null, activityDateKey: string | null): string | null {
  return pairId && activityDateKey ? `logical_${hash(`${pairId}|${activityDateKey}`)}` : null;
}

export function buildDuplicateLookupKeys(args: {
  duplicateGroupKey: string | null;
  matchRequestId: string | null;
  inviteId: string | null;
}): string[] {
  return [
    args.duplicateGroupKey,
    args.matchRequestId ? `request_${hash(args.matchRequestId)}` : null,
    args.inviteId ? `invite_${hash(args.inviteId)}` : null,
  ].filter((value): value is string => value !== null).sort();
}

function sharedLookupKey(a: ComparableEvent, b: ComparableEvent, prefix: string): string | null {
  return a.duplicateLookupKeys.find((key) => key.startsWith(prefix) && b.duplicateLookupKeys.includes(key)) || null;
}

function millis(value: unknown): number | null {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value.getTime();
  if (value && typeof (value as {toMillis?: () => number}).toMillis === "function") {
    return (value as {toMillis: () => number}).toMillis();
  }
  if (value && typeof (value as {toDate?: () => Date}).toDate === "function") {
    return (value as {toDate: () => Date}).toDate().getTime();
  }
  return null;
}

function bothDifferent(a: string | null, b: string | null): boolean {
  return a !== null && b !== null && a !== b;
}

function bothSame(a: string | null, b: string | null): boolean {
  return a !== null && b !== null && a === b;
}

export function classifyDuplicateCandidates(a: ComparableEvent, b: ComparableEvent): DuplicateClassificationResult {
  const groupKey = a.duplicateGroupKey || b.duplicateGroupKey || null;
  if (!a.pairId || !b.pairId || a.pairId !== b.pairId) {
    return {classification: "NONE", evidenceCodes: [], duplicateGroupKey: null};
  }

  if (bothSame(a.originalMatchRequestId, b.originalMatchRequestId)) {
    return {classification: "CONFIRMED_SAME_MATCH", evidenceCodes: ["SAME_MATCH_REQUEST"], duplicateGroupKey: sharedLookupKey(a, b, "request_") || groupKey};
  }
  if (bothSame(a.inviteId, b.inviteId)) {
    return {classification: "CONFIRMED_SAME_MATCH", evidenceCodes: ["SAME_INVITE"], duplicateGroupKey: sharedLookupKey(a, b, "invite_") || groupKey};
  }
  if (!a.activityDateKey || a.activityDateKey !== b.activityDateKey) {
    return {classification: "NONE", evidenceCodes: [], duplicateGroupKey: null};
  }

  const evidence: DuplicateEvidenceCode[] = ["SAME_PAIR_AND_DATE"];
  if (bothDifferent(a.originalMatchRequestId, b.originalMatchRequestId)) evidence.push("DISTINCT_REQUESTS");
  if (bothDifferent(a.inviteId, b.inviteId)) evidence.push("DISTINCT_INVITES");
  if (bothSame(a.scoreFingerprint, b.scoreFingerprint)) evidence.push("SAME_SCORE");
  if (bothDifferent(a.scoreFingerprint, b.scoreFingerprint)) evidence.push("DIFFERENT_SCORE");
  if (bothSame(a.conversationFingerprint, b.conversationFingerprint)) evidence.push("SAME_CONVERSATION");
  if (bothDifferent(a.conversationFingerprint, b.conversationFingerprint)) evidence.push("DIFFERENT_CONVERSATION");
  if (bothSame(a.locationFingerprint, b.locationFingerprint)) evidence.push("SAME_LOCATION");
  if (bothDifferent(a.locationFingerprint, b.locationFingerprint)) evidence.push("DIFFERENT_LOCATION");

  const aMillis = millis(a.sourceCompletedAt);
  const bMillis = millis(b.sourceCompletedAt);
  if (aMillis !== null && bMillis !== null) {
    const difference = Math.abs(aMillis - bMillis);
    evidence.push(difference <= 2 * 60 * 60 * 1000 ? "CLOSE_COMPLETION_TIME" : "SEPARATED_COMPLETION_TIME");
  }

  const distinctAuthority = evidence.includes("DISTINCT_REQUESTS") || evidence.includes("DISTINCT_INVITES");
  const materialDifference = evidence.includes("DIFFERENT_SCORE") ||
    evidence.includes("DIFFERENT_CONVERSATION") ||
    evidence.includes("DIFFERENT_LOCATION") ||
    evidence.includes("SEPARATED_COMPLETION_TIME");
  return {
    classification: distinctAuthority || materialDifference ? "LIKELY_DISTINCT_REMATCH" : "POSSIBLE_SAME_MATCH",
    evidenceCodes: evidence,
    duplicateGroupKey: groupKey,
  };
}

export function strongestClassification(values: DuplicateClassification[]): DuplicateClassification {
  if (values.includes("CONFIRMED_SAME_MATCH")) return "CONFIRMED_SAME_MATCH";
  if (values.includes("POSSIBLE_SAME_MATCH")) return "POSSIBLE_SAME_MATCH";
  if (values.includes("LIKELY_DISTINCT_REMATCH")) return "LIKELY_DISTINCT_REMATCH";
  return "NONE";
}

export function applyDuplicateClassification(
  event: NormalizedActivityEvent,
  classification: DuplicateClassification,
  evidenceCodes: DuplicateEvidenceCode[]
): NormalizedActivityEvent {
  const needsReview = classification === "POSSIBLE_SAME_MATCH" ||
    classification === "CONFIRMED_SAME_MATCH";
  return {
    ...event,
    duplicateClassification: classification,
    duplicateEvidenceCodes: Array.from(new Set([
      ...event.duplicateEvidenceCodes,
      ...evidenceCodes,
    ])).sort(),
    duplicateReviewStatus: needsReview ? "PENDING" :
      classification === "LIKELY_DISTINCT_REMATCH" ? "AUTO_RESOLVED" :
        "NOT_REQUIRED",
    duplicateResolutionRole: needsReview ? "PENDING_REVIEW" : "NOT_APPLICABLE",
    duplicateSurvivorEventId: null,
    eligibleForScoring: event.eligible && !needsReview,
  };
}
