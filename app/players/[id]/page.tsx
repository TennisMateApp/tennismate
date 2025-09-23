"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { db } from "@/lib/firebase";
import { doc, getDoc, collection, query, where, getDocs } from "firebase/firestore";
import Image from "next/image";
import withAuth from "@/components/withAuth";
import { onAuthStateChanged } from "firebase/auth";
import { auth } from "@/lib/firebase";
import { CalendarDays, CheckCircle2, Trophy } from "lucide-react";


type Player = {
  name: string;
  postcode: string;
  skillLevel: string;
  availability: string[];
  bio: string;
  photoURL?: string;
};

function PublicProfilePage() {
  const { id } = useParams();
  const [player, setPlayer] = useState<Player | null>(null);
  const [loading, setLoading] = useState(true);
  const [matchStats, setMatchStats] = useState({
    matches: 0,
    completed: 0,
    wins: 0,
  });
  const [showFullBio, setShowFullBio] = useState(false);

useEffect(() => {
  const fetchPlayerAndStats = async () => {
    if (!id) return;

    try {
      const playerRef = doc(db, "players", id as string);
      const playerSnap = await getDoc(playerRef);

      if (playerSnap.exists()) {
        const d = playerSnap.data();
        setPlayer({
          name: d.name,
          postcode: d.postcode,
          skillLevel: d.skillLevel,
          availability: d.availability,
          bio: d.bio,
          photoURL: d.photoURL,
        });
      } else {
        console.warn("Player not found in Firestore.");
      }

      const matchQuery = query(
        collection(db, "match_history"),
        where("players", "array-contains", id)
      );
      const snapshot = await getDocs(matchQuery);

      let total = 0, complete = 0, wins = 0;
      snapshot.forEach((doc) => {
        const match = doc.data();
        total++;
        if (match.completed) complete++;
        if (match.winnerId === id) wins++;
      });

      setMatchStats({ matches: total, completed: complete, wins });
    } catch (error) {
      console.error("Error loading player profile:", error);
    } finally {
      setLoading(false);
    }
  };

  const unsubscribe = onAuthStateChanged(auth, (user) => {
    if (user) {
      fetchPlayerAndStats();
    } else {
      console.warn("User not signed in");
      setLoading(false);
    }
  });

  return () => unsubscribe();
}, [id]);

  if (loading) {
    return (
      <div className="flex justify-center items-center p-6">
        <div className="animate-spin border-t-4 border-blue-600 rounded-full w-12 h-12"></div>
        <span className="ml-3 text-sm text-gray-600">Loading profile...</span>
      </div>
    );
  }

  if (!player) {
    return (
      <div className="p-6 text-center text-red-600">
        <h2 className="text-xl font-bold">Player not found.</h2>
        <p>Please check the URL or try searching for another player.</p>
      </div>
    );
  }

  return (
  <div className="mx-auto max-w-3xl p-4 sm:p-6 pb-28 text-gray-800 space-y-6">
    {/* HERO HEADER */}
    <section className="relative overflow-hidden rounded-2xl border border-gray-200 bg-gradient-to-b from-white to-emerald-50 p-5 sm:p-6 shadow-sm">
      {/* decorative blobs */}
      <span className="pointer-events-none absolute -top-10 -right-10 h-28 w-28 rounded-full bg-emerald-200/40 blur-2xl" />
      <span className="pointer-events-none absolute -bottom-8 -left-8 h-24 w-24 rounded-full bg-emerald-100/60 blur-2xl" />

      <div className="flex flex-col sm:flex-row sm:items-center gap-4 sm:gap-6">
  {/* Avatar (keep it round) */}
  <div className="relative h-24 w-24 shrink-0 rounded-full overflow-hidden ring-4 ring-white bg-gray-100 aspect-square">
    {player.photoURL ? (
      <Image
        src={player.photoURL}
        alt={`${player.name} avatar`}
        fill
        className="object-cover"
        sizes="96px"
      />
    ) : (
      <div className="flex h-full w-full items-center justify-center text-xl text-gray-500">
        {player.name.slice(0, 2).toUpperCase()}
      </div>
    )}
  </div>

  {/* Name + meta */}
  <div className="min-w-0">
    <h1 className="text-2xl sm:text-3xl font-bold tracking-tight break-words">
      {player.name}
    </h1>

    {/* Chips */}
    <div className="mt-2 flex flex-wrap items-center gap-2 text-sm">
      <span className="rounded-full border border-emerald-200 bg-emerald-50 text-emerald-700 px-2.5 py-0.5">
        Skill: {player.skillLevel || "—"}
      </span>
      {player.postcode ? (
        <span className="rounded-full border border-emerald-200 bg-emerald-50 text-emerald-700 px-2.5 py-0.5">
          Postcode {player.postcode}
        </span>
      ) : null}
    </div>

    {/* Bio */}
    {player.bio && (
      <div className="mt-3">
        <p
          className={`text-[15px] leading-relaxed text-gray-700 ${
            showFullBio ? "" : "line-clamp-3"
          }`}
        >
          {player.bio}
        </p>
        {player.bio.length > 160 && (
          <button
            type="button"
            onClick={() => setShowFullBio((v) => !v)}
            className="mt-1 text-sm text-gray-600 underline"
          >
            {showFullBio ? "Show less" : "Read more"}
          </button>
        )}
      </div>
    )}
  </div>
</div>

    </section>

    {/* AVAILABILITY */}
    <section className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
      <h2 className="text-lg font-semibold">Availability</h2>
      {player.availability?.length ? (
        <div className="mt-2 flex flex-wrap gap-2">
          {player.availability.map((slot, i) => (
            <span
              key={`${slot}-${i}`}
              className="rounded-full border border-emerald-200 bg-emerald-50 text-emerald-800 px-3 py-1 text-sm"
            >
              {slot}
            </span>
          ))}
        </div>
      ) : (
        <p className="mt-2 text-sm text-gray-600">No availability provided.</p>
      )}
    </section>

    {/* MATCH STATS */}
    <section className="grid grid-cols-1 sm:grid-cols-3 gap-3" aria-labelledby="stats-heading">
      <h2 id="stats-heading" className="sr-only">Match stats</h2>

      {/* Card 1 */}
      <div className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm text-center">
        <div className="mx-auto mb-2 flex h-8 w-8 items-center justify-center rounded-full bg-emerald-100 text-emerald-700">
          <CalendarDays className="h-4 w-4" />
        </div>
        <div className="text-2xl font-bold tabular-nums">{matchStats.matches}</div>
        <div className="mt-1 text-sm text-gray-700">Total Matches</div>
      </div>

      {/* Card 2 */}
      <div className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm text-center">
        <div className="mx-auto mb-2 flex h-8 w-8 items-center justify-center rounded-full bg-emerald-100 text-emerald-700">
          <CheckCircle2 className="h-4 w-4" />
        </div>
        <div className="text-2xl font-bold tabular-nums">{matchStats.completed}</div>
        <div className="mt-1 text-sm text-gray-700">Completed Matches</div>
      </div>

      {/* Card 3 */}
      <div className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm text-center">
        <div className="mx-auto mb-2 flex h-8 w-8 items-center justify-center rounded-full bg-emerald-100 text-emerald-700">
          <Trophy className="h-4 w-4" />
        </div>
        <div className="text-2xl font-bold tabular-nums">{matchStats.wins}</div>
        <div className="mt-1 text-sm text-gray-700">Wins</div>
      </div>
    </section>
  </div>
);
}

export default withAuth(PublicProfilePage);
