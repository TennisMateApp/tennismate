export const MATCH_DISTANCE_OPTIONS_KM = [5, 10, 15, 20, 30, 50] as const;

export type MatchDistanceKm = (typeof MATCH_DISTANCE_OPTIONS_KM)[number];

// Match Me has historically fetched candidates within 50 km. Keep that experience
// unchanged unless the user explicitly chooses a narrower radius.
export const DEFAULT_MATCH_DISTANCE_KM: MatchDistanceKm = 50;

export function isMatchDistanceKm(value: unknown): value is MatchDistanceKm {
  return typeof value === "number" &&
    MATCH_DISTANCE_OPTIONS_KM.includes(value as MatchDistanceKm);
}

export function normalizeMatchDistanceKm(value: unknown): MatchDistanceKm {
  const numeric = typeof value === "number" ? value : Number(value);
  return isMatchDistanceKm(numeric) ? numeric : DEFAULT_MATCH_DISTANCE_KM;
}
