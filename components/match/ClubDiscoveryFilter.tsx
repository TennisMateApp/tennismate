"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { MapPin, Search, X } from "lucide-react";
import { loadUniqueClubs, searchClubs, type ClubSearchResult } from "@/lib/clubs";
import {
  ANY_CLUB_FILTER,
  getCompleteClubMembership,
  selectedClubFilter,
  type ClubFilter,
  type ClubMembershipLike,
} from "@/lib/matchClubDiscovery";

export default function ClubDiscoveryFilter({
  value,
  currentPlayer,
  onChange,
  tone = "light",
}: {
  value: ClubFilter;
  currentPlayer: ClubMembershipLike | null;
  onChange: (value: ClubFilter) => void;
  tone?: "light" | "dark";
}) {
  const [searchOpen, setSearchOpen] = useState(value.mode === "selected");
  const [queryText, setQueryText] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [clubs, setClubs] = useState<ClubSearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState("");
  const membership = getCompleteClubMembership(currentPlayer);
  const dark = tone === "dark";

  useEffect(() => {
    if (!searchOpen || clubs.length || loading || loadError) return;
    let active = true;
    setLoading(true);
    loadUniqueClubs()
      .then((items) => {
        if (active) setClubs(items);
      })
      .catch((error) => {
        console.error("[MatchClubFilter] failed to load clubs", error);
        if (active) setLoadError("Club search is unavailable right now.");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => { active = false; };
  }, [clubs.length, loadError, loading, searchOpen]);

  useEffect(() => {
    const timeout = window.setTimeout(() => setDebouncedQuery(queryText.trim()), 300);
    return () => window.clearTimeout(timeout);
  }, [queryText]);

  const results = useMemo(
    () => debouncedQuery ? searchClubs(clubs, debouncedQuery, 6) : [],
    [clubs, debouncedQuery]
  );

  const chooseMode = (mode: "any" | "my" | "selected") => {
    if (mode === "any") {
      onChange(ANY_CLUB_FILTER);
      setSearchOpen(false);
    } else if (mode === "my" && membership) {
      onChange({ mode: "my", clubId: null, clubName: null });
      setSearchOpen(false);
    } else if (mode === "selected") {
      setSearchOpen(true);
    }
  };

  return (
    <div>
      <div className={`mb-2 text-xs font-semibold ${dark ? "text-white/80" : "text-gray-700"}`}>Club</div>
      <div className="grid grid-cols-3 gap-1.5">
        {([
          ["any", "Any club"],
          ["my", "My club"],
          ["selected", "Select club"],
        ] as const).map(([mode, label]) => {
          const disabled = mode === "my" && !membership;
          const active = value.mode === mode || (mode === "selected" && searchOpen);
          return (
            <button
              key={mode}
              type="button"
              disabled={disabled}
              onClick={() => chooseMode(mode)}
              className={`min-h-10 rounded-lg border px-2 py-2 text-[11px] font-extrabold outline-none focus-visible:ring-2 focus-visible:ring-[#39FF14] disabled:cursor-not-allowed disabled:opacity-40 ${active
                ? "border-[#39FF14]/60 bg-[#39FF14]/15"
                : dark ? "border-white/15 bg-white/[0.06] text-white" : "border-emerald-950/15 bg-white text-emerald-950"
              }`}
            >
              {label}
            </button>
          );
        })}
      </div>

      {!membership ? (
        <p className={`mt-2 text-[11px] font-semibold ${dark ? "text-white/65" : "text-emerald-950/60"}`}>
          <Link href="/profile?edit=true" className="underline decoration-[#39FF14] decoration-2 underline-offset-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#39FF14]">
            Add your club in Profile
          </Link>{" "}to find fellow members.
        </p>
      ) : value.mode === "my" ? (
        <p className={`mt-2 truncate text-[11px] font-bold ${dark ? "text-white/70" : "text-emerald-950/60"}`}>{membership.clubName}</p>
      ) : null}

      {value.mode === "selected" ? (
        <div className={`mt-2 flex items-center justify-between gap-2 rounded-lg px-3 py-2 text-xs font-bold ${dark ? "bg-white/[0.08] text-white" : "bg-emerald-950/[0.05] text-emerald-950"}`}>
          <span className="truncate">{value.clubName}</span>
          <button type="button" onClick={() => { onChange(ANY_CLUB_FILTER); setSearchOpen(false); setQueryText(""); }} className="grid h-7 w-7 shrink-0 place-items-center rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#39FF14]" aria-label="Clear selected club"><X size={14} /></button>
        </div>
      ) : null}

      {searchOpen ? (
        <div className="mt-2">
          <div className="relative">
            <Search className={`pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 ${dark ? "text-white/55" : "text-emerald-950/45"}`} size={16} aria-hidden="true" />
            <input
              type="search"
              value={queryText}
              onChange={(event) => setQueryText(event.target.value)}
              placeholder="Name, suburb or postcode"
              aria-label="Search clubs"
              className={`w-full rounded-lg border py-2.5 pl-9 pr-3 text-sm font-semibold outline-none focus:ring-2 focus:ring-[#39FF14]/60 ${dark ? "border-white/15 bg-white/[0.08] text-white placeholder:text-white/45" : "border-emerald-950/15 bg-white text-emerald-950"}`}
            />
          </div>
          {loadError ? <p className="mt-2 text-xs font-semibold text-red-300" role="alert">{loadError}</p> : null}
          {queryText.trim() ? (
            <div className={`mt-1 max-h-40 overflow-y-auto rounded-lg border ${dark ? "border-white/15 bg-emerald-950" : "border-emerald-950/10 bg-white"}`}>
              {loading || queryText.trim() !== debouncedQuery ? (
                <div className={`p-3 text-xs font-semibold ${dark ? "text-white/65" : "text-emerald-950/55"}`}>Searching clubs...</div>
              ) : results.length ? results.map((club) => (
                <button
                  key={club.id}
                  type="button"
                  onClick={() => {
                    onChange(selectedClubFilter(club));
                    setSearchOpen(false);
                    setQueryText("");
                  }}
                  className={`flex w-full items-start gap-2 border-b px-3 py-2.5 text-left last:border-b-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[#39FF14] ${dark ? "border-white/10 text-white hover:bg-white/[0.06]" : "border-emerald-950/[0.07] text-emerald-950 hover:bg-emerald-950/[0.03]"}`}
                >
                  <MapPin size={14} className="mt-0.5 shrink-0 opacity-60" aria-hidden="true" />
                  <span className="min-w-0">
                    <span className="block truncate text-xs font-extrabold">{club.name}</span>
                    {(club.suburb || club.postcode) ? <span className="block truncate text-[10px] font-semibold opacity-60">{[club.suburb, club.postcode].filter(Boolean).join(" · ")}</span> : null}
                  </span>
                </button>
              )) : (
                <div className={`p-3 text-xs font-semibold ${dark ? "text-white/65" : "text-emerald-950/55"}`}>No matching clubs found.</div>
              )}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
