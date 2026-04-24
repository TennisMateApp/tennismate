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
const PLAYERS_PRIVATE_COLLECTION = "players_private";
const BATCH_LIMIT = 400;
const FIELDS_TO_COPY = ["lat", "lng", "geohash"] as const;

type FirestoreDoc = Record<string, unknown>;

function hasOwnValue(obj: FirestoreDoc, key: string) {
  return Object.prototype.hasOwnProperty.call(obj, key) && obj[key] !== undefined;
}

async function run() {
  console.log("Starting public location restore for Match/Home...");
  console.log("Project:", serviceAccount.project_id);

  const playersSnap = await db.collection(PLAYERS_COLLECTION).get();
  console.log(`Loaded ${playersSnap.size} player docs`);

  let scanned = 0;
  let updated = 0;
  let skipped = 0;

  let batch = db.batch();
  let batchCount = 0;
  let batchesCommitted = 0;

  for (const playerDoc of playersSnap.docs) {
    scanned++;

    const privateSnap = await db.collection(PLAYERS_PRIVATE_COLLECTION).doc(playerDoc.id).get();
    const privateData = (privateSnap.exists ? privateSnap.data() : {}) as FirestoreDoc;

    const payload: FirestoreDoc = {};

    for (const field of FIELDS_TO_COPY) {
      if (!hasOwnValue(privateData, field)) continue;
      payload[field] = privateData[field];
    }

    if (Object.keys(payload).length === 0) {
      skipped++;
      continue;
    }

    batch.set(playerDoc.ref, payload, { merge: true });
    batchCount++;
    updated++;

    if (batchCount >= BATCH_LIMIT) {
      await batch.commit();
      batchesCommitted++;
      console.log(
        `Committed batch ${batchesCommitted} (updated ${updated}, scanned ${scanned})`
      );
      batch = db.batch();
      batchCount = 0;
    }
  }

  if (batchCount > 0) {
    await batch.commit();
    batchesCommitted++;
    console.log(`Committed final batch ${batchesCommitted}`);
  }

  console.log("Restore complete.");
  console.log({
    scanned,
    updated,
    skipped,
  });
}

run().catch((error) => {
  console.error("Restore failed:", error);
  process.exit(1);
});
