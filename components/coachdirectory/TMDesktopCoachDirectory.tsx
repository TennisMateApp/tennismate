"use client";

import Image from "next/image";
import Link from "next/link";
import { MapPin, Search } from "lucide-react";

export type CoachListItem = {
  id: string;
  name: string;
  avatar: string | null;
  coachingExperience: string;
  courtAddress: string;
  coachingSkillLevels: string[];
  contactFirstForRate: boolean;
};

const TM = {
  forest: "#0B3D2E",
  neon: "#39FF14",
  bg: "#F7FAF8",
  ink: "#0F172A",
};

export function TMDesktopCoachDirectory(props: {
  loading?: boolean;

  coaches: CoachListItem[];
  totalCoaches?: number | null;

  search: string;
  setSearch: (v: string) => void;

  onViewProfile: (coachId: string) => Promise<void> | void;
  onContactCoach: (coachId: string) => Promise<void> | void;
}) {
  const {
    loading = false,
    coaches,
    totalCoaches = null,
    search,
    setSearch,
    onViewProfile,
    onContactCoach,
  } = props;

  return (
    <div className="min-w-0">
      {/* Top bar (title + subtext) */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1
            className="text-[28px] font-extrabold tracking-tight"
            style={{ color: TM.forest }}
          >
            Coach Directory
          </h1>
          <div className="mt-1 text-sm" style={{ color: "rgba(11,61,46,0.60)" }}>
            {totalCoaches != null
              ? `${totalCoaches} total coaches`
              : `${coaches.length} coaches`}
          </div>
        </div>
      </div>

      {/* Search row (same as DesktopDirectoryPage) */}
      <div
        className="mt-4 rounded-2xl border bg-white p-3 shadow-sm"
        style={{ borderColor: "rgba(11,61,46,0.10)" }}
      >
        <div className="relative">
          <Search
            className="absolute left-3 top-1/2 -translate-y-1/2 h-5 w-5"
            style={{ color: "rgba(11,61,46,0.45)" }}
          />
          <input
            type="text"
            placeholder="Search coaches by name, skill level, or location"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full rounded-xl border pl-10 pr-3 py-2.5 text-sm outline-none"
            style={{
              borderColor: "rgba(11,61,46,0.12)",
              background: "rgba(247,250,248,0.65)",
            }}
          />
        </div>
      </div>

      {/* Content */}
      <div className="mt-5">
        {/* Loading */}
        {loading ? (
          <div className="mt-4 grid grid-cols-2 gap-4 xl:grid-cols-3">
            {Array.from({ length: 6 }).map((_, i) => (
              <div
                key={i}
                className="rounded-2xl border bg-white p-4 shadow-sm animate-pulse"
                style={{ borderColor: "rgba(11,61,46,0.10)" }}
              >
                <div className="h-[110px] w-[110px] rounded-2xl bg-gray-200 mx-auto" />
                <div className="mt-3 h-4 w-40 bg-gray-200 rounded mx-auto" />
                <div className="mt-2 h-3 w-28 bg-gray-200 rounded mx-auto" />
                <div className="mt-4 h-9 w-full bg-gray-200 rounded-xl" />
              </div>
            ))}
          </div>
        ) : coaches.length === 0 ? (
          <div
            className="mt-4 rounded-2xl border bg-white p-10 text-center"
            style={{ borderColor: "rgba(11,61,46,0.12)" }}
          >
            <div className="font-semibold" style={{ color: TM.forest }}>
              No coaches found
            </div>
            <div className="text-sm mt-1" style={{ color: "rgba(11,61,46,0.65)" }}>
              Try another search.
            </div>
          </div>
        ) : (
          <>
            {/* Grid (same pattern as DesktopDirectoryPage) */}
            <div className="mt-4 grid grid-cols-2 gap-4 xl:grid-cols-3">
              {coaches.map((c) => {
                const avatarSrc = c.avatar || "/default-avatar.png";
                const skills = Array.isArray(c.coachingSkillLevels)
                  ? c.coachingSkillLevels
                  : [];

                const specialtyText =
                  skills.length > 0 ? skills.slice(0, 2).join(" & ") : "—";

                return (
                  <div
                    key={c.id}
                    className="rounded-2xl border bg-white p-4 shadow-sm"
                    style={{ borderColor: "rgba(11,61,46,0.10)" }}
                  >
                    <div className="flex flex-col items-center text-center">
                      {/* Avatar block (same square style as players) */}
                      <div
                        className="relative aspect-square w-[110px] overflow-hidden rounded-2xl"
                        style={{
                          background: "rgba(0,0,0,0.04)",
                          border: "1px solid rgba(0,0,0,0.10)",
                        }}
                      >
                        <Image
                          src={avatarSrc}
                          alt={c.name || "Coach"}
                          fill
                          sizes="(min-width: 1280px) 260px, 100vw"
                          className="object-cover object-center"
                        />
                      </div>

                      <div className="mt-3 font-extrabold" style={{ color: TM.forest }}>
                        {c.name || "Coach"}
                      </div>

                      <div
                        className="mt-1 text-[10px] font-extrabold uppercase"
                        style={{ color: "rgba(11,61,46,0.60)" }}
                      >
                        {c.contactFirstForRate ? "Contact for rates" : "Coach"}
                      </div>

                      {/* Specialty */}
                      <div
                        className="mt-1 text-[11px]"
                        style={{ color: "rgba(11,61,46,0.55)" }}
                      >
                        {specialtyText}
                      </div>

                      {/* Location (optional) */}
                      {c.courtAddress?.trim() ? (
                        <div
                          className="mt-2 flex items-center justify-center gap-1.5 text-[11px]"
                          style={{ color: "rgba(11,61,46,0.55)" }}
                          title={c.courtAddress}
                        >
                          <MapPin className="h-3.5 w-3.5" />
                          <span className="line-clamp-1">{c.courtAddress}</span>
                        </div>
                      ) : null}

                      {/* Actions (2 buttons like coaches page) */}
                      <div className="mt-3 grid w-full grid-cols-2 gap-2">
                        <Link
                          href={`/coaches/${c.id}`}
                          onClick={() => onViewProfile(c.id)}
                          className="rounded-xl py-2.5 text-[12px] font-extrabold"
                          style={{
                            background: "rgba(11,61,46,0.06)",
                            color: TM.forest,
                            border: "1px solid rgba(11,61,46,0.12)",
                          }}
                        >
                          View Profile
                        </Link>

                        <button
                          type="button"
                          onClick={() => onContactCoach(c.id)}
                          className="rounded-xl py-2.5 text-[12px] font-extrabold"
                          style={{
                            background: TM.neon,
                            color: TM.forest,
                            border: "1px solid rgba(57,255,20,0.35)",
                          }}
                        >
                          Contact
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
