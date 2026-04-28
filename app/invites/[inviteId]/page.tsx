"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Image from "next/image";
import { ArrowLeft, CheckCircle2, XCircle, MapPin } from "lucide-react";

import { db, auth } from "@/lib/firebaseConfig";
import {
  doc,
  getDoc,
  onSnapshot,
  serverTimestamp,
  updateDoc,
  deleteDoc,
  addDoc,
  collection,
  getDocs,     // ✅ ADD
  query,       // ✅ ADD
  where,       // ✅ ADD
} from "firebase/firestore";
import PlayerProfileView from "@/components/players/PlayerProfileView";
import { resolveSmallProfilePhoto } from "@/lib/profilePhoto";
import { trackEvent } from "@/lib/mixpanel";
import { shouldTrackRematchInviteAccepted } from "@/lib/rematchAnalytics";

const TM = {
  ink: "#0B3D2E",
  neon: "#39FF14",
};

function formatInviteWhen(startISO?: string | null) {
  if (!startISO) return "Time TBD";
  const d = new Date(startISO);
  if (isNaN(d.getTime())) return "Invalid date";
  return d.toLocaleString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function mapsUrlFor(labelOrAddress?: string | null) {
  const q = (labelOrAddress || "").trim();
  if (!q) return null;
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(q)}`;
}

export default function InviteDetailsPage() {
  const { inviteId } = useParams<{ inviteId: string }>();
  const router = useRouter();

  const [inviteDoc, setInviteDoc] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  const [fromProfile, setFromProfile] = useState<any>(null);
  const [toProfile, setToProfile] = useState<any>(null);

    const [profileOpen, setProfileOpen] = useState(false);
    const [openingScore, setOpeningScore] = useState(false);
const [scoreError, setScoreError] = useState<string | null>(null);

  const me = auth.currentUser?.uid || null;

  async function goToRecordScore() {
  if (!inviteDoc) return;

  try {
    setOpeningScore(true);
    setScoreError(null);

    const matchId = await resolveMatchIdForInvite();

    if (!matchId) {
      setScoreError("Could not find the linked match for this invite yet.");
      return;
    }

    router.push(`/matches/${matchId}/complete/details?fromInvite=${inviteId}`);
  } catch (err) {
    console.error("Failed to open score entry:", err);
    setScoreError("Could not open score entry.");
  } finally {
    setOpeningScore(false);
  }
}

  // Live subscribe to invite doc
  useEffect(() => {
    if (!inviteId) return;

    const ref = doc(db, "match_invites", String(inviteId));
    const unsub = onSnapshot(
      ref,
      async (snap) => {
        setLoading(false);
        if (!snap.exists()) {
          setInviteDoc(null);
          return;
        }

        const data = snap.data();
        setInviteDoc({ id: snap.id, ...data });

        // Load participant profiles (players)
        const [fromSnap, toSnap] = await Promise.all([
          getDoc(doc(db, "players", data.fromUserId)),
          getDoc(doc(db, "players", data.toUserId)),
        ]);

        setFromProfile(fromSnap.exists() ? fromSnap.data() : null);
        setToProfile(toSnap.exists() ? toSnap.data() : null);
      },
      () => {
        setLoading(false);
        setInviteDoc(null);
      }
    );

    return () => unsub();
  }, [inviteId]);

useEffect(() => {
  const onKey = (e: KeyboardEvent) => {
    if (e.key === "Escape") setProfileOpen(false);
  };
  document.addEventListener("keydown", onKey);
  return () => document.removeEventListener("keydown", onKey);
}, []);

useEffect(() => {
  if (!profileOpen) return;

  const prevOverflow = document.body.style.overflow;
  const prevTouch = document.body.style.touchAction;

  document.body.style.overflow = "hidden";
  document.body.style.touchAction = "none";

  return () => {
    document.body.style.overflow = prevOverflow;
    document.body.style.touchAction = prevTouch;
  };
}, [profileOpen]);

  const inv = inviteDoc?.invite || {};
  const court = inv?.court || null;

  const when = formatInviteWhen(inv?.startISO);
  const duration = inv?.durationMins ? `${inv.durationMins} min` : "";
  const location = inv?.location || "";

  const courtAddressLine = court
    ? [court?.address, court?.suburb, court?.state, court?.postcode].filter(Boolean).join(", ")
    : "";

  const mapsHref = mapsUrlFor(courtAddressLine || court?.name || location);
  const status = inviteDoc?.inviteStatus || "pending";

  const isRecipient = me && inviteDoc?.toUserId === me;
  const isSender = me && inviteDoc?.fromUserId === me;

  const bookingStatus = inviteDoc?.inviteBookingStatus || "not_confirmed";
  const canConfirmBooking = status === "accepted" && bookingStatus !== "confirmed" && (isSender || isRecipient);

  const canRecordScore =
  status === "accepted" &&
  (isSender || isRecipient);

  async function updateInviteEverywhere(patch: Record<string, any>) {
    if (!inviteDoc?.conversationId || !inviteDoc?.messageId) return;

    const inviteRef = doc(db, "match_invites", String(inviteId));
    const msgRef = doc(
      db,
      "conversations",
      String(inviteDoc.conversationId),
      "messages",
      String(inviteDoc.messageId)
    );

    // update invite doc
    await updateDoc(inviteRef, { ...patch, updatedAt: serverTimestamp() });

    // mirror key fields on message so chat UI stays correct
    const mirror: Record<string, any> = {};
    if ("inviteStatus" in patch) mirror.inviteStatus = patch.inviteStatus;
    if ("inviteBookingStatus" in patch) mirror.inviteBookingStatus = patch.inviteBookingStatus;
    if ("inviteBookedBy" in patch) mirror.inviteBookedBy = patch.inviteBookedBy;
    if ("inviteBookedAt" in patch) mirror.inviteBookedAt = patch.inviteBookedAt;

    if (Object.keys(mirror).length) {
      await updateDoc(msgRef, mirror);
    }
  }

  async function respond(status: "accepted" | "declined") {
    if (!isRecipient) return;

    const isRematch =
      inviteDoc?.type === "rematch" ||
      inviteDoc?.source === "post_match_prompt" ||
      !!inviteDoc?.previousInviteId;

    await updateInviteEverywhere({
      inviteStatus: status,
      inviteRespondedAt: serverTimestamp(),
      inviteRespondedBy: me,
      ...(status === "accepted"
        ? {
            inviteBookingStatus: "not_confirmed",
            inviteBookedBy: null,
            inviteBookedAt: null,
          }
        : {}),
    });

    const acceptedInviteId = String(inviteId);

    if (
      status === "accepted" &&
      isRematch &&
      shouldTrackRematchInviteAccepted(acceptedInviteId)
    ) {
      trackEvent("rematch_invite_accepted", {
        inviteId: acceptedInviteId,
        previousInviteId: inviteDoc?.previousInviteId || null,
        conversationId: inviteDoc?.conversationId || null,
        accepterId: me || null,
        senderId: inviteDoc?.fromUserId || null,
        startISO:
          (typeof inviteDoc?.invite?.startISO === "string" ? inviteDoc.invite.startISO : null) ||
          null,
        source: inviteDoc?.source || null,
        type: inviteDoc?.type || "invite",
      });
    }
  }

  async function confirmBooked() {
    if (!canConfirmBooking) return;

    await updateInviteEverywhere({
      inviteBookingStatus: "confirmed",
      inviteBookedBy: me,
      inviteBookedAt: serverTimestamp(),
    });
  }

  async function deleteRelatedCalendarEvents(conversationId: string, messageId: string) {
    if (!me) return;

    const qRef = query(
      collection(db, "calendar_events"),
      where("ownerId", "==", me),
      where("conversationId", "==", conversationId),
      where("messageId", "==", messageId)
    );

    const snap = await getDocs(qRef);
    await Promise.all(snap.docs.map((d) => deleteDoc(d.ref)));
  }

async function resolveMatchIdForInvite(): Promise<string | null> {
  if (!inviteDoc) return null;

  // 1) Best case: already linked directly on invite doc
  if (typeof inviteDoc.matchId === "string" && inviteDoc.matchId.trim()) {
    return inviteDoc.matchId.trim();
  }

  // 2) Fallback: try to find a match_request linked to this invite/conversation/users
  const fromUserId = inviteDoc.fromUserId;
  const toUserId = inviteDoc.toUserId;
  const conversationId = inviteDoc.conversationId;

  // Try by conversation first
  if (conversationId) {
    const [sentSnap, receivedSnap] = await Promise.all([
      getDocs(
        query(
          collection(db, "match_requests"),
          where("conversationId", "==", conversationId),
          where("fromUserId", "==", fromUserId),
          where("toUserId", "==", toUserId)
        )
      ),
      getDocs(
        query(
          collection(db, "match_requests"),
          where("conversationId", "==", conversationId),
          where("fromUserId", "==", toUserId),
          where("toUserId", "==", fromUserId)
        )
      ),
    ]);

    const candidates = [...sentSnap.docs, ...receivedSnap.docs]
      .map((d) => ({ id: d.id, ...d.data() } as any))
      .filter((m) => typeof m?.fromUserId === "string" && typeof m?.toUserId === "string");

    if (candidates.length > 0) {
      candidates.sort((a, b) => {
        const aMs = a.updatedAt?.toMillis?.() ?? a.createdAt?.toMillis?.() ?? 0;
        const bMs = b.updatedAt?.toMillis?.() ?? b.createdAt?.toMillis?.() ?? 0;
        return bMs - aMs;
      });

      return candidates[0].id;
    }
  }

  // 3) Fallback: direct pair lookup
  const q1 = query(
    collection(db, "match_requests"),
    where("fromUserId", "==", fromUserId),
    where("toUserId", "==", toUserId)
  );

  const q2 = query(
    collection(db, "match_requests"),
    where("fromUserId", "==", toUserId),
    where("toUserId", "==", fromUserId)
  );

  const [snap1, snap2] = await Promise.all([getDocs(q1), getDocs(q2)]);

  const candidates = [...snap1.docs, ...snap2.docs].map((d) => ({
    id: d.id,
    ...d.data(),
  })) as any[];

  if (!candidates.length) return null;

  candidates.sort((a, b) => {
    const aMs = a.updatedAt?.toMillis?.() ?? a.createdAt?.toMillis?.() ?? 0;
    const bMs = b.updatedAt?.toMillis?.() ?? b.createdAt?.toMillis?.() ?? 0;
    return bMs - aMs;
  });

  return candidates[0].id;
}

async function cancelInvite() {
  if (!me) return;
  if (!inviteDoc?.conversationId || !inviteDoc?.messageId) return;

  // 🔥 NEW — delete related calendar event (doc id = inviteId)
  try {
    await deleteDoc(doc(db, "calendar_events", String(inviteId)));
  } catch (err) {
    console.error("Failed to delete calendar event:", err);
  }

  // 1) Mark invite cancelled + mirror to message
  await updateInviteEverywhere({
    inviteStatus: "cancelled",
    cancelledAt: serverTimestamp(),
    cancelledBy: me,
  });

   // 1.5) Delete related calendar event(s) for both owners
  await deleteRelatedCalendarEvents(String(inviteDoc.conversationId), String(inviteDoc.messageId));

// 2) Post a system message into the chat thread (with senderId so avatar logic works)
await addDoc(
  collection(db, "conversations", String(inviteDoc.conversationId), "messages"),
  {
    type: "system",
    system: true,
    systemType: "invite_cancelled",

    senderId: "system",          // ✅ critical: prevents broken avatar lookup
    recipientId: null,           // ✅ makes it a “thread message” not a DM

    inviteId: String(inviteId),  // ✅ lets UI link back to invite
    messageId: String(inviteDoc.messageId),
    conversationId: String(inviteDoc.conversationId),

    text: "🚫 This invite has been cancelled.",
    timestamp: serverTimestamp(),
  }
);
  // 3) Redirect back to the chat
  router.push(`/messages/${inviteDoc.conversationId}`);
}

  const title = useMemo(() => {
    const otherName =
      isSender ? (toProfile?.name || "Opponent") : (fromProfile?.name || "Opponent");
    return `Match with ${otherName}`;
  }, [isSender, fromProfile, toProfile]);

  if (loading) {
    return <div className="min-h-screen bg-white p-6">Loading…</div>;
  }

  if (!inviteDoc) {
    return (
      <div className="min-h-screen bg-white p-6">
        <div className="text-lg font-extrabold">Invite not found</div>
        <button
          className="mt-4 rounded-xl px-4 py-2 text-sm font-extrabold"
          style={{ background: TM.neon, color: TM.ink }}
          onClick={() => router.push("/messages")}
        >
          Back to Messages
        </button>
      </div>
    );
  }

    if (inviteDoc?.inviteStatus === "cancelled") {
    return (
      <div className="min-h-screen bg-white p-6">
        <div className="text-lg font-extrabold">This invite has been cancelled</div>
        <button
          className="mt-4 rounded-xl px-4 py-2 text-sm font-extrabold"
          style={{ background: TM.neon, color: TM.ink }}
          onClick={() => router.push(`/messages/${inviteDoc.conversationId}`)}
        >
          Back to Chat
        </button>
      </div>
    );
  }

  const otherProfile = isSender ? toProfile : fromProfile;
  const otherPhoto = resolveSmallProfilePhoto(otherProfile);

  function handleBack() {
  if (typeof window !== "undefined" && window.history.length > 1) {
    router.back();
    return;
  }

  if (inviteDoc?.conversationId) {
    router.push(`/messages/${inviteDoc.conversationId}`);
    return;
  }

  router.push("/messages");
}

  return (
    <div className="min-h-screen bg-white">
      {/* Header */}
      <div className="sticky top-0 z-10 bg-white/95 backdrop-blur border-b px-4">
        <div className="h-[64px] flex items-center gap-3">
<button
  onClick={handleBack}
  className="h-10 w-10 rounded-full grid place-items-center hover:bg-black/5"
  aria-label="Back"
>
  <ArrowLeft className="w-5 h-5 text-gray-800" />
</button>

          <div className="flex-1 min-w-0">
            <div className="truncate text-[18px] font-extrabold text-gray-900">{title}</div>
            <div className="text-[12px] text-gray-500 font-semibold">{when}</div>
          </div>

          {otherPhoto ? (
            <div className="relative h-10 w-10 overflow-hidden rounded-full border">
              <Image src={otherPhoto} alt="Opponent" fill sizes="40px" className="object-cover" />
            </div>
          ) : (
            <div className="h-10 w-10 rounded-full bg-black/5 grid place-items-center text-sm font-extrabold text-black/50">
              {(otherProfile?.name || "O").trim().charAt(0).toUpperCase()}
            </div>
          )}
        </div>
      </div>

      {/* Body */}
      <div className="mx-auto max-w-lg px-4 py-5 space-y-4">
                {/* Opponent */}
        {otherProfile && (
          <div
            className="rounded-3xl border p-4 bg-white flex items-center gap-4"
            style={{ borderColor: "rgba(11,61,46,0.10)" }}
          >
            {otherPhoto ? (
              <div className="relative h-14 w-14 overflow-hidden rounded-full border">
                <Image
                  src={otherPhoto}
                  alt="Opponent"
                  fill
                  sizes="56px"
                  className="object-cover"
                />
              </div>
            ) : (
              <div className="h-14 w-14 rounded-full bg-black/5 grid place-items-center text-lg font-extrabold">
                {(otherProfile?.name || "O").charAt(0).toUpperCase()}
              </div>
            )}

            <div className="flex-1 min-w-0">
              <div className="text-[16px] font-extrabold text-gray-900 truncate">
                {otherProfile?.name || "Opponent"}
              </div>

              <button
                type="button"
                onClick={() => setProfileOpen(true)}
                className="mt-1 text-[12px] font-extrabold underline"
                style={{ color: TM.ink }}
              >
                View Profile
              </button>
            </div>

            {/* Cancel (show to both participants) */}
            {(isSender || isRecipient) && status !== "cancelled" && (
              <button
                type="button"
                onClick={cancelInvite}
                className="shrink-0 rounded-xl px-3 py-2 text-[12px] font-extrabold"
                style={{ background: "#111827", color: "white" }}
              >
                Cancel
              </button>
            )}
          </div>
        )}
        <div className="rounded-3xl border p-4" style={{ borderColor: "rgba(11,61,46,0.10)", background: "#F3F8F4" }}>
          <div className="text-[12px] font-extrabold text-black/70">DETAILS</div>

          <div className="mt-2 text-[16px] font-extrabold text-gray-900">{when}</div>
          <div className="mt-1 text-[13px] font-semibold text-black/60">
            {duration}
            {duration && location ? " • " : ""}
            {location}
          </div>

          {(court?.name || courtAddressLine) && (
            <div className="mt-3 rounded-2xl border p-3 bg-white" style={{ borderColor: "rgba(11,61,46,0.10)" }}>
              {court?.name && <div className="text-[13px] font-extrabold">{court.name}</div>}
              {(courtAddressLine || location) && (
                <div className="mt-1 text-[12px] text-black/60">{courtAddressLine || location}</div>
              )}

              {mapsHref && (
                <a
                  href={mapsHref}
                  target="_blank"
                  rel="noreferrer"
                  className="mt-3 inline-flex w-full items-center justify-center gap-2 rounded-xl px-4 py-2 text-[12px] font-extrabold"
                  style={{ background: TM.neon, color: TM.ink }}
                >
                  <MapPin className="h-4 w-4" />
                  Open in Maps
                </a>
              )}

              {!!court?.bookingUrl && bookingStatus !== "confirmed" && (
                <a
                  href={court.bookingUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="mt-2 inline-flex w-full items-center justify-center rounded-xl px-4 py-2 text-[12px] font-extrabold"
                  style={{ background: "#16A34A", color: "white" }}
                >
                  Book Court ↗
                </a>
              )}
            </div>
          )}

          <div className="mt-3">
            {status === "pending" && (
              <div className="text-[12px] font-extrabold text-black/60">Status: Pending</div>
            )}
            {status === "accepted" && (
              <div className="inline-flex items-center gap-2 text-[12px] font-extrabold" style={{ color: "#16A34A" }}>
                <CheckCircle2 className="h-4 w-4" /> Accepted
              </div>
            )}
            {status === "declined" && (
              <div className="inline-flex items-center gap-2 text-[12px] font-extrabold" style={{ color: "#DC2626" }}>
                <XCircle className="h-4 w-4" /> Declined
              </div>
            )}
          </div>
        </div>

        {/* Actions */}
        {status === "pending" && isRecipient && (
          <div className="grid grid-cols-2 gap-3">
            <button
              onClick={() => respond("accepted")}
              className="rounded-2xl py-3 text-sm font-extrabold"
              style={{ background: "#16A34A", color: "white" }}
            >
              Accept
            </button>
            <button
              onClick={() => respond("declined")}
              className="rounded-2xl py-3 text-sm font-extrabold"
              style={{ background: "#EF4444", color: "white" }}
            >
              Decline
            </button>
          </div>
        )}

     {status === "accepted" && (
  <div className="rounded-3xl border p-4" style={{ borderColor: "rgba(11,61,46,0.10)" }}>
    <div className="text-[12px] font-extrabold text-black/70">COURT BOOKING</div>

    {bookingStatus === "confirmed" ? (
      <div className="mt-2 text-[13px] font-extrabold" style={{ color: "#16A34A" }}>
        🟢 Confirmed
      </div>
    ) : (
      <div className="mt-2 text-[13px] font-extrabold" style={{ color: "#DC2626" }}>
        🔴 Not confirmed
      </div>
    )}

    {canConfirmBooking && bookingStatus !== "confirmed" && (
      <button
        onClick={confirmBooked}
        className="mt-3 w-full rounded-2xl py-3 text-sm font-extrabold"
        style={{ background: TM.neon, color: TM.ink }}
      >
        I’ve booked the court ✅
      </button>
    )}

    {canRecordScore && (
      <button
        onClick={goToRecordScore}
        disabled={openingScore}
        className="mt-3 w-full rounded-2xl py-3 text-sm font-extrabold disabled:opacity-60"
        style={{ background: "#16A34A", color: "white" }}
      >
        {openingScore ? "Opening score entry…" : "Record Match Score"}
      </button>
    )}

    {scoreError && (
      <div className="mt-3 text-[12px] font-bold text-red-600">
        {scoreError}
      </div>
    )}
  </div>
)}

      </div>
       {/* Profile overlay modal */}
{profileOpen && otherProfile && (
  <div className="fixed inset-0 z-[9999]">
    {/* Backdrop */}
    <div
      className="absolute inset-0 bg-black/60"
      onMouseDown={() => setProfileOpen(false)}
    />

    {/* Panel */}
    <div className="absolute inset-0 flex items-start justify-center px-3 pt-3 pb-4 sm:items-center sm:p-6">
      <div
        className="w-full max-w-[560px] rounded-2xl shadow-2xl overflow-hidden"
        style={{ background: "#071B15" }}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div
          style={{
            height: "min(88dvh, 820px)",
            maxHeight: "min(88dvh, 820px)",
          }}
        >
          <PlayerProfileView
            playerId={isSender ? inviteDoc?.toUserId : inviteDoc?.fromUserId}
            onClose={() => setProfileOpen(false)}
          />
        </div>
      </div>
    </div>
  </div>
)}
    </div>
  );
}
