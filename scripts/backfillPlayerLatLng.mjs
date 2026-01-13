import admin from "firebase-admin";
import { geohashForLocation } from "geofire-common";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

// ✅ Resolve the scripts folder reliably (no matter where you run node from)
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ✅ Use the ACTUAL filename you have in /scripts
const SERVICE_ACCOUNT_FILENAME = "serviceAccountKey.json"; // <-- change if needed
const serviceAccountPath = path.join(__dirname, SERVICE_ACCOUNT_FILENAME);

// ✅ Helpful error if file name/path is wrong
if (!fs.existsSync(serviceAccountPath)) {
  console.error("❌ Service account file not found at:", serviceAccountPath);
  console.error("➡️ Check the filename in /scripts and update SERVICE_ACCOUNT_FILENAME.");
  process.exit(1);
}

const serviceAccount = JSON.parse(fs.readFileSync(serviceAccountPath, "utf8"));

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

const db = admin.firestore();

// --- rest of your script below (unchanged) ---
const PLAYERS = "players";
const POSTCODES = "postcodes";

const BATCH_SIZE = 450; // keep under 500 writes/batch
const DRY_RUN = false;  // set true first if you want

const isNumber = (x) => typeof x === "number" && Number.isFinite(x);

// ... keep everything else exactly the same ...


async function run() {
  console.log("Backfill players lat/lng starting...");

  // 1) Load all players (hundreds = fine)
  const playersSnap = await db.collection(PLAYERS).get();
  console.log(`Players loaded: ${playersSnap.size}`);

  // 2) Build a set of postcodes we actually need
  const neededPostcodes = new Set();
  const candidates = [];

  playersSnap.forEach((docSnap) => {
    const d = docSnap.data();
    const hasLatLng = isNumber(d.lat) && isNumber(d.lng);

    if (hasLatLng) return;

    const postcode = (d.postcode || "").toString().trim();
    if (!postcode) return;

    neededPostcodes.add(postcode);
    candidates.push({ ref: docSnap.ref, postcode });
  });

  console.log(
    `Candidates missing lat/lng: ${candidates.length} (unique postcodes needed: ${neededPostcodes.size})`
  );

  // 3) Fetch each required postcode doc ONCE and cache it
  const postcodeCache = new Map(); // postcode -> {lat,lng} | null

  for (const pc of neededPostcodes) {
    const pcSnap = await db.collection(POSTCODES).doc(pc).get();
    if (!pcSnap.exists) {
      postcodeCache.set(pc, null);
      continue;
    }
    const data = pcSnap.data() || {};
    if (!isNumber(data.lat) || !isNumber(data.lng)) {
      postcodeCache.set(pc, null);
      continue;
    }
    postcodeCache.set(pc, { lat: data.lat, lng: data.lng });
  }

  // 4) Prepare updates
  const updates = [];
  let noCoords = 0;

  for (const c of candidates) {
    const coords = postcodeCache.get(c.postcode);
    if (!coords) {
      noCoords++;
      continue;
    }

    const { lat, lng } = coords;
    const geohash = geohashForLocation([lat, lng]);

    updates.push({
      ref: c.ref,
      data: { lat, lng, geohash },
    });
  }

  console.log(
    `Ready to update: ${updates.length} players. Missing postcode coords: ${noCoords}`
  );

  // 5) Write in batches
  if (DRY_RUN) {
    console.log("[DRY RUN] No writes performed.");
    return;
  }

  let written = 0;
  for (let i = 0; i < updates.length; i += BATCH_SIZE) {
    const chunk = updates.slice(i, i + BATCH_SIZE);
    const batch = db.batch();

    for (const u of chunk) {
      batch.set(u.ref, u.data, { merge: true });
    }

    await batch.commit();
    written += chunk.length;

    console.log(
      `Committed batch ${i / BATCH_SIZE + 1}/${Math.ceil(
        updates.length / BATCH_SIZE
      )} (written so far: ${written})`
    );
  }

  console.log("✅ Done. Total updated:", written);
}

run().catch((e) => {
  console.error("❌ Backfill failed:", e);
  process.exit(1);
});
