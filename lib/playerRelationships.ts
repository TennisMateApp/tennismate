import {
  addDoc,
  collection,
  doc,
  serverTimestamp,
  setDoc,
  type DocumentData,
  type DocumentReference,
  type Firestore,
} from "firebase/firestore";

type PublicPlayerSnapshot = {
  name?: string | null;
  photoURL?: string | null;
  photoThumbURL?: string | null;
};

type RelationshipInteractionType = "match_request" | "match_invite" | "completed_match";
type RelationshipInteractionCollection =
  | "match_requests"
  | "match_invites"
  | "match_history"
  | "completed_matches"
  | "match_scores";

type RelationshipUpsertOptions = {
  actorId: string;
  interactionId: string;
  interactionType: RelationshipInteractionType;
  interactionCollection: RelationshipInteractionCollection;
  latestRefField:
    | "latestMatchRequestId"
    | "latestMatchInviteId"
    | "latestHistoryId"
    | "latestCompletedMatchId"
    | "latestScoreId";
  refs?: Record<string, string | null | undefined>;
  playerSnapshots?: Record<string, PublicPlayerSnapshot | null | undefined>;
};

type CreateMatchRequestOptions = {
  actorId: string;
  playerSnapshots?: Record<string, PublicPlayerSnapshot | null | undefined>;
};

const cleanUid = (uid: string) => uid.trim();

export function getPairId(uidA: string, uidB: string) {
  const players = [cleanUid(uidA), cleanUid(uidB)].filter(Boolean).sort();
  if (players.length !== 2 || players[0] === players[1]) {
    throw new Error("A player relationship requires two distinct player ids.");
  }
  return players.join("_");
}

export function getRelationshipRef(db: Firestore, uidA: string, uidB: string) {
  return doc(db, "player_relationships", getPairId(uidA, uidB));
}

export function getRelationshipRefPath(uidA: string, uidB: string) {
  return `player_relationships/${getPairId(uidA, uidB)}`;
}

export function withRelationshipFields<T extends DocumentData>(
  uidA: string,
  uidB: string,
  payload: T
): T & { pairId: string; relationshipRefPath: string } {
  const pairId = getPairId(uidA, uidB);
  return {
    ...payload,
    pairId,
    relationshipRefPath: getRelationshipRefPath(uidA, uidB),
  };
}

export function buildRelationshipUpsertPayload(
  uidA: string,
  uidB: string,
  options: RelationshipUpsertOptions
) {
  const [playerAId, playerBId] = [cleanUid(uidA), cleanUid(uidB)].sort();
  const pairId = getPairId(playerAId, playerBId);
  const at = serverTimestamp();

  return {
    pairId,
    players: [playerAId, playerBId],
    playerAId,
    playerBId,
    status: "active",

    // Stage 1-3: client writes only link latest interaction references.
    // Counters/stats are intentionally left for a later Cloud Functions-backed migration.
    createdAt: at,
    updatedAt: at,
    lastInteractionAt: at,
    lastInteraction: {
      type: options.interactionType,
      id: options.interactionId,
      collection: options.interactionCollection,
      at,
      actorId: options.actorId,
    },
    refs: {
      [options.latestRefField]: options.interactionId,
      ...(options.refs || {}),
    },
    ...(options.playerSnapshots ? { playerSnapshots: options.playerSnapshots } : {}),
  };
}

export async function upsertPlayerRelationshipInteraction(
  db: Firestore,
  uidA: string,
  uidB: string,
  options: RelationshipUpsertOptions
) {
  const relationshipRef = getRelationshipRef(db, uidA, uidB);
  const relationshipPayload = buildRelationshipUpsertPayload(uidA, uidB, options);

  await setDoc(relationshipRef, relationshipPayload, { merge: true });
}

export async function upsertMatchInviteRelationship(
  db: Firestore,
  uidA: string,
  uidB: string,
  inviteId: string,
  actorId: string,
  playerSnapshots?: Record<string, PublicPlayerSnapshot | null | undefined>
) {
  await upsertPlayerRelationshipInteraction(db, uidA, uidB, {
    actorId,
    interactionId: inviteId,
    interactionType: "match_invite",
    interactionCollection: "match_invites",
    latestRefField: "latestMatchInviteId",
    playerSnapshots,
  });
}

export async function upsertCompletedMatchRelationship(
  db: Firestore,
  uidA: string,
  uidB: string,
  interactionId: string,
  actorId: string,
  interactionCollection: Extract<
    RelationshipInteractionCollection,
    "match_history" | "completed_matches" | "match_scores"
  >,
  refs?: Record<string, string | null | undefined>
) {
  const latestRefField =
    interactionCollection === "completed_matches"
      ? "latestCompletedMatchId"
      : interactionCollection === "match_scores"
        ? "latestScoreId"
        : "latestHistoryId";

  await upsertPlayerRelationshipInteraction(db, uidA, uidB, {
    actorId,
    interactionId,
    interactionType: "completed_match",
    interactionCollection,
    latestRefField,
    refs,
  });
}

export async function createMatchRequestWithRelationship(
  db: Firestore,
  uidA: string,
  uidB: string,
  matchRequestPayload: DocumentData,
  options: CreateMatchRequestOptions
) {
  const pairId = getPairId(uidA, uidB);
  const relationshipRef = getRelationshipRef(db, uidA, uidB);
  const relationshipRefPath = getRelationshipRefPath(uidA, uidB);
  const matchRequestWithRelationship = withRelationshipFields(uidA, uidB, matchRequestPayload);

  console.debug("[player_relationships:stage1] before match_requests create", {
    pairId,
    relationshipRefPath,
    fromUserId: matchRequestWithRelationship.fromUserId,
    toUserId: matchRequestWithRelationship.toUserId,
    status: matchRequestWithRelationship.status,
  });

  let matchRequestRef: DocumentReference<DocumentData>;
  try {
    matchRequestRef = await addDoc(collection(db, "match_requests"), matchRequestWithRelationship);
  } catch (error) {
    console.error("[player_relationships:stage1] match_requests create failed", {
      pairId,
      relationshipRefPath,
      fromUserId: matchRequestWithRelationship.fromUserId,
      toUserId: matchRequestWithRelationship.toUserId,
      error,
    });
    throw error;
  }

  console.debug("[player_relationships:stage1] after match_requests create", {
    pairId,
    matchRequestId: matchRequestRef.id,
  });

  const relationshipPayload = buildRelationshipUpsertPayload(uidA, uidB, {
    actorId: options.actorId,
    interactionId: matchRequestRef.id,
    interactionType: "match_request",
    interactionCollection: "match_requests",
    latestRefField: "latestMatchRequestId",
    playerSnapshots: options.playerSnapshots,
  });

  console.debug("[player_relationships:stage1] before player_relationships upsert", {
    pairId,
    relationshipPath: relationshipRef.path,
    players: relationshipPayload.players,
    playerAId: relationshipPayload.playerAId,
    playerBId: relationshipPayload.playerBId,
    actorId: options.actorId,
    matchRequestId: matchRequestRef.id,
  });

  try {
    await setDoc(
      relationshipRef,
      relationshipPayload,
      { merge: true }
    );
  } catch (error) {
    console.error("[player_relationships:stage1] player_relationships upsert failed", {
      pairId,
      relationshipPath: relationshipRef.path,
      players: relationshipPayload.players,
      playerAId: relationshipPayload.playerAId,
      playerBId: relationshipPayload.playerBId,
      actorId: options.actorId,
      matchRequestId: matchRequestRef.id,
      error,
    });
    throw error;
  }

  console.debug("[player_relationships:stage1] after player_relationships upsert", {
    pairId,
    relationshipPath: relationshipRef.path,
    matchRequestId: matchRequestRef.id,
  });

  return matchRequestRef;
}
