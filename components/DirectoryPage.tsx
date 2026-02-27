"use client";

import { useEffect, useMemo, useState } from "react";
import { Search, SlidersHorizontal, ChevronDown } from "lucide-react";
import {
  collection,
  getDocs,
  query,
  orderBy,
  limit,
  startAfter,
  startAt,
  endAt,
  QueryDocumentSnapshot,
  DocumentData,
  getCountFromServer,
} from "firebase/firestore";
import { db } from "@/lib/firebaseConfig";
import Link from "next/link";
import { motion } from "framer-motion";
import Image from "next/image";
import { skillFromUTR, SKILL_OPTIONS } from "@/lib/skills";
import PlayerProfileView from "@/components/players/PlayerProfileView";
import { useIsDesktop } from "@/lib/useIsDesktop";
import TMDesktopSidebar from "@/components/desktop_layout/TMDesktopSidebar";
import DesktopDirectoryPage from "@/components/directory/DesktopDirectoryPage";


interface Player {
  id: string;
  name: string;
  postcode: string;
  skillLevel: string;
  availability?: string[];
  bio?: string;
  photoURL?: string;
  photoThumbURL?: string;
  timestamp?: any;
  joinedAt?: any;
  createdAt?: any;
  nameLower?: string;
}

// ✅ show first 10 like the mock (and load 10 at a time)
const PAGE_SIZE = 10;

const DIR_CACHE_KEY = "tm_directory_page1_v2";
const DIR_CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

const SEARCH_CACHE_PREFIX = "tm_dir_search_v2:";
const SEARCH_CACHE_TTL_MS = 2 * 60 * 1000; // 2 minutes

const TM = {
  forest: "#0B3D2E",
  neon: "#39FF14",
  bg: "#F7FAF8",
  ink: "#0F172A",
};

function getSkillLabel(v: DocumentData): string {
  if (typeof v.skillBandLabel === "string" && v.skillBandLabel.trim()) {
    return v.skillBandLabel;
  }

  if (typeof v.skillBand === "string" && v.skillBand.trim()) {
    const val = v.skillBand.trim();
    const fromOptions = SKILL_OPTIONS.find((s) => s.value === val)?.label;
    if (fromOptions) return fromOptions;

    if (val.includes("_")) {
      return val
        .split("_")
        .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
        .join(" ");
    }

    return val;
  }

  const direct =
    (typeof v.skillLevel === "string" && v.skillLevel) ||
    (typeof v.skill === "string" && v.skill) ||
    (typeof v.skill_label === "string" && v.skill_label) ||
    (typeof v.skill_band === "string" && v.skill_band);

  if (direct) return direct as string;

  const utr = typeof v.utr === "number" ? v.utr : undefined;
  const tmr = typeof v.tmr === "number" ? v.tmr : undefined;
  const rating = utr ?? tmr;
  if (typeof rating === "number") {
    try {
      const bandValue = skillFromUTR(rating);
      if (bandValue) {
        const fromOptions = SKILL_OPTIONS.find((s) => s.value === bandValue)?.label;
        return fromOptions ?? bandValue;
      }
    } catch {
      // ignore
    }
  }

  return "";
}

export default function DirectoryPage() {
  // ----- browse mode state -----
  const [players, setPlayers] = useState<Player[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [cursor, setCursor] = useState<QueryDocumentSnapshot<DocumentData> | null>(null);
  const [hasMore, setHasMore] = useState(true);
  const [totalPlayers, setTotalPlayers] = useState<number | null>(null);

  // ----- search state -----
  const [searchTerm, setSearchTerm] = useState("");
  const [searching, setSearching] = useState(false);
  const [searchResults, setSearchResults] = useState<Player[]>([]);
  const [searchCursor, setSearchCursor] = useState<QueryDocumentSnapshot<DocumentData> | null>(null);
  const [hasMoreSearch, setHasMoreSearch] = useState(false);

  const inSearch = searchTerm.trim().length >= 2;
  const qStr = searchTerm.trim().toLowerCase();

  const [profileOpenId, setProfileOpenId] = useState<string | null>(null);

  const isDesktop = useIsDesktop();

// Close profile modal on Escape
useEffect(() => {
  const onKey = (e: KeyboardEvent) => {
    if (e.key === "Escape" && profileOpenId) setProfileOpenId(null);
  };
  document.addEventListener("keydown", onKey);
  return () => document.removeEventListener("keydown", onKey);
}, [profileOpenId]);

// Lock page scroll while profile modal is open
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


  // ----- fetch total count (for “Showing X of Y”) -----
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const agg = await getCountFromServer(collection(db, "players"));
        if (!cancelled) setTotalPlayers(agg.data().count ?? null);
      } catch {
        if (!cancelled) setTotalPlayers(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // ----- initial browse load -----
  useEffect(() => {
    const loadFirstPage = async () => {
      const cachedRaw = sessionStorage.getItem(DIR_CACHE_KEY);
      if (cachedRaw) {
        try {
          const cached = JSON.parse(cachedRaw);
          const isFresh = Date.now() - cached.ts < DIR_CACHE_TTL_MS;
          if (isFresh && Array.isArray(cached.players)) {
            setPlayers(cached.players);
            setHasMore(!!cached.hasMore);
            setCursor(null);
            setLoading(false);
            return;
          }
        } catch {
          // ignore
        }
      }

      try {
        setLoading(true);
        const qy = query(collection(db, "players"), orderBy("nameLower"), limit(PAGE_SIZE));
        const snap = await getDocs(qy);

        const page = snap.docs.map((d) => {
          const v = d.data() as DocumentData;
          return {
            id: d.id,
            name: v.name ?? "",
            postcode: v.postcode ?? "",
            skillLevel: getSkillLabel(v),
            photoURL: v.photoURL ?? undefined,
            photoThumbURL: v.photoThumbURL ?? undefined,
            timestamp: v.timestamp ?? undefined,
            joinedAt: v.joinedAt ?? undefined,
            createdAt: v.createdAt ?? undefined,
            nameLower: v.nameLower ?? undefined,
            bio: v.bio ?? undefined,
          } as Player;
        });

        setPlayers(page);
        setCursor(snap.docs[snap.docs.length - 1] ?? null);
        setHasMore(snap.size === PAGE_SIZE);

        sessionStorage.setItem(
          DIR_CACHE_KEY,
          JSON.stringify({
            ts: Date.now(),
            players: page,
            hasMore: snap.size === PAGE_SIZE,
          })
        );
      } catch (err) {
        console.error("Error fetching first page:", err);
      } finally {
        setLoading(false);
      }
    };

    loadFirstPage();
  }, []);

  // ----- load more (browse mode) -----
  const loadMore = async () => {
    if (!hasMore || loadingMore) return;

    try {
      setLoadingMore(true);

      let effectiveCursor = cursor;

      if (!effectiveCursor) {
        const bootstrapSnap = await getDocs(
          query(collection(db, "players"), orderBy("nameLower"), limit(PAGE_SIZE))
        );
        effectiveCursor = bootstrapSnap.docs[bootstrapSnap.docs.length - 1] ?? null;
        setCursor(effectiveCursor);
        if (!effectiveCursor) return;
      }

      const qy = query(
        collection(db, "players"),
        orderBy("nameLower"),
        startAfter(effectiveCursor),
        limit(PAGE_SIZE)
      );

      const snap = await getDocs(qy);

      const page = snap.docs.map((d) => {
        const v = d.data() as DocumentData;
        return {
          id: d.id,
          name: v.name ?? "",
          postcode: v.postcode ?? "",
          skillLevel: getSkillLabel(v),
          photoURL: v.photoURL ?? undefined,
          photoThumbURL: v.photoThumbURL ?? undefined,
          timestamp: v.timestamp ?? undefined,
          joinedAt: v.joinedAt ?? undefined,
          createdAt: v.createdAt ?? undefined,
          nameLower: v.nameLower ?? undefined,
          bio: v.bio ?? undefined,
        } as Player;
      });

      setPlayers((prev) => [...prev, ...page]);
      setCursor(snap.docs[snap.docs.length - 1] ?? null);
      setHasMore(snap.size === PAGE_SIZE);
    } catch (err) {
      console.error("Error fetching next page:", err);
    } finally {
      setLoadingMore(false);
    }
  };

  // ----- search (prefix on nameLower) -----
  useEffect(() => {
    let cancelled = false;

    if (!inSearch) {
      setSearching(false);
      setSearchResults([]);
      setSearchCursor(null);
      setHasMoreSearch(false);
      return;
    }

    setSearching(true);

    const cacheKey = SEARCH_CACHE_PREFIX + qStr;
    const cachedRaw = sessionStorage.getItem(cacheKey);
    if (cachedRaw) {
      try {
        const cached = JSON.parse(cachedRaw);
        const isFresh = Date.now() - cached.ts < SEARCH_CACHE_TTL_MS;

        if (isFresh && Array.isArray(cached.players)) {
          setSearchResults(cached.players);
          setSearchCursor(null);
          setHasMoreSearch(!!cached.hasMore);
          setSearching(false);
          return;
        }
      } catch {
        // ignore
      }
    }

    const handle = setTimeout(async () => {
      try {
        const qy = query(
          collection(db, "players"),
          orderBy("nameLower"),
          startAt(qStr),
          endAt(qStr + "\uf8ff"),
          limit(PAGE_SIZE)
        );

        const snap = await getDocs(qy);
        if (cancelled) return;

        const page = snap.docs.map((d) => {
          const v = d.data() as DocumentData;
          return {
            id: d.id,
            name: v.name ?? "",
            postcode: v.postcode ?? "",
            skillLevel: getSkillLabel(v),
            photoURL: v.photoURL ?? undefined,
            photoThumbURL: v.photoThumbURL ?? undefined,
            timestamp: v.timestamp ?? undefined,
            joinedAt: v.joinedAt ?? undefined,
            createdAt: v.createdAt ?? undefined,
            nameLower: v.nameLower ?? undefined,
            bio: v.bio ?? undefined,
          } as Player;
        });

        setSearchResults(page);
        setSearchCursor(snap.docs[snap.docs.length - 1] ?? null);
        setHasMoreSearch(snap.size === PAGE_SIZE);

        sessionStorage.setItem(
          cacheKey,
          JSON.stringify({
            ts: Date.now(),
            players: page,
            hasMore: snap.size === PAGE_SIZE,
          })
        );
      } catch (err) {
        console.error("Error searching players:", err);
      } finally {
        if (!cancelled) setSearching(false);
      }
    }, 300);

    return () => {
      cancelled = true;
      clearTimeout(handle);
    };
  }, [qStr, inSearch]);

  // ----- load more (search mode) -----
  const loadMoreSearch = async () => {
    if (!inSearch || !hasMoreSearch || loadingMore) return;

    try {
      setLoadingMore(true);

      let effectiveCursor = searchCursor;

      if (!effectiveCursor) {
        const bootstrapSnap = await getDocs(
          query(
            collection(db, "players"),
            orderBy("nameLower"),
            startAt(qStr),
            endAt(qStr + "\uf8ff"),
            limit(PAGE_SIZE)
          )
        );
        effectiveCursor = bootstrapSnap.docs[bootstrapSnap.docs.length - 1] ?? null;
        setSearchCursor(effectiveCursor);
        if (!effectiveCursor) return;
      }

      const qy = query(
        collection(db, "players"),
        orderBy("nameLower"),
        startAfter(effectiveCursor),
        endAt(qStr + "\uf8ff"),
        limit(PAGE_SIZE)
      );

      const snap = await getDocs(qy);

      const page = snap.docs.map((d) => {
        const v = d.data() as DocumentData;
        return {
          id: d.id,
          name: v.name ?? "",
          postcode: v.postcode ?? "",
          skillLevel: getSkillLabel(v),
          photoURL: v.photoURL ?? undefined,
          photoThumbURL: v.photoThumbURL ?? undefined,
          timestamp: v.timestamp ?? undefined,
          joinedAt: v.joinedAt ?? undefined,
          createdAt: v.createdAt ?? undefined,
          nameLower: v.nameLower ?? undefined,
          bio: v.bio ?? undefined,
        } as Player;
      });

      setSearchResults((prev) => [...prev, ...page]);
      setSearchCursor(snap.docs[snap.docs.length - 1] ?? null);
      setHasMoreSearch(snap.size === PAGE_SIZE);
    } catch (err) {
      console.error("Error fetching more search results:", err);
    } finally {
      setLoadingMore(false);
    }
  };

  const visiblePlayers = useMemo(() => (inSearch ? searchResults : players), [inSearch, searchResults, players]);
  const canLoadMore = inSearch ? hasMoreSearch : hasMore;
  const onLoadMore = inSearch ? loadMoreSearch : loadMore;

    // ✅ Desktop layout (sidebar left + results centered)
  if (isDesktop) {
    return (
      <div className="min-h-screen" style={{ background: "#f6f7f8" }}>
        <div className="w-full px-4 lg:px-8 2xl:px-12 py-6">
          <div className="flex items-start gap-6">
            {/* Left sidebar */}
            <TMDesktopSidebar active="Search" player={null} />

            {/* Main content */}
            <div className="flex-1 min-w-0">
              <DesktopDirectoryPage
                loading={loading || searching}
                searchTerm={searchTerm}
                setSearchTerm={setSearchTerm}
                players={visiblePlayers}
                totalPlayers={!inSearch ? totalPlayers : null}
                canLoadMore={canLoadMore}
                loadingMore={loadingMore}
                onLoadMore={onLoadMore}
                onViewProfile={(id) => setProfileOpenId(id)}
              />
            </div>
          </div>
        </div>

        {/* ✅ Profile overlay modal (shared) */}
        {profileOpenId && (
          <div className="fixed inset-0 z-[9999]">
            <div
              className="absolute inset-0 bg-black/60"
              onMouseDown={() => setProfileOpenId(null)}
            />
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
                    playerId={profileOpenId}
                    onClose={() => setProfileOpenId(null)}
                  />
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    );
  }


  return (
    <div className="min-h-screen" style={{ background: TM.bg, color: TM.ink }}>
      <div className="mx-auto w-full max-w-md px-4 py-6">
        {/* Header */}
        <div className="flex items-center justify-between mb-3">
          <h1 className="text-[22px] font-extrabold tracking-tight" style={{ color: TM.forest }}>
            Players
          </h1>

          <button
            type="button"
            className="rounded-xl p-2 border"
            style={{
              borderColor: "rgba(11,61,46,0.12)",
              background: "rgba(255,255,255,0.8)",
            }}
            aria-label="Filters"
          >
            <SlidersHorizontal className="h-5 w-5" style={{ color: TM.forest }} />
          </button>
        </div>

        {/* Search */}
        <div
          className="rounded-2xl border p-3 shadow-sm mb-4"
          style={{
            background: "#fff",
            borderColor: "rgba(11,61,46,0.10)",
          }}
        >
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-5 w-5" style={{ color: "rgba(11,61,46,0.45)" }} />
            <input
              type="text"
              placeholder="Search players by name or postcode"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full rounded-xl border pl-10 pr-3 py-2.5 text-sm outline-none"
              style={{
                borderColor: "rgba(11,61,46,0.12)",
                background: "rgba(247,250,248,0.65)",
              }}
              aria-label="Search players"
            />
          </div>

          {searchTerm && !inSearch && (
            <div className="pt-2 text-xs" style={{ color: "rgba(11,61,46,0.60)" }}>
              Type at least 2 characters to search.
            </div>
          )}
        </div>

        {/* Loading */}
        {loading ? (
          <div className="space-y-3">
            {Array.from({ length: 6 }).map((_, i) => (
              <div
                key={i}
                className="rounded-2xl border bg-white p-4 shadow-sm"
                style={{ borderColor: "rgba(11,61,46,0.10)" }}
              >
                <div className="flex items-center gap-3">
                  <div className="h-12 w-12 rounded-full bg-gray-200 animate-pulse" />
                  <div className="flex-1">
                    <div className="h-4 w-40 bg-gray-200 rounded animate-pulse" />
                    <div className="mt-2 h-3 w-28 bg-gray-200 rounded animate-pulse" />
                  </div>
                  <div className="h-9 w-24 bg-gray-200 rounded-xl animate-pulse" />
                </div>
              </div>
            ))}
          </div>
        ) : visiblePlayers.length === 0 ? (
          <div className="rounded-2xl border bg-white p-8 text-center" style={{ borderColor: "rgba(11,61,46,0.12)" }}>
            <p className="font-semibold" style={{ color: TM.forest }}>
              No players found
            </p>
            <p className="text-sm mt-1" style={{ color: "rgba(11,61,46,0.65)" }}>
              Try another name or postcode.
            </p>
          </div>
        ) : (
          <>
            {/* List */}
            <div className="space-y-3">
              {visiblePlayers.map((player, index) => {
                const avatarSrc = player.photoThumbURL || player.photoURL || "/images/avatar-fallback.svg";

                return (
                  <motion.article
                    key={player.id}
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.25, delay: Math.min(index * 0.02, 0.18) }}
                    className="rounded-2xl border bg-white p-4 shadow-sm"
                    style={{ borderColor: "rgba(11,61,46,0.10)" }}
                    aria-labelledby={`player-${player.id}-name`}
                  >
                    <div className="flex items-center gap-3">
                 {/* Avatar */}
<div className="relative h-12 w-12 shrink-0">
  <div className="absolute inset-0 rounded-full bg-gray-200 animate-pulse" />
  <div className="relative h-12 w-12 overflow-hidden rounded-full">
    <Image
      src={avatarSrc}
      alt=""
      fill
      sizes="48px"
      className="object-cover"
    />
  </div>
</div>


                      {/* Name + meta */}
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 min-w-0">
                          <h3
                            id={`player-${player.id}-name`}
                            className="font-extrabold truncate"
                            style={{ color: TM.forest }}
                          >
                            {player.name || "Player"}
                          </h3>
                        </div>

                        <div className="mt-1 flex items-center gap-2 text-xs">
                          <span
                            className="rounded-full px-2 py-0.5"
                            style={{
                              background: "rgba(11,61,46,0.08)",
                              color: "rgba(11,61,46,0.85)",
                            }}
                          >
                            {player.skillLevel ? player.skillLevel : "Skill —"}
                          </span>

                          <span style={{ color: "rgba(11,61,46,0.55)" }}>
                            {player.postcode ? player.postcode : "—"}
                          </span>
                        </div>
                      </div>

                      {/* View Profile */}
                   <button
  type="button"
  onClick={() => setProfileOpenId(player.id)}
  className="shrink-0 rounded-full px-3 py-2 text-sm font-semibold"
  style={{
    border: `1px solid rgba(11,61,46,0.22)`,
    color: TM.forest,
    background: "#fff",
  }}
  aria-label={`View ${player.name?.split(" ")[0] || "player"} profile`}
>
  View Profile
</button>

                    </div>
                  </motion.article>
                );
              })}
            </div>

            {/* Footer count + Load more */}
            <div className="pt-5 text-center">
              <div className="text-xs mb-2" style={{ color: "rgba(11,61,46,0.55)" }}>
                Showing {visiblePlayers.length}
                {totalPlayers != null && !inSearch ? ` of ${totalPlayers}` : ""} players
              </div>

              {canLoadMore ? (
                <button
                  onClick={onLoadMore}
                  disabled={loadingMore}
                  className="inline-flex items-center justify-center gap-1 rounded-full px-4 py-2 text-sm font-semibold disabled:opacity-60"
                  style={{
                    color: TM.forest,
                    background: "transparent",
                  }}
                >
                  {loadingMore ? "Loading…" : "Load More"}
                  <ChevronDown className="h-4 w-4" />
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

           {/* 👇 Profile overlay modal — MUST live here */}
      {profileOpenId && (
        <div className="fixed inset-0 z-[9999]">
          {/* Backdrop */}
          <div
            className="absolute inset-0 bg-black/60"
            onMouseDown={() => setProfileOpenId(null)}
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
                  playerId={profileOpenId}
                  onClose={() => setProfileOpenId(null)}
                />
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

