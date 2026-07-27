import * as crypto from "crypto";
import * as admin from "firebase-admin";
import {CallableRequest, HttpsError, onCall} from "firebase-functions/v2/https";

type SourceType = "match_request" | "match_invite";
type Outcome = "played" | "not_played";
type SetResult = {A: number; B: number; tieBreakA?: number; tieBreakB?: number};

type MatchResultInput = {
  outcome: Outcome;
  playedDate?: string;
  score?: string;
  sets?: SetResult[];
  winnerId?: string | null;
  location?: string | null;
  courtId?: string | null;
  matchType?: string | null;
  livePoints?: string | null;
  matchComments?: string | null;
  tiebreakMode?: boolean;
};

export type RecordCompletedMatchInput =
  | {mode: "invite"; sourceId: string; sourceType: SourceType; result: MatchResultInput}
  | {mode: "chat_check_in"; conversationId: string; result: MatchResultInput};

export type RecordCompletedMatchResult = {
  recorded: boolean;
  alreadyRecorded: boolean;
  historyId: string;
  outcome: Outcome;
};

const COMPLETABLE_STATUSES = new Set(["accepted", "confirmed", "completed"]);
const MAX_TEXT_LENGTH = 300;

function cleanId(value: unknown, field: string): string {
  if (typeof value !== "string" || !value.trim() || value.length > 200) {
    throw new HttpsError("invalid-argument", `${field} is required.`);
  }
  return value.trim();
}

function cleanOptionalText(value: unknown, field: string): string | null {
  if (value == null || value === "") return null;
  if (typeof value !== "string" || value.length > MAX_TEXT_LENGTH) {
    throw new HttpsError("invalid-argument", `${field} is invalid.`);
  }
  return value.trim() || null;
}

function cleanPlayedDate(value: unknown, required: boolean): string | null {
  if (value == null || value === "") {
    if (required) throw new HttpsError("invalid-argument", "A played date is required.");
    return null;
  }
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new HttpsError("invalid-argument", "The played date is invalid.");
  }
  const date = new Date(`${value}T00:00:00Z`);
  const today = new Date();
  const todayKey = today.toISOString().slice(0, 10);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value || value > todayKey) {
    throw new HttpsError("invalid-argument", "The played date is invalid.");
  }
  return value;
}

function cleanSets(value: unknown): SetResult[] {
  if (value == null) return [];
  if (!Array.isArray(value) || value.length > 5) {
    throw new HttpsError("invalid-argument", "The match sets are invalid.");
  }
  return value.map((set) => {
    if (!set || typeof set !== "object") throw new HttpsError("invalid-argument", "The match sets are invalid.");
    const source = set as Record<string, unknown>;
    const A = source.A;
    const B = source.B;
    if (!Number.isInteger(A) || !Number.isInteger(B) || Number(A) < 0 || Number(B) < 0 || Number(A) > 99 || Number(B) > 99) {
      throw new HttpsError("invalid-argument", "The match sets are invalid.");
    }
    const result: SetResult = {A: Number(A), B: Number(B)};
    for (const key of ["tieBreakA", "tieBreakB"] as const) {
      const item = source[key];
      if (item == null) continue;
      if (!Number.isInteger(item) || Number(item) < 0 || Number(item) > 99) {
        throw new HttpsError("invalid-argument", "The match sets are invalid.");
      }
      result[key] = Number(item);
    }
    return result;
  });
}

function cleanResult(value: unknown, allowedOutcome: Outcome | "both", requirePlayedDate: boolean): MatchResultInput {
  if (!value || typeof value !== "object") throw new HttpsError("invalid-argument", "Match result is required.");
  const source = value as Record<string, unknown>;
  const outcome = source.outcome;
  if (outcome !== "played" && outcome !== "not_played") throw new HttpsError("invalid-argument", "Match outcome is invalid.");
  if (allowedOutcome !== "both" && outcome !== allowedOutcome) throw new HttpsError("invalid-argument", "Match outcome is invalid for this recording path.");
  return {
    outcome,
    playedDate: cleanPlayedDate(source.playedDate, outcome === "played" && requirePlayedDate) || undefined,
    score: cleanOptionalText(source.score, "Score") || undefined,
    sets: cleanSets(source.sets),
    winnerId: source.winnerId == null || source.winnerId === "" ? null : cleanId(source.winnerId, "Winner"),
    location: cleanOptionalText(source.location, "Location"),
    courtId: cleanOptionalText(source.courtId, "Court"),
    matchType: cleanOptionalText(source.matchType, "Match type"),
    livePoints: cleanOptionalText(source.livePoints, "Live points"),
    matchComments: cleanOptionalText(source.matchComments, "Match comments"),
    tiebreakMode: source.tiebreakMode === true,
  };
}

function participantsFrom(data: FirebaseFirestore.DocumentData): [string, string] {
  const candidates = Array.isArray(data.participants) ? data.participants : [data.fromUserId, data.toUserId];
  const participants = candidates.filter((value: unknown): value is string => typeof value === "string" && Boolean(value.trim())).map((value: string) => value.trim());
  const unique = [...new Set(participants)];
  if (unique.length !== 2) throw new HttpsError("failed-precondition", "The match participants are invalid.");
  return [unique[0], unique[1]];
}

function pairFields(players: [string, string]) {
  const sorted = [...players].sort();
  const pairId = `${sorted[0]}_${sorted[1]}`;
  return {pairId, relationshipRefPath: `player_relationships/${pairId}`};
}

function playerSnapshot(data: FirebaseFirestore.DocumentData | undefined) {
  return {
    name: typeof data?.name === "string" && data.name.trim() ? data.name.trim() : "Player",
    photo: typeof data?.photoThumbURL === "string" ? data.photoThumbURL : typeof data?.photoURL === "string" ? data.photoURL : typeof data?.avatar === "string" ? data.avatar : "",
  };
}

function assertWinner(winnerId: string | null | undefined, players: [string, string]) {
  if (winnerId && !players.includes(winnerId)) throw new HttpsError("invalid-argument", "The winner must be a match participant.");
}

function historyMatches(existing: FirebaseFirestore.DocumentData, players: [string, string], outcome: Outcome): boolean {
  const stored = Array.isArray(existing.players) ? existing.players.filter((value: unknown) => typeof value === "string") : [];
  const storedOutcome = existing.outcome || (existing.completed === true || existing.status === "completed" ? "played" : existing.status === "not_played" ? "not_played" : null);
  return stored.length === 2 && new Set(stored).size === 2 && stored.every((uid: string) => players.includes(uid)) && storedOutcome === outcome;
}

function chatHistoryId(conversationId: string): string {
  return `chat_${crypto.createHash("sha256").update(conversationId).digest("hex").slice(0, 40)}`;
}

function canonicalHistory(
  players: [string, string],
  profiles: [FirebaseFirestore.DocumentData | undefined, FirebaseFirestore.DocumentData | undefined],
  result: MatchResultInput,
  provenance: Record<string, unknown>
): FirebaseFirestore.DocumentData {
  const first = playerSnapshot(profiles[0]);
  const second = playerSnapshot(profiles[1]);
  const played = result.outcome === "played";
  return {
    players,
    fromUserId: players[0],
    toUserId: players[1],
    fromName: first.name,
    toName: second.name,
    fromPhotoURL: first.photo,
    toPhotoURL: second.photo,
    ...pairFields(players),
    completed: played,
    status: played ? "completed" : "not_played",
    outcome: result.outcome,
    completedAt: played ? admin.firestore.FieldValue.serverTimestamp() : null,
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    playedDate: result.playedDate || "",
    score: result.score || "",
    sets: result.sets || [],
    winnerId: result.winnerId || null,
    location: result.location || "",
    court: result.courtId ? {id: result.courtId} : null,
    livePoints: result.livePoints || "",
    matchComments: result.matchComments || "",
    tiebreakMode: result.tiebreakMode === true,
    ...provenance,
  };
}

async function recordInvite(
  db: FirebaseFirestore.Firestore,
  uid: string,
  input: Extract<RecordCompletedMatchInput, {mode: "invite"}>
): Promise<RecordCompletedMatchResult> {
  const sourceId = cleanId(input.sourceId, "Source ID");
  if (input.sourceType !== "match_request" && input.sourceType !== "match_invite") throw new HttpsError("invalid-argument", "Match source type is invalid.");
  const result = cleanResult(input.result, "played", false);
  const sourceCollection = input.sourceType === "match_request" ? "match_requests" : "match_invites";
  const sourceRef = db.collection(sourceCollection).doc(sourceId);
  const historyRef = db.collection("match_history").doc(sourceId);

  return db.runTransaction(async (transaction) => {
    const sourceSnap = await transaction.get(sourceRef);
    if (!sourceSnap.exists) throw new HttpsError("not-found", "The match could not be found.");
    const source = sourceSnap.data() || {};
    const players = participantsFrom(source);
    if (!players.includes(uid)) throw new HttpsError("permission-denied", "You are not a participant in this match.");
    const status = String(input.sourceType === "match_invite" ? source.inviteStatus || source.status || "" : source.status || "").toLowerCase();
    if (!COMPLETABLE_STATUSES.has(status)) throw new HttpsError("failed-precondition", "This match is not ready to be recorded.");
    assertWinner(result.winnerId, players);

    const [historySnap, firstProfile, secondProfile] = await Promise.all([
      transaction.get(historyRef),
      transaction.get(db.collection("players").doc(players[0])),
      transaction.get(db.collection("players").doc(players[1])),
    ]);
    if (historySnap.exists) {
      if (!historyMatches(historySnap.data() || {}, players, "played")) throw new HttpsError("already-exists", "A conflicting match record already exists.");
      return {recorded: false, alreadyRecorded: true, historyId: historyRef.id, outcome: "played"};
    }

    const sourceInviteId = input.sourceType === "match_invite" ? sourceId : typeof source.inviteId === "string" ? source.inviteId : "";
    const sourceRequestId = input.sourceType === "match_request" ? sourceId : typeof source.matchId === "string" ? source.matchId : "";
    const sourceCourt = source.invite?.court && typeof source.invite.court === "object" ? source.invite.court : source.court && typeof source.court === "object" ? source.court : null;
    const sourceLocation = result.location || (typeof source.suggestedCourtName === "string" ? source.suggestedCourtName : typeof source.courtName === "string" ? source.courtName : typeof source.invite?.location === "string" ? source.invite.location : null);
    const sourceCourtId = result.courtId || (typeof source.suggestedCourtId === "string" ? source.suggestedCourtId : typeof sourceCourt?.id === "string" ? sourceCourt.id : null);
    const sourcePlayedDateCandidate = result.playedDate || (typeof source.playedDate === "string" ? source.playedDate : typeof source.invite?.startISO === "string" ? source.invite.startISO.slice(0, 10) : undefined);
    const sourcePlayedDate = cleanPlayedDate(sourcePlayedDateCandidate, false) || undefined;
    const canonicalResult = {...result, location: sourceLocation, courtId: sourceCourtId, playedDate: sourcePlayedDate};
    const payload = canonicalHistory(players, [firstProfile.data(), secondProfile.data()], canonicalResult, {
      completedFrom: sourceInviteId ? "invite" : "match_request",
      matchRequestId: sourceRequestId,
      inviteId: sourceInviteId,
      conversationId: typeof source.conversationId === "string" ? source.conversationId : "",
      matchType: source.matchType || null,
      ...(sourceCourt ? {court: sourceCourt} : {}),
    });
    transaction.create(historyRef, payload);
    transaction.set(sourceRef, {
      completed: true,
      ...(input.sourceType === "match_invite" ? {inviteStatus: "completed"} : {status: "completed"}),
      completedAt: admin.firestore.FieldValue.serverTimestamp(),
      completedBy: admin.firestore.FieldValue.arrayUnion(uid),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      historyId: historyRef.id,
      score: result.score || "",
      sets: result.sets || [],
      winnerId: result.winnerId || null,
      matchType: result.matchType || source.matchType || null,
      livePoints: result.livePoints || "",
      matchComments: result.matchComments || "",
      tiebreakMode: result.tiebreakMode === true,
    }, {merge: true});
    transaction.set(db.collection("match_scores").doc(sourceId), {
      players,
      ...pairFields(players),
      score: result.score || "",
      sets: result.sets || [],
      livePoints: result.livePoints || "",
      matchComments: result.matchComments || "",
      tiebreakMode: result.tiebreakMode === true,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    }, {merge: true});
    transaction.set(db.collection("completed_matches").doc(sourceId), {
      fromUserId: players[0],
      toUserId: players[1],
      players,
      ...pairFields(players),
      matchId: sourceId,
      winnerId: result.winnerId || null,
      timestamp: admin.firestore.FieldValue.serverTimestamp(),
    }, {merge: true});
    transaction.set(db.collection("player_relationships").doc(pairFields(players).pairId), {
      players: [...players].sort(),
      latestHistoryId: historyRef.id,
      latestScoreId: sourceId,
      lastInteractionAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    }, {merge: true});
    return {recorded: true, alreadyRecorded: false, historyId: historyRef.id, outcome: "played"};
  });
}

async function recordChatCheckIn(
  db: FirebaseFirestore.Firestore,
  uid: string,
  input: Extract<RecordCompletedMatchInput, {mode: "chat_check_in"}>
): Promise<RecordCompletedMatchResult> {
  const conversationId = cleanId(input.conversationId, "Conversation ID");
  const result = cleanResult(input.result, "both", true);
  const conversationRef = db.collection("conversations").doc(conversationId);
  const historyRef = db.collection("match_history").doc(chatHistoryId(conversationId));

  return db.runTransaction(async (transaction) => {
    const conversationSnap = await transaction.get(conversationRef);
    if (!conversationSnap.exists) throw new HttpsError("not-found", "The conversation could not be found.");
    const conversation = conversationSnap.data() || {};
    const players = participantsFrom(conversation);
    if (!players.includes(uid)) throw new HttpsError("permission-denied", "You are not a participant in this conversation.");
    if (conversation.context?.type === "event" || conversation.activeMatchId || !conversation.matchIntentAt || conversation.matchCheckInSuppressed === true) {
      throw new HttpsError("failed-precondition", "This conversation is not eligible for match check-in.");
    }
    assertWinner(result.winnerId, players);

    const messagesQuery = conversationRef.collection("messages").orderBy("timestamp", "desc").limit(200);
    const invitesQuery = db.collection("match_invites").where("conversationId", "==", conversationId).where("inviteStatus", "==", "accepted").limit(1);
    const historyQuery = db.collection("match_history").where("conversationId", "==", conversationId).limit(1);
    const [historySnap, messages, acceptedInvites, existingHistory, firstProfile, secondProfile] = await Promise.all([
      transaction.get(historyRef),
      transaction.get(messagesQuery),
      transaction.get(invitesQuery),
      transaction.get(historyQuery),
      transaction.get(db.collection("players").doc(players[0])),
      transaction.get(db.collection("players").doc(players[1])),
    ]);
    if (historySnap.exists) {
      if (!historyMatches(historySnap.data() || {}, players, result.outcome)) throw new HttpsError("already-exists", "A conflicting check-in response already exists.");
      return {recorded: false, alreadyRecorded: true, historyId: historyRef.id, outcome: result.outcome};
    }
    if (conversation.matchCheckInResolved === true || !existingHistory.empty) throw new HttpsError("already-exists", "This match check-in has already been recorded.");
    if (!acceptedInvites.empty) throw new HttpsError("failed-precondition", "Use the accepted match invite to record this match.");
    const realSenders = new Set(messages.docs.map((doc) => doc.data()).filter((message) => message.type !== "system" && message.type !== "invite").map((message) => message.senderId));
    if (!players.every((playerId) => realSenders.has(playerId))) throw new HttpsError("failed-precondition", "This conversation is not eligible for match check-in.");

    const payload = canonicalHistory(players, [firstProfile.data(), secondProfile.data()], result, {
      completedFrom: "chat_check_in",
      conversationId,
      inviteId: "",
      matchRequestId: "",
      matchType: null,
    });
    transaction.create(historyRef, payload);
    if ((result.sets?.length || 0) > 0 || result.score) {
      transaction.set(db.collection("match_scores").doc(historyRef.id), {
        players,
        ...pairFields(players),
        score: result.score || "",
        sets: result.sets || [],
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      }, {merge: true});
      transaction.set(db.collection("completed_matches").doc(historyRef.id), {
        fromUserId: players[0],
        toUserId: players[1],
        players,
        ...pairFields(players),
        matchId: historyRef.id,
        winnerId: result.winnerId || null,
        timestamp: admin.firestore.FieldValue.serverTimestamp(),
      }, {merge: true});
    }
    transaction.set(conversationRef, {
      matchCheckInResolved: true,
      matchCheckInResolvedAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    }, {merge: true});
    transaction.set(db.collection("player_relationships").doc(pairFields(players).pairId), {
      players: [...players].sort(),
      latestHistoryId: historyRef.id,
      lastInteractionAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    }, {merge: true});
    return {recorded: true, alreadyRecorded: false, historyId: historyRef.id, outcome: result.outcome};
  });
}

export async function recordCompletedMatchForUser(
  db: FirebaseFirestore.Firestore,
  uid: string,
  rawInput: unknown
): Promise<RecordCompletedMatchResult> {
  if (!rawInput || typeof rawInput !== "object") throw new HttpsError("invalid-argument", "A recording mode is required.");
  const input = rawInput as RecordCompletedMatchInput;
  if (input.mode === "invite") return recordInvite(db, uid, input);
  if (input.mode === "chat_check_in") return recordChatCheckIn(db, uid, input);
  throw new HttpsError("invalid-argument", "Recording mode is invalid.");
}

export async function recordCompletedMatchHandler(request: CallableRequest<unknown>): Promise<RecordCompletedMatchResult> {
  const uid = request.auth?.uid;
  if (!uid) throw new HttpsError("unauthenticated", "Authentication required.");
  return recordCompletedMatchForUser(admin.firestore(), uid, request.data);
}

export const recordCompletedMatch = onCall({region: "australia-southeast2"}, recordCompletedMatchHandler);
