"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { db } from "@/lib/firebase";
import { doc, getDoc, collection, query, where, getDocs } from "firebase/firestore";
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
  const [showFullBio, setShowFullBio] = useState(false);

  useEffect(() => {
    const fetchPlayerAndStats = async () => {
      if (!id) return;

      const playerRef = doc(db, "players", id as string);
      const playerSnap = await getDoc(playerRef);
      if (playerSnap.exists()) {
        setPlayer(playerSnap.data() as Player);
      }

      const matchQuery = query(collection(db, "match_history"), where("players", "array-contains", id));
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
    <div className="p-6 max-w-4xl mx-auto text-gray-800 space-y-10">

      {/* Top Section: Player Info */}
      <section className="flex flex-col gap-4">
        <div className="flex items-start gap-6">
          <div className="w-28 h-28 relative rounded-full overflow-hidden bg-gray-300">
            {player.photoURL ? (
              <Image src={player.photoURL} alt={player.name} fill className="object-cover" />
            ) : (
              <div className="flex items-center justify-center w-full h-full text-white text-xl">
                {player.name.slice(0, 2).toUpperCase()}
              </div>
            )}
          </div>
          <div className="flex flex-col justify-center gap-2">
            <p className="text-base font-medium text-gray-800">📍 Postcode: <span className="font-semibold">{player.postcode}</span></p>
            <p className="text-base font-medium text-gray-800">🎾 Skill Level: <span className="font-semibold">{player.skillLevel}</span></p>
          </div>
        </div>

        {/* Bio */}
        {player.bio && (
          <div className="mt-2 text-sm text-gray-700">
            <h3 className="font-semibold text-md mb-1">Bio</h3>
            <p>
              {showFullBio ? player.bio : `${player.bio.slice(0, 100)}...`}
              {player.bio.length > 100 && (
                <button
                  onClick={() => setShowFullBio(!showFullBio)}
                  className="ml-2 text-blue-600 underline text-xs"
                >
                  {showFullBio ? "Show Less" : "Read More"}
                </button>
              )}
            </p>
          </div>
        )}
      </section>

      {/* Middle Section: Availability */}
      <section className="flex flex-col sm:flex-row sm:items-start sm:gap-6 border-t pt-6">
        <h2 className="font-semibold text-lg sm:w-1/3">Availability</h2>
        <ul className="list-disc text-sm text-green-600 space-y-1 pl-5 sm:pl-0 sm:w-2/3">
          {player.availability?.length > 0 ? (
            player.availability.map((slot, index) => (
              <li key={index}>{slot}</li>
            ))
          ) : (
            <li className="text-gray-500">No availability provided</li>
          )}
        </ul>
      </section>

      {/* Bottom Section: Match Stats */}
      <section className="bg-gradient-to-r from-gray-600 to-gray-800 p-8 rounded-xl shadow-lg text-white text-center">
        <h2 className="text-2xl font-semibold mb-4">Match Stats</h2>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-6">
          <div>
            <p className="text-2xl font-bold">{matchStats.matches}</p>
            <p className="text-sm text-gray-300">Total Matches</p>
          </div>
          <div>
            <p className="text-2xl font-bold">{matchStats.completed}</p>
            <p className="text-sm text-gray-300">Completed Matches</p>
          </div>
          <div>
            <p className="text-2xl font-bold">{matchStats.wins}</p>
            <p className="text-sm text-gray-300">Wins</p>
          </div>
        </div>
      </section>
    </div>
  );
}

export default withAuth(PublicProfilePage);
