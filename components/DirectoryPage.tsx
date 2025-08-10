"use client";

import { useEffect, useState } from "react";
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

  const filteredPlayers = players.filter((player) =>
    player.name?.toLowerCase().includes(searchTerm.toLowerCase())
  );

  return (
    <div className="min-h-screen bg-gray-50 text-gray-900">
      <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
        <h1 className="text-2xl font-bold mb-4">TennisMates</h1>

        <input
          type="text"
          placeholder="Search TennisMates by name..."
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          className="mb-4 w-full px-4 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
        />

        {loading ? (
          <p>Loading players...</p>
        ) : filteredPlayers.length === 0 ? (
          <p>No players found.</p>
        ) : (
          <>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
              {filteredPlayers.map((player, index) => (
                <motion.div
                  key={player.id}
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.4, delay: index * 0.05 }}
                  className="p-4 border rounded bg-white shadow-sm flex items-center gap-4"
                >
                  {player.photoURL ? (
                    <img
                      src={player.photoURL}
                      alt={player.name}
                      className="w-16 h-16 rounded-full object-cover"
                    />
                  ) : (
                    <div className="w-16 h-16 rounded-full bg-gray-300 flex items-center justify-center text-gray-600 text-sm">
                      No Photo
                    </div>
                  )}
                  <div>
                    <p className="font-medium">{player.name}</p>
                    <p className="text-sm text-gray-600">Postcode: {player.postcode}</p>
                    <p className="text-sm text-gray-600">Skill: {player.skillLevel}</p>
                    <Link href={`/players/${player.id}`}>
                      <button className="bg-gray-200 px-3 py-1 rounded text-sm mt-2">
                        View {player.name?.split(" ")[0] || "Profile"}’s Profile
                      </button>
                    </Link>
                  </div>
                </motion.div>
              ))}
            </div>

            {/* Load more */}
            <div className="flex justify-center">
              {hasMore ? (
                <button
                  onClick={loadMore}
                  disabled={loadingMore}
                  className="mt-6 px-4 py-2 rounded bg-green-600 text-white disabled:opacity-60"
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
