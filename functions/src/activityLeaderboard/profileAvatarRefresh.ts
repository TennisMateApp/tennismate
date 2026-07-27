/* eslint-disable max-len, require-jsdoc */
import {onDocumentUpdated} from "firebase-functions/v2/firestore";
import {admin, FieldValue} from "./adminSdk";
import {monthKeyFor} from "./dateUtils";

const PROFILE_AVATAR_REFRESH_REASON = "PROFILE_AVATAR_UPDATED";
const REASON_LIMIT = 20;

type ProfilePhotoFields = {
  photoURL?: unknown;
  photoThumbURL?: unknown;
};

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

export function isSuccessfulProfilePhotoUpdate(
  before: ProfilePhotoFields | null | undefined,
  after: ProfilePhotoFields | null | undefined,
): boolean {
  const nextFull = text(after?.photoURL);
  const nextThumb = text(after?.photoThumbURL);
  if (!nextFull || !nextThumb) return false;
  return nextFull !== text(before?.photoURL) || nextThumb !== text(before?.photoThumbURL);
}

export function currentActivityMonth(now = new Date()): string {
  return monthKeyFor(now);
}

export async function queueCurrentActivityMonthForAvatarRefresh(
  db: FirebaseFirestore.Firestore,
  now = new Date(),
): Promise<{monthKey: string; queued: boolean}> {
  const monthKey = currentActivityMonth(now);
  const requestRef = db.collection("activity_recalculation_requests").doc(monthKey);
  let queued = false;
  await db.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(requestRef);
    const existing = snapshot.data() || {};
    const reasons = [...new Set([
      ...(Array.isArray(existing.reasons) ? existing.reasons.filter((item): item is string => typeof item === "string") : []),
      PROFILE_AVATAR_REFRESH_REASON,
    ])].sort().slice(0, REASON_LIMIT);
    if (existing.status === "pending" && reasons.includes(PROFILE_AVATAR_REFRESH_REASON)) return;
    transaction.set(requestRef, {
      monthKey,
      status: "pending",
      reasons,
      sourceEventIds: Array.isArray(existing.sourceEventIds) ? existing.sourceEventIds : [],
      requestedAt: existing.requestedAt || FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    }, {merge: false});
    queued = true;
  });
  return {monthKey, queued};
}

export async function handleProfilePhotoUpdate(
  before: ProfilePhotoFields | null | undefined,
  after: ProfilePhotoFields | null | undefined,
  queue: () => Promise<{monthKey: string; queued: boolean}> = () =>
    queueCurrentActivityMonthForAvatarRefresh(admin.firestore()),
): Promise<"ignored" | "queued" | "failed"> {
  if (!isSuccessfulProfilePhotoUpdate(before, after)) return "ignored";
  try {
    const result = await queue();
    console.log("[activity_leaderboard] profile avatar refresh requested", result);
    return "queued";
  } catch (error) {
    console.error("[activity_leaderboard] profile avatar refresh request failed", {
      monthKey: currentActivityMonth(),
      errorCategory: error instanceof Error ? error.name : "UNKNOWN",
    });
    return "failed";
  }
}

export const refreshActivityAvatarOnPlayerPhotoUpdate = onDocumentUpdated(
  {document: "players/{uid}", region: "australia-southeast2"},
  async (event) => {
    const before = event.data?.before.data() as ProfilePhotoFields | undefined;
    const after = event.data?.after.data() as ProfilePhotoFields | undefined;
    // Profile persistence has already succeeded. This best-effort handler never
    // throws, so an Activity queue outage cannot undo or retry the photo write.
    await handleProfilePhotoUpdate(before, after);
  },
);
