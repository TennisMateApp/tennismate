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
const PLAYERS_PRIVATE_COLLECTION = "players_private";
const BATCH_LIMIT = 400;
const FIELDS_TO_COPY = [
  "email",
  "postcode",
  "birthYear",
  "lat",
  "lng",
  "geohash",
] as const;

type CopyField = (typeof FIELDS_TO_COPY)[number];
type FirestoreDoc = Record<string, unknown>;

function hasOwnValue(obj: FirestoreDoc, key: string) {
  return Object.prototype.hasOwnProperty.call(obj, key) && obj[key] !== undefined;
}

async function run() {
  console.log("Starting players -> players_private migration...");
  console.log("Project:", serviceAccount.project_id);

  const playersSnap = await db.collection(PLAYERS_COLLECTION).get();
  console.log(`Loaded ${playersSnap.size} player docs`);

  let scanned = 0;
  let created = 0;
  let updated = 0;
  let skipped = 0;
  let writesQueued = 0;
  let batchesCommitted = 0;

  let batch = db.batch();
  let batchCount = 0;

  for (const playerDoc of playersSnap.docs) {
    scanned++;

    const playerData = (playerDoc.data() || {}) as FirestoreDoc;
    const privateRef = db.collection(PLAYERS_PRIVATE_COLLECTION).doc(playerDoc.id);
    const privateSnap = await privateRef.get();
    const privateData = (privateSnap.exists ? privateSnap.data() : {}) as FirestoreDoc;

    const payload: FirestoreDoc = {};

    for (const field of FIELDS_TO_COPY) {
      if (hasOwnValue(privateData, field)) continue;
      if (!hasOwnValue(playerData, field)) continue;
      payload[field] = playerData[field];
    }

    const needsMigratedAt = !hasOwnValue(privateData, "migratedAt");
    const hasFieldCopies = Object.keys(payload).length > 0;

    if (!hasFieldCopies && !needsMigratedAt) {
      skipped++;
      continue;
    }

    payload.migratedAt = FieldValue.serverTimestamp();
    payload.updatedAt = FieldValue.serverTimestamp();

    batch.set(privateRef, payload, { merge: true });
    batchCount++;
    writesQueued++;

    if (privateSnap.exists) {
      updated++;
    } else {
      created++;
    }

    if (batchCount >= BATCH_LIMIT) {
      await batch.commit();
      batchesCommitted++;
      console.log(
        `Committed batch ${batchesCommitted} (${writesQueued} writes queued so far, scanned ${scanned})`
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

  console.log("Migration complete.");
  console.log({
    scanned,
    created,
    updated,
    skipped,
    writesQueued,
    batchesCommitted,
  });
}

run().catch((error) => {
  console.error("Migration failed:", error);
  process.exit(1);
});
