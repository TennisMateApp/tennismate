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

type FirestoreDoc = Record<string, unknown>;

type SkipReason =
  | "missing players_private doc"
  | "missing lat"
  | "missing lng"
  | "missing geohash"
  | "missing postcode";

const REASONS: SkipReason[] = [
  "missing players_private doc",
  "missing lat",
  "missing lng",
  "missing geohash",
  "missing postcode",
];

function hasOwnValue(obj: FirestoreDoc, key: string) {
  return Object.prototype.hasOwnProperty.call(obj, key) && obj[key] !== undefined;
}

async function run() {
  console.log("Auditing skipped public-location restores...");
  console.log("Project:", serviceAccount.project_id);

  const playersSnap = await db.collection(PLAYERS_COLLECTION).get();
  console.log(`Loaded ${playersSnap.size} player docs`);

  let totalChecked = 0;
  const countByReason: Record<SkipReason, number> = {
    "missing players_private doc": 0,
    "missing lat": 0,
    "missing lng": 0,
    "missing geohash": 0,
    "missing postcode": 0,
  };

  const skipped: Array<{
    uid: string;
    name: string;
    postcode: string;
    reasons: SkipReason[];
  }> = [];

  for (const playerDoc of playersSnap.docs) {
    totalChecked++;

    const publicData = (playerDoc.data() || {}) as FirestoreDoc;
    const privateSnap = await db.collection(PLAYERS_PRIVATE_COLLECTION).doc(playerDoc.id).get();

    const reasons: SkipReason[] = [];

    if (!privateSnap.exists) {
      reasons.push("missing players_private doc");
    } else {
      const privateData = (privateSnap.data() || {}) as FirestoreDoc;

      if (!hasOwnValue(privateData, "lat")) reasons.push("missing lat");
      if (!hasOwnValue(privateData, "lng")) reasons.push("missing lng");
      if (!hasOwnValue(privateData, "geohash")) reasons.push("missing geohash");
      if (!hasOwnValue(privateData, "postcode")) reasons.push("missing postcode");
    }

    if (reasons.length === 0) continue;

    for (const reason of reasons) {
      countByReason[reason]++;
    }

    skipped.push({
      uid: playerDoc.id,
      name: typeof publicData.name === "string" ? publicData.name : "",
      postcode: typeof publicData.postcode === "string" ? publicData.postcode : "",
      reasons,
    });
  }

  console.log("");
  console.log("Audit summary:");
  console.log({ totalChecked, countByReason });

  console.log("");
  console.log("Skipped players:");
  if (skipped.length === 0) {
    console.log("None");
    return;
  }

  for (const row of skipped) {
    console.log(
      `${row.uid}\t${row.name || "(no name)"}\t${row.postcode || "(no postcode)"}\t${row.reasons.join(", ")}`
    );
  }
}

run().catch((error) => {
  console.error("Audit failed:", error);
  process.exit(1);
});
