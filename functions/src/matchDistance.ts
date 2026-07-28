export const MATCH_DISTANCE_OPTIONS_KM = [5, 10, 15, 20, 30, 50] as const;
export const DEFAULT_MATCH_DISTANCE_KM = 50;

export function normalizeMatchDistanceKm(value: unknown): number {
  if (value == null) return DEFAULT_MATCH_DISTANCE_KM;
  if (
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    !MATCH_DISTANCE_OPTIONS_KM.includes(value as (typeof MATCH_DISTANCE_OPTIONS_KM)[number])
  ) {
    throw new Error("unsupported-match-distance");
  }
  return value;
}
