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

const MATCH_INVITES_COLLECTION = "match_invites";
const BATCH_LIMIT = 400;

type MatchInviteDoc = {
  fromUserId?: unknown;
  toUserId?: unknown;
  participants?: unknown;
};

function asNonEmptyString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function parseArgs() {
  const args = new Set(process.argv.slice(2));
  return {
    dryRun: !args.has("--write"),
  };
}

async function run() {
  const { dryRun } = parseArgs();

  console.log("Starting match_invites participants backfill...");
  console.log("Project:", serviceAccount.project_id);
  console.log("Mode:", dryRun ? "DRY RUN" : "WRITE");

  const invitesSnap = await db.collection(MATCH_INVITES_COLLECTION).get();
  console.log(`Loaded ${invitesSnap.size} match_invites docs`);

  let scanned = 0;
  let updated = 0;
  let skippedExistingParticipants = 0;
  let skippedMissingUsers = 0;
  let batchesCommitted = 0;

  let batch = db.batch();
  let batchCount = 0;

  for (const inviteDoc of invitesSnap.docs) {
    scanned++;

    const data = (inviteDoc.data() || {}) as MatchInviteDoc;

    if (Array.isArray(data.participants) && data.participants.length > 0) {
      skippedExistingParticipants++;
      continue;
    }

    const fromUserId = asNonEmptyString(data.fromUserId);
    const toUserId = asNonEmptyString(data.toUserId);

    if (!fromUserId || !toUserId) {
      skippedMissingUsers++;
      console.log(
        `[SKIP missing user ids] inviteId=${inviteDoc.id} fromUserId=${String(
          data.fromUserId ?? ""
        )} toUserId=${String(data.toUserId ?? "")}`
      );
      continue;
    }

    const participants = Array.from(new Set([fromUserId, toUserId]));
    updated++;

    if (dryRun) {
      console.log(
        `[DRY RUN] would update inviteId=${inviteDoc.id} participants=${JSON.stringify(
          participants
        )}`
      );
      continue;
    }

    batch.set(inviteDoc.ref, { participants }, { merge: true });
    batchCount++;

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
    updated,
    skippedExistingParticipants,
    skippedMissingUsers,
    batchesCommitted,
  });
}

run().catch((error) => {
  console.error("Backfill failed:", error);
  process.exit(1);
});
