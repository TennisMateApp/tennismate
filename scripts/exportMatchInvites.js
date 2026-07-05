const admin = require("firebase-admin");
const fs = require("node:fs");
const path = require("node:path");

function loadServiceAccount() {
  const candidates = [
    "../serviceAccountKey.json",
    "./serviceAccountKey.json",
    "./scripts/serviceAccountKey.json",
  ];

  for (const candidate of candidates) {
    try {
      return require(candidate);
    } catch (error) {
      if (error?.code !== "MODULE_NOT_FOUND") throw error;
    }
  }

  throw new Error(
    "Could not find serviceAccountKey.json. Tried project root and scripts directory."
  );
}

function timestampForFilename() {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

function serializeFirestoreValue(value) {
  if (value == null) return value;

  if (typeof value?.toDate === "function") {
    return value.toDate().toISOString();
  }

  if (Array.isArray(value)) {
    return value.map(serializeFirestoreValue);
  }

  if (typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, nestedValue]) => [
        key,
        serializeFirestoreValue(nestedValue),
      ])
    );
  }

  return value;
}

function csvEscape(value) {
  const text = value == null ? "" : String(value);
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function getFirst(value, fallback = "") {
  return value == null ? fallback : value;
}

admin.initializeApp({
  credential: admin.credential.cert(loadServiceAccount()),
});

const db = admin.firestore();

async function main() {
  console.log("Exporting match_invites...");

  const snap = await db.collection("match_invites").get();
  const rows = snap.docs.map((doc) => {
    const data = serializeFirestoreValue(doc.data() || {});
    return {
      id: doc.id,
      path: doc.ref.path,
      ...data,
    };
  });

  rows.sort((a, b) => {
    const aTime = String(a.createdAt || a.timestamp || a.updatedAt || "");
    const bTime = String(b.createdAt || b.timestamp || b.updatedAt || "");
    return bTime.localeCompare(aTime) || a.id.localeCompare(b.id);
  });

  const exportDir = path.join(process.cwd(), "exports");
  fs.mkdirSync(exportDir, { recursive: true });

  const stamp = timestampForFilename();
  const jsonPath = path.join(exportDir, `match-invites-${stamp}.json`);
  const csvPath = path.join(exportDir, `match-invites-${stamp}.csv`);

  fs.writeFileSync(
    jsonPath,
    `${JSON.stringify(
      {
        exportedAt: new Date().toISOString(),
        collection: "match_invites",
        count: rows.length,
        rows,
      },
      null,
      2
    )}\n`,
    "utf8"
  );

  const csvHeaders = [
    "id",
    "fromUserId",
    "toUserId",
    "senderId",
    "receiverId",
    "status",
    "createdAt",
    "timestamp",
    "updatedAt",
    "conversationId",
    "relationshipRefPath",
  ];
  const csv = [
    csvHeaders.join(","),
    ...rows.map((row) =>
      csvHeaders.map((header) => csvEscape(getFirst(row[header]))).join(",")
    ),
  ].join("\n");

  fs.writeFileSync(csvPath, `${csv}\n`, "utf8");

  console.log(`Exported ${rows.length} match_invites.`);
  console.log(`JSON written to ${jsonPath}`);
  console.log(`CSV written to ${csvPath}`);
  console.log("Read-only export. No Firebase data was changed.");
}

main().catch((error) => {
  console.error("Failed to export match_invites:", error);
  process.exitCode = 1;
});
