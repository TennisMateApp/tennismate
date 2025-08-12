"use client";

import { useEffect, useMemo, useState } from "react";
import { Search } from "lucide-react";
import { collection, getDocs, query, orderBy, limit, startAfter, QueryDocumentSnapshot, DocumentData } from "firebase/firestore";
import { db } from "@/lib/firebaseConfig";
import Link from "next/link";
import { motion } from "framer-motion";

interface Player {
  id: string;
  name: string;
  postcode: string;
  skillLevel: string;
  availability?: string[]; // Optional here; we don't need it for cards
  bio?: string;            // Optional to keep payload light
  photoURL?: string;
  timestamp?: any;
}

const PAGE_SIZE = 20;

export default function DirectoryPage() {
  const [players, setPlayers] = useState<Player[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [cursor, setCursor] = useState<QueryDocumentSnapshot<DocumentData> | null>(null);
  const [hasMore, setHasMore] = useState(true);
  const [searchTerm, setSearchTerm] = useState("");

  const onImgError = (e: React.SyntheticEvent<HTMLImageElement>) => {
  (e.currentTarget as HTMLImageElement).src = "/images/avatar-fallback.svg"; // add this asset
};

  // Load first page
  useEffect(() => {
    const loadFirstPage = async () => {
      try {
        setLoading(true);
        const q = query(
          collection(db, "players"),
          orderBy("timestamp", "desc"),
          limit(PAGE_SIZE)
        );
        const snapshot = await getDocs(q);

        const page = snapshot.docs.map((d) => {
          const v = d.data() as DocumentData;
          return {
            id: d.id,
            name: v.name ?? "",
            postcode: v.postcode ?? "",
            skillLevel: v.skillLevel ?? "",
            photoURL: v.photoURL ?? undefined,
            timestamp: v.timestamp ?? undefined,
          } as Player;
        });

        setPlayers(page);
        setCursor(snapshot.docs[snapshot.docs.length - 1] ?? null);
        setHasMore(snapshot.size === PAGE_SIZE);
      } catch (err) {
        console.error("Error fetching first page:", err);
      } finally {
        setLoading(false);
      }
    };

    loadFirstPage();
  }, []);

  // Load next page
  const loadMore = async () => {
    if (!hasMore || loadingMore || !cursor) return;
    try {
      setLoadingMore(true);
      const q = query(
        collection(db, "players"),
        orderBy("timestamp", "desc"),
        startAfter(cursor),
        limit(PAGE_SIZE)
      );
      const snapshot = await getDocs(q);

      const page = snapshot.docs.map((d) => {
        const v = d.data() as DocumentData;
        return {
          id: d.id,
          name: v.name ?? "",
          postcode: v.postcode ?? "",
          skillLevel: v.skillLevel ?? "",
          photoURL: v.photoURL ?? undefined,
          timestamp: v.timestamp ?? undefined,
        } as Player;
      });

      setPlayers((prev) => [...prev, ...page]);
      setCursor(snapshot.docs[snapshot.docs.length - 1] ?? null);
      setHasMore(snapshot.size === PAGE_SIZE);
    } catch (err) {
      console.error("Error fetching next page:", err);
    } finally {
      setLoadingMore(false);
    }
  };

const filteredPlayers = useMemo(() => {
  const q = searchTerm.trim().toLowerCase();
  if (!q) return players;
return players.filter((p) => p.name?.toLowerCase().includes(q));
}, [players, searchTerm]);

  return (
    <div className="min-h-screen bg-gray-50 text-gray-900">
      <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
   {/* Heading */}
<h1 className="text-2xl font-bold mb-3">TennisMates</h1>

{/* Sticky search / controls bar (offset equals header height) */}
<div className="sticky top-[56px] z-30 bg-white/90 backdrop-blur supports-[backdrop-filter]:bg-white/60 border rounded-xl">
  <div className="flex items-center gap-3 px-3 py-2.5">
    <div className="relative flex-1">
      <input
        type="text"
        placeholder="Search TennisMates by name…"
        value={searchTerm}
        onChange={(e) => setSearchTerm(e.target.value)}
        className="w-full pl-10 pr-3 py-2.5 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-green-500"
        aria-label="Search TennisMates by name"
      />
      <Search className="absolute left-3 top-2.5 h-5 w-5 text-gray-400" aria-hidden="true" />
    </div>
    <div className="hidden sm:flex text-sm text-gray-600 min-w-[140px] justify-end">
      {filteredPlayers.length} result{filteredPlayers.length === 1 ? "" : "s"}
    </div>
  </div>
</div>

     {loading ? (
  // Skeleton grid
  <div className="mt-5 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
    {Array.from({ length: 6 }).map((_, i) => (
      <div key={i} className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
        <div className="flex gap-4">
          <div className="w-14 h-14 rounded-full bg-gray-200 animate-pulse" />
          <div className="flex-1 space-y-2">
            <div className="h-4 w-1/2 bg-gray-200 rounded animate-pulse" />
            <div className="h-3 w-2/3 bg-gray-200 rounded animate-pulse" />
            <div className="h-8 w-32 bg-gray-200 rounded animate-pulse mt-3" />
          </div>
        </div>
      </div>
    ))}
  </div>
) : filteredPlayers.length === 0 ? (
  // Empty state
  <div className="mt-8 rounded-xl border border-dashed border-gray-300 bg-white p-10 text-center">
    <p className="text-gray-800 font-medium">No players found</p>
    <p className="text-gray-600 text-sm mt-1">Try another name.</p>
  </div>
) : (
  <>
    {/* Cards grid */}
    <div className="mt-5 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
      {filteredPlayers.map((player, index) => {
        const ts =
          typeof player.timestamp?.toDate === "function"
            ? player.timestamp.toDate().getTime()
            : player.timestamp
            ? new Date(player.timestamp).getTime()
            : 0;
        const isNew = ts > 0 && Date.now() - ts < 3 * 24 * 60 * 60 * 1000;

        return (
          <motion.article
            key={player.id}
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.35, delay: index * 0.03 }}
            className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm hover:shadow-md transition"
            aria-labelledby={`player-${player.id}-name`}
          >
            <div className="flex gap-4">
              <img
                src={player.photoURL || "/images/avatar-fallback.svg"}
                onError={onImgError}
                alt=""
                loading="lazy"
                className="w-14 h-14 rounded-full object-cover bg-gray-100"
              />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <h3 id={`player-${player.id}-name`} className="font-semibold truncate">
                    {player.name}
                  </h3>
                  {isNew && (
                    <span className="text-xs px-2 py-0.5 rounded-full bg-green-100 text-green-700">
                      New
                    </span>
                  )}
                </div>

                <div className="mt-1 flex flex-wrap gap-2 text-xs">
                  <span className="px-2 py-0.5 rounded-full bg-gray-100 text-gray-700">
                    Postcode {player.postcode || "—"}
                  </span>
                  <span className="px-2 py-0.5 rounded-full bg-gray-100 text-gray-700">
                    Skill {player.skillLevel || "—"}
                  </span>
                </div>

                {player.bio && (
                  <p className="mt-2 text-sm text-gray-600 line-clamp-2">{player.bio}</p>
                )}

                <div className="mt-3">
                  <Link
                    href={`/players/${player.id}`}
                    className="inline-flex items-center justify-center rounded-lg bg-green-600 px-3 py-2 text-sm font-medium text-white hover:bg-green-700"
                    aria-label={`View ${player.name?.split(" ")[0] || "player"}’s profile`}
                  >
                    View Profile
                  </Link>
                </div>
              </div>
            </div>
          </motion.article>
        );
      })}
    </div>

    {/* Load more */}
    <div className="flex justify-center">
      {hasMore ? (
        <button
          onClick={loadMore}
          disabled={loadingMore}
          className="mt-6 px-4 py-2.5 rounded-lg bg-green-600 text-white hover:bg-green-700 disabled:opacity-60"
        >
          {loadingMore ? "Loading…" : "Load more"}
        </button>
      ) : (
        <div className="mt-6 text-xs text-gray-500">No more players</div>
      )}
    </div>
  </>
)}
      </div>
    </div>
  );
}
