const admin = require("firebase-admin");
const ExcelJS = require("exceljs");
const fs = require("node:fs");
const path = require("node:path");

const COLLECTION = "match_invites";
const EXCEL_CELL_LIMIT = 32767;

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

  if (typeof value?.path === "string" && value?.firestore) {
    return value.path;
  }

  if (
    typeof value?.latitude === "number" &&
    typeof value?.longitude === "number"
  ) {
    return {
      latitude: value.latitude,
      longitude: value.longitude,
    };
  }

  if (Buffer.isBuffer(value) || value instanceof Uint8Array) {
    return Buffer.from(value).toString("base64");
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

function flattenForSpreadsheet(value, prefix = "", result = {}) {
  if (value == null || typeof value !== "object") {
    result[prefix] = value;
    return result;
  }

  if (Array.isArray(value)) {
    result[prefix] = JSON.stringify(value);
    return result;
  }

  const entries = Object.entries(value);
  if (entries.length === 0) {
    result[prefix] = "{}";
    return result;
  }

  for (const [key, nestedValue] of entries) {
    const fieldPath = prefix ? `${prefix}.${key}` : key;
    flattenForSpreadsheet(nestedValue, fieldPath, result);
  }

  return result;
}

function valueType(value) {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  return typeof value;
}

function appendLongFormFields(rows, docId, documentPath, value, fieldPath = "") {
  if (value != null && typeof value === "object") {
    const entries = Array.isArray(value)
      ? value.map((item, index) => [`[${index}]`, item])
      : Object.entries(value);

    if (entries.length > 0) {
      for (const [key, nestedValue] of entries) {
        const separator = String(key).startsWith("[") ? "" : fieldPath ? "." : "";
        appendLongFormFields(
          rows,
          docId,
          documentPath,
          nestedValue,
          `${fieldPath}${separator}${key}`
        );
      }
      return;
    }
  }

  const text =
    value == null
      ? value === null
        ? "null"
        : ""
      : typeof value === "string"
        ? value
        : JSON.stringify(value);
  const chunks = String(text).match(new RegExp(`.{1,${EXCEL_CELL_LIMIT}}`, "gs")) || [""];

  chunks.forEach((chunk, index) => {
    rows.push({
      id: docId,
      path: documentPath,
      fieldPath: fieldPath || "(document)",
      valueType: valueType(value),
      chunk: index + 1,
      chunks: chunks.length,
      value: chunk,
    });
  });
}

function safeExcelValue(value) {
  if (value == null) return "";
  const text = typeof value === "string" ? value : String(value);
  if (text.length <= EXCEL_CELL_LIMIT) return value;
  return `${text.slice(0, EXCEL_CELL_LIMIT - 21)}...[see All Fields]`;
}

function styleHeader(row) {
  row.font = { bold: true, color: { argb: "FFFFFFFF" } };
  row.fill = {
    type: "pattern",
    pattern: "solid",
    fgColor: { argb: "FF1F4E78" },
  };
  row.alignment = { vertical: "middle" };
}

function extractCourtInfo(row) {
  const invite = row.invite && typeof row.invite === "object" ? row.invite : {};
  const nestedCourt =
    invite.court && typeof invite.court === "object" ? invite.court : {};
  const hasStructuredCourt = Boolean(
    nestedCourt.id || nestedCourt.name || row.courtId || row.courtName
  );

  return {
    "court.id": nestedCourt.id || row.courtId || "",
    "court.name":
      nestedCourt.name || row.courtName || invite.location || row.location || "",
    "court.address": nestedCourt.address || row.courtAddress || "",
    "court.suburb": nestedCourt.suburb || row.courtSuburb || "",
    "court.state": nestedCourt.state || row.courtState || "",
    "court.postcode": nestedCourt.postcode || row.courtPostcode || "",
    "court.bookingUrl": nestedCourt.bookingUrl || row.courtBookingUrl || "",
    "court.latitude": nestedCourt.lat ?? row.courtLat ?? "",
    "court.longitude": nestedCourt.lng ?? row.courtLng ?? "",
    "court.locationText": invite.location || row.location || "",
    "court.dataSource": hasStructuredCourt ? "structured court" : "free-text location",
  };
}

async function writeWorkbook(filePath, rows, exportedAt) {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "TennisMate Firestore export";
  workbook.created = new Date(exportedAt);

  const info = workbook.addWorksheet("Export Info");
  info.addRows([
    ["Property", "Value"],
    ["Collection", COLLECTION],
    ["Exported at (UTC)", exportedAt],
    ["Document count", rows.length],
    ["Read only", "Yes - no Firestore data was changed"],
  ]);
  styleHeader(info.getRow(1));
  info.columns = [{ width: 24 }, { width: 48 }];

  const flattenedRows = rows.map((row) => ({
    ...extractCourtInfo(row),
    ...flattenForSpreadsheet(row),
  }));
  const preferredColumns = [
    "id",
    "path",
    "createdAt",
    "updatedAt",
    "inviteStatus",
    "invite.startISO",
    "court.id",
    "court.name",
    "court.address",
    "court.suburb",
    "court.state",
    "court.postcode",
    "court.bookingUrl",
    "court.latitude",
    "court.longitude",
    "court.locationText",
    "court.dataSource",
  ];
  const discoveredColumns = [...new Set(flattenedRows.flatMap((row) => Object.keys(row)))];
  const columns = [
    ...preferredColumns.filter((column) => discoveredColumns.includes(column)),
    ...discoveredColumns
      .filter((column) => !preferredColumns.includes(column))
      .sort((a, b) => a.localeCompare(b)),
  ];

  const wide = workbook.addWorksheet("Match Invites", {
    views: [{ state: "frozen", ySplit: 1, xSplit: Math.min(2, columns.length) }],
  });
  wide.columns = columns.map((key) => ({
    header: key,
    key,
    width: Math.min(45, Math.max(12, key.length + 2)),
  }));
  for (const row of flattenedRows) {
    wide.addRow(Object.fromEntries(columns.map((key) => [key, safeExcelValue(row[key])])));
  }
  if (columns.length > 0) {
    styleHeader(wide.getRow(1));
    wide.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: columns.length } };
  }

  const courtSheet = workbook.addWorksheet("Court Information", {
    views: [{ state: "frozen", ySplit: 1, xSplit: 2 }],
  });
  const courtColumns = [
    ["inviteId", "inviteId", 28],
    ["inviteStatus", "inviteStatus", 16],
    ["startISO", "startISO", 25],
    ["fromUserId", "fromUserId", 30],
    ["toUserId", "toUserId", 30],
    ["courtId", "court.id", 34],
    ["courtName", "court.name", 34],
    ["address", "court.address", 46],
    ["suburb", "court.suburb", 24],
    ["state", "court.state", 12],
    ["postcode", "court.postcode", 12],
    ["bookingUrl", "court.bookingUrl", 46],
    ["latitude", "court.latitude", 14],
    ["longitude", "court.longitude", 14],
    ["locationText", "court.locationText", 34],
    ["dataSource", "court.dataSource", 20],
  ];
  courtSheet.columns = courtColumns.map(([header, key, width]) => ({
    header,
    key,
    width,
  }));
  courtSheet.addRows(
    rows.map((row) => {
      const court = extractCourtInfo(row);
      return {
        inviteId: row.id,
        inviteStatus: row.inviteStatus || "",
        startISO: row.invite?.startISO || row.startISO || "",
        fromUserId: row.fromUserId || row.senderId || "",
        toUserId: row.toUserId || row.receiverId || "",
        ...Object.fromEntries(courtColumns.slice(5).map(([, key]) => [key, court[key]])),
      };
    })
  );
  styleHeader(courtSheet.getRow(1));
  courtSheet.autoFilter = `A1:P1`;

  const longRows = [];
  for (const row of rows) {
    const { id, path: documentPath, ...data } = row;
    appendLongFormFields(longRows, id, documentPath, data);
  }

  const allFields = workbook.addWorksheet("All Fields", {
    views: [{ state: "frozen", ySplit: 1, xSplit: 2 }],
  });
  allFields.columns = [
    { header: "id", key: "id", width: 28 },
    { header: "path", key: "path", width: 40 },
    { header: "fieldPath", key: "fieldPath", width: 42 },
    { header: "valueType", key: "valueType", width: 14 },
    { header: "chunk", key: "chunk", width: 10 },
    { header: "chunks", key: "chunks", width: 10 },
    { header: "value", key: "value", width: 60 },
  ];
  allFields.addRows(longRows);
  styleHeader(allFields.getRow(1));
  allFields.autoFilter = "A1:G1";
  allFields.getColumn("value").alignment = { wrapText: true, vertical: "top" };

  await workbook.xlsx.writeFile(filePath);
}

admin.initializeApp({
  credential: admin.credential.cert(loadServiceAccount()),
});

const db = admin.firestore();

async function main() {
  console.log(`Exporting ${COLLECTION}...`);

  const snap = await db.collection(COLLECTION).get();
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
  const excelPath = path.join(exportDir, `match-invites-${stamp}.xlsx`);
  const exportedAt = new Date().toISOString();

  fs.writeFileSync(
    jsonPath,
    `${JSON.stringify(
      {
        exportedAt,
        collection: COLLECTION,
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
  await writeWorkbook(excelPath, rows, exportedAt);

  console.log(`Exported ${rows.length} ${COLLECTION} documents.`);
  console.log(`Excel written to ${excelPath}`);
  console.log(`JSON written to ${jsonPath}`);
  console.log(`CSV written to ${csvPath}`);
  console.log("Read-only export. No Firebase data was changed.");
}

main().catch((error) => {
  console.error("Failed to export match_invites:", error);
  process.exitCode = 1;
});
