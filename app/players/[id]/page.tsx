"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { db } from "@/lib/firebase";
import {
  doc,
  getDoc,
  collection,
  query,
  where,
  getDocs,
} from "firebase/firestore";
import Image from "next/image";
import withAuth from "@/components/withAuth";

type Player = {
  name: string;
  email: string;
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

  useEffect(() => {
    const fetchPlayerAndStats = async () => {
      if (!id) return;

      // Fetch player data
      const playerRef = doc(db, "players", id as string);
      const playerSnap = await getDoc(playerRef);
      if (playerSnap.exists()) {
        setPlayer(playerSnap.data() as Player);
      }

      // ✅ Fetch match stats from match_history
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
      setLoading(false);
    };

    fetchPlayerAndStats();
  }, [id]);

  if (loading) {
    return <p className="p-4">Loading profile...</p>;
  }

  if (!player) {
    return <p className="p-4 text-red-600">Player not found.</p>;
  }

  return (
    <div className="p-6 max-w-xl mx-auto text-gray-800">
      <h1 className="text-2xl font-bold mb-4">Player Profile</h1>
      <div className="flex flex-col items-center gap-4">
        {player.photoURL ? (
          <Image
            src={player.photoURL}
            width={100}
            height={100}
            alt={player.name}
            className="rounded-full object-cover"
          />
        ) : (
          <div className="w-[100px] h-[100px] rounded-full bg-gray-300 flex items-center justify-center text-sm text-gray-700">
            No Photo
          </div>
        )}
        <p className="text-lg font-semibold">{player.name}</p>
        <p className="text-sm text-gray-600">Postcode: {player.postcode}</p>
        <p className="text-sm text-gray-600">Skill Level: {player.skillLevel}</p>
        <p className="text-sm mt-2">{player.bio}</p>
        <div className="mt-2">
          <h2 className="font-semibold text-sm">Availability:</h2>
          <ul className="list-disc list-inside text-sm">
            {player.availability?.length > 0 ? (
              player.availability.map((slot, index) => (
                <li key={index}>{slot}</li>
              ))
            ) : (
              <li>No availability provided</li>
            )}
          </ul>
        </div>

        {/* ✅ Match Stats */}
        <div className="mt-6 bg-gray-50 p-4 rounded shadow w-full text-left">
          <h2 className="font-semibold mb-2 text-gray-700">Match Stats</h2>
          <p>Total Matches: {matchStats.matches}</p>
          <p>Completed Matches: {matchStats.completed}</p>
          <p>Wins: {matchStats.wins}</p>
        </div>
      </div>
    </div>
  );
}

export default withAuth(PublicProfilePage);
