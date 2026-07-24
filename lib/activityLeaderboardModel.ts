export const ACTIVITY_LEADERBOARD_ROW_FIELDS = [
  "avatarUrl",
  "displayName",
  "distinctOpponentCount",
  "eligibleActivityCount",
  "playerId",
  "points",
  "rank",
  "scoringActivityCount",
] as const;

export type ActivityLeaderboardRow = {
  avatarUrl: string | null;
  displayName: string;
  distinctOpponentCount: number;
  eligibleActivityCount: number;
  playerId: string;
  points: number;
  rank: number;
  scoringActivityCount: number;
};

export type ActivityLeaderboardViewState = "loading" | "error" | "unavailable" | "empty" | "ranked";

export function activityLeaderboardViewState(
  status: "loading" | "ready" | "unavailable" | "error",
  hasPublishedLeaderboard: boolean,
  rowCount: number,
): ActivityLeaderboardViewState {
  if (status === "loading") return "loading";
  if (status === "error") return "error";
  if (status === "unavailable" || !hasPublishedLeaderboard) return "unavailable";
  return rowCount === 0 ? "empty" : "ranked";
}

export function parseActivityLeaderboardRow(
  value: unknown,
): ActivityLeaderboardRow | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  const integers = [
    row.distinctOpponentCount,
    row.eligibleActivityCount,
    row.points,
    row.rank,
    row.scoringActivityCount,
  ];
  if (
    typeof row.playerId !== "string" ||
    !row.playerId ||
    typeof row.displayName !== "string" ||
    !row.displayName.trim() ||
    !integers.every((item) => Number.isInteger(item) && Number(item) >= 0) ||
    Number(row.rank) < 1 ||
    (row.avatarUrl !== null && typeof row.avatarUrl !== "string")
  ) {
    return null;
  }
  return {
    avatarUrl: typeof row.avatarUrl === "string" && row.avatarUrl ? row.avatarUrl : null,
    displayName: row.displayName.trim().slice(0, 80),
    distinctOpponentCount: Number(row.distinctOpponentCount),
    eligibleActivityCount: Number(row.eligibleActivityCount),
    playerId: row.playerId,
    points: Number(row.points),
    rank: Number(row.rank),
    scoringActivityCount: Number(row.scoringActivityCount),
  };
}

export function isExcludedActivityLeaderboardRow(row: ActivityLeaderboardRow): boolean {
  return row.displayName.trim().toLowerCase() === "test";
}

export function sortPublishedRows(
  rows: ActivityLeaderboardRow[],
): ActivityLeaderboardRow[] {
  return [...rows].sort((a, b) =>
    a.rank - b.rank ||
    b.points - a.points ||
    b.distinctOpponentCount - a.distinctOpponentCount ||
    b.scoringActivityCount - a.scoringActivityCount ||
    a.playerId.localeCompare(b.playerId),
  );
}

export function tiedRanks(rows: ActivityLeaderboardRow[]): Set<number> {
  const counts = new Map<number, number>();
  rows.forEach((row) => counts.set(row.rank, (counts.get(row.rank) || 0) + 1));
  return new Set([...counts].filter(([, count]) => count > 1).map(([rank]) => rank));
}

export function currentMonthKey(now = new Date()): string {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

export function defaultPublishedMonth(months: string[], now = new Date()): string | null {
  const sorted = [...new Set(months)].sort().reverse();
  const current = currentMonthKey(now);
  return sorted.find((month) => month <= current) || sorted[0] || null;
}

export function formatActivityMonth(monthKey: string): string {
  const [year, month] = monthKey.split("-").map(Number);
  if (!year || !month || month < 1 || month > 12) return monthKey;
  return new Intl.DateTimeFormat("en-AU", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(Date.UTC(year, month - 1, 1)));
}

export function rowTone(row: ActivityLeaderboardRow, currentUserId: string | null): string {
  if (row.rank === 1) return "gold";
  if (row.rank === 2) return "silver";
  if (row.rank === 3) return "bronze";
  if (row.playerId === currentUserId) return "current-user";
  return "standard";
}

export function currentUserPlacement(
  rows: ActivityLeaderboardRow[],
  currentUserId: string | null,
  initialRowCount = 10,
): "visible" | "outside" | "absent" {
  if (!currentUserId) return "absent";
  const index = rows.findIndex((row) => row.playerId === currentUserId);
  if (index < 0) return "absent";
  return index < initialRowCount ? "visible" : "outside";
}
