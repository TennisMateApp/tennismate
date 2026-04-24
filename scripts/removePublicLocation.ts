import { initializeApp, cert } from "firebase-admin/app";
import { FieldValue, getFirestore } from "firebase-admin/firestore";
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
const BATCH_LIMIT = 400;
const FIELDS_TO_REMOVE = ["lat", "lng", "geohash"] as const;

type FirestoreDoc = Record<string, unknown>;

function hasOwnValue(obj: FirestoreDoc, key: string) {
  return Object.prototype.hasOwnProperty.call(obj, key) && obj[key] !== undefined;
}

async function run() {
  console.log("Starting public location cleanup...");
  console.log("Project:", serviceAccount.project_id);

  const playersSnap = await db.collection(PLAYERS_COLLECTION).get();
  console.log(`Loaded ${playersSnap.size} player docs`);

  let scanned = 0;
  let cleaned = 0;
  let skipped = 0;
  let batchesCommitted = 0;

  let batch = db.batch();
  let batchCount = 0;

  for (const playerDoc of playersSnap.docs) {
    scanned++;

    const playerData = (playerDoc.data() || {}) as FirestoreDoc;
    const updatePayload: FirestoreDoc = {};

    for (const field of FIELDS_TO_REMOVE) {
      if (!hasOwnValue(playerData, field)) continue;
      updatePayload[field] = FieldValue.delete();
    }

    if (Object.keys(updatePayload).length === 0) {
      skipped++;
      continue;
    }

    batch.set(playerDoc.ref, updatePayload, { merge: true });
    batchCount++;
    cleaned++;

    if (batchCount >= BATCH_LIMIT) {
      await batch.commit();
      batchesCommitted++;
      console.log(
        `Committed batch ${batchesCommitted} (cleaned ${cleaned}, scanned ${scanned})`
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

  console.log("Cleanup complete.");
  console.log({
    scanned,
    cleaned,
    skipped,
    batchesCommitted,
  });
}

run().catch((error) => {
  console.error("Cleanup failed:", error);
  process.exit(1);
});
