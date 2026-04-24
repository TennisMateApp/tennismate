"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import { CheckCircle2, XCircle, MapPin } from "lucide-react";
import { auth, db } from "@/lib/firebaseConfig";
import {
  doc,
  getDoc,
  onSnapshot,
  serverTimestamp,
  updateDoc,
  deleteDoc,
  addDoc,
  collection,
  getDocs,
  query,
  where,
} from "firebase/firestore";
import { resolveSmallProfilePhoto } from "@/lib/profilePhoto";

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


export default function InviteOverlayCard({
  inviteId,
  onClose,
}: {
  inviteId: string;
  onClose?: () => void;
}) {
  const router = useRouter();

const [inviteDoc, setInviteDoc] = useState<any>(null);
const [loading, setLoading] = useState(true);
const [fromProfile, setFromProfile] = useState<any>(null);
const [toProfile, setToProfile] = useState<any>(null);
const [error, setError] = useState<string | null>(null);
const [openingScore, setOpeningScore] = useState(false);
const [scoreError, setScoreError] = useState<string | null>(null);

  // ✅ Auth can be null on first render — track it in state
  const [me, setMe] = useState<string | null>(null);

  useEffect(() => {
    const unsub = auth.onAuthStateChanged((u) => setMe(u?.uid || null));
    return () => unsub();
  }, []);



  useEffect(() => {
  if (!inviteId) return;

  setLoading(true);
  setError(null);

  const ref = doc(db, "match_invites", String(inviteId));

  const unsub = onSnapshot(
    ref,
    async (snap) => {
      try {
        if (!snap.exists()) {
          setInviteDoc(null);
          setFromProfile(null);
          setToProfile(null);
          setLoading(false);
          return;
        }

        const data = snap.data();
        setInviteDoc({ id: snap.id, ...data });

        // Guard against missing ids (prevents doc(db,'players',undefined) crashing)
        const fromId = data?.fromUserId ? String(data.fromUserId) : null;
        const toId = data?.toUserId ? String(data.toUserId) : null;

        if (!fromId || !toId) {
          setFromProfile(null);
          setToProfile(null);
          setError("Invite is missing fromUserId/toUserId.");
          setLoading(false);
          return;
        }

        // These can fail due to rules; catch and continue so overlay still renders
        const [fromSnap, toSnap] = await Promise.allSettled([
          getDoc(doc(db, "players", fromId)),
          getDoc(doc(db, "players", toId)),
        ]);

        setFromProfile(
          fromSnap.status === "fulfilled" && fromSnap.value.exists()
            ? fromSnap.value.data()
            : null
        );
        setToProfile(
          toSnap.status === "fulfilled" && toSnap.value.exists()
            ? toSnap.value.data()
            : null
        );

        // If players reads failed, surface it (this is a key diagnostic for your Germany test)
        if (fromSnap.status === "rejected" || toSnap.status === "rejected") {
          console.error("InviteOverlayCard: player profile read failed", {
            fromErr: fromSnap.status === "rejected" ? fromSnap.reason : null,
            toErr: toSnap.status === "rejected" ? toSnap.reason : null,
          });
          setError("Loaded invite, but player profiles could not be read (likely permissions).");
        }

        setLoading(false);
      } catch (err: any) {
        console.error("InviteOverlayCard snapshot handler error:", err);
        setError(err?.message || String(err));
        setInviteDoc(null);
        setFromProfile(null);
        setToProfile(null);
        setLoading(false);
      }
    },
    (err) => {
      console.error("InviteOverlayCard onSnapshot error:", err);
      setError(err?.message || String(err));
      setInviteDoc(null);
      setFromProfile(null);
      setToProfile(null);
      setLoading(false);
    }
  );

  return () => unsub();
}, [inviteId]);

  const inv = inviteDoc?.invite || {};
  const court = inv?.court || null;

  const duration = inv?.durationMins ? `${inv.durationMins} min` : "";
  const location = inv?.location || "";

  const courtAddressLine = court
    ? [court?.address, court?.suburb, court?.state, court?.postcode].filter(Boolean).join(", ")
    : "";

  const mapsHref = mapsUrlFor(courtAddressLine || court?.name || location);

    // ✅ Derived statuses + permissions
  const status = inviteDoc?.inviteStatus || "pending";
  const bookingStatus = inviteDoc?.inviteBookingStatus || "not_confirmed";

  const isRecipient = !!me && inviteDoc?.toUserId === me;
  const isSender = !!me && inviteDoc?.fromUserId === me;

const canConfirmBooking =
  status === "accepted" && bookingStatus !== "confirmed" && (isSender || isRecipient);

const canRecordScore =
  status === "accepted" &&
  bookingStatus === "confirmed" &&
  (isSender || isRecipient);

  // ✅ Keep invite doc + message doc in sync (same as InviteDetailsPage)
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

    // 1) update invite doc
    await updateDoc(inviteRef, { ...patch, updatedAt: serverTimestamp() });

    // 2) mirror key fields on message so chat UI updates instantly
    const mirror: Record<string, any> = {};
    if ("inviteStatus" in patch) mirror.inviteStatus = patch.inviteStatus;
    if ("inviteBookingStatus" in patch) mirror.inviteBookingStatus = patch.inviteBookingStatus;
    if ("inviteBookedBy" in patch) mirror.inviteBookedBy = patch.inviteBookedBy;
    if ("inviteBookedAt" in patch) mirror.inviteBookedAt = patch.inviteBookedAt;

    if (Object.keys(mirror).length) await updateDoc(msgRef, mirror);
  }

  async function respond(next: "accepted" | "declined") {
    if (!isRecipient) return;

    await updateInviteEverywhere({
      inviteStatus: next,
      inviteRespondedAt: serverTimestamp(),
      inviteRespondedBy: me,
      ...(next === "accepted"
        ? {
            inviteBookingStatus: "not_confirmed",
            inviteBookedBy: null,
            inviteBookedAt: null,
          }
        : {}),
    });
  }

  async function confirmBooked() {
    if (!canConfirmBooking) return;

    await updateInviteEverywhere({
      inviteBookingStatus: "confirmed",
      inviteBookedBy: me,
      inviteBookedAt: serverTimestamp(),
    });
  }

  async function resolveMatchIdForInvite(): Promise<string | null> {
  if (!inviteDoc) return null;

  // Best case: invite already stores matchId
  if (typeof inviteDoc.matchId === "string" && inviteDoc.matchId.trim()) {
    return inviteDoc.matchId.trim();
  }

  const fromUserId = inviteDoc.fromUserId;
  const toUserId = inviteDoc.toUserId;
  const conversationId = inviteDoc.conversationId;

  // Try by conversation first
  if (conversationId) {
    const byConversationQ = query(
      collection(db, "match_requests"),
      where("conversationId", "==", conversationId)
    );

    const byConversationSnap = await getDocs(byConversationQ);

    const candidates = byConversationSnap.docs
      .map((d) => ({ id: d.id, ...d.data() } as any))
      .filter((m) => {
        const a = m.fromUserId;
        const b = m.toUserId;
        return (
          (a === fromUserId && b === toUserId) ||
          (a === toUserId && b === fromUserId)
        );
      });

    if (candidates.length > 0) {
      candidates.sort((a, b) => {
        const aMs = a.updatedAt?.toMillis?.() ?? a.createdAt?.toMillis?.() ?? 0;
        const bMs = b.updatedAt?.toMillis?.() ?? b.createdAt?.toMillis?.() ?? 0;
        return bMs - aMs;
      });

      return candidates[0].id;
    }
  }

  // Fallback: direct pair lookup
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

    onClose?.();
    router.push(`/matches/${matchId}/complete/details?fromInvite=${inviteId}`);
  } catch (err) {
    console.error("InviteOverlayCard: failed to open score entry", err);
    setScoreError("Could not open score entry.");
  } finally {
    setOpeningScore(false);
  }
}
  async function deleteRelatedCalendarEvents(conversationId: string, messageId: string) {
    const qRef = query(
      collection(db, "calendar_events"),
      where("conversationId", "==", conversationId),
      where("messageId", "==", messageId)
    );

    const snap = await getDocs(qRef);
    await Promise.all(snap.docs.map((d) => deleteDoc(d.ref)));
  }

  async function cancelInvite() {
    if (!me) return;
    if (!(isSender || isRecipient)) return;
    if (!inviteDoc?.conversationId || !inviteDoc?.messageId) return;

    // delete primary calendar event doc (id = inviteId) if you use that pattern
    try {
      await deleteDoc(doc(db, "calendar_events", String(inviteId)));
    } catch (err) {
      console.error("Failed to delete calendar event:", err);
    }

    // mark cancelled
    await updateInviteEverywhere({
      inviteStatus: "cancelled",
      cancelledAt: serverTimestamp(),
      cancelledBy: me,
    });

    // delete any per-user event copies
    try {
      await deleteRelatedCalendarEvents(
        String(inviteDoc.conversationId),
        String(inviteDoc.messageId)
      );
    } catch (err) {
      console.error("Failed to delete related calendar events:", err);
    }

    // system message so chat shows cancellation
    await addDoc(collection(db, "conversations", String(inviteDoc.conversationId), "messages"), {
      type: "system",
      system: true,
      systemType: "invite_cancelled",
      senderId: "system",
      recipientId: null,
      inviteId: String(inviteId),
      messageId: String(inviteDoc.messageId),
      conversationId: String(inviteDoc.conversationId),
      text: "🚫 This invite has been cancelled.",
      timestamp: serverTimestamp(),
    });

    onClose?.(); // ✅ close overlay
  }

  const mapQuery = (courtAddressLine || court?.name || location || "").trim();
const mapsEmbedSrc = mapQuery
  ? `https://www.google.com/maps?q=${encodeURIComponent(mapQuery)}&output=embed`
  : null;


  const otherProfile = isSender ? toProfile : fromProfile;
  const otherName = otherProfile?.name || "Opponent";
  const otherPhoto = resolveSmallProfilePhoto(otherProfile);

  if (loading) {
    return <div className="p-4 text-sm text-slate-600">Loading invite…</div>;
  }

  if (error) {
  return (
    <div className="p-4">
      <div className="text-sm font-extrabold text-slate-900">Couldn’t load invite</div>
      <div className="mt-2 text-xs font-semibold text-red-600 break-words">{error}</div>
      <button
        type="button"
        onClick={() => onClose?.()}
        className="mt-3 w-full rounded-xl py-2 text-xs font-extrabold"
        style={{ background: TM.neon, color: TM.ink }}
      >
        Close
      </button>
    </div>
  );
}

  if (!inviteDoc) {
    return (
      <div className="p-4">
        <div className="text-sm font-extrabold text-slate-900">Invite not found</div>
        <div className="mt-3 text-xs font-semibold text-slate-500">
  Please close this window and try again.
</div>
      </div>
    );
  }

    if (inviteDoc?.inviteStatus === "cancelled") {
    return (
      <div className="p-4">
        <div className="text-sm font-extrabold text-slate-900">This invite has been cancelled.</div>
        <button
          type="button"
          onClick={() => onClose?.()}
          className="mt-3 w-full rounded-xl py-2 text-xs font-extrabold"
          style={{ background: TM.neon, color: TM.ink }}
        >
          Close
        </button>
      </div>
    );
  }

  return (
   <div className="h-full min-h-0 flex flex-col">

      {/* Content */}
      <div
  className="min-h-0 flex-1 overflow-y-auto p-4 space-y-4 [-webkit-overflow-scrolling:touch]"
  style={{ paddingBottom: "calc(env(safe-area-inset-bottom) + 120px)" }}
>
        {/* Opponent */}
        <div className="rounded-2xl border border-slate-200 bg-white p-3 flex items-center gap-3">
          {otherPhoto ? (
            <div className="relative h-12 w-12 overflow-hidden rounded-full border border-slate-200">
              <Image src={otherPhoto} alt="Opponent" fill sizes="48px" className="object-cover" />
            </div>
          ) : (
            <div className="h-12 w-12 rounded-full bg-slate-100 grid place-items-center text-base font-extrabold text-slate-600">
              {String(otherName).trim().charAt(0).toUpperCase()}
            </div>
          )}

          <div className="min-w-0 flex-1">
            <div className="text-sm font-extrabold text-slate-900 truncate">{otherName}</div>
            <div className="text-[12px] font-semibold text-slate-500 truncate">
              {duration}
              {duration && location ? " • " : ""}
              {location || "Court TBA"}
            </div>
          </div>

          {/* Status pill */}
          <div className="shrink-0">
            {status === "accepted" && (
              <div className="inline-flex items-center gap-1 text-xs font-extrabold text-green-700">
                <CheckCircle2 className="h-4 w-4" /> Accepted
              </div>
            )}
            {status === "declined" && (
              <div className="inline-flex items-center gap-1 text-xs font-extrabold text-red-600">
                <XCircle className="h-4 w-4" /> Declined
              </div>
            )}
            {status === "pending" && (
              <div className="text-xs font-extrabold text-slate-600">Pending</div>
            )}
          </div>
          {/* ✅ Cancel Invite (both participants) */}
{(isSender || isRecipient) && status !== "cancelled" && !!inviteDoc?.conversationId && !!inviteDoc?.messageId && (
  <button
    type="button"
    onClick={cancelInvite}
    className="ml-2 shrink-0 rounded-xl px-3 py-2 text-[12px] font-extrabold"
    style={{ background: "#111827", color: "white" }}
  >
    Cancel
  </button>
)}
        </div>

        {/* Location card */}
        <div className="rounded-2xl border border-slate-200 bg-white p-3">
          <div className="text-xs font-extrabold text-slate-700">LOCATION</div>
          <div className="mt-2 text-sm font-extrabold text-slate-900">
            {court?.name || location || "Court TBA"}
          </div>
          {(courtAddressLine || location) && (
  <div className="mt-1 text-xs font-semibold text-slate-500">
    {courtAddressLine || location}
  </div>
)}

{/* ✅ Embedded Google Map */}
{mapsEmbedSrc && (
  <div className="mt-3 overflow-hidden rounded-xl border border-slate-200">
    <div className="relative w-full h-[220px]">
      <iframe
        title="Court location map"
        src={mapsEmbedSrc}
        className="absolute inset-0 w-full h-full"
        loading="lazy"
        referrerPolicy="no-referrer-when-downgrade"
      />
    </div>
  </div>
)}

          {mapsHref && (
            <a
              href={mapsHref}
              target="_blank"
              rel="noreferrer"
              className="mt-3 inline-flex w-full items-center justify-center gap-2 rounded-xl px-4 py-2 text-xs font-extrabold"
              style={{ background: TM.neon, color: TM.ink }}
            >
              <MapPin className="h-4 w-4" />
              Open in Maps
            </a>
          )}
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

        {status === "pending" && isSender && (
  <div className="rounded-2xl border border-slate-200 bg-white p-3 text-center">
    <div className="text-xs font-extrabold text-slate-600">
      Waiting for opponent to respond…
    </div>
  </div>
)}

{status === "accepted" && (
  <div className="rounded-2xl border border-slate-200 bg-white p-3">
    <div className="text-xs font-extrabold text-slate-700">COURT BOOKING</div>

    <div className="mt-2 text-sm font-extrabold">
      {bookingStatus === "confirmed" ? (
        <span className="text-green-700">🟢 Confirmed</span>
      ) : (
        <span className="text-red-600">🔴 Not confirmed</span>
      )}
    </div>

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
      <div className="mt-3 text-xs font-bold text-red-600">
        {scoreError}
      </div>
    )}
  </div>
)}
      </div>
    </div>
  );
}
