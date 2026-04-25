import { cert, initializeApp } from "firebase-admin/app";
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
const APPLY = process.argv.includes("--apply");
const DRY_RUN = !APPLY;
const BATCH_LIMIT = 400;

function chunk<T>(values: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < values.length; i += size) {
    chunks.push(values.slice(i, i + size));
  }
  return chunks;
}

async function deleteRefsInBatches(refs: FirebaseFirestore.DocumentReference[]) {
  const uniqueRefs = Array.from(new Map(refs.map((ref) => [ref.path, ref])).values());
  for (const refChunk of chunk(uniqueRefs, BATCH_LIMIT)) {
    const batch = db.batch();
    refChunk.forEach((ref) => batch.delete(ref));
    await batch.commit();
  }
  return uniqueRefs.length;
}

async function deleteConversationDeep(conversationId: string) {
  const convoRef = db.collection("conversations").doc(conversationId);
  if (typeof (db as any).recursiveDelete === "function") {
    const messagesSnap = await convoRef.collection("messages").get();
    await (db as any).recursiveDelete(convoRef);
    return messagesSnap.size;
  }

  console.warn(
    `[cleanupOrphanedConversations] recursiveDelete unavailable; falling back to direct messages-only cleanup for ${conversationId}`
  );

  const messagesRef = convoRef.collection("messages");
  let deletedMessages = 0;

  while (true) {
    const snap = await messagesRef.limit(BATCH_LIMIT).get();
    if (snap.empty) break;
    deletedMessages += snap.size;

    const batch = db.batch();
    snap.docs.forEach((docSnap) => batch.delete(docSnap.ref));
    await batch.commit();
  }

  await convoRef.delete().catch(() => {});
  return deletedMessages;
}

async function getMissingParticipantStatus(
  uid: string,
  cache: Map<string, boolean>
): Promise<boolean> {
  if (cache.has(uid)) return cache.get(uid)!;

  const [userSnap, playerSnap] = await Promise.all([
    db.collection("users").doc(uid).get(),
    db.collection("players").doc(uid).get(),
  ]);

  const missing = !userSnap.exists && !playerSnap.exists;
  cache.set(uid, missing);
  return missing;
}

async function run() {
  console.log("Starting orphaned conversation cleanup...");
  console.log("Project:", serviceAccount.project_id);
  console.log("Mode:", DRY_RUN ? "DRY RUN" : "APPLY");

  const participantMissingCache = new Map<string, boolean>();
  const inviteRefsHandled = new Set<string>();

  let scannedConversations = 0;
  let orphanedConversations = 0;
  let deletedConversations = 0;
  let deletedMessages = 0;
  let deletedConversationInvites = 0;
  let skippedSharedConversations = 0;
  let scannedInvites = 0;
  let orphanedStandaloneInvites = 0;
  let deletedStandaloneInvites = 0;

  const conversationSnap = await db.collection("conversations").get();
  console.log(`Loaded ${conversationSnap.size} conversations`);

  for (const convoDoc of conversationSnap.docs) {
    scannedConversations++;

    const data = convoDoc.data() as { participants?: unknown };
    const participants = Array.isArray(data.participants)
      ? data.participants.filter((value): value is string => typeof value === "string" && !!value)
      : [];

    const missingParticipants: string[] = [];
    for (const participantUid of participants) {
      if (await getMissingParticipantStatus(participantUid, participantMissingCache)) {
        missingParticipants.push(participantUid);
      }
    }

    if (!missingParticipants.length) continue;

    orphanedConversations++;

    if (participants.length !== 2) {
      skippedSharedConversations++;
      console.log("[skipped-shared-conversation]", {
        conversationId: convoDoc.id,
        participants,
        missingParticipants,
      });
      continue;
    }

    const messagesSnap = await convoDoc.ref.collection("messages").get();
    const invitesSnap = await db
      .collection("match_invites")
      .where("conversationId", "==", convoDoc.id)
      .get();

    console.log("[orphaned-conversation]", {
      conversationId: convoDoc.id,
      participants,
      missingParticipants,
      messages: messagesSnap.size,
      relatedInvites: invitesSnap.size,
    });

    invitesSnap.docs.forEach((docSnap) => inviteRefsHandled.add(docSnap.ref.path));

    if (DRY_RUN) continue;

    deletedMessages += await deleteConversationDeep(convoDoc.id);
    deletedConversations++;
    deletedConversationInvites += await deleteRefsInBatches(invitesSnap.docs.map((docSnap) => docSnap.ref));
  }

  const inviteSnap = await db.collection("match_invites").get();
  console.log(`Loaded ${inviteSnap.size} match_invites`);

  for (const inviteDoc of inviteSnap.docs) {
    scannedInvites++;
    if (inviteRefsHandled.has(inviteDoc.ref.path)) continue;

    const data = inviteDoc.data() as {
      fromUserId?: unknown;
      toUserId?: unknown;
      conversationId?: unknown;
    };

    const participantUids = [data.fromUserId, data.toUserId].filter(
      (value): value is string => typeof value === "string" && !!value
    );

    const missingParticipants: string[] = [];
    for (const participantUid of participantUids) {
      if (await getMissingParticipantStatus(participantUid, participantMissingCache)) {
        missingParticipants.push(participantUid);
      }
    }

    if (!missingParticipants.length) continue;

    orphanedStandaloneInvites++;
    console.log("[orphaned-invite]", {
      inviteId: inviteDoc.id,
      conversationId:
        typeof data.conversationId === "string" ? data.conversationId : null,
      participants: participantUids,
      missingParticipants,
    });

    if (DRY_RUN) continue;

    await inviteDoc.ref.delete();
    deletedStandaloneInvites++;
  }

  console.log("Cleanup complete.");
  console.log({
    dryRun: DRY_RUN,
    scannedConversations,
    orphanedConversations,
    deletedConversations,
    deletedMessages,
    deletedConversationInvites,
    skippedSharedConversations,
    scannedInvites,
    orphanedStandaloneInvites,
    deletedStandaloneInvites,
  });
}

run().catch((error) => {
  console.error("Cleanup failed:", error);
  process.exit(1);
});
