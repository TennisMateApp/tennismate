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

const CONVERSATIONS_COLLECTION = "conversations";
const BATCH_LIMIT = 400;

type FirestoreDoc = Record<string, unknown>;

function asNonEmptyString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry) => asNonEmptyString(entry))
    .filter((entry): entry is string => !!entry);
}

function uniqueStrings(values: string[]): string[] {
  return Array.from(new Set(values.filter(Boolean)));
}

function parseArgs() {
  const args = new Set(process.argv.slice(2));
  return {
    dryRun: !args.has("--write"),
  };
}

function deriveFromConversationId(conversationId: string): string[] {
  const trimmed = conversationId.trim();
  if (!trimmed) return [];

  // Conservative: only accept a single "_" or "-" separator creating exactly two parts.
  const underscoreMatch = /^([^_]+)_([^_]+)$/.exec(trimmed);
  if (underscoreMatch) {
    const ids = uniqueStrings([
      asNonEmptyString(underscoreMatch[1]) ?? "",
      asNonEmptyString(underscoreMatch[2]) ?? "",
    ]);
    return ids.length === 2 ? ids : [];
  }

  const hyphenMatch = /^([^-]+)-([^-]+)$/.exec(trimmed);
  if (hyphenMatch) {
    const ids = uniqueStrings([
      asNonEmptyString(hyphenMatch[1]) ?? "",
      asNonEmptyString(hyphenMatch[2]) ?? "",
    ]);
    return ids.length === 2 ? ids : [];
  }

  return [];
}

function deriveFromFields(data: FirestoreDoc): string[] {
  const pairCandidates: string[] = [];

  const fromUserId = asNonEmptyString(data.fromUserId);
  const toUserId = asNonEmptyString(data.toUserId);
  if (fromUserId && toUserId) {
    pairCandidates.push(fromUserId, toUserId);
  }

  const senderId = asNonEmptyString(data.senderId);
  const receiverId = asNonEmptyString(data.receiverId);
  if (senderId && receiverId) {
    pairCandidates.push(senderId, receiverId);
  }

  const playerIds = asStringArray(data.playerIds);
  if (playerIds.length === 2) {
    pairCandidates.push(...playerIds);
  }

  const users = asStringArray(data.users);
  if (users.length === 2) {
    pairCandidates.push(...users);
  }

  const userIds = asStringArray(data.userIds);
  if (userIds.length === 2) {
    pairCandidates.push(...userIds);
  }

  const unique = uniqueStrings(pairCandidates);
  return unique.length === 2 ? unique : [];
}

function deriveParticipants(conversationId: string, data: FirestoreDoc): string[] {
  const fromFields = deriveFromFields(data);
  if (fromFields.length === 2) return fromFields;

  const fromId = deriveFromConversationId(conversationId);
  if (fromId.length === 2) return fromId;

  return [];
}

async function run() {
  const { dryRun } = parseArgs();

  console.log("Starting conversations participants backfill...");
  console.log("Project:", serviceAccount.project_id);
  console.log("Mode:", dryRun ? "DRY RUN" : "WRITE");

  const conversationsSnap = await db.collection(CONVERSATIONS_COLLECTION).get();
  console.log(`Loaded ${conversationsSnap.size} conversation docs`);

  let scanned = 0;
  let wouldUpdate = 0;
  let updated = 0;
  let skippedExistingParticipants = 0;
  let skippedCouldNotDerive = 0;
  let batchesCommitted = 0;

  let batch = db.batch();
  let batchCount = 0;

  for (const conversationDoc of conversationsSnap.docs) {
    scanned++;

    const data = (conversationDoc.data() || {}) as FirestoreDoc;
    const existingParticipants = asStringArray(data.participants);

    if (existingParticipants.length > 0) {
      skippedExistingParticipants++;
      continue;
    }

    const participants = deriveParticipants(conversationDoc.id, data);

    if (participants.length !== 2) {
      skippedCouldNotDerive++;
      console.log(`[SKIP could not derive] conversationId=${conversationDoc.id}`);
      continue;
    }

    if (dryRun) {
      wouldUpdate++;
      console.log(
        `[DRY RUN] would update conversationId=${conversationDoc.id} participants=${JSON.stringify(
          participants
        )}`
      );
      continue;
    }

    batch.set(conversationDoc.ref, { participants }, { merge: true });
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

  if (!dryRun && batchCount > 0) {
    await batch.commit();
    batchesCommitted++;
    console.log(`Committed final batch ${batchesCommitted}`);
  }

  console.log("Backfill complete.");
  console.log({
    mode: dryRun ? "dry-run" : "write",
    scanned,
    wouldUpdate,
    updated,
    skippedExistingParticipants,
    skippedCouldNotDerive,
    batchesCommitted,
  });
}

run().catch((error) => {
  console.error("Backfill failed:", error);
  process.exit(1);
});
