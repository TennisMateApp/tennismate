/* scripts/backfill-player-createdAt-by-email.js */
const admin = require("firebase-admin");
const serviceAccount = require("../serviceAccountKey.json");

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

const db = admin.firestore();

function normalizeEmail(email) {
  return String(email || "").trim().toLowerCase();
}

async function backfillPlayerCreatedAtByEmail() {
  console.log("Starting backfill by email...");
  console.log("Project:", serviceAccount.project_id);

  const usersSnap = await db.collection("users").get();
  const playersSnap = await db.collection("players").get();

  console.log(`Loaded ${usersSnap.size} users`);
  console.log(`Loaded ${playersSnap.size} players`);

  // Build lookup: normalized email -> user createdAt
  const userByEmail = new Map();

  let usersMissingEmail = 0;
  let usersMissingCreatedAt = 0;
  let duplicateUserEmails = 0;

  for (const userDoc of usersSnap.docs) {
    const data = userDoc.data();
    const email = normalizeEmail(data.email);
    const createdAt = data.createdAt;

    if (!email) {
      usersMissingEmail++;
      continue;
    }

    if (!createdAt) {
      usersMissingCreatedAt++;
      continue;
    }

    if (userByEmail.has(email)) {
      duplicateUserEmails++;
      console.warn(`Duplicate user email found: ${email}`);
    }

    // latest one wins if duplicates exist, but we log it above
    userByEmail.set(email, {
      userId: userDoc.id,
      createdAt,
    });
  }

  let checkedPlayers = 0;
  let updatedPlayers = 0;
  let skippedPlayersNoEmail = 0;
  let skippedNoMatchingUser = 0;
  let errors = 0;

  let batch = db.batch();
  let batchCount = 0;
  const BATCH_LIMIT = 400;

  for (const playerDoc of playersSnap.docs) {
    checkedPlayers++;

    try {
      const playerData = playerDoc.data();
      const email = normalizeEmail(playerData.email);

      if (!email) {
        skippedPlayersNoEmail++;
        console.log(`Skipping player ${playerDoc.id}: missing email`);
        continue;
      }

      const matchedUser = userByEmail.get(email);

      if (!matchedUser) {
        skippedNoMatchingUser++;
        console.log(`Skipping player ${playerDoc.id}: no matching user for ${email}`);
        continue;
      }

batch.set(
  playerDoc.ref,
  {
    createdAt: matchedUser.createdAt,
  },
  { merge: true }
);

      updatedPlayers++;
      batchCount++;

      if (batchCount >= BATCH_LIMIT) {
        await batch.commit();
        console.log(`Committed batch of ${batchCount}`);
        batch = db.batch();
        batchCount = 0;
      }
    } catch (err) {
      errors++;
      console.error(`Error processing player ${playerDoc.id}:`, err);
    }
  }

  if (batchCount > 0) {
    await batch.commit();
    console.log(`Committed final batch of ${batchCount}`);
  }

  console.log("Backfill complete.");
  console.log({
    usersLoaded: usersSnap.size,
    playersLoaded: playersSnap.size,
    usersMissingEmail,
    usersMissingCreatedAt,
    duplicateUserEmails,
    checkedPlayers,
    updatedPlayers,
    skippedPlayersNoEmail,
    skippedNoMatchingUser,
    errors,
  });
}

backfillPlayerCreatedAtByEmail()
  .then(() => {
    console.log("Done.");
    process.exit(0);
  })
  .catch((err) => {
    console.error("Fatal error:", err);
    process.exit(1);
  });