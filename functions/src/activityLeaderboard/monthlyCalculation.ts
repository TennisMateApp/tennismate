/* eslint-disable max-len, require-jsdoc, curly, brace-style, block-spacing */
import {createHash} from "crypto";
import {NORMALIZATION_VERSION} from "./config";
import {MonthlyCalculation, MonthlyPlayerAggregate, MonthlyRanking, Phase2ActivityEvent, PublicProfileSnapshot} from "./phase2Types";

export const ACTIVITY_CALCULATION_VERSION = 1 as const;
export const ACTIVITY_SCORING_VERSION = 1 as const;
export const POINTS_PER_CAPPED_ACTIVITY = 10 as const;
export const POINTS_PER_DISTINCT_OPPONENT = 5 as const;
export const MAX_POINT_BEARING_MATCHES_PER_OPPONENT = 4 as const;

export class MalformedScoringEventError extends Error {
  constructor(message: string) { super(message); this.name = "MalformedScoringEventError"; }
}
export class UnsupportedCalculationVersionError extends Error {
  constructor(message: string) { super(message); this.name = "UnsupportedCalculationVersionError"; }
}

function stable(value: unknown): unknown {
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, stable(item)]));
  return value;
}
function checksum(value: unknown): string { return createHash("sha256").update(JSON.stringify(stable(value))).digest("hex"); }
function validMonth(monthKey: string): boolean { return /^\d{4}-(0[1-9]|1[0-2])$/.test(monthKey); }
function millis(value: Date | null): number { return value instanceof Date && !Number.isNaN(value.getTime()) ? value.getTime() : -1; }

function validateScoringEvent(event: Phase2ActivityEvent, monthKey: string): [string, string] {
  if (event.normalizationVersion > NORMALIZATION_VERSION) throw new UnsupportedCalculationVersionError("A scoring event uses a newer normalization version");
  if (!event.eligible || event.monthKey !== monthKey || !event.activityAt || millis(event.activityAt) < 0) throw new MalformedScoringEventError("Scoring event eligibility, month, or date is malformed");
  const participants = [...new Set(event.participantIds)];
  if (participants.length !== 2 || participants.some((id) => typeof id !== "string" || !id.trim())) throw new MalformedScoringEventError("Scoring event must contain exactly two distinct participants");
  return [participants[0], participants[1]];
}

function sameRankMetrics(left: MonthlyRanking, right: MonthlyRanking): boolean {
  return left.activityPoints === right.activityPoints && left.distinctOpponentCount === right.distinctOpponentCount && left.cappedActivityCount === right.cappedActivityCount;
}

export function calculateMonthlyActivity(
  input: Phase2ActivityEvent[], monthKey: string,
  profiles: ReadonlyMap<string, PublicProfileSnapshot> = new Map()
): MonthlyCalculation {
  if (!validMonth(monthKey)) throw new Error("monthKey must use YYYY-MM");
  const byCanonical = new Map<string, Phase2ActivityEvent>();
  for (const event of input.filter((item) => item.monthKey === monthKey)) {
    const prior = byCanonical.get(event.canonicalMatchId);
    if (prior && checksum({sourceFingerprint: prior.sourceFingerprint, participants: prior.participantIds, eligibleForScoring: prior.eligibleForScoring}) !== checksum({sourceFingerprint: event.sourceFingerprint, participants: event.participantIds, eligibleForScoring: event.eligibleForScoring})) throw new MalformedScoringEventError("Conflicting copies of one canonical activity event");
    byCanonical.set(event.canonicalMatchId, event);
  }
  const monthEvents = [...byCanonical.values()].sort((a, b) => a.canonicalMatchId.localeCompare(b.canonicalMatchId));
  const scoringEvents = monthEvents.filter((event) => event.eligibleForScoring === true);
  const working = new Map<string, {count: number; last: Date; opponents: Map<string, number>} >();
  for (const event of scoringEvents) {
    const [left, right] = validateScoringEvent(event, monthKey);
    for (const [playerId, opponentId] of [[left, right], [right, left]]) {
      const current = working.get(playerId) || {count: 0, last: event.activityAt as Date, opponents: new Map<string, number>()};
      current.count += 1; if (millis(event.activityAt) > current.last.getTime()) current.last = event.activityAt as Date;
      current.opponents.set(opponentId, (current.opponents.get(opponentId) || 0) + 1); working.set(playerId, current);
    }
  }
  const sourceStates = monthEvents.map((event) => ({canonicalMatchId: event.canonicalMatchId, sourceFingerprint: event.sourceFingerprint, normalizationVersion: event.normalizationVersion, eligibleForScoring: event.eligibleForScoring, monthKey: event.monthKey, participantIds: [...event.participantIds].sort(), activityAt: event.activityAt?.toISOString() || null}));
  const sourceChecksum = checksum({monthKey, calculationVersion: ACTIVITY_CALCULATION_VERSION, scoringVersion: ACTIVITY_SCORING_VERSION, events: sourceStates});
  // The scoring checksum intentionally excludes presentation data. The
  // generation identity includes the published profile snapshot so an avatar
  // repair creates a rollback-safe generation without changing points.
  const profileStates = [...working.keys()].sort().map((playerId) => ({playerId, ...(profiles.get(playerId) || {displayName: null, avatarUrl: null})}));
  const generationId = `v${ACTIVITY_CALCULATION_VERSION}-${checksum({sourceChecksum, profiles: profileStates}).slice(0, 20)}`;
  const aggregates: MonthlyPlayerAggregate[] = [...working.entries()].map(([playerId, value]) => {
    const cappedActivityCount = [...value.opponents.values()].reduce((total, count) => total + Math.min(count, MAX_POINT_BEARING_MATCHES_PER_OPPONENT), 0);
    const distinctOpponentCount = value.opponents.size;
    return {playerId, monthKey, eligibleActivityCount: value.count, cappedActivityCount, distinctOpponentCount, lastActivityAt: value.last, activityPoints: cappedActivityCount * POINTS_PER_CAPPED_ACTIVITY + distinctOpponentCount * POINTS_PER_DISTINCT_OPPONENT, pointBreakdown: {cappedActivities: cappedActivityCount * POINTS_PER_CAPPED_ACTIVITY, distinctOpponents: distinctOpponentCount * POINTS_PER_DISTINCT_OPPONENT}, calculationVersion: ACTIVITY_CALCULATION_VERSION, scoringVersion: ACTIVITY_SCORING_VERSION, generationId, sourceChecksum};
  }).sort((a, b) => a.playerId.localeCompare(b.playerId));
  const ordered = [...aggregates].sort((a, b) => b.activityPoints - a.activityPoints || b.distinctOpponentCount - a.distinctOpponentCount || b.cappedActivityCount - a.cappedActivityCount || b.lastActivityAt.getTime() - a.lastActivityAt.getTime() || a.playerId.localeCompare(b.playerId));
  const rankings: MonthlyRanking[] = []; let rank = 0;
  ordered.forEach((aggregate, index) => {
    const profile = profiles.get(aggregate.playerId) || {displayName: null, avatarUrl: null};
    const candidate: MonthlyRanking = {...profile, playerId: aggregate.playerId, monthKey, rank: index + 1, position: index + 1, activityPoints: aggregate.activityPoints, eligibleActivityCount: aggregate.eligibleActivityCount, cappedActivityCount: aggregate.cappedActivityCount, distinctOpponentCount: aggregate.distinctOpponentCount, lastActivityAt: aggregate.lastActivityAt, calculationVersion: aggregate.calculationVersion, scoringVersion: aggregate.scoringVersion, generationId};
    rank = index === 0 ? 1 : sameRankMetrics(candidate, rankings[index - 1]) ? rank : index + 1; candidate.rank = rank; rankings.push(candidate);
  });
  return {monthKey, generationId, sourceChecksum, sourceEventCount: monthEvents.length, scoringEventCount: scoringEvents.length, rejectedMalformedCount: 0, aggregates, rankings};
}
