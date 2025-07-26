"use client";
export const dynamic = "force-dynamic"; // ✅ Keep this
export const fetchCache = 'force-no-store'; // ✅ Prevents caching that triggers SSR

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { auth, db } from "@/lib/firebaseConfig";
import { collection, getDocs, query, orderBy } from "firebase/firestore";
import Link from "next/link";
import { motion } from "framer-motion";
import withAuth from "@/components/withAuth"; // ✅ Import the wrapper

interface Player {
  id: string;
  name: string;
  postcode: string;
  skillLevel: string;
  availability: string[];
  bio: string;
  photoURL?: string;
}

function DirectoryPage() {
  const router = useRouter();
  const [players, setPlayers] = useState<Player[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState("");

  useEffect(() => {
    const fetchPlayers = async () => {
      try {
        const q = query(collection(db, "players"), orderBy("timestamp", "desc"));
        const snapshot = await getDocs(q);
        const data = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })) as Player[];
        setPlayers(data);
        setLoading(false);
      } catch (err) {
        console.error("Error fetching players:", err);
        setLoading(false);
      }
    };

    fetchPlayers();
  }, []);

  const filteredPlayers = players.filter((player) =>
    player.name.toLowerCase().includes(searchTerm.toLowerCase())
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
                      View Profile
                    </button>
                  </Link>
                </div>
              </motion.div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export default withAuth(DirectoryPage as React.ComponentType);

