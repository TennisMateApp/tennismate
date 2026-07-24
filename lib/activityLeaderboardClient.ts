import {
  collection,
  doc,
  getDoc,
  getDocs,
  limit,
  query,
  where,
} from "firebase/firestore";
import {auth, db} from "@/lib/firebaseConfig";
import {
  ActivityLeaderboardRow,
  isExcludedActivityLeaderboardRow,
  parseActivityLeaderboardRow,
  sortPublishedRows,
} from "@/lib/activityLeaderboardModel";

const MONTH_LIMIT = 24;
const ROW_LIMIT = 100;
const CACHE_MS = 5 * 60 * 1000;

type CacheItem<T> = {expiresAt: number; value: Promise<T>};
const cache = new Map<string, CacheItem<unknown>>();

export type PublishedLeaderboard = {
  excludedRowCount: number;
  generationId: string;
  malformedRowCount: number;
  monthKey: string;
  rows: ActivityLeaderboardRow[];
};

function cached<T>(key: string, load: () => Promise<T>): Promise<T> {
  const existing = cache.get(key) as CacheItem<T> | undefined;
  if (existing && existing.expiresAt > Date.now()) return existing.value;
  const value = load().catch((error) => {
    cache.delete(key);
    throw error;
  });
  cache.set(key, {expiresAt: Date.now() + CACHE_MS, value});
  return value;
}

function requireSignedIn(): string {
  const uid = auth.currentUser?.uid;
  if (!uid) throw new Error("permission-denied");
  return uid;
}

export function clearActivityLeaderboardCache(): void {
  cache.clear();
}

export async function listPublishedActivityMonths(): Promise<string[]> {
  requireSignedIn();
  return cached("published-months", async () => {
    const snapshot = await getDocs(query(
      collection(db, "activity_leaderboards"),
      where("status", "==", "published"),
      limit(MONTH_LIMIT),
    ));
    return snapshot.docs
      .map((item) => item.id)
      .filter((month) => /^\d{4}-(0[1-9]|1[0-2])$/.test(month))
      .sort()
      .reverse();
  });
}

export async function readPublishedActivityLeaderboard(
  monthKey: string,
): Promise<PublishedLeaderboard | null> {
  const uid = requireSignedIn();
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(monthKey)) return null;
  return cached(`leaderboard:${uid}:${monthKey}`, async () => {
    const pointer = await getDoc(doc(db, "activity_leaderboards", monthKey));
    if (!pointer.exists() || pointer.data().status !== "published") return null;
    const generationId = pointer.data().publishedGenerationId;
    if (typeof generationId !== "string" || !generationId) return null;
    const rankingCollection = collection(
      db,
      "activity_leaderboards",
      monthKey,
      "generations",
      generationId,
      "rankings",
    );
    const snapshot = await getDocs(query(rankingCollection, limit(ROW_LIMIT)));
    const parsed = snapshot.docs.map((item) => parseActivityLeaderboardRow(item.data()));
    const validRows = parsed.filter((row): row is ActivityLeaderboardRow => row !== null);
    const excludedRowCount = validRows.filter(isExcludedActivityLeaderboardRow).length;
    let rows = validRows.filter((row) => !isExcludedActivityLeaderboardRow(row));
    if (!rows.some((row) => row.playerId === uid)) {
      const currentUserSnapshot = await getDoc(doc(rankingCollection, uid));
      if (currentUserSnapshot.exists()) {
        const currentUserRow = parseActivityLeaderboardRow(currentUserSnapshot.data());
        if (currentUserRow && !isExcludedActivityLeaderboardRow(currentUserRow)) rows = [...rows, currentUserRow];
      }
    }
    return {
      generationId,
      excludedRowCount,
      malformedRowCount: parsed.filter((row) => row === null).length,
      monthKey,
      rows: sortPublishedRows(rows),
    };
  });
}

// Keeps the Firestore import surface explicit: the client never builds a query
// against players, events, aggregates, reviews, requests, or retired generations.
export const activityLeaderboardReadContract = {
  monthLimit: MONTH_LIMIT,
  rankingRowLimit: ROW_LIMIT,
  rootCollection: "activity_leaderboards",
  rowDocumentKey: "documentId",
} as const;
