// scripts/backfillIsMatchable.cjs
const admin = require("firebase-admin");
const fs = require("fs");
const path = require("path");

// ✅ Put your service account JSON at: scripts/serviceAccountKey.json
const serviceAccountPath = path.join(__dirname, "serviceAccountKey.json");
const serviceAccount = JSON.parse(fs.readFileSync(serviceAccountPath, "utf8"));

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

const db = admin.firestore();

async function run() {
  const snap = await db.collection("players").get();

  let updated = 0;
  const batchSize = 400;

  let batch = db.batch();
  let ops = 0;

  for (const d of snap.docs) {
    const data = d.data();

    // ✅ If missing or not boolean, set to true
    if (typeof data.isMatchable !== "boolean") {
      batch.update(d.ref, { isMatchable: true });
      updated++;
      ops++;

      if (ops >= batchSize) {
        await batch.commit();
        batch = db.batch();
        ops = 0;
      }
    }
  }

  if (ops > 0) await batch.commit();

  console.log(`✅ Backfilled isMatchable=true for ${updated} player docs`);
  process.exit(0);
}

run().catch((err) => {
  console.error("❌ Backfill failed:", err);
  process.exit(1);
});
