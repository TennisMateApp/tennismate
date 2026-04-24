import * as admin from "firebase-admin";

const db = admin.firestore();

const ACCEPTED_MATCH_STATUSES = new Set(["accepted", "confirmed", "completed"]);
const COMPLETED_MATCH_STATUSES = new Set(["completed"]);

type MatchRequestDoc = {
  status?: unknown;
};

type MatchHistoryDoc = {
  players?: unknown;
  winnerId?: unknown;
  winnerIds?: unknown;
  completedByWinner?: unknown;
  completed?: unknown;
  status?: unknown;
};

type CompletedMatchDoc = {
  matchId?: unknown;
  players?: unknown;
  fromUserId?: unknown;
  toUserId?: unknown;
  winnerId?: unknown;
};

function asUidSet(value: unknown): Set<string> {
  if (!Array.isArray(value)) return new Set<string>();
  return new Set(
    value
      .filter((item): item is string => typeof item === "string" && item.trim().length > 0)
      .map((item) => item.trim())
  );
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
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

function extractCompletedMatchParticipants(match: CompletedMatchDoc): Set<string> {
  const fromUserId = asString(match.fromUserId);
  const toUserId = asString(match.toUserId);
  const players = asUidSet(match.players);

  if (fromUserId) players.add(fromUserId);
  if (toUserId) players.add(toUserId);

  return players;
}

export async function recomputePlayerPublicStats(uid: string) {
  if (!uid) {
    throw new Error("UID_REQUIRED");
  }

  const acceptedFromQ = db
    .collection("match_requests")
    .where("fromUserId", "==", uid);
  const acceptedToQ = db
    .collection("match_requests")
    .where("toUserId", "==", uid);

  const historyQ = db
    .collection("match_history")
    .where("players", "array-contains", uid);

  const completedFromQ = db
    .collection("completed_matches")
    .where("fromUserId", "==", uid);
  const completedToQ = db
    .collection("completed_matches")
    .where("toUserId", "==", uid);

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
      const participants = extractCompletedMatchParticipants(data);
      if (!participants.has(uid)) continue;

      const completedId = asString(data.matchId) || docSnap.id;
      completedMatchIds.add(completedId);

      const winnerId = asString(data.winnerId);
      if (winnerId === uid) {
        winMatchIds.add(completedId);
      }
    }
  }

  const payload = {
    acceptedMatches: acceptedMatchIds.size,
    completedMatches: completedMatchIds.size,
    wins: winMatchIds.size,
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  };

  await db.collection("player_public_stats").doc(uid).set(payload, { merge: true });

  return {
    uid,
    ...payload,
  };
}

export function affectedUserIdsFromMatchRequest(data: unknown): string[] {
  const doc = (data || {}) as { fromUserId?: unknown; toUserId?: unknown };
  return Array.from(
    new Set([asString(doc.fromUserId), asString(doc.toUserId)].filter(Boolean) as string[])
  );
}

export function affectedUserIdsFromMatchHistory(data: unknown): string[] {
  const doc = (data || {}) as MatchHistoryDoc;
  return Array.from(asUidSet(doc.players));
}

export function affectedUserIdsFromCompletedMatch(data: unknown): string[] {
  const doc = (data || {}) as CompletedMatchDoc;
  return Array.from(extractCompletedMatchParticipants(doc));
}
