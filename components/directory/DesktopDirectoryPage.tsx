"use client";

import Image from "next/image";
import { Search } from "lucide-react";

type Player = {
  id: string;
  name: string;
  postcode: string;
  skillLevel: string;
  photoURL?: string;
  photoThumbURL?: string;
};

const TM = {
  forest: "#0B3D2E",
  neon: "#39FF14",
  bg: "#F7FAF8",
  ink: "#0F172A",
};

export default function DesktopDirectoryPage(props: {
  loading: boolean;

  searchTerm: string;
  setSearchTerm: (v: string) => void;

  players: Player[];
  totalPlayers: number | null;

  canLoadMore: boolean;
  loadingMore: boolean;
  onLoadMore: () => void;

  onViewProfile: (id: string) => void;
}) {
  const {
    loading,
    searchTerm,
    setSearchTerm,
    players,
    totalPlayers,
    canLoadMore,
    loadingMore,
    onLoadMore,
    onViewProfile,
  } = props;

  return (
    <div className="min-w-0">
      {/* Top bar (title + icons) */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-[28px] font-extrabold tracking-tight" style={{ color: TM.forest }}>
            Directory
          </h1>
          <div className="mt-1 text-sm" style={{ color: "rgba(11,61,46,0.60)" }}>
            {totalPlayers != null ? `${totalPlayers} total players` : "Directory"}
          </div>
        </div>
      </div>

      {/* Search + quick filter row (visual only for now) */}
      <div className="mt-4 rounded-2xl border bg-white p-3 shadow-sm"
        style={{ borderColor: "rgba(11,61,46,0.10)" }}
      >
        <div className="relative">
          <Search
            className="absolute left-3 top-1/2 -translate-y-1/2 h-5 w-5"
            style={{ color: "rgba(11,61,46,0.45)" }}
          />
          <input
            type="text"
            placeholder="Search players by name or area"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
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
          <div className="mt-4 grid grid-cols-2 gap-4">
            {Array.from({ length: 6 }).map((_, i) => (
              <div
                key={i}
                className="rounded-2xl border bg-white p-4 shadow-sm animate-pulse"
                style={{ borderColor: "rgba(11,61,46,0.10)" }}
              >
                <div className="h-16 w-16 rounded-full bg-gray-200 mx-auto" />
                <div className="mt-3 h-4 w-32 bg-gray-200 rounded mx-auto" />
                <div className="mt-2 h-3 w-24 bg-gray-200 rounded mx-auto" />
                <div className="mt-4 h-9 w-full bg-gray-200 rounded-xl" />
              </div>
            ))}
          </div>
        ) : players.length === 0 ? (
          <div className="mt-4 rounded-2xl border bg-white p-10 text-center"
            style={{ borderColor: "rgba(11,61,46,0.12)" }}
          >
            <div className="font-semibold" style={{ color: TM.forest }}>
              No players found
            </div>
            <div className="text-sm mt-1" style={{ color: "rgba(11,61,46,0.65)" }}>
              Try another search.
            </div>
          </div>
        ) : (
          <>
            {/* Grid like screenshot */}
            <div className="mt-4 grid grid-cols-2 gap-4">
              {players.map((p) => {
                const avatarSrc =
                  p.photoThumbURL || p.photoURL || "/default-avatar.png";

                return (
                  <div
                    key={p.id}
                    className="rounded-2xl border bg-white p-4 shadow-sm"
                    style={{ borderColor: "rgba(11,61,46,0.10)" }}
                  >
                    <div className="flex flex-col items-center text-center">
<div
  className="relative aspect-square w-[110px] overflow-hidden rounded-2xl"
  style={{
    background: "rgba(0,0,0,0.04)",
    border: "1px solid rgba(0,0,0,0.10)",
  }}
>

  <Image
    src={avatarSrc}
    alt={p.name || "Player"}
    fill
    sizes="(min-width: 1024px) 240px, 100vw"
    className="object-cover object-center"
  />
</div>


                      <div className="mt-3 font-extrabold" style={{ color: TM.forest }}>
                        {p.name || "Player"}
                      </div>

                      <div className="mt-1 text-[10px] font-extrabold uppercase"
                        style={{ color: "rgba(11,61,46,0.60)" }}
                      >
                        {p.skillLevel || "—"}
                      </div>

                      <div className="mt-1 text-[11px]" style={{ color: "rgba(11,61,46,0.55)" }}>
                        {p.postcode || "—"}
                      </div>

                      <button
                        type="button"
                        onClick={() => onViewProfile(p.id)}
                        className="mt-3 w-full rounded-xl py-2.5 text-[12px] font-extrabold"
                        style={{
                          background: "rgba(11,61,46,0.06)",
                          color: TM.forest,
                          border: "1px solid rgba(11,61,46,0.12)",
                        }}
                      >
                        View Profile
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Load more */}
            <div className="mt-6 flex justify-center">
              {canLoadMore ? (
              <button
  onClick={onLoadMore}
  disabled={loadingMore}
  className="inline-flex items-center gap-2 rounded-full px-5 py-2 text-sm font-semibold disabled:opacity-60"
  style={{ color: TM.forest, background: "transparent" }}
>
  {loadingMore ? "Loading…" : "Load More"}
</button>

              ) : (
                <div className="text-xs" style={{ color: "rgba(11,61,46,0.45)" }}>
                  No more players
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
