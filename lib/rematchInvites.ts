"use client";

import { db } from "@/lib/firebaseConfig";
import {
  addDoc,
  collection,
  doc,
  getDoc,
  getDocs,
  limit,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
} from "firebase/firestore";

type InviteCourt = {
  id?: string | null;
  name?: string | null;
  address?: string | null;
  suburb?: string | null;
  state?: string | null;
  postcode?: string | null;
  bookingUrl?: string | null;
  lat?: number | null;
  lng?: number | null;
};

type InvitePayload = {
  startISO?: string | null;
  durationMins?: number | null;
  location?: string | null;
  note?: string | null;
  court?: InviteCourt | null;
};

type MatchInviteDoc = {
  conversationId?: string | null;
  fromUserId?: string | null;
  toUserId?: string | null;
  inviteStatus?: string | null;
  invite?: InvitePayload | null;
  inviteStart?: string | null;
  courtName?: string | null;
  location?: string | null;
  type?: string | null;
  source?: string | null;
  previousInviteId?: string | null;
  rematchPromptShownTo?: Record<string, unknown> | null;
  rematchPromptDismissedTo?: Record<string, unknown> | null;
};

export type RematchPrefill = {
  previousInviteId: string;
  conversationId: string;
  fromUserId: string;
  toUserId: string;
  opponentId: string;
  startISO: string;
  location: string;
  courtName: string | null;
  courtId: string | null;
  durationMins: number;
  note: string;
  court: InviteCourt | null;
};

function asInviteDoc(data: unknown): MatchInviteDoc {
  return (data || {}) as MatchInviteDoc;
}

function getInvitePayload(data: MatchInviteDoc): InvitePayload {
  return (data.invite || {}) as InvitePayload;
}

function getStartISO(data: MatchInviteDoc): string | null {
  const invite = getInvitePayload(data);
  return typeof invite.startISO === "string" && invite.startISO
    ? invite.startISO
    : typeof data.inviteStart === "string" && data.inviteStart
    ? data.inviteStart
    : null;
}

function getDurationMins(data: MatchInviteDoc): number {
  const invite = getInvitePayload(data);
  return typeof invite.durationMins === "number" && Number.isFinite(invite.durationMins)
    ? invite.durationMins
    : 60;
}

function getLocation(data: MatchInviteDoc): string {
  const invite = getInvitePayload(data);
  if (typeof invite.location === "string" && invite.location.trim()) {
    return invite.location.trim();
  }
  if (typeof data.location === "string" && data.location.trim()) {
    return data.location.trim();
  }
  return "";
}

function getCourt(data: MatchInviteDoc): InviteCourt | null {
  const invite = getInvitePayload(data);
  const court = invite.court;
  return court && typeof court === "object" ? court : null;
}

function hasMapValue(map: Record<string, unknown> | null | undefined, key: string) {
  return !!(map && Object.prototype.hasOwnProperty.call(map, key) && map[key] != null);
}

function addWeek(startISO: string): string {
  const d = new Date(startISO);
  d.setDate(d.getDate() + 7);
  return d.toISOString();
}

function defaultRematchNote() {
  return "Up for the same time next week?";
}

async function hasExistingRematch(previousInviteId: string) {
  const snap = await getDocs(
    query(
      collection(db, "match_invites"),
      where("previousInviteId", "==", previousInviteId),
      limit(1)
    )
  );

  return !snap.empty;
}

export function buildRematchPrefill(
  previousInviteId: string,
  data: MatchInviteDoc,
  currentUserId: string
): RematchPrefill | null {
  const fromUserId = typeof data.fromUserId === "string" ? data.fromUserId : null;
  const toUserId = typeof data.toUserId === "string" ? data.toUserId : null;
  const conversationId =
    typeof data.conversationId === "string" ? data.conversationId : null;
  const startISO = getStartISO(data);

  if (!fromUserId || !toUserId || !conversationId || !startISO) return null;
  if (currentUserId !== fromUserId && currentUserId !== toUserId) return null;

  const opponentId = currentUserId === fromUserId ? toUserId : fromUserId;
  const nextStartISO = addWeek(startISO);
  const court = getCourt(data);
  const location = getLocation(data);

  return {
    previousInviteId,
    conversationId,
    fromUserId: currentUserId,
    toUserId: opponentId,
    opponentId,
    startISO: nextStartISO,
    location,
    courtName:
      (court?.name && String(court.name)) ||
      (typeof data.courtName === "string" ? data.courtName : null) ||
      null,
    courtId: court?.id ? String(court.id) : null,
    durationMins: getDurationMins(data),
    note: defaultRematchNote(),
    court,
  };
}

export async function findEligibleRematchInvite(params: {
  conversationId: string;
  currentUserId: string;
  nowMs?: number;
}) {
  const { conversationId, currentUserId, nowMs = Date.now() } = params;

  const snap = await getDocs(
    query(
      collection(db, "match_invites"),
      where("conversationId", "==", conversationId),
      where("inviteStatus", "==", "accepted")
    )
  );

  const sorted = snap.docs
    .map((d) => ({ id: d.id, data: asInviteDoc(d.data()) }))
    .sort((a, b) => {
      const aMs = Date.parse(getStartISO(a.data) || "") || 0;
      const bMs = Date.parse(getStartISO(b.data) || "") || 0;
      return bMs - aMs;
    });

  for (const row of sorted) {
    const startISO = getStartISO(row.data);
    if (!startISO) continue;

    const startMs = Date.parse(startISO);
    if (!Number.isFinite(startMs)) continue;
    if (startMs > nowMs) continue;
    if (startMs + 30 * 60 * 1000 > nowMs) continue;

    if (
      currentUserId !== row.data.fromUserId &&
      currentUserId !== row.data.toUserId
    ) {
      continue;
    }

    if (hasMapValue(row.data.rematchPromptShownTo, currentUserId)) continue;
    if (hasMapValue(row.data.rematchPromptDismissedTo, currentUserId)) continue;
    if (await hasExistingRematch(row.id)) continue;

    const prefill = buildRematchPrefill(row.id, row.data, currentUserId);
    if (!prefill) continue;

    return prefill;
  }

  return null;
}

export async function markRematchPromptShown(inviteId: string, userId: string) {
  await updateDoc(doc(db, "match_invites", inviteId), {
    [`rematchPromptShownTo.${userId}`]: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
}

export async function dismissRematchPrompt(inviteId: string, userId: string) {
  await updateDoc(doc(db, "match_invites", inviteId), {
    [`rematchPromptDismissedTo.${userId}`]: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
}

export async function createRematchInviteFromPrevious(params: {
  currentUserId: string;
  previousInviteId: string;
  conversationId: string;
  startISO: string;
  durationMins: number;
  location: string;
  note?: string | null;
  court?: InviteCourt | null;
}) {
  const {
    currentUserId,
    previousInviteId,
    conversationId,
    startISO,
    durationMins,
    location,
    note,
    court = null,
  } = params;

  const previousRef = doc(db, "match_invites", previousInviteId);
  const previousSnap = await getDoc(previousRef);
  if (!previousSnap.exists()) {
    throw new Error("Previous invite does not exist.");
  }

  const previous = asInviteDoc(previousSnap.data());
  if (previous.inviteStatus !== "accepted") {
    throw new Error("Previous invite must be accepted.");
  }

  const fromUserId = typeof previous.fromUserId === "string" ? previous.fromUserId : null;
  const toUserId = typeof previous.toUserId === "string" ? previous.toUserId : null;
  if (!fromUserId || !toUserId) {
    throw new Error("Previous invite is missing participants.");
  }

  if (currentUserId !== fromUserId && currentUserId !== toUserId) {
    throw new Error("You are not a participant in the previous invite.");
  }

  if (previous.conversationId !== conversationId) {
    throw new Error("Conversation mismatch for rematch invite.");
  }

  if (await hasExistingRematch(previousInviteId)) {
    throw new Error("A rematch already exists for this invite.");
  }

  const recipientId = currentUserId === fromUserId ? toUserId : fromUserId;
  const invitePayload: InvitePayload = {
    startISO,
    durationMins,
    location: location.trim(),
    note: note?.trim() || null,
    court,
  };

  const newMessage: Record<string, unknown> = {
    senderId: currentUserId,
    recipientId,
    type: "invite",
    inviteType: "rematch",
    previousInviteId,
    source: "post_match_prompt",
    invite: invitePayload,
    inviteStatus: "pending",
    timestamp: serverTimestamp(),
    read: false,
  };

  const msgRef = await addDoc(
    collection(db, "conversations", conversationId, "messages"),
    newMessage
  );

  const inviteId = msgRef.id;

  await setDoc(doc(db, "match_invites", inviteId), {
    inviteId,
    messageId: inviteId,
    conversationId,
    previousInviteId,
    fromUserId: currentUserId,
    toUserId: recipientId,
    opponentId: recipientId,
    startISO,
    location: location.trim(),
    courtName: court?.name || null,
    courtId: court?.id || null,
    type: "rematch",
    source: "post_match_prompt",
    invite: invitePayload,
    inviteStatus: "pending",
    inviteBookingStatus: "not_confirmed",
    inviteBookedBy: null,
    inviteBookedAt: null,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });

  await updateDoc(msgRef, { inviteId });

  await updateDoc(doc(db, "conversations", conversationId), {
    latestMessage: {
      text: "🎾 Rematch invite",
      senderId: currentUserId,
      timestamp: serverTimestamp(),
      type: "invite",
    },
    updatedAt: serverTimestamp(),
    [`lastRead.${currentUserId}`]: serverTimestamp(),
    [`typing.${currentUserId}`]: false,
  });

  return inviteId;
}
