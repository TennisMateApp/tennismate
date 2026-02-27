"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import TMDesktopSidebar from "@/components/desktop_layout/TMDesktopSidebar";
import {
  CalendarDays,
  MapPin,
  Users,
  ShieldCheck,
  MessageCircle,
  XCircle,
  Pencil,
  CheckCircle2,
} from "lucide-react";

import PlayerProfileView from "@/components/players/PlayerProfileView";


export type EventDoc = {
  title?: string;
  type?: string;
  location?: string;
  start?: string; // ISO
  end?: string; // ISO
  durationMins?: number;

  // ✅ keep legacy numeric for older events
  minSkill?: number | null;

  // ✅ Range labels (new)
  minSkillLabel?: string | null; // FROM
  maxSkillLabel?: string | null; // TO

  spotsTotal?: number;
  spotsFilled?: number;
  status?: "open" | "full" | "cancelled" | "completed" | string;
  hostId?: string;
  participants?: string[];
  description?: string | null;

  court?: {
    id?: string | null;
    name?: string | null;
    address?: string | null;
    suburb?: string | null;
    state?: string | null;
    postcode?: string | null;
    bookingUrl?: string | null;
    lat?: number | null;
    lng?: number | null;
  } | null;

  bookingConfirmed?: boolean;
  bookingConfirmedAt?: any;
  bookingConfirmedBy?: string;
};

export type Player = {
  name?: string;
  // ✅ allow null because Firestore / auth sometimes gives nulls
  photoURL?: string | null;
  photoThumbURL?: string | null;
  avatar?: string | null;
};

export type JoinRequest = {
  id: string;
  userId: string;
  status: "pending" | "accepted" | "declined" | "left";
  profile?: Player;
};

const TM = {
  forest: "#0B3D2E",
  neon: "#39FF14",
  bg: "#F7FAF8",
};

const pickPlayerImg = (p?: Player | null) =>
  p?.photoThumbURL || p?.photoURL || p?.avatar || "/default-avatar.png";

function toTitleCase(input?: string | null) {
  return (input ?? "")
    .toString()
    .trim()
    .toLowerCase()
    .split(/\s+/)
    .map((w) => (w ? w[0].toUpperCase() + w.slice(1) : ""))
    .join(" ");
}

function formatWhen(startISO?: string, endISO?: string) {
  if (!startISO) return "TBA";
  const start = new Date(startISO);
  const end = endISO ? new Date(endISO) : null;

  const datePart = start.toLocaleDateString([], {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
  });

  const startTime = start.toLocaleTimeString([], {
    hour: "numeric",
    minute: "2-digit",
  });
  const endTime = end
    ? end.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })
    : "";

  return `${datePart} • ${startTime}${endTime ? ` - ${endTime}` : ""}`;
}

function buildCourtAddress(event: EventDoc) {
  const c = event.court;
  const full = [c?.address, c?.suburb, c?.state, c?.postcode].filter(Boolean).join(", ");
  return full || event.location || "";
}

function mapsEmbedUrlForAddress(address?: string | null) {
  const q = (address || "").trim();
  if (!q) return "";
  return `https://www.google.com/maps?q=${encodeURIComponent(q)}&output=embed`;
}

function StatusPill({ status }: { status?: EventDoc["status"] }) {
  const base = "inline-flex items-center rounded-full px-3 py-1 text-xs font-extrabold";
  const s = (status || "open").toString();
  if (s === "open")
    return <span className={`${base} bg-emerald-100 text-emerald-800`}>OPEN</span>;
  if (s === "full")
    return <span className={`${base} bg-amber-100 text-amber-800`}>FULL</span>;
  if (s === "cancelled")
    return <span className={`${base} bg-red-100 text-red-800`}>CANCELLED</span>;
  if (s === "completed")
    return <span className={`${base} bg-gray-200 text-gray-700`}>COMPLETED</span>;
  return <span className={`${base} bg-gray-100 text-gray-800`}>{s.toUpperCase()}</span>;
}

export default function DesktopEventDetailsPage(props: {
  eventId: string;
  event: EventDoc;
  uid: string | null;

  hostProfile: Player | null;
  participantProfiles: Record<string, Player | undefined>;

  conversationId: string | null;

  // ✅ new props passed from /events/[id]/page.tsx
  isHost: boolean;
  status: "open" | "full" | "cancelled" | "completed";

  // actions are passed in from the route page
  onCancelEvent: () => void;
  cancelling: boolean;

    // ✅ Booking confirmed (passed from /events/[id]/page.tsx)
  onConfirmBooking: () => void;
  confirmingBooking: boolean;

   canRequest: boolean;
  hasPendingRequest: boolean;
  sendingJoin: boolean;
  onJoinRequest: () => void;

  isParticipant: boolean;
  isFull: boolean;
  authLoading: boolean;

   requests: JoinRequest[];
  acceptingId: string | null;
  onAcceptRequest: (req: JoinRequest) => void;
  onDeclineRequest: (req: JoinRequest) => void;
  

}) {
  const {
    eventId,
    event,
    uid,
    hostProfile,
    participantProfiles,
    conversationId,
    isHost,
    status,
    onCancelEvent,
    cancelling,

      onConfirmBooking,
    confirmingBooking,

      canRequest,
    hasPendingRequest,
    sendingJoin,
    onJoinRequest,
    isParticipant,
    isFull,
    authLoading,

     requests,
    acceptingId,
    onAcceptRequest,
    onDeclineRequest,
    
  } = props;

    const [profileOpenId, setProfileOpenId] = useState<string | null>(null);

  // Close profile modal on Escape
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setProfileOpenId(null);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  // Lock scroll while profile modal is open
  useEffect(() => {
    if (!profileOpenId) return;

    const prevOverflow = document.body.style.overflow;
    const prevTouch = document.body.style.touchAction;

    document.body.style.overflow = "hidden";
    document.body.style.touchAction = "none";

    return () => {
      document.body.style.overflow = prevOverflow;
      document.body.style.touchAction = prevTouch;
    };
  }, [profileOpenId]);

  const filled =
    typeof event.spotsFilled === "number"
      ? event.spotsFilled
      : event.participants?.length ?? 0;

  const total =
    typeof event.spotsTotal === "number" && event.spotsTotal > 0 ? event.spotsTotal : null;

  const remaining = total !== null ? Math.max(0, total - filled) : null;

  const participants = useMemo(() => {
    const ids = Array.from(new Set(event.participants ?? []));
    const hostId = event.hostId;

    const out: Array<{ id: string; profile?: Player; isHost?: boolean }> = [];

    if (hostId) {
      out.push({ id: hostId, profile: hostProfile ?? undefined, isHost: true });
    }

    ids
      .filter((id) => id && id !== hostId)
      .forEach((id) => out.push({ id, profile: participantProfiles[id] }));

    const openSlots = total !== null ? Math.max(0, total - out.length) : 0;
    for (let i = 0; i < openSlots; i++) out.push({ id: `open-${i}` });

    return out;
  }, [event.participants, event.hostId, hostProfile, participantProfiles, total]);

    const pendingRequests = useMemo(
    () => (requests || []).filter((r) => r.status === "pending"),
    [requests]
  );

  return (
  <div className="min-h-screen" style={{ background: TM.bg }}>
    <div className="w-full px-8 2xl:px-12 py-8">
      <div className="grid gap-8 2xl:gap-10 xl:grid-cols-[300px_1fr]">
        {/* Sidebar (match home) */}
        <TMDesktopSidebar active="Events" player={null} />

        {/* Main (match home) */}
        <main className="min-w-0 xl:pr-[460px] 2xl:pr-[520px]">
          <div className="mt-2 grid gap-8 2xl:gap-10">
            {/* Left column content */}
            <section className="min-w-0">
              {/* Hero */}
              <div className="overflow-hidden rounded-3xl border border-gray-200 bg-white shadow-sm">
                <div className="relative h-[210px] w-full">
                  <img
                    src="/images/eventspagetile.jpg"
                    alt=""
                    className="h-full w-full object-cover"
                    loading="lazy"
                  />
                  <div className="absolute inset-0 bg-black/25" />

                  <div className="absolute left-6 top-6">
                    <span
                      className="rounded-full px-3 py-1 text-[11px] font-extrabold"
                      style={{ background: TM.neon, color: TM.forest }}
                    >
                      TRENDING EVENT
                    </span>
                  </div>

                  <div className="absolute bottom-6 left-6 right-6 flex items-end justify-between gap-4">
                    <div className="min-w-0">
                      <h1 className="text-3xl font-extrabold text-white drop-shadow-sm line-clamp-2">
                        {event.title || "Tennis Event"}
                      </h1>

                      <div className="mt-2 flex items-center gap-3">
                        <StatusPill status={event.status as any} />
                        {event.type ? (
                          <span className="rounded-full bg-white/20 px-3 py-1 text-xs font-bold text-white backdrop-blur">
                            {(event.type || "").toString()}
                          </span>
                        ) : null}
                      </div>
                    </div>

                    {/* Right CTA cluster */}
                    <div className="flex items-center gap-3">
                      {/* ✅ Request to Join (non-host) */}
                      {!isHost && (
                        <>
                          {hasPendingRequest ? (
                            <button
                              type="button"
                              disabled
                              className="inline-flex items-center gap-2 rounded-xl bg-gray-200 px-4 py-2 text-sm font-extrabold text-gray-700"
                              title="Your join request is awaiting approval"
                            >
                              Request Pending
                            </button>
                          ) : canRequest ? (
                            <button
                              type="button"
                              onClick={onJoinRequest}
                              disabled={sendingJoin}
                              className="inline-flex items-center justify-center gap-2 rounded-xl px-4 py-2 text-sm font-extrabold shadow-sm disabled:opacity-70"
                              style={{
                                background: TM.neon,
                                color: TM.forest,
                                boxShadow: "0 10px 24px rgba(57,255,20,0.20)",
                              }}
                              title="Request to join this event"
                            >
                              {sendingJoin ? "Sending…" : "Request to Join"}
                            </button>
                          ) : (
                            <button
                              type="button"
                              disabled
                              className="inline-flex items-center gap-2 rounded-xl bg-white/20 px-4 py-2 text-sm font-extrabold text-white backdrop-blur"
                              title={
                                authLoading
                                  ? "Checking your account…"
                                  : isParticipant
                                  ? "You’ve already joined"
                                  : isFull
                                  ? "Event is full"
                                  : status === "cancelled"
                                  ? "Event was cancelled"
                                  : status === "completed"
                                  ? "Event has finished"
                                  : "Join unavailable"
                              }
                            >
                              {authLoading
                                ? "Loading…"
                                : isParticipant
                                ? "You’ve Joined"
                                : isFull
                                ? "Full"
                                : status === "cancelled"
                                ? "Cancelled"
                                : status === "completed"
                                ? "Completed"
                                : "Unavailable"}
                            </button>
                          )}
                        </>
                      )}

                      {/* Group chat */}
                      {conversationId && status !== "cancelled" && (
                        <Link
                          href={`/messages/${conversationId}`}
                          className="inline-flex items-center gap-2 rounded-xl border border-white/30 bg-white/15 px-4 py-2 text-sm font-extrabold text-white backdrop-blur hover:bg-white/20"
                          title="Open group chat"
                        >
                          <MessageCircle className="h-4 w-4" />
                          Group Chat
                        </Link>
                      )}

                      {/* Host actions */}
                      {isHost && status !== "cancelled" && status !== "completed" && (
                        <>
                          <Link
                            href={`/events/new?edit=${eventId}`}
                            className="inline-flex items-center gap-2 rounded-xl border border-white/30 bg-white/15 px-4 py-2 text-sm font-extrabold text-white backdrop-blur hover:bg-white/20"
                            title="Edit this event"
                          >
                            <Pencil className="h-4 w-4" />
                            Edit Event
                          </Link>

                          <button
                            type="button"
                            onClick={onCancelEvent}
                            disabled={cancelling}
                            className="inline-flex items-center gap-2 rounded-xl bg-red-600 px-4 py-2 text-sm font-extrabold text-white hover:bg-red-700 disabled:opacity-70"
                            title="Cancel this event"
                          >
                            <XCircle className="h-4 w-4" />
                            {cancelling ? "Cancelling…" : "Cancel Event"}
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                </div>

                {/* Organizer row */}
                <div className="flex flex-wrap items-center justify-between gap-4 p-5">
                  <div className="flex items-center gap-3">
                    <img
                      src={pickPlayerImg(hostProfile)}
                      alt={hostProfile?.name || "Host"}
                      className="h-10 w-10 rounded-full object-cover"
                    />
                    <div>
                      <div className="text-xs text-gray-500">Organized by</div>
                      <div className="text-sm font-extrabold text-gray-900">
                        {hostProfile?.name || "Host"}
                        <span className="ml-2 rounded-full bg-emerald-100 px-2 py-0.5 text-[11px] font-bold text-emerald-800">
                          Verified Host
                        </span>
                      </div>
                    </div>
                  </div>

                  <div className="text-sm">
                    <div className="text-xs text-gray-500">Availability</div>
                    <div className="font-extrabold" style={{ color: TM.forest }}>
                      {total !== null ? `${remaining} slots remaining` : "Open"}
                    </div>
                  </div>
                </div>
              </div>

              {/* Main grid (left content only now) */}
              <div className="mt-6 space-y-6">
                {/* Event Info */}
                <div className="rounded-3xl border border-gray-200 bg-white p-6 shadow-sm">
                  <div className="mb-4 flex items-center justify-between">
                    <div className="text-sm font-extrabold" style={{ color: TM.forest }}>
                      Event Info
                    </div>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                    {/* When */}
                    <div className="flex items-start gap-3">
                      <div className="grid h-10 w-10 place-items-center rounded-xl bg-lime-100">
                        <CalendarDays className="h-5 w-5" style={{ color: TM.forest }} />
                      </div>
                      <div>
                        <div className="text-xs font-extrabold text-gray-700">When</div>
                        <div className="mt-1 text-sm font-semibold text-gray-900">
                          {formatWhen(event.start, event.end)}
                        </div>
                        {event.durationMins ? (
                          <div className="mt-1 text-xs text-gray-500">
                            ({event.durationMins} mins)
                          </div>
                        ) : null}
                      </div>
                    </div>

                    {/* Skill */}
                    <div className="flex items-start gap-3">
                      <div className="grid h-10 w-10 place-items-center rounded-xl bg-lime-100">
                        <ShieldCheck className="h-5 w-5" style={{ color: TM.forest }} />
                      </div>

                      <div>
                        <div className="text-xs font-extrabold text-gray-700">Skill Level</div>

                        <div className="mt-1 flex flex-wrap items-center gap-2">
                          <span className="rounded-full bg-gray-100 px-3 py-1 text-xs font-bold text-gray-800">
                            {event.minSkillLabel
                              ? toTitleCase(event.minSkillLabel)
                              : typeof event.minSkill === "number"
                              ? `Min ${event.minSkill}`
                              : "Any"}
                          </span>

                          <span className="text-xs text-gray-500">to</span>

                          <span className="rounded-full bg-gray-100 px-3 py-1 text-xs font-bold text-gray-800">
                            {event.maxSkillLabel ? toTitleCase(event.maxSkillLabel) : "Any"}
                          </span>
                        </div>
                      </div>
                    </div>

                    {/* Location + Map + Booking */}
                    <div className="flex items-start gap-3 md:col-span-2">
                      <div className="grid h-10 w-10 place-items-center rounded-xl bg-lime-100">
                        <MapPin className="h-5 w-5" style={{ color: TM.forest }} />
                      </div>

                      <div className="min-w-0 flex-1">
                        <div className="text-xs font-extrabold text-gray-700">Location</div>

                        <div className="mt-1 text-sm font-semibold text-gray-900">
                          {event.court?.name || event.location || "TBA"}
                        </div>

                        {!!buildCourtAddress(event) && (
                          <div className="mt-1 text-xs text-gray-600">
                            {buildCourtAddress(event)}
                          </div>
                        )}

                        {!!buildCourtAddress(event) && (
                          <div className="mt-3 overflow-hidden rounded-2xl border border-gray-200">
                            <iframe
                              src={mapsEmbedUrlForAddress(buildCourtAddress(event))}
                              width="100%"
                              height="240"
                              loading="lazy"
                              referrerPolicy="no-referrer-when-downgrade"
                              className="block w-full"
                            />
                          </div>
                        )}

                        {!!event.court?.bookingUrl && !event.bookingConfirmed && (
                          <a
                            href={event.court.bookingUrl}
                            target="_blank"
                            rel="noreferrer"
                            className="mt-3 inline-flex w-full items-center justify-center rounded-xl px-4 py-3 text-[12px] font-extrabold"
                            style={{
                              background: TM.neon,
                              color: TM.forest,
                              boxShadow: "0 6px 18px rgba(57,255,20,0.22)",
                            }}
                          >
                            Book Court ↗
                          </a>
                        )}

                        {event.bookingConfirmed ? (
                          <div className="mt-3 inline-flex w-full items-center justify-center gap-2 rounded-xl bg-emerald-100 px-4 py-3 text-[12px] font-extrabold text-emerald-800">
                            <CheckCircle2 className="h-4 w-4" />
                            Booking Confirmed by Host
                          </div>
                        ) : (
                          isHost &&
                          status !== "cancelled" &&
                          status !== "completed" &&
                          !!buildCourtAddress(event) && (
                            <button
                              type="button"
                              onClick={onConfirmBooking}
                              disabled={confirmingBooking}
                              className="mt-3 inline-flex w-full items-center justify-center gap-2 rounded-xl px-4 py-3 text-[12px] font-extrabold disabled:opacity-70"
                              style={{ background: "#0B3D2E", color: "white" }}
                              title="Confirm to all players that the court is booked"
                            >
                              <CheckCircle2 className="h-4 w-4" />
                              {confirmingBooking ? "Confirming…" : "Booking Confirmed"}
                            </button>
                          )
                        )}
                      </div>
                    </div>
                  </div>
                </div>

                {/* About */}
                <div className="rounded-3xl border border-gray-200 bg-white p-6 shadow-sm">
                  <div className="text-sm font-extrabold" style={{ color: TM.forest }}>
                    About the Match
                  </div>

                  <p className="mt-3 whitespace-pre-wrap text-sm leading-6 text-gray-700">
                    {event.description?.trim() ? event.description : "No description provided."}
                  </p>
                </div>
              </div>
            </section>

            {/* ✅ Right rail (fixed like home) */}
            <aside
              className="
                min-w-0
                xl:fixed xl:top-8 xl:right-8 2xl:right-12
                xl:w-[420px] 2xl:w-[480px]
                xl:max-h-[calc(100vh-4rem)]
                xl:overflow-auto
              "
            >
              <div className="space-y-6">
                {/* HOST: Join Requests */}
                {isHost && status !== "cancelled" && status !== "completed" && (
                  <div className="rounded-3xl border border-gray-200 bg-white p-6 shadow-sm">
                    <div className="mb-4 flex items-center justify-between">
                      <div className="text-sm font-extrabold" style={{ color: TM.forest }}>
                        Join Requests
                      </div>

                      <div className="text-xs font-bold text-gray-500">
                        {pendingRequests.length} pending
                      </div>
                    </div>

                    {pendingRequests.length === 0 ? (
                      <div className="rounded-2xl border border-dashed border-gray-200 p-4 text-center">
                        <div className="text-sm font-semibold text-gray-700">
                          No pending requests
                        </div>
                        <div className="mt-1 text-xs text-gray-500">
                          When someone requests to join, they’ll appear here.
                        </div>
                      </div>
                    ) : (
                      <div className="space-y-3">
                        {pendingRequests.map((r) => {
                          const p = r.profile;
                          return (
                            <div
                              key={r.id}
                              className="flex items-center justify-between gap-3 rounded-2xl border border-gray-200 p-3"
                            >
                              <button
                                type="button"
                                onClick={() => setProfileOpenId(r.userId)}
                                className="flex min-w-0 items-center gap-3 text-left hover:opacity-90"
                                title="View profile"
                              >
                                <img
                                  src={pickPlayerImg(p ?? null)}
                                  alt={p?.name || "Player"}
                                  className="h-10 w-10 rounded-full object-cover"
                                />
                                <div className="min-w-0">
                                  <div className="truncate text-sm font-extrabold text-gray-900">
                                    {p?.name || "Unknown Player"}
                                  </div>
                                  <div className="truncate text-[11px] text-gray-500">
                                    Requested to join
                                  </div>
                                </div>
                              </button>

                              <div className="flex shrink-0 items-center gap-2">
                                <button
                                  type="button"
                                  onClick={() => onDeclineRequest(r)}
                                  className="rounded-xl border border-gray-200 bg-white px-3 py-2 text-[12px] font-extrabold text-gray-700 hover:bg-gray-50"
                                  title="Decline request"
                                >
                                  Decline
                                </button>

                                <button
                                  type="button"
                                  onClick={() => onAcceptRequest(r)}
                                  disabled={acceptingId === r.id || isFull}
                                  className="rounded-xl px-3 py-2 text-[12px] font-extrabold text-white disabled:opacity-70"
                                  style={{ background: TM.forest }}
                                  title="Accept request"
                                >
                                  {acceptingId === r.id ? "Accepting…" : "Accept"}
                                </button>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                )}

                {/* Players card */}
                <div className="rounded-3xl border border-gray-200 bg-white p-6 shadow-sm">
                  <div className="mb-4 flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <div className="text-sm font-extrabold" style={{ color: TM.forest }}>
                        Players
                      </div>
                      {total !== null ? (
                        <div className="text-xs text-gray-500">
                          {filled}/{total}
                        </div>
                      ) : null}
                    </div>

                    <Link
                      href="#"
                      className="text-xs font-extrabold"
                      style={{ color: TM.forest }}
                      onClick={(e) => e.preventDefault()}
                    >
                      See All
                    </Link>
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    {participants.slice(0, 6).map((p) => {
                      const isOpenSlot = p.id.startsWith("open-");
                      if (isOpenSlot) {
                        return (
                          <div
                            key={p.id}
                            className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-gray-200 p-4 text-center"
                          >
                            <div className="grid h-12 w-12 place-items-center rounded-full bg-gray-100 text-gray-400">
                              <Users className="h-5 w-5" />
                            </div>
                            <div className="mt-2 text-xs font-semibold text-gray-400">
                              Open Slot
                            </div>
                          </div>
                        );
                      }

                      return (
                        <button
                          key={p.id}
                          type="button"
                          onClick={() => setProfileOpenId(p.id)}
                          className="flex flex-col items-center rounded-2xl border border-gray-200 p-4 hover:bg-gray-50"
                          title="View profile"
                        >
                          <div className="relative">
                            <img
                              src={pickPlayerImg(p.profile ?? null)}
                              alt={p.profile?.name || "Player"}
                              className="h-14 w-14 rounded-full object-cover"
                            />
                            {p.isHost ? (
                              <span
                                className="absolute -bottom-2 left-1/2 -translate-x-1/2 rounded-full px-2 py-0.5 text-[10px] font-extrabold"
                                style={{ background: TM.neon, color: TM.forest }}
                              >
                                HOST
                              </span>
                            ) : null}
                          </div>

                          <div className="mt-3 text-xs font-extrabold text-gray-900 text-center line-clamp-1">
                            {p.profile?.name || "Player"}
                          </div>
                        </button>
                      );
                    })}
                  </div>

                  <div className="mt-4">
                    <Link
                      href="#"
                      className="block w-full rounded-xl border border-gray-200 bg-white px-4 py-2 text-center text-xs font-extrabold text-gray-700 hover:bg-gray-50"
                      onClick={(e) => e.preventDefault()}
                    >
                      View Full Roster
                    </Link>
                  </div>
                </div>
              </div>
            </aside>

            {/* Profile overlay modal (unchanged) */}
            {profileOpenId && (
              <div className="fixed inset-0 z-[9999]">
                <div
                  className="absolute inset-0 bg-black/60"
                  onMouseDown={() => setProfileOpenId(null)}
                />

                <div className="absolute inset-0 flex items-start justify-center px-3 pt-3 pb-4 sm:items-center sm:p-6">
                  <div
                    className="w-full max-w-[680px] rounded-2xl shadow-2xl overflow-hidden"
                    style={{ background: "#071B15" }}
                    onMouseDown={(e) => e.stopPropagation()}
                  >
                    <div
                      style={{
                        height: "min(88dvh, 860px)",
                        maxHeight: "min(88dvh, 860px)",
                      }}
                    >
                      <PlayerProfileView
                        playerId={profileOpenId}
                        onClose={() => setProfileOpenId(null)}
                      />
                    </div>
                  </div>
                </div>
              </div>
            )}

            <div className="h-10" />
          </div>
        </main>
      </div>
    </div>
  </div>
);
}


