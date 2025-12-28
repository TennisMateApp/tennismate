console.log("✅ import-postcodes.js started");

const admin = require("firebase-admin");
const fs = require("fs");
const path = require("path");
const csv = require("csv-parser");

// ✅ Update these if your paths differ
const SERVICE_ACCOUNT_PATH = path.join(__dirname, "serviceAccountKey.json");
const CSV_PATH = path.join(__dirname, "data", "australian_postcodes.csv");


// ✅ If you want to import only some states first, set this:
// const ONLY_STATES = new Set(["VIC", "NSW"]);
const ONLY_STATES = null;

if (!fs.existsSync(SERVICE_ACCOUNT_PATH)) {
  throw new Error(`Missing service account key: ${SERVICE_ACCOUNT_PATH}`);
}

admin.initializeApp({
  credential: admin.credential.cert(require(SERVICE_ACCOUNT_PATH)),
});

const db = admin.firestore();

function pick(row, keys) {
  for (const k of keys) {
    if (row[k] != null && String(row[k]).trim() !== "") return row[k];
  }
  return null;
}

async function run() {
  console.log("CSV path:", CSV_PATH);

  if (!fs.existsSync(CSV_PATH)) {
    throw new Error(`CSV not found at: ${CSV_PATH}`);
  }

  const rows = [];
  await new Promise((resolve, reject) => {
    fs.createReadStream(CSV_PATH)
      .pipe(csv())
      .on("data", (row) => rows.push(row))
      .on("end", resolve)
      .on("error", reject);
  });

  console.log(`Loaded ${rows.length} CSV rows`);

  const byPostcode = new Map();

  for (const row of rows) {
    const postcodeRaw = pick(row, ["postcode", "postal_code", "Postcode", "POSTCODE"]);
    const stateRaw = pick(row, ["state", "State", "STATE"]);
    const latRaw = pick(row, ["lat", "latitude", "Latitude", "LAT"]);
    const lngRaw = pick(row, ["lng", "lon", "longitude", "Longitude", "LNG", "LONG"]);

    const postcode = postcodeRaw ? String(postcodeRaw).trim() : "";
    const state = stateRaw ? String(stateRaw).trim().toUpperCase() : "";

    if (!postcode) continue;
    if (ONLY_STATES && state && !ONLY_STATES.has(state)) continue;

    const lat = latRaw != null ? Number(String(latRaw).trim()) : NaN;
    const lng = lngRaw != null ? Number(String(lngRaw).trim()) : NaN;

    if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;

    if (!byPostcode.has(postcode)) {
      byPostcode.set(postcode, { postcode, lat, lng, state });
    }
  }

  const items = Array.from(byPostcode.values());
  console.log(`Prepared ${items.length} unique postcodes to write`);

  const BATCH_SIZE = 500;
  let written = 0;

  for (let i = 0; i < items.length; i += BATCH_SIZE) {
    const batch = db.batch();
    const chunk = items.slice(i, i + BATCH_SIZE);

    for (const item of chunk) {
      const ref = db.collection("postcodes").doc(item.postcode);

      batch.set(
        ref,
        {
          postcode: item.postcode,
          lat: item.lat,
          lng: item.lng,
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        },
        { merge: true }
      );
    }

    await batch.commit();
    written += chunk.length;
    console.log(`Committed ${written}/${items.length}`);
  }

  console.log("✅ Done. Postcodes imported/merged successfully.");
}

run().catch((e) => {
  console.error("❌ Import failed:", e);
  process.exit(1);
});
