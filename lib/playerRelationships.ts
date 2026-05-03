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

type RelationshipUpsertOptions = {
  actorId: string;
  matchRequestId: string;
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

    // Stage 1: match request writes only. Counters/stats are intentionally
    // left for a later Cloud Functions-backed migration.
    createdAt: at,
    updatedAt: at,
    lastInteractionAt: at,
    lastInteraction: {
      type: "match_request",
      id: options.matchRequestId,
      collection: "match_requests",
      at,
      actorId: options.actorId,
    },
    refs: {
      latestMatchRequestId: options.matchRequestId,
    },
    ...(options.playerSnapshots ? { playerSnapshots: options.playerSnapshots } : {}),
  };
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
  const relationshipRefPath = `player_relationships/${pairId}`;
  const matchRequestWithRelationship: DocumentData & {
    pairId: string;
    relationshipRefPath: string;
  } = {
    ...matchRequestPayload,
    pairId,
    relationshipRefPath,
  };

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
    matchRequestId: matchRequestRef.id,
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
