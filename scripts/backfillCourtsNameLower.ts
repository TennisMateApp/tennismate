import { initializeApp, cert } from "firebase-admin/app";
import { getFirestore, FieldValue } from "firebase-admin/firestore";
import { readFileSync } from "node:fs";

const serviceAccount = JSON.parse(readFileSync("./serviceAccountKey.json", "utf8"));

initializeApp({
  credential: cert(serviceAccount),
});

const db = getFirestore();

function buildPrefixes(nameLower: string, maxLen = 30) {
  const s = nameLower.trim().replace(/\s+/g, " ");
  const out: string[] = [];
  for (let i = 1; i <= Math.min(s.length, maxLen); i++) {
    out.push(s.slice(0, i));
  }
  return out;
}

async function run() {
  const courtsRef = db.collection("courts");

  let updated = 0;
  let scanned = 0;

  // Stream all docs (works fine for a few thousand)
  const snap = await courtsRef.get();

  let batch = db.batch();
  let batchCount = 0;

  for (const docSnap of snap.docs) {
    scanned++;
    const data = docSnap.data() as any;

    const name = (data?.name ?? "").toString().trim();
    if (!name) continue;

    const nameLower = name.toLowerCase();

    // Only update if missing or wrong (saves writes)
    const needsNameLower = data.nameLower !== nameLower;

    // OPTIONAL: only if you want prefix arrays
    const prefixes = buildPrefixes(nameLower);
    const needsPrefixes =
      !Array.isArray(data.namePrefixes) || data.namePrefixes?.[data.namePrefixes.length - 1] !== prefixes[prefixes.length - 1];

    if (!needsNameLower && !needsPrefixes) continue;

    const updatePayload: Record<string, any> = {
      updatedAt: FieldValue.serverTimestamp(),
    };
    if (needsNameLower) updatePayload.nameLower = nameLower;
    if (needsPrefixes) updatePayload.namePrefixes = prefixes;

    batch.update(docSnap.ref, updatePayload);
    batchCount++;
    updated++;

    if (batchCount >= 450) {
      await batch.commit();
      batch = db.batch();
      batchCount = 0;
      console.log(`Committed 450 updates... (scanned ${scanned}, updated ${updated})`);
    }
  }

  if (batchCount > 0) {
    await batch.commit();
  }

  console.log(`Done. Scanned: ${scanned}, Updated: ${updated}`);
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});