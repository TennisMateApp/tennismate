const path = require("path");
const admin = require("firebase-admin");

const serviceAccount = require(path.join(__dirname, "serviceAccountKey.json"));

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

const db = admin.firestore();
const { FieldValue } = admin.firestore;

const WRITE_MODE = process.argv.includes("--write");
const BATCH_LIMIT = 450;

function cleanUid(value) {
  return typeof value === "string" ? value.trim() : "";
}

function validPair(values) {
  if (!Array.isArray(values)) return null;
  const players = values.map(cleanUid).filter(Boolean);
  const unique = Array.from(new Set(players));
  if (unique.length !== 2) return null;
  return unique.sort();
}

function normalizedPlayerArray(values) {
  return Array.isArray(values) ? values.map(cleanUid).filter(Boolean) : [];
}

function pairFromFromTo(data) {
  const fromUserId = cleanUid(data.fromUserId);
  const toUserId = cleanUid(data.toUserId);
  if (!fromUserId || !toUserId || fromUserId === toUserId) return null;
  return [fromUserId, toUserId].sort();
}

function derivePlayers(data) {
  return (
    validPair(data.players) ||
    validPair(data.participants) ||
    pairFromFromTo(data)
  );
}

function getPairId(players) {
  return [...players].sort().join("_");
}

function relationshipRefPath(pairId) {
  return `player_relationships/${pairId}`;
}

function incrementReason(reasons, reason) {
  reasons[reason] = (reasons[reason] || 0) + 1;
}

function relationshipNeedsUpsert(snap, pairId, players) {
  if (!snap.exists) return true;
  const data = snap.data() || {};
  const relationshipPlayers = validPair(data.players);
  return (
    data.pairId !== pairId ||
    !relationshipPlayers ||
    relationshipPlayers.join("|") !== players.join("|") ||
    data.playerAId !== players[0] ||
    data.playerBId !== players[1]
  );
}

async function commitBatch(batchState) {
  if (!WRITE_MODE || batchState.count === 0) return;
  await batchState.batch.commit();
  batchState.batch = db.batch();
  batchState.count = 0;
}

async function main() {
  const stats = {
    scanned: 0,
    alreadyValid: 0,
    wouldUpdate: 0,
    updated: 0,
    skipped: 0,
    skipReasons: {},
  };

  console.log("Backfill match_history relationship fields");
  console.log("Mode:", WRITE_MODE ? "WRITE" : "DRY RUN");
  console.log("Project:", serviceAccount.project_id);

  const snap = await db.collection("match_history").get();
  const batchState = {
    batch: db.batch(),
    count: 0,
  };

  for (const docSnap of snap.docs) {
    stats.scanned += 1;

    const data = docSnap.data() || {};
    const players = derivePlayers(data);

    if (!players) {
      stats.skipped += 1;
      incrementReason(stats.skipReasons, "missing_valid_two_player_identity");
      console.log("SKIP", docSnap.id, "missing_valid_two_player_identity", {
        players: data.players || null,
        participants: data.participants || null,
        fromUserId: data.fromUserId || null,
        toUserId: data.toUserId || null,
      });
      continue;
    }

    const pairId = getPairId(players);
    const expectedRelationshipRefPath = relationshipRefPath(pairId);
    const existingPairId = cleanUid(data.pairId);
    const existingRelationshipRefPath = cleanUid(data.relationshipRefPath);

    if (existingPairId && existingPairId !== pairId) {
      stats.skipped += 1;
      incrementReason(stats.skipReasons, "existing_pairId_mismatch");
      console.log("SKIP", docSnap.id, "existing_pairId_mismatch", {
        existingPairId,
        expectedPairId: pairId,
      });
      continue;
    }

    if (
      existingRelationshipRefPath &&
      existingRelationshipRefPath !== expectedRelationshipRefPath
    ) {
      stats.skipped += 1;
      incrementReason(stats.skipReasons, "existing_relationshipRefPath_mismatch");
      console.log("SKIP", docSnap.id, "existing_relationshipRefPath_mismatch", {
        existingRelationshipRefPath,
        expectedRelationshipRefPath,
      });
      continue;
    }

    const currentPlayers = normalizedPlayerArray(data.players);
    const historyUpdate = {};

    if (currentPlayers.length !== 2 || currentPlayers.join("|") !== players.join("|")) {
      historyUpdate.players = players;
    }

    if (!existingPairId) {
      historyUpdate.pairId = pairId;
    }

    if (!existingRelationshipRefPath) {
      historyUpdate.relationshipRefPath = expectedRelationshipRefPath;
    }

    const relationshipRef = db.collection("player_relationships").doc(pairId);
    const relationshipSnap = await relationshipRef.get();
    const needsRelationshipUpsert = relationshipNeedsUpsert(relationshipSnap, pairId, players);
    const relationshipUpdate = {
      pairId,
      players,
      playerAId: players[0],
      playerBId: players[1],
      status: "active",
      updatedAt: FieldValue.serverTimestamp(),
    };

    if (!relationshipSnap.exists) {
      relationshipUpdate.createdAt = FieldValue.serverTimestamp();
    }

    const needsHistoryUpdate = Object.keys(historyUpdate).length > 0;

    if (!needsHistoryUpdate && !needsRelationshipUpsert) {
      stats.alreadyValid += 1;
      continue;
    }

    if (!WRITE_MODE) {
      stats.wouldUpdate += 1;
      console.log("WOULD UPDATE", docSnap.id, {
        historyUpdate,
        relationshipPath: expectedRelationshipRefPath,
        relationshipExists: relationshipSnap.exists,
        needsRelationshipUpsert,
      });
      continue;
    }

    if (needsHistoryUpdate) {
      batchState.batch.update(docSnap.ref, historyUpdate);
      batchState.count += 1;
    }

    if (needsRelationshipUpsert) {
      batchState.batch.set(relationshipRef, relationshipUpdate, { merge: true });
      batchState.count += 1;
    }

    stats.updated += 1;

    if (batchState.count >= BATCH_LIMIT) {
      await commitBatch(batchState);
    }
  }

  await commitBatch(batchState);

  console.log("Summary:", JSON.stringify(stats, null, 2));

  if (!WRITE_MODE) {
    console.log("Dry run only. Re-run with --write to apply changes.");
  }
}

main().catch((error) => {
  console.error("Backfill failed", error);
  process.exitCode = 1;
});
