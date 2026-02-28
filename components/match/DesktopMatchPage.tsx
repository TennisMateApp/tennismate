"use client";

import Image from "next/image";
import { useEffect, useCallback, useMemo, useRef, useState } from "react";
import PlayerProfileView from "@/components/players/PlayerProfileView";
import { CalendarDays, MapPin } from "lucide-react";

const TM = {
  forest: "#0B3D2E",
  forestDark: "#071B15",
  neon: "#39FF14",
  ink: "#EAF7F0",
  sub: "rgba(234,247,240,0.75)",
};

type AgeBand = "" | "18-24" | "25-34" | "35-44" | "45-54" | "55+";
type GenderFilter = "" | "Male" | "Female" | "Non-binary" | "Other";

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

  hideContacted: boolean;
  setHideContacted: (v: boolean) => void;

  onLoadMore: () => void;
  onInvite: (match: any) => void;
  onViewProfile: (id: string) => void;

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
    hideContacted,
    setHideContacted,

    onLoadMore,
    onInvite,
    onViewProfile,

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
    if (!recipient) return; // optionally show a user-friendly toast later
    onInvite(recipient);
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
            </div>

            {/* GRID */}
            <main className="mt-6">
              {visibleMatches.length === 0 ? (
                <div className="rounded-2xl border bg-white p-6 shadow-sm text-sm text-gray-700">
                  No matches found yet. Try adjusting your filters.
                </div>
              ) : (
                <>
                  <div className="grid grid-cols-3 gap-6 2xl:grid-cols-4">
                    {visibleMatches.map((p) => (
                      <div
                        key={p.id}
                        className="rounded-2xl p-4 shadow-sm"
                        style={{
                          background: "#ffffff",
                          border: "1px solid rgba(0,0,0,0.10)",
                          boxShadow: "0 10px 28px rgba(0,0,0,0.10)",
                        }}
                      >
                        {/* image */}
                        <div
                          className="relative w-full aspect-square rounded-xl overflow-hidden"
                          style={{
                            background: "rgba(0,0,0,0.04)",
                            border: "1px solid rgba(0,0,0,0.08)",
                          }}
                        >
                          {p.photoThumbURL || p.photoURL ? (
                            <>
                              <Image
                                src={p.photoThumbURL || p.photoURL}
                                alt={p.name}
                                fill
                                sizes="260px"
                                className="object-cover object-center"
                              />
                              <div
                                className="absolute inset-0"
                                style={{
                                  background:
                                    "linear-gradient(180deg, rgba(0,0,0,0.04) 0%, rgba(0,0,0,0.10) 100%)",
                                }}
                              />
                            </>
                          ) : (
                            <div className="h-full w-full grid place-items-center text-2xl font-black text-black/50">
                              {(p.name || "?").slice(0, 1).toUpperCase()}
                            </div>
                          )}
                        </div>

                        {/* name/postcode/level */}
                        <div className="mt-3">
                          <div className="flex items-start justify-between gap-3">
                            <div className="flex-1 min-w-0">
                              <div
                                className="font-extrabold text-gray-900 text-base leading-snug"
                                style={{
                                  display: "-webkit-box",
                                  WebkitLineClamp: 2,
                                  WebkitBoxOrient: "vertical",
                                  overflow: "hidden",
                                }}
                              >
                                {p.name}
                              </div>
                            </div>

                            <div className="shrink-0 text-[12px] text-gray-500 font-semibold pt-[2px]">
                              {p.postcode || ""}
                            </div>
                          </div>

                          {!!getSkillLabel(p) && (
                            <div className="mt-2">
                              <span
                                className="inline-flex rounded-full px-2 py-[2px] text-[11px] font-extrabold tracking-wide"
                                style={{ background: TM.neon, color: TM.forest }}
                              >
                                LEVEL {String(getSkillLabel(p)).toUpperCase()}
                              </span>
                            </div>
                          )}
                        </div>

                        {!!formatAvailabilityLine(p) && (
                          <div className="mt-2 flex items-center gap-2 text-[12px] text-gray-600">
                            <CalendarDays size={14} className="shrink-0 opacity-80" />
                            <span className="truncate">{formatAvailabilityLine(p)}</span>
                          </div>
                        )}

                        {!!formatDistanceAway(p) && (
                          <div className="mt-1 flex items-center gap-2 text-[12px] text-gray-600">
                            <MapPin size={14} className="shrink-0 opacity-80" />
                            <span>{formatDistanceAway(p)}</span>
                          </div>
                        )}

                        {/* actions */}
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
                    ))}
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