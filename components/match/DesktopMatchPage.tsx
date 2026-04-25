"use client";

import Image from "next/image";
import { useEffect, useCallback, useMemo, useRef, useState } from "react";
import PlayerProfileView from "@/components/players/PlayerProfileView";
import { CalendarDays, MapPin, X } from "lucide-react";

const TM = {
  forest: "#0B3D2E",
  forestDark: "#071B15",
  neon: "#39FF14",
  ink: "#EAF7F0",
  sub: "rgba(234,247,240,0.75)",
};

type ActivityLevel = "online" | "recent" | "inactive";

const getActivityLevel = (lastActiveAt: any): ActivityLevel => {
  if (!lastActiveAt) return "inactive";

  const lastActive =
    typeof lastActiveAt?.toDate === "function"
      ? lastActiveAt.toDate()
      : new Date(lastActiveAt);

  const diffMs = Date.now() - lastActive.getTime();
  if (!Number.isFinite(diffMs) || diffMs < 0) return "inactive";

  const mins = diffMs / (1000 * 60);
  const days = mins / (60 * 24);

  if (mins <= 5) return "online";
  if (days <= 14) return "recent";
  return "inactive";
};

const getActivityAgoLabel = (lastActiveAt: any): string => {
  if (!lastActiveAt) return "Offline";

  const lastActive =
    typeof lastActiveAt?.toDate === "function"
      ? lastActiveAt.toDate()
      : new Date(lastActiveAt);

  const diffMs = Date.now() - lastActive.getTime();
  if (!Number.isFinite(diffMs) || diffMs < 0) return "Offline";

  const mins = Math.floor(diffMs / (1000 * 60));
  const hrs = Math.floor(mins / 60);
  const days = Math.floor(hrs / 24);

  if (mins <= 5) return "ONLINE NOW";
  if (mins < 60) return `Active ${mins} mins ago`;
  if (hrs < 24) return `Active ${hrs} hours ago`;
  if (days === 1) return "Active yesterday";
  return `Active ${days} days ago`;
};

const getActivityBadge = (lastActiveAt: any) => {
  const level = getActivityLevel(lastActiveAt);
  const agoLabel = getActivityAgoLabel(lastActiveAt);

  if (level === "online") {
    return {
      label: "ONLINE NOW",
      style: {
        background: "rgba(57,255,20,0.18)",
        border: "1.5px solid #39FF14",
        color: "#0B3D2E",
        boxShadow: "0 0 12px rgba(57,255,20,0.7)",
      } as React.CSSProperties,
    };
  }

  if (level === "recent") {
    return {
      label: agoLabel,
      style: {
        background: "rgba(255,200,0,0.15)",
        border: "1px solid rgba(255,200,0,0.6)",
        color: "#0B3D2E",
      } as React.CSSProperties,
    };
  }

  return {
    label: agoLabel,
    style: {
      background: "rgba(15,23,42,0.06)",
      border: "1px solid rgba(15,23,42,0.12)",
      color: "rgba(15,23,42,0.6)",
    } as React.CSSProperties,
  };
};

type AgeBand = "" | "18-24" | "25-34" | "35-44" | "45-54" | "55+";
type GenderFilter = "" | "Male" | "Female" | "Non-binary" | "Other";
type ActivityFilter = "" | "online" | "recent" | "offline";

export default function DesktopMatchPage(props: {
  loading: boolean;
  myProfileHidden: boolean;
  sortedMatches: any[];
  visibleMatches: any[];
  visibleCount: number;
  pageSize: number;
  refreshing: boolean;

  filtersActive: boolean;
  filtersOpen: boolean;
  setFiltersOpen: (v: boolean) => void;

  sortBy: string;
  setSortBy: (v: string) => void;

  matchMode: "auto" | "skill" | "utr";
  setMatchMode: (v: "auto" | "skill" | "utr") => void;

  ageBand: AgeBand;
  setAgeBand: (v: AgeBand) => void;

  genderFilter: GenderFilter;
  setGenderFilter: (v: GenderFilter) => void;

  activityFilter: ActivityFilter;
setActivityFilter: (v: ActivityFilter) => void;

  hideContacted: boolean;
  setHideContacted: (v: boolean) => void;
  matchSurface: "players" | "availability";
  setMatchSurface: (v: "players" | "availability") => void;
  activeAvailability: {
    dateLabel: string;
    timeLabel: string;
    postcode: string;
    radiusLabel: string;
    matchTypeLabel: string;
    note: string;
  } | null;
  browseAvailabilityCards: Array<{
    id: string;
    userId: string;
    availabilityInstanceId: string;
    name: string;
    photoURL?: string | null;
    postcode?: string | null;
    skillLabel: string;
    distanceLabel: string;
    dateLabel: string;
    timeLabel: string;
    matchTypeLabel: string;
    note?: string;
  }>;
  sentRequestUserIds: Set<string>;
  sendingRequestUserIds: Set<string>;
  pendingAvailabilityInterestKeys: Set<string>;

  onLoadMore: () => void;
  onInvite: (match: any) => void;
  onDismiss: (match: any) => void;
  onViewProfile: (id: string) => void;
  onOpenAvailabilityRequest: () => void;
  onOpenAvailabilityActions: () => void;

  profileOpenId: string | null;
  setProfileOpenId: (id: string | null) => void;
}) {
  const {
    loading,
    myProfileHidden,
    sortedMatches,
    visibleMatches,
    visibleCount,
    refreshing,

    // filtersActive, // not used in this component UI yet
    setFiltersOpen,

    sortBy,
    setSortBy,
    matchMode,
    setMatchMode,
    ageBand,
    setAgeBand,
    genderFilter,
    setGenderFilter,
    activityFilter,
    setActivityFilter,
    hideContacted,
    setHideContacted,
    matchSurface,
    setMatchSurface,
    activeAvailability,
    browseAvailabilityCards,
    sentRequestUserIds,
    sendingRequestUserIds,
    pendingAvailabilityInterestKeys,

    onLoadMore,
    onInvite,
    onDismiss,
    onViewProfile,
    onOpenAvailabilityRequest,
    onOpenAvailabilityActions,

    profileOpenId,
    setProfileOpenId,
  } = props;


// ✅ Small helper: derive Auth UID (preferred) with safe fallbacks
const deriveRecipientId = (p: any): string | null => {
  const candidate =
    p?.userId ??  // ✅ auth uid (preferred)
    p?.uid ??     // ✅ auth uid (alternate)
    p?.docId ??   // ✅ if players doc id == auth uid
    p?.id ??      // ✅ last fallback
    null;

  const recipient =
    typeof candidate === "string" && candidate.trim() ? candidate.trim() : null;

  return recipient;
};

const handleInvite = useCallback(
  (p: any) => {
    const recipient = deriveRecipientId(p);
    if (!recipient) return;
    onInvite(p);
  },
  [onInvite]
);

  // ---------------- Existing display helpers ----------------
  const formatDistance = (p: any) => {
    const raw =
      typeof p?.distanceKm === "number"
        ? p.distanceKm
        : typeof p?.distance === "number"
        ? p.distance
        : typeof p?.kmAway === "number"
        ? p.kmAway
        : null;

    if (raw == null) return "";
    if (raw < 1) return `${Math.round(raw * 1000)} m`;
    return `${raw.toFixed(1)} km`;
  };

  const getSkillLabel = (p: any) => {
    return p?.skillBandLabel || p?.skillLevel || p?.skill || p?.level || "";
  };

  const getAvailability = (p: any): string[] => {
    const a = p?.availability;
    return Array.isArray(a) ? a.filter(Boolean) : [];
  };

  const formatAvailabilityLine = (p: any) => {
    const a = getAvailability(p);
    if (!a.length) return "";
    if (a.length === 1) return a[0];
    if (a.length === 2) return `${a[0]} & ${a[1]}`;
    return `${a[0]} & ${a[1]} +${a.length - 2}`;
  };

  const formatDistanceAway = (p: any) => {
    const d = formatDistance(p);
    if (!d) return "";
    return `${d} away`;
  };

  useEffect(() => {
    if (!profileOpenId) return;

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setProfileOpenId(null);
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [profileOpenId, setProfileOpenId]);

  // ---------------- UI ----------------
  if (loading) {
    return (
      <div className="min-h-screen bg-white p-10">
        <div className="text-sm text-gray-600">Loading matches…</div>
      </div>
    );
  }

  if (myProfileHidden) {
    return (
      <div className="min-h-screen bg-white p-10">
        <div className="rounded-2xl border bg-white p-6 shadow-sm max-w-xl">
          <div className="text-xl font-bold">Match Me is turned off</div>
          <div className="mt-2 text-sm text-gray-600">
            Your profile is hidden — turn it back on to use Match Me.
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#f6f7f8]">
      <div className="w-full max-w-[1800px] mx-auto px-6 2xl:px-10 py-6">


        {/* TWO-COLUMN LAYOUT */}
        <div className="grid grid-cols-[minmax(0,1fr)_340px] gap-8 items-start">
          {/* LEFT */}
          <div className="min-w-0">
            <div className="flex items-start justify-between gap-6">
              <div>
                <div className="flex items-center gap-3">
                  <div className="text-[22px] font-black tracking-tight text-gray-900">
                    Find a Match
                  </div>

                  <span
                    className="rounded-full px-3 py-1 text-xs font-extrabold"
                    style={{
                      background: "rgba(11,61,46,0.10)",
                      border: "1px solid rgba(11,61,46,0.18)",
                      color: TM.forest,
                    }}
                  >
                    {sortedMatches.length} partners
                  </span>
                </div>

                <div className="text-[12px] text-gray-600 mt-1">
                  Recommended tennis players based on your profile, distance and availability.
                </div>
              </div>

              <button
                type="button"
                onClick={onOpenAvailabilityRequest}
                className="shrink-0 rounded-full px-4 py-2.5 text-sm font-extrabold"
                style={{
                  background: TM.forest,
                  color: "white",
                  boxShadow: "0 10px 24px rgba(11,61,46,0.18)",
                }}
              >
                Post Availability
              </button>
            </div>

            {/* GRID */}
            <main className="mt-6">
              <div className="mb-5 inline-flex rounded-full bg-white p-1 ring-1 ring-black/10">
                <button
                  type="button"
                  onClick={() => setMatchSurface("players")}
                  className="rounded-full px-4 py-2 text-sm font-extrabold transition"
                  style={
                    matchSurface === "players"
                      ? { background: TM.neon, color: TM.forest }
                      : { background: "transparent", color: "rgba(11,61,46,0.62)" }
                  }
                >
                  Players
                </button>
                <button
                  type="button"
                  onClick={() => setMatchSurface("availability")}
                  className="rounded-full px-4 py-2 text-sm font-extrabold transition"
                  style={
                    matchSurface === "availability"
                      ? { background: TM.neon, color: TM.forest }
                      : { background: "transparent", color: "rgba(11,61,46,0.62)" }
                  }
                >
                  Availabilities
                </button>
              </div>

              {matchSurface === "availability" ? (
                <div className="space-y-5">
                  {activeAvailability ? (
                    <button
                      type="button"
                      onClick={onOpenAvailabilityActions}
                      className="w-full rounded-3xl border bg-white p-5 text-left shadow-sm transition hover:-translate-y-0.5 hover:shadow-md"
                    >
                      <div className="flex items-start justify-between gap-4">
                        <div>
                          <div className="text-[11px] font-extrabold uppercase tracking-[0.16em] text-black/45">
                            My Availability
                          </div>
                          <div className="mt-2 text-xl font-black text-[#0B3D2E]">
                            {activeAvailability.dateLabel}
                          </div>
                          <div className="mt-1 text-sm font-semibold text-black/60">
                            {activeAvailability.timeLabel} | {activeAvailability.matchTypeLabel}
                          </div>
                        </div>

                        <span
                          className="rounded-full px-3 py-1 text-xs font-extrabold"
                          style={{ background: "rgba(57,255,20,0.16)", color: TM.forest }}
                        >
                          Looking
                        </span>
                      </div>

                      <div className="mt-4 grid grid-cols-2 gap-3 text-sm text-black/65">
                        <div className="rounded-2xl bg-[#F6F7F8] px-4 py-3">
                          {activeAvailability.postcode} | {activeAvailability.radiusLabel}
                        </div>
                        <div className="rounded-2xl bg-[#F6F7F8] px-4 py-3">
                          {activeAvailability.note || "No note added"}
                        </div>
                      </div>
                      <div className="mt-4 text-xs font-extrabold uppercase tracking-[0.16em] text-black/45">
                        Tap to edit or cancel
                      </div>
                    </button>
                  ) : (
                    <div className="rounded-3xl border bg-white p-6 shadow-sm">
                      <div className="text-lg font-black text-[#0B3D2E]">No live availability yet</div>
                      <div className="mt-2 text-sm text-black/60">
                        Post a time you want to play and browse other open requests here.
                      </div>
                      <button
                        type="button"
                        onClick={onOpenAvailabilityRequest}
                        className="mt-4 rounded-full px-4 py-3 text-sm font-extrabold"
                        style={{ background: TM.forest, color: "#FFFFFF" }}
                      >
                        Post Availability
                      </button>
                    </div>
                  )}

                  <div>
                    <div className="mb-3 text-[11px] font-extrabold uppercase tracking-[0.16em] text-black/45">
                      Browse Open Requests
                    </div>
                    <div className="mb-4 text-sm text-black/60">
                      Explore players who are already looking to play and raise your hand when someone fits.
                    </div>

                    {browseAvailabilityCards.length === 0 ? (
                      <div className="rounded-3xl border bg-white p-6 shadow-sm text-sm text-black/60">
                        No open availability requests are live right now.
                      </div>
                    ) : (
                      <div className="grid grid-cols-2 gap-5 2xl:grid-cols-3">
                        {browseAvailabilityCards.map((card) => (
                          <div key={card.id} className="rounded-3xl border bg-white p-5 shadow-sm">
                            {(() => {
                              const recipientUid = card.userId;
                              const interestKey = `${recipientUid}:${card.availabilityInstanceId}`;
                              const alreadySent = pendingAvailabilityInterestKeys.has(interestKey);
                              const sending = sendingRequestUserIds.has(recipientUid);

                              return (
                                <>
                            <div className="flex items-start gap-3">
                              <div className="relative h-14 w-14 shrink-0 overflow-hidden rounded-full bg-black/5">
                                {card.photoURL ? (
                                  <Image src={card.photoURL} alt={card.name} fill sizes="56px" className="object-cover" />
                                ) : (
                                  <div className="grid h-full w-full place-items-center text-lg font-extrabold text-black/40">
                                    {(card.name || "?").charAt(0).toUpperCase()}
                                  </div>
                                )}
                              </div>

                              <div className="min-w-0 flex-1">
                                <div className="truncate text-base font-extrabold text-[#0B3D2E]">{card.name}</div>
                                <div className="mt-1 text-sm font-semibold text-black/55">
                                  {card.dateLabel} | {card.timeLabel}
                                </div>
                              </div>
                            </div>

                            <div className="mt-4 flex flex-wrap gap-2">
                              <span className="rounded-full bg-[#F6F7F8] px-3 py-1 text-xs font-extrabold text-[#0B3D2E]">
                                {card.matchTypeLabel}
                              </span>
                              <span className="rounded-full bg-[#F6F7F8] px-3 py-1 text-xs font-extrabold text-[#0B3D2E]">
                                {card.skillLabel}
                              </span>
                            </div>

                            <div className="mt-3 space-y-1 text-sm text-black/60">
                              <div>{card.distanceLabel}{card.postcode ? ` | ${card.postcode}` : ""}</div>
                              <div>{card.note || "Open to a casual hit."}</div>
                            </div>

                            <button
                              type="button"
                              onClick={() => onInvite(card)}
                              disabled={alreadySent || sending}
                              className="mt-4 w-full rounded-full py-3 text-sm font-extrabold"
                              style={{
                                background: alreadySent ? "rgba(11,61,46,0.10)" : TM.neon,
                                color: alreadySent ? "rgba(11,61,46,0.60)" : TM.forest,
                                opacity: sending ? 0.75 : 1,
                              }}
                            >
                              {sending ? "Sending..." : alreadySent ? "Request Sent" : "I'm Interested"}
                            </button>
                                </>
                              );
                            })()}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              ) : visibleMatches.length === 0 ? (
  <div className="rounded-2xl border bg-white p-6 shadow-sm text-sm text-gray-700">
    No matches found yet. Try adjusting your filters.
  </div>
) : (
  <>
    {activityFilter === "recent" && (
      <div
        className="text-sm font-semibold mb-4 px-1"
        style={{ color: "rgba(11,61,46,0.70)" }}
      >
        Showing players who have been active recently
      </div>
    )}

    <div className="grid grid-cols-3 gap-6 2xl:grid-cols-4">
{visibleMatches.map((p) => {
  const activityBadge = getActivityBadge(p.lastActiveAt);

  return (
    <div
      key={p.id}
      className="relative rounded-2xl p-4 shadow-sm"
      style={{
        background: "#F6F7F8",
        border: "1px solid rgba(15,23,42,0.08)",
      }}
    >
      <button
        type="button"
        onClick={() => onDismiss(p)}
        className="absolute right-3 top-3 rounded-full p-2"
        style={{
          background: "rgba(15,23,42,0.06)",
          border: "1px solid rgba(15,23,42,0.10)",
          color: "rgba(15,23,42,0.65)",
        }}
        aria-label={`Hide ${p.name} from recommendations`}
        title="Hide this Player"
      >
        <X size={14} />
      </button>

      <div className="relative w-full aspect-square rounded-xl overflow-hidden bg-black/5">

        {p.photoURL ? (
          <Image
            src={p.photoURL}
            alt={p.name}
            fill
            className="object-cover"
          />
        ) : (
          <div className="h-full w-full flex items-center justify-center text-3xl font-bold text-slate-400">
            {(p.name || "?").charAt(0).toUpperCase()}
          </div>
        )}
      </div>

<div className="mt-3">
  <div className="flex items-start justify-between gap-3">
    <div className="min-w-0 flex-1">
      <div className="mb-2">
        <div
          className="inline-flex rounded-full px-2 py-[3px] text-[10px] font-bold uppercase tracking-[0.03em] whitespace-nowrap"
          style={activityBadge.style}
        >
          {activityBadge.label}
        </div>
      </div>

      <div
        className="text-base font-extrabold truncate"
        style={{ color: TM.forest }}
      >
        {p.name}
      </div>

            <div
              className="mt-1 text-sm font-semibold"
              style={{ color: "rgba(11,61,46,0.70)" }}
            >
              {typeof p.distance === "number" ? `${p.distance} km away` : "Distance unknown"}
              {p.postcode ? ` • ${p.postcode}` : ""}
            </div>
          </div>
        </div>

        <div
          className="mt-2 inline-flex items-center rounded-full px-2.5 py-1 text-[11px] font-extrabold"
          style={{
            background: "rgba(57,255,20,0.14)",
            border: "1px solid rgba(57,255,20,0.35)",
            color: TM.forest,
          }}
        >
          LEVEL{" "}
          {typeof (p.skillRating ?? p.utr) === "number"
            ? (p.skillRating ?? p.utr)!.toFixed(1)
            : p.skillBandLabel || p.skillLevel || "Unknown"}
        </div>

        <div
          className="mt-2 flex items-center gap-2 text-sm"
          style={{ color: "rgba(11,61,46,0.70)" }}
        >
          <CalendarDays size={14} />
          <span>{Array.isArray(p.availability) && p.availability.length > 0 ? p.availability.slice(0, 2).join(" & ") : "Availability unknown"}</span>
        </div>

        <div
          className="mt-1 flex items-center gap-2 text-sm"
          style={{ color: "rgba(11,61,46,0.70)" }}
        >
          <MapPin size={14} />
          <span>{p.postcode || "Location unknown"}</span>
        </div>

        <div className="mt-3 flex items-center gap-2">
          <button
            type="button"
            onClick={() => handleInvite(p)}
            className="flex-1 rounded-xl py-2 text-sm font-extrabold"
            style={{
              background: TM.neon,
              color: TM.forest,
            }}
          >
            Invite to Play
          </button>

          <button
            type="button"
            onClick={() => setProfileOpenId(p.docId || p.id)}
            className="rounded-xl px-3 py-2 text-sm font-semibold"
            style={{
              color: "#0B3D2E",
              background: "#ffffff",
              border: "1px solid rgba(11,61,46,0.25)",
            }}
          >
            View Profile
          </button>
        </div>
      </div>
    </div>
  );
})}
</div>

                  {sortedMatches.length > visibleCount && (
                    <div className="mt-6 flex justify-center">
                      <button
                        onClick={onLoadMore}
                        disabled={refreshing}
                        className="rounded-full px-5 py-2 text-sm font-semibold disabled:opacity-60"
                        style={{
                          background: "#ffffff",
                          border: "1px solid rgba(0,0,0,0.10)",
                        }}
                      >
                        {refreshing ? "Loading…" : "Load More Partners"}
                      </button>
                    </div>
                  )}
                </>
              )}
            </main>
          </div>

          {/* RIGHT */}
          <aside className="rounded-2xl border bg-white p-4 shadow-sm h-fit sticky top-6 self-start">
            <div className="text-sm font-bold text-gray-900">Filter Partners</div>

            <div className="mt-4 space-y-4">
              <div>
                <div className="text-xs font-semibold text-gray-700 mb-2">Match by</div>
                <select
                  value={matchMode}
                  onChange={(e) => setMatchMode(e.target.value as any)}
                  className="w-full rounded-xl border bg-white px-3 py-2 text-sm"
                >
                  <option value="auto">Auto</option>
                  <option value="skill">Skill level</option>
                  <option value="utr">TMR</option>
                </select>
              </div>

              <div>
                <div className="text-xs font-semibold text-gray-700 mb-2">Age</div>
                <select
                  value={ageBand}
                  onChange={(e) => setAgeBand(e.target.value as any)}
                  className="w-full rounded-xl border bg-white px-3 py-2 text-sm"
                >
                  <option value="">Any</option>
                  <option value="18-24">18–24</option>
                  <option value="25-34">25–34</option>
                  <option value="35-44">35–44</option>
                  <option value="45-54">45–54</option>
                  <option value="55+">55+</option>
                </select>
              </div>

              <div>
                <div className="text-xs font-semibold text-gray-700 mb-2">Gender</div>
                <select
                  value={genderFilter}
                  onChange={(e) => setGenderFilter(e.target.value as any)}
                  className="w-full rounded-xl border bg-white px-3 py-2 text-sm"
                >
                  <option value="">Any</option>
                  <option value="Male">Male</option>
                  <option value="Female">Female</option>
                  <option value="Non-binary">Non-binary</option>
                  <option value="Other">Other</option>
                </select>
              </div>

              <div>
  <div className="text-xs font-semibold text-gray-700 mb-2">Activity</div>
  <select
    value={activityFilter}
    onChange={(e) => setActivityFilter(e.target.value as ActivityFilter)}
    className="w-full rounded-xl border bg-white px-3 py-2 text-sm"
  >
    <option value="">Any</option>
    <option value="online">Online now</option>
    <option value="recent">Active recently</option>
    <option value="offline">Offline</option>
  </select>
</div>

              <label className="flex items-center gap-2 text-sm text-gray-800">
                <input
                  type="checkbox"
                  className="accent-[#39FF14]"
                  checked={hideContacted}
                  onChange={(e) => setHideContacted(e.target.checked)}
                />
                Hide contacted
              </label>

            </div>
          </aside>
        </div>

        {/* profile overlay */}
        {profileOpenId && (
          <div className="fixed inset-0 z-[9999]">
            <div
              className="absolute inset-0 bg-black/40"
              onMouseDown={() => setProfileOpenId(null)}
            />
            <div className="absolute inset-0 flex items-center justify-center p-4">
              <div
                className="w-[560px] max-w-[92vw] max-h-[92dvh] rounded-2xl overflow-hidden shadow-2xl"
                style={{
                  background: TM.forestDark,
                  border: "1px solid rgba(255,255,255,0.10)",
                }}
                onMouseDown={(e) => e.stopPropagation()}
              >
                <PlayerProfileView
                  playerId={profileOpenId}
                  onClose={() => setProfileOpenId(null)}
                />
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
