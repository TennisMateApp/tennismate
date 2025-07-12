"use client";

import { useEffect, useState } from "react";
import { db, auth } from "@/lib/firebaseConfig";
import { onAuthStateChanged } from "firebase/auth";
import {
  collection,
  getDocs,
  doc,
  getDoc,
  addDoc,
  serverTimestamp,
  query,
  where,
  onSnapshot,
} from "firebase/firestore";
import { useRouter } from "next/navigation";
import Link from "next/link";

interface Player {
  id: string;
  name: string;
  postcode: string;
  skillLevel: string;
  availability: string[];
  bio: string;
  email: string;
  photoURL?: string;
  timestamp?: any;
}

export default function MatchPage() {
  const [user, setUser] = useState<any>(null);
  const [myProfile, setMyProfile] = useState<Player | null>(null);
  const [matches, setMatches] = useState<Player[]>([]);
  const [sentRequests, setSentRequests] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const router = useRouter();

  useEffect(() => {
    let unsubscribeIncoming: () => void;
    let unsubscribeAccepted: () => void;

    const unsubscribeAuth = onAuthStateChanged(auth, async (currentUser) => {
      if (!currentUser) {
        router.push("/login");
        return;
      }
      setUser(currentUser);

      const myRef = doc(db, "players", currentUser.uid);
      const mySnap = await getDoc(myRef);
      if (!mySnap.exists()) {
        alert("Please complete your profile first.");
        router.push("/profile");
        return;
      }

      const myData = mySnap.data() as Player;
      setMyProfile(myData);

      // Fetch match requests sent by this user
      const reqQuery = query(
        collection(db, "match_requests"),
        where("fromUserId", "==", currentUser.uid)
      );
      const reqSnap = await getDocs(reqQuery);
      const sentTo = new Set<string>();
      reqSnap.forEach((doc) => {
        const data = doc.data();
        if (data.toUserId) sentTo.add(data.toUserId);
      });
      setSentRequests(sentTo);

      // Get all players
      const snapshot = await getDocs(collection(db, "players"));
      const allPlayers = snapshot.docs.map((doc) => ({
        id: doc.id,
        ...doc.data(),
      })) as Player[];

      // Score & filter matches
      const scoredMatches = allPlayers
        .filter((p) => p.id !== currentUser.uid)
        .map((p) => {
          let score = 0;

          if (p.skillLevel === myData.skillLevel) score += 2;
          else if (
            (p.skillLevel === "Intermediate" && myData.skillLevel === "Beginner") ||
            (p.skillLevel === "Beginner" && myData.skillLevel === "Intermediate")
          )
            score += 1;

          const sharedAvailability = p.availability.filter((a) =>
            myData.availability.includes(a)
          ).length;
          score += sharedAvailability;

          if (p.postcode.startsWith(myData.postcode.slice(0, 1))) score += 1;

          return { ...p, score };
        })
        .filter((p) => p.score > 0)
        .sort((a, b) => b.score - a.score);

      setMatches(scoredMatches);
      setLoading(false);
    });

    return () => {
      unsubscribeAuth();
      if (unsubscribeIncoming) unsubscribeIncoming();
      if (unsubscribeAccepted) unsubscribeAccepted();
    };
  }, [router]);

  const handleMatchRequest = async (match: Player) => {
    if (!myProfile || !user) return;

    try {
      await addDoc(collection(db, "match_requests"), {
        fromUserId: user.uid,
        fromName: myProfile.name,
        fromEmail: myProfile.email,
        toUserId: match.id,
        toName: match.name,
        message: `Hey ${match.name}, I’d love to play sometime soon!`,
        timestamp: serverTimestamp(),
        status: "unread",
      });

      setSentRequests((prev) => new Set(prev).add(match.id));
      alert(`✅ Request sent to ${match.name}`);
    } catch (err) {
      console.error("Failed to send match request:", err);
      alert("❌ Could not send request. Try again.");
    }
  };

  if (loading) return <p className="p-6">Looking for matches...</p>;

  return (
    <div className="max-w-2xl mx-auto p-6">
      <h1 className="text-2xl font-bold mb-4">Your Top Matches</h1>
      <button
        onClick={() => window.location.reload()}
        className="text-sm text-blue-600 underline mb-4"
      >
        🔄 Refresh Matches
      </button>
      {matches.length === 0 ? (
        <p>No matches found yet. Try adjusting your availability or skill level.</p>
      ) : (
        <ul className="space-y-4">
          {matches.map((match) => {
            const alreadySent = sentRequests.has(match.id);
            const isNew =
              match.timestamp &&
              Date.now() - new Date(match.timestamp.toDate?.() || match.timestamp).getTime() <
                3 * 24 * 60 * 60 * 1000;

            return (
              <li
                key={match.id}
                className="border p-4 rounded bg-white shadow-sm flex items-start gap-4"
              >
                {match.photoURL ? (
                  <img
                    src={match.photoURL}
                    alt={match.name}
                    className="w-16 h-16 rounded-full object-cover"
                  />
                ) : (
                  <div className="w-16 h-16 rounded-full bg-gray-300 flex items-center justify-center text-gray-600 text-xs">
                    No Photo
                  </div>
                )}
                <div>
                  <h2 className="font-semibold text-lg flex items-center gap-2">
                    {match.name}
                    {isNew && (
                      <span className="text-xs bg-green-200 text-green-800 px-2 py-0.5 rounded">
                        New
                      </span>
                    )}
                  </h2>
                  <p className="text-sm text-gray-600">
                    Skill: {match.skillLevel} — Postcode: {match.postcode}
                  </p>
                  <p className="text-sm">
                    <strong>Availability:</strong> {match.availability.join(", ")}
                  </p>
                  <p className="mt-1 text-sm">{match.bio}</p>
                  <div className="mt-3 flex gap-3">
                    {alreadySent ? (
                      <span className="text-green-600 text-sm font-medium">✅ Request Sent</span>
                    ) : (
                      <button
                        onClick={() => handleMatchRequest(match)}
                        className="text-sm text-blue-600 underline"
                      >
                        Request to Play
                      </button>
                    )}
                    <Link href={`/players/${match.id}`}>
                      <button className="text-sm bg-gray-200 rounded px-3 py-1">
                        View Profile
                      </button>
                    </Link>
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
