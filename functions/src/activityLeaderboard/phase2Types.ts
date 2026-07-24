import {NormalizedActivityEvent} from "./types";

export interface PublicProfileSnapshot {
  displayName: string | null;
  avatarUrl: string | null;
}

export interface MonthlyPlayerAggregate {
  playerId: string;
  monthKey: string;
  eligibleActivityCount: number;
  cappedActivityCount: number;
  distinctOpponentCount: number;
  lastActivityAt: Date;
  activityPoints: number;
  pointBreakdown: {cappedActivities: number; distinctOpponents: number};
  calculationVersion: number;
  scoringVersion: number;
  generationId: string;
  sourceChecksum: string;
}

export interface MonthlyRanking extends PublicProfileSnapshot {
  playerId: string;
  monthKey: string;
  rank: number;
  position: number;
  activityPoints: number;
  eligibleActivityCount: number;
  cappedActivityCount: number;
  distinctOpponentCount: number;
  lastActivityAt: Date;
  calculationVersion: number;
  scoringVersion: number;
  generationId: string;
}

export interface MonthlyCalculation {
  monthKey: string;
  generationId: string;
  sourceChecksum: string;
  sourceEventCount: number;
  scoringEventCount: number;
  rejectedMalformedCount: number;
  aggregates: MonthlyPlayerAggregate[];
  rankings: MonthlyRanking[];
}

export type Phase2ActivityEvent = NormalizedActivityEvent;
