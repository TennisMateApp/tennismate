import { initializeApp, cert } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const serviceAccountPath = path.join(__dirname, "serviceAccountKey.json");

if (!existsSync(serviceAccountPath)) {
  console.error("Service account file not found:", serviceAccountPath);
  process.exit(1);
}

const serviceAccount = JSON.parse(readFileSync(serviceAccountPath, "utf8"));

initializeApp({
  credential: cert(serviceAccount),
});

const db = getFirestore();

const PLAYERS_COLLECTION = "players";

const ACCEPTED_MATCH_STATUSES = new Set(["accepted", "confirmed", "completed"]);
const COMPLETED_MATCH_STATUSES = new Set(["completed"]);

type MatchRequestDoc = {
  status?: unknown;
};

type MatchHistoryDoc = {
  winnerId?: unknown;
  winnerIds?: unknown;
  completedByWinner?: unknown;
  completed?: unknown;
  status?: unknown;
};

type CompletedMatchDoc = {
  winnerId?: unknown;
  matchId?: unknown;
};

function asString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function asUidSet(value: unknown): Set<string> {
  if (!Array.isArray(value)) return new Set<string>();
  return new Set(
    value
      .filter((item): item is string => typeof item === "string" && item.trim().length > 0)
      .map((item) => item.trim())
  );
}

function isCompletedHistoryMatch(match: MatchHistoryDoc): boolean {
  return match.completed === true || COMPLETED_MATCH_STATUSES.has(String(match.status || ""));
}

function historyWinForUid(match: MatchHistoryDoc, uid: string): boolean {
  const winnerId = asString(match.winnerId);
  if (winnerId === uid) return true;

  const winnerIds = asUidSet(match.winnerIds);
  if (winnerIds.has(uid)) return true;

  const completedByWinner = asUidSet(match.completedByWinner);
  return completedByWinner.has(uid);
}

async function recomputePlayerPublicStats(uid: string) {
  const acceptedFromQ = db.collection("match_requests").where("fromUserId", "==", uid);
  const acceptedToQ = db.collection("match_requests").where("toUserId", "==", uid);
  const historyQ = db.collection("match_history").where("players", "array-contains", uid);
  const completedFromQ = db.collection("completed_matches").where("fromUserId", "==", uid);
  const completedToQ = db.collection("completed_matches").where("toUserId", "==", uid);

  const [
    acceptedFromSnap,
    acceptedToSnap,
    historySnap,
    completedFromSnap,
    completedToSnap,
  ] = await Promise.all([
    acceptedFromQ.get(),
    acceptedToQ.get(),
    historyQ.get(),
    completedFromQ.get(),
    completedToQ.get(),
  ]);

  const acceptedMatchIds = new Set<string>();
  for (const snap of [acceptedFromSnap, acceptedToSnap]) {
    for (const docSnap of snap.docs) {
      const data = docSnap.data() as MatchRequestDoc;
      if (ACCEPTED_MATCH_STATUSES.has(String(data.status || ""))) {
        acceptedMatchIds.add(docSnap.id);
      }
    }
  }

  const completedMatchIds = new Set<string>();
  const winMatchIds = new Set<string>();

  for (const docSnap of historySnap.docs) {
    const data = docSnap.data() as MatchHistoryDoc;
    if (isCompletedHistoryMatch(data)) {
      completedMatchIds.add(docSnap.id);
    }
    if (historyWinForUid(data, uid)) {
      winMatchIds.add(docSnap.id);
    }
  }

  for (const snap of [completedFromSnap, completedToSnap]) {
    for (const docSnap of snap.docs) {
      const data = docSnap.data() as CompletedMatchDoc;
      const completedId = asString(data.matchId) || docSnap.id;
      completedMatchIds.add(completedId);
      if (asString(data.winnerId) === uid) {
        winMatchIds.add(completedId);
      }
    }
  }

  const payload = {
    acceptedMatches: acceptedMatchIds.size,
    completedMatches: completedMatchIds.size,
    wins: winMatchIds.size,
  };

  return payload;
}

async function run() {
  console.log("Starting player public stats backfill...");
  console.log("Project:", serviceAccount.project_id);

  const playersSnap = await db.collection(PLAYERS_COLLECTION).get();
  console.log(`Loaded ${playersSnap.size} player docs`);

  let scanned = 0;
  let written = 0;
  let skipped = 0;
  let failed = 0;

  for (const playerDoc of playersSnap.docs) {
    scanned++;
    const uid = playerDoc.id;

    try {
      const payload = await recomputePlayerPublicStats(uid);
      const statsRef = db.collection("player_public_stats").doc(uid);
      const existingSnap = await statsRef.get();
      const existing = existingSnap.exists ? (existingSnap.data() as Record<string, unknown>) : null;

      const unchanged =
        existing &&
        existing.acceptedMatches === payload.acceptedMatches &&
        existing.completedMatches === payload.completedMatches &&
        existing.wins === payload.wins;

      if (unchanged) {
        skipped++;
        continue;
      }

      await statsRef.set(
        {
          ...payload,
          updatedAt: new Date(),
        },
        { merge: true }
      );
      written++;
      console.log(`[player_public_stats] wrote ${uid}`, payload);
    } catch (error) {
      failed++;
      console.error(`[player_public_stats] failed ${uid}`, error);
    }
  }

  console.log("Backfill complete.");
  console.log({
    scanned,
    written,
    skipped,
    failed,
  });
}

run().catch((error) => {
  console.error("Backfill failed:", error);
  process.exit(1);
});
