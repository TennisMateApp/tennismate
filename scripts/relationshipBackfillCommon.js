const path = require("path");
const admin = require("firebase-admin");

const serviceAccount = require(path.join(__dirname, "serviceAccountKey.json"));

if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
  });
}

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

function pairFromFields(data, fields) {
  const first = cleanUid(data[fields[0]]);
  const second = cleanUid(data[fields[1]]);
  if (!first || !second || first === second) return null;
  return [first, second].sort();
}

function getPairId(players) {
  return [...players].sort().join("_");
}

function relationshipRefPath(pairId) {
  return `player_relationships/${pairId}`;
}

function relationshipNeedsUpsert(data, pairId, players, latestRefField) {
  const relationshipPlayers = validPair(data.players);
  const refs = data.refs || {};

  return (
    data.pairId !== pairId ||
    !relationshipPlayers ||
    relationshipPlayers.join("|") !== players.join("|") ||
    data.playerAId !== players[0] ||
    data.playerBId !== players[1] ||
    !cleanUid(refs[latestRefField])
  );
}

function docNeedsLinkUpdate(data, pairId, expectedRelationshipRefPath) {
  const existingPairId = cleanUid(data.pairId);
  const existingRelationshipRefPath = cleanUid(data.relationshipRefPath);

  if (existingPairId && existingPairId !== pairId) {
    return {
      error: "existing_pairId_mismatch",
      details: { existingPairId, expectedPairId: pairId },
    };
  }

  if (existingRelationshipRefPath && existingRelationshipRefPath !== expectedRelationshipRefPath) {
    return {
      error: "existing_relationshipRefPath_mismatch",
      details: { existingRelationshipRefPath, expectedRelationshipRefPath },
    };
  }

  const update = {};
  if (!existingPairId) update.pairId = pairId;
  if (!existingRelationshipRefPath) update.relationshipRefPath = expectedRelationshipRefPath;

  return { update };
}

function buildRelationshipUpdate(config, players, pairId, docId, relationshipData) {
  const at = FieldValue.serverTimestamp();
  const existingRefs = relationshipData.refs || {};

  const relationshipUpdate = {
    pairId,
    players,
    playerAId: players[0],
    playerBId: players[1],
    status: "active",
    updatedAt: at,
  };

  if (!cleanUid(existingRefs[config.latestRefField])) {
    relationshipUpdate.refs = {
      [config.latestRefField]: docId,
    };
  }

  return relationshipUpdate;
}

function derivePairFromCommonFields(data, fieldPairs) {
  for (const fields of fieldPairs || []) {
    const pair = pairFromFields(data, fields);
    if (pair) return pair;
  }

  return validPair(data.players) || validPair(data.participants);
}

async function pairFromMatchLookup(matchId) {
  const cleanMatchId = cleanUid(matchId);
  if (!cleanMatchId) return null;

  const lookups = [
    ["match_history", cleanMatchId],
    ["completed_matches", cleanMatchId],
    ["match_scores", cleanMatchId],
    ["match_requests", cleanMatchId],
    ["match_invites", cleanMatchId],
  ];

  for (const [collectionName, docId] of lookups) {
    const snap = await db.collection(collectionName).doc(docId).get();
    if (!snap.exists) continue;
    const data = snap.data() || {};
    const pair = derivePairFromCommonFields(data, [
      ["fromUserId", "toUserId"],
      ["senderId", "receiverId"],
    ]);
    if (pair) return pair;
  }

  return null;
}

async function commitBatch(batchState) {
  if (!WRITE_MODE || batchState.count === 0) return;
  await batchState.batch.commit();
  batchState.batch = db.batch();
  batchState.count = 0;
}

async function runRelationshipBackfill(config) {
  const stats = {
    scanned: 0,
    wouldUpdate: 0,
    updated: 0,
    skippedAlreadyLinked: 0,
    skippedNoPair: 0,
    errors: 0,
  };

  console.log(`Backfill ${config.collection} relationship fields`);
  console.log("Mode:", WRITE_MODE ? "WRITE" : "DRY RUN");
  console.log("Project:", serviceAccount.project_id);

  const snap = await db.collection(config.collection).get();
  const batchState = {
    batch: db.batch(),
    count: 0,
  };

  for (const docSnap of snap.docs) {
    stats.scanned += 1;

    try {
      const data = docSnap.data() || {};
      const players = await config.derivePlayers(data, docSnap.id);

      if (!players) {
        stats.skippedNoPair += 1;
        console.log("SKIP", docSnap.id, "missing_valid_two_player_identity");
        continue;
      }

      const pairId = getPairId(players);
      const expectedRelationshipRefPath = relationshipRefPath(pairId);
      const linkState = docNeedsLinkUpdate(data, pairId, expectedRelationshipRefPath);

      if (linkState.error) {
        stats.errors += 1;
        console.log("ERROR", docSnap.id, linkState.error, linkState.details);
        continue;
      }

      const relationshipRef = db.collection("player_relationships").doc(pairId);
      const relationshipSnap = await relationshipRef.get();
      const relationshipData = relationshipSnap.exists ? relationshipSnap.data() || {} : {};
      const needsRelationshipUpsert =
        !relationshipSnap.exists ||
        relationshipNeedsUpsert(
          relationshipData,
          pairId,
          players,
          config.latestRefField
        );

      const docUpdate = linkState.update || {};
      const needsDocUpdate = Object.keys(docUpdate).length > 0;

      if (!needsDocUpdate && !needsRelationshipUpsert) {
        stats.skippedAlreadyLinked += 1;
        continue;
      }

      if (!WRITE_MODE) {
        stats.wouldUpdate += 1;
        console.log("WOULD UPDATE", docSnap.id, {
          docUpdate,
          relationshipPath: expectedRelationshipRefPath,
          relationshipExists: relationshipSnap.exists,
          needsRelationshipUpsert,
        });
        continue;
      }

      if (needsDocUpdate) {
        batchState.batch.update(docSnap.ref, docUpdate);
        batchState.count += 1;
      }

      if (needsRelationshipUpsert) {
        const relationshipUpdate = buildRelationshipUpdate(
          config,
          players,
          pairId,
          docSnap.id,
          relationshipData
        );
        if (!relationshipSnap.exists) {
          relationshipUpdate.createdAt = FieldValue.serverTimestamp();
        }
        await relationshipRef.set(relationshipUpdate, { merge: true });
      }

      stats.updated += 1;

      if (batchState.count >= BATCH_LIMIT) {
        await commitBatch(batchState);
      }
    } catch (error) {
      stats.errors += 1;
      console.log("ERROR", docSnap.id, error);
    }
  }

  await commitBatch(batchState);

  console.log("Summary:", JSON.stringify(stats, null, 2));

  if (!WRITE_MODE) {
    console.log("Dry run only. Re-run with --write to apply changes.");
  }
}

module.exports = {
  cleanUid,
  derivePairFromCommonFields,
  pairFromMatchLookup,
  runRelationshipBackfill,
  validPair,
};
