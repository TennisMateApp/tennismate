/* eslint-disable max-len, require-jsdoc, valid-jsdoc, curly, brace-style, block-spacing */
import {FieldValue, Timestamp} from "./adminSdk";
import {applyCanonicalSourceConflict, hasCanonicalSourceConflict} from "./collisionProtection";
import {DIRTY_EVENT_ID_SAMPLE_LIMIT, DUPLICATE_CANDIDATE_QUERY_LIMIT, DUPLICATE_REVIEW_ARRAY_LIMIT, DUPLICATE_RESOLUTION_VERSION, NORMALIZATION_VERSION} from "./config";
import {classifyDuplicateCandidates, strongestClassification} from "./duplicateClassifier";
import {applyManualDuplicateResolution, duplicateGroupFingerprint, holdPossibleDuplicateGroup, ManualDuplicateResolution, resolveConfirmedDuplicateGroup} from "./duplicateResolution";
import {normalizeMatchHistory} from "./normalization";
import {DuplicateClassification, MatchHistorySource, NormalizedActivityEvent} from "./types";
import {privacySafeRefHash} from "./privacyLogging";

export interface MatchHistoryWriteInput {sourceDocumentId: string; before: MatchHistorySource | null; after: MatchHistorySource | null}
export interface PersistenceResult {operation: "create" | "update" | "delete"; sourceDocumentId: string; canonicalEventId: string | null; duplicateGroupKey: string | null; resolutionSource: "automatic" | "manual" | "pending" | "none"; oldMonthKey: string | null; newMonthKey: string | null; collision: boolean; dirtyMonthCount: number}
export class UnsupportedActivityVersionError extends Error {
  constructor(version: number) { super(`Stored activity event uses unsupported newer normalization version ${version}`); this.name = "UnsupportedActivityVersionError"; }
}

function bounded(values: string[], limit = DUPLICATE_REVIEW_ARRAY_LIMIT): string[] {
  return [...new Set(values.filter(Boolean))].sort().slice(0, limit);
}
function date(value: unknown): Date | null {
  if (value instanceof Date) return value;
  if (value && typeof (value as {toDate?: () => Date}).toDate === "function") return (value as {toDate: () => Date}).toDate();
  return null;
}
export function storedActivityEvent(data: FirebaseFirestore.DocumentData): NormalizedActivityEvent {
  return {...data, activityAt: date(data.activityAt), sourceCompletedAt: date(data.sourceCompletedAt), sourceUpdatedAt: date(data.sourceUpdatedAt), duplicateEvidenceCodes: Array.isArray(data.duplicateEvidenceCodes) ? data.duplicateEvidenceCodes : [], conflictingSourcePaths: Array.isArray(data.conflictingSourcePaths) ? data.conflictingSourcePaths : [], conflictingSourceFingerprints: Array.isArray(data.conflictingSourceFingerprints) ? data.conflictingSourceFingerprints : [], duplicateLookupKeys: Array.isArray(data.duplicateLookupKeys) ? data.duplicateLookupKeys : []} as NormalizedActivityEvent;
}
export function activityEventPayload(event: NormalizedActivityEvent): FirebaseFirestore.DocumentData {
  return {...event, activityAt: event.activityAt ? Timestamp.fromDate(event.activityAt) : null, sourceCompletedAt: event.sourceCompletedAt ? Timestamp.fromDate(event.sourceCompletedAt) : null, sourceUpdatedAt: event.sourceUpdatedAt ? Timestamp.fromDate(event.sourceUpdatedAt) : null, normalizedAt: FieldValue.serverTimestamp()};
}
export async function markActivityMonthsDirty(db: FirebaseFirestore.Firestore, transaction: FirebaseFirestore.Transaction, months: string[], reason: string, eventId: string): Promise<void> {
  const keys = bounded(months);
  const refs = keys.map((key) => db.collection("activity_recalculation_requests").doc(key));
  const snaps = await Promise.all(refs.map((ref) => transaction.get(ref)));
  refs.forEach((ref, index) => {
    const existing = snaps[index].data() || {};
    transaction.set(ref, {monthKey: keys[index], status: "pending", reasons: bounded([...(Array.isArray(existing.reasons) ? existing.reasons : []), reason]), sourceEventIds: bounded([...(Array.isArray(existing.sourceEventIds) ? existing.sourceEventIds : []), eventId], DIRTY_EVENT_ID_SAMPLE_LIMIT), requestedAt: existing.requestedAt || FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp()}, {merge: false});
  });
}

function classifyGroup(events: NormalizedActivityEvent[]): {classification: DuplicateClassification; groupKey: string | null; evidence: string[]} {
  const results = [];
  for (let left = 0; left < events.length; left += 1) for (let right = left + 1; right < events.length; right += 1) {
    const result = classifyDuplicateCandidates(events[left], events[right]);
    if (result.classification !== "NONE") results.push(result);
  }
  const classification = strongestClassification(results.map((item) => item.classification));
  const strongest = results.find((item) => item.classification === classification);
  return {classification, groupKey: strongest?.duplicateGroupKey || null, evidence: bounded(results.flatMap((item) => item.evidenceCodes))};
}

export async function normalizeAndPersistMatchHistoryWrite(db: FirebaseFirestore.Firestore, input: MatchHistoryWriteInput): Promise<PersistenceResult> {
  const before = input.before ? normalizeMatchHistory(input.sourceDocumentId, input.before) : null;
  const after = input.after ? normalizeMatchHistory(input.sourceDocumentId, input.after) : null;
  const operation = !before ? "create" : !after ? "delete" : "update";
  const lookupKeys = bounded([...(before?.duplicateLookupKeys || []), ...(after?.duplicateLookupKeys || [])]).slice(0, 10);
  let result: PersistenceResult = {operation, sourceDocumentId: input.sourceDocumentId, canonicalEventId: after?.canonicalMatchId || before?.canonicalMatchId || null, duplicateGroupKey: after?.duplicateGroupKey || before?.duplicateGroupKey || null, resolutionSource: "none", oldMonthKey: before?.monthKey || null, newMonthKey: after?.monthKey || null, collision: false, dirtyMonthCount: 0};
  await db.runTransaction(async (transaction) => {
    const candidateQuery = lookupKeys.length ? db.collection("activity_match_events").where("duplicateLookupKeys", "array-contains-any", lookupKeys).limit(DUPLICATE_CANDIDATE_QUERY_LIMIT) : null;
    const candidateSnap = candidateQuery ? await transaction.get(candidateQuery) : null;
    const candidates = candidateSnap?.docs.map((doc) => storedActivityEvent(doc.data())) || [];
    const newerCandidate = candidates.find((event) => Number(event.normalizationVersion || 0) > NORMALIZATION_VERSION);
    if (newerCandidate) throw new UnsupportedActivityVersionError(Number(newerCandidate.normalizationVersion));
    const oldRef = before ? db.collection("activity_match_events").doc(before.canonicalMatchId) : null;
    const newRef = after ? db.collection("activity_match_events").doc(after.canonicalMatchId) : null;
    const newSnap = newRef ? await transaction.get(newRef) : null;
    const existingNew = newSnap?.exists ? storedActivityEvent(newSnap.data() || {}) : null;
    if (existingNew && Number(existingNew.normalizationVersion || 0) > NORMALIZATION_VERSION) throw new UnsupportedActivityVersionError(Number(existingNew.normalizationVersion));
    const dirtyMonths = bounded([before?.monthKey || "", after?.monthKey || "", ...candidates.map((event) => event.monthKey || "")]);

    if (after && existingNew && (hasCanonicalSourceConflict(existingNew, after) || existingNew.ineligibilityReasons.includes("CANONICAL_SOURCE_CONFLICT"))) {
      const conflict = applyCanonicalSourceConflict(existingNew, after);
      const groupKey = `canonical_${after.canonicalMatchId}`;
      const reviewRef = db.collection("activity_duplicate_reviews").doc(groupKey);
      const review = await transaction.get(reviewRef);
      const previous = review.data() || {};
      if (Number(previous.normalizationVersion || 0) > NORMALIZATION_VERSION || Number(previous.resolutionVersion || 0) > DUPLICATE_RESOLUTION_VERSION) throw new UnsupportedActivityVersionError(Number(previous.normalizationVersion || previous.resolutionVersion));
      await markActivityMonthsDirty(db, transaction, dirtyMonths, "CANONICAL_SOURCE_CONFLICT", after.canonicalMatchId);
      transaction.set(newRef as FirebaseFirestore.DocumentReference, activityEventPayload(conflict), {merge: false});
      transaction.set(reviewRef, {duplicateGroupKey: groupKey, classification: "CONFIRMED_SAME_MATCH", status: "PENDING", staleManualResolution: false, survivorEventId: null, excludedEventIds: [], sourceEventIds: bounded([...(previous.sourceEventIds || []), after.canonicalMatchId]), sourcePaths: bounded([...(previous.sourcePaths || []), ...conflict.conflictingSourcePaths]), sourceFingerprints: bounded([...(previous.sourceFingerprints || []), ...conflict.conflictingSourceFingerprints]), evidenceCodes: ["CANONICAL_SOURCE_CONFLICT"], affectedMonthKeys: dirtyMonths, normalizationVersion: NORMALIZATION_VERSION, updatedAt: FieldValue.serverTimestamp()}, {merge: false});
      result = {...result, duplicateGroupKey: groupKey, resolutionSource: "pending", collision: true, dirtyMonthCount: dirtyMonths.length};
      return;
    }

    const byPath = new Map(candidates.map((event) => [event.sourcePath, event]));
    const priorReviewKeys = bounded(candidates.map((event) => event.duplicateGroupKey || ""));
    const priorResolutionRefs = priorReviewKeys.map((key) => db.collection("activity_duplicate_resolutions").doc(key));
    const priorReviewRefs = priorReviewKeys.map((key) => db.collection("activity_duplicate_reviews").doc(key));
    const [priorResolutionSnaps, priorReviewSnaps] = await Promise.all([Promise.all(priorResolutionRefs.map((ref) => transaction.get(ref))), Promise.all(priorReviewRefs.map((ref) => transaction.get(ref)))]);
    const newerReview = priorReviewSnaps.map((snap) => snap.data() || {}).find((review) => Number(review.normalizationVersion || 0) > NORMALIZATION_VERSION || Number(review.resolutionVersion || 0) > DUPLICATE_RESOLUTION_VERSION);
    if (newerReview) throw new UnsupportedActivityVersionError(Number(newerReview.normalizationVersion || newerReview.resolutionVersion));
    const manualByGroup = new Map(priorResolutionSnaps.filter((snap) => snap.exists).map((snap) => [snap.id, snap.data() as ManualDuplicateResolution]));
    if (before) byPath.delete(before.sourcePath);
    if (after) byPath.set(after.sourcePath, after);
    const groupMembers = [...byPath.values()].filter((event) => event.eligible);
    const group = classifyGroup(groupMembers);
    let resolvedEvents = groupMembers;
    let status = "NOT_REQUIRED";
    let survivorEventId: string | null = null;
    let excludedEventIds: string[] = [];
    let staleManualResolution = false;
    if (group.groupKey && (group.classification === "CONFIRMED_SAME_MATCH" || group.classification === "POSSIBLE_SAME_MATCH")) {
      const storedManual = manualByGroup.get(group.groupKey) || null;
      if (storedManual) {
        const manual = applyManualDuplicateResolution(groupMembers, storedManual);
        if (manual.status !== "PENDING") {
          resolvedEvents = manual.events; status = manual.status; survivorEventId = manual.survivorEventId; excludedEventIds = manual.excludedEventIds; result.resolutionSource = "manual";
        } else {
          staleManualResolution = true;
          resolvedEvents = holdPossibleDuplicateGroup(groupMembers); status = "PENDING"; result.resolutionSource = "pending";
          console.warn("[activity_leaderboard] stale manual duplicate resolution", {duplicateGroupRefHash: privacySafeRefHash(group.groupKey), sourceRefHash: privacySafeRefHash(input.sourceDocumentId), errorCategory: "STALE_MANUAL_RESOLUTION"});
        }
      } else if (group.classification === "CONFIRMED_SAME_MATCH") {
        const automatic = resolveConfirmedDuplicateGroup(groupMembers);
        resolvedEvents = automatic.events; status = automatic.status; survivorEventId = automatic.survivorEventId; excludedEventIds = automatic.excludedEventIds; result.resolutionSource = automatic.status === "AUTO_RESOLVED" ? "automatic" : "pending";
      } else {
        resolvedEvents = holdPossibleDuplicateGroup(groupMembers); status = "PENDING"; result.resolutionSource = "pending";
      }
      resolvedEvents = resolvedEvents.map((event) => ({...event, duplicateClassification: group.classification, duplicateGroupKey: group.groupKey}));
      const reviewRef = db.collection("activity_duplicate_reviews").doc(group.groupKey);
      const existingReview = (await transaction.get(reviewRef)).data() || {};
      if (Number(existingReview.normalizationVersion || 0) > NORMALIZATION_VERSION || Number(existingReview.resolutionVersion || 0) > DUPLICATE_RESOLUTION_VERSION) throw new UnsupportedActivityVersionError(Number(existingReview.normalizationVersion || existingReview.resolutionVersion));
      if (dirtyMonths.length) await markActivityMonthsDirty(db, transaction, dirtyMonths, operation === "delete" ? "EVENT_DELETED" : before?.monthKey !== after?.monthKey ? "EVENT_MOVED_MONTH" : before?.eligible !== after?.eligible ? "ELIGIBILITY_CHANGED" : "LEADERBOARD_FIELDS_CHANGED", result.canonicalEventId || input.sourceDocumentId);
      transaction.set(reviewRef, {duplicateGroupKey: group.groupKey, groupFingerprint: duplicateGroupFingerprint(groupMembers), classification: group.classification, status, staleManualResolution, manualResolutionStatus: staleManualResolution ? "STALE_OR_REJECTED" : result.resolutionSource === "manual" ? "APPLIED" : "NOT_APPLICABLE", survivorEventId, excludedEventIds: bounded(excludedEventIds), sourceEventIds: bounded(groupMembers.map((event) => event.canonicalMatchId)), sourcePaths: bounded(groupMembers.map((event) => event.sourcePath)), sourceFingerprints: bounded(groupMembers.map((event) => event.sourceFingerprint)), evidenceCodes: bounded(group.evidence), affectedMonthKeys: dirtyMonths, normalizationVersion: NORMALIZATION_VERSION, resolutionVersion: status === "AUTO_RESOLVED" ? DUPLICATE_RESOLUTION_VERSION : null, updatedAt: FieldValue.serverTimestamp()}, {merge: false});
      result.duplicateGroupKey = group.groupKey;
    }

    if (dirtyMonths.length && !(group.groupKey && (group.classification === "CONFIRMED_SAME_MATCH" || group.classification === "POSSIBLE_SAME_MATCH"))) await markActivityMonthsDirty(db, transaction, dirtyMonths, operation === "delete" ? "EVENT_DELETED" : before?.monthKey !== after?.monthKey ? "EVENT_MOVED_MONTH" : before?.eligible !== after?.eligible ? "ELIGIBILITY_CHANGED" : "LEADERBOARD_FIELDS_CHANGED", result.canonicalEventId || input.sourceDocumentId);

    if (oldRef && (!after || before?.canonicalMatchId !== after.canonicalMatchId)) transaction.delete(oldRef);
    if (after && !after.eligible) transaction.set(newRef as FirebaseFirestore.DocumentReference, activityEventPayload({...after, eligibleForScoring: false}), {merge: false});
    else if (after && !resolvedEvents.some((event) => event.sourcePath === after.sourcePath)) transaction.set(newRef as FirebaseFirestore.DocumentReference, activityEventPayload(after), {merge: false});
    for (const event of resolvedEvents) transaction.set(db.collection("activity_match_events").doc(event.canonicalMatchId), activityEventPayload(event), {merge: false});
    if (!after && before && groupMembers.length === 0) {
      const reviewKey = before.duplicateGroupKey;
      if (reviewKey) transaction.delete(db.collection("activity_duplicate_reviews").doc(reviewKey));
    } else if (groupMembers.length === 1) {
      const staleManualKey = priorReviewKeys.find((key) => manualByGroup.has(key));
      const only = staleManualKey ? {...groupMembers[0], duplicateReviewStatus: "PENDING" as const, duplicateResolutionRole: "PENDING_REVIEW" as const, duplicateSurvivorEventId: null, eligibleForScoring: false} : {...groupMembers[0], duplicateClassification: "NONE" as const, duplicateReviewStatus: "NOT_REQUIRED" as const, duplicateResolutionRole: "NOT_APPLICABLE" as const, duplicateSurvivorEventId: null, eligibleForScoring: groupMembers[0].eligible};
      transaction.set(db.collection("activity_match_events").doc(only.canonicalMatchId), activityEventPayload(only), {merge: false});
      for (const key of priorReviewKeys) {
        const ref = db.collection("activity_duplicate_reviews").doc(key);
        if (key === staleManualKey) transaction.set(ref, {duplicateGroupKey: key, status: "PENDING", staleManualResolution: true, manualResolutionStatus: "STALE_OR_REJECTED", survivorEventId: null, excludedEventIds: [], sourceEventIds: [only.canonicalMatchId], sourcePaths: [only.sourcePath], sourceFingerprints: [only.sourceFingerprint], affectedMonthKeys: dirtyMonths, updatedAt: FieldValue.serverTimestamp()}, {merge: false});
        else transaction.delete(ref);
      }
    }
    result.dirtyMonthCount = dirtyMonths.length;
  });
  return result;
}
