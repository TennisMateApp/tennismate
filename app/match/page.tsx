"use client";

import { useEffect, useState, useMemo } from "react";
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
  where
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
  score?: number;
}

interface PostcodeCoords {
  [postcode: string]: { lat: number; lng: number };
}

function getDistanceFromLatLonInKm(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number
): number {
  const R = 6371; // Radius of the Earth in km
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * Math.PI / 180) *
      Math.cos(lat2 * Math.PI / 180) *
      Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return Math.round(R * c);
}

export default function MatchPage() {
  const [user, setUser] = useState<any>(null);
  const [myProfile, setMyProfile] = useState<Player | null>(null);
  const [rawMatches, setRawMatches] = useState<Player[]>([]);
  const [sentRequests, setSentRequests] = useState<Set<string>>(new Set());
  const [postcodeCoords, setPostcodeCoords] = useState<PostcodeCoords>({});
  const [loading, setLoading] = useState(true);
  const [sortBy, setSortBy] = useState<string>("score");
  const router = useRouter();

  useEffect(() => {
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

      // Load postcode coordinates
      const postcodeSnap = await getDocs(collection(db, "postcodes"));
      const coords: PostcodeCoords = {};
      postcodeSnap.forEach((d) => {
        coords[d.id] = d.data() as { lat: number; lng: number };
      });
      setPostcodeCoords(coords);

      // Load sent requests
      const reqQuery = query(
        collection(db, "match_requests"),
        where("fromUserId", "==", currentUser.uid)
      );
      const reqSnap = await getDocs(reqQuery);
      const sentTo = new Set<string>();
      reqSnap.forEach((d) => {
        const data = d.data();
        if (data.toUserId) sentTo.add(data.toUserId);
      });
      setSentRequests(sentTo);

      // Load all players and score
      const snapshot = await getDocs(collection(db, "players"));
      const allPlayers = snapshot.docs.map((d) => {
  const data = d.data() as Player;
  const { id: _id, ...rest } = data; // remove any id from data
  return { ...rest, id: d.id };      // always set id from doc.id last
});
      const scored = allPlayers
        .filter((p) => p.id !== currentUser.uid)
        .map((p) => {
          let score = 0;
          // Skill match
          if (p.skillLevel === myData.skillLevel) score += 2;
          else if (
            (p.skillLevel === "Intermediate" && myData.skillLevel === "Beginner") ||
            (p.skillLevel === "Beginner" && myData.skillLevel === "Intermediate")
          ) {
            score += 1;
          }
          // Availability overlap
          const shared = p.availability.filter((a) => myData.availability.includes(a)).length;
          score += shared;
          // Postcode proximity (first digit)
          if (p.postcode.startsWith(myData.postcode.slice(0, 1))) score += 1;

          return { ...p, score };
        })
        .filter((p) => (p.score ?? 0) > 0);

      setRawMatches(scored);
      setLoading(false);
    });

    return () => unsubscribeAuth();
  }, [router]);

const [isSubmitting, setIsSubmitting] = useState(false);

const handleMatchRequest = async (match: Player) => {
  if (!myProfile || !user || isSubmitting) return;

  setIsSubmitting(true);
  try {
    const matchRef = await addDoc(collection(db, "match_requests"), {
      fromUserId: user.uid,
      toUserId: match.id,
      fromName: myProfile.name,
      fromEmail: myProfile.email,
      toName: match.name,
      message: `Hey ${match.name}, I’d love to play sometime soon!`,
      status: "unread",
      timestamp: serverTimestamp(),
    });

    const notifQuery = query(
      collection(db, "notifications"),
      where("matchId", "==", matchRef.id),
      where("recipientId", "==", match.id)
    );
    const existingNotifs = await getDocs(notifQuery);

    if (existingNotifs.empty) {
     await addDoc(collection(db, "notifications"), {
  recipientId: match.id,
  matchId: matchRef.id,
  fromUserId: user.uid, // ✅ required by backend
  type: "match_request", // ✅ helps future filtering
  message: `${myProfile.name} has challenged you to a match!`, // ✅ becomes notification title
  url: `/matches/${matchRef.id}`, // ✅ required for navigation
  timestamp: serverTimestamp(),
  read: false,
});

    } else {
      console.log("⚠️ Notification already exists, skipping duplicate.");
    }

    setSentRequests((prev) => new Set(prev).add(match.id));
    alert(`✅ Request sent to ${match.name}`);
  } catch (err) {
    console.error("Failed to send match request:", err);
    alert("❌ Could not send request. Try again.");
  } finally {
    setIsSubmitting(false);
  }
};

  // Sort matches based on user choice
  const sortedMatches = useMemo(() => {
    if (!myProfile) return rawMatches;
    return [...rawMatches].sort((a, b) => {
      if (sortBy === "distance") {
        const myC = postcodeCoords[myProfile.postcode];
        const aC = postcodeCoords[a.postcode];
        const bC = postcodeCoords[b.postcode];
        const da = myC && aC
          ? getDistanceFromLatLonInKm(myC.lat, myC.lng, aC.lat, aC.lng)
          : Infinity;
        const db_ = myC && bC
          ? getDistanceFromLatLonInKm(myC.lat, myC.lng, bC.lat, bC.lng)
          : Infinity;
        return da - db_;
      }
      if (sortBy === "availability") {
        const sa = a.availability.filter((t) => myProfile.availability.includes(t)).length;
        const sb = b.availability.filter((t) => myProfile.availability.includes(t)).length;
        return sb - sa;
      }
      if (sortBy === "skill") {
        const scoreFn = (p: Player) =>
          p.skillLevel === myProfile.skillLevel ? 2 :
          (["Beginner","Intermediate"].includes(p.skillLevel) && ["Beginner","Intermediate"].includes(myProfile.skillLevel)) ? 1 : 0;
        return scoreFn(b) - scoreFn(a);
      }
      // default: best match score
      return (b.score ?? 0) - (a.score ?? 0);
    });
  }, [rawMatches, sortBy, postcodeCoords, myProfile]);

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

      {/* Sort Selector */}
      <div className="mb-4 flex items-center gap-3">
        <label className="text-sm font-medium">Sort by:</label>
        <select
          value={sortBy}
          onChange={(e) => setSortBy(e.target.value)}
          className="border px-3 py-1 rounded"
        >
          <option value="score">Best Match</option>
          <option value="distance">Location</option>
          <option value="availability">Availability</option>
          <option value="skill">Skill Compatibility</option>
        </select>
      </div>

      {sortedMatches.length === 0 ? (
        <p>No matches found yet. Try adjusting your availability or skill level.</p>
      ) : (
        <ul className="space-y-4">
          {sortedMatches.map((match) => {
            const alreadySent = sentRequests.has(match.id);
            const isNew =
              match.timestamp &&
              Date.now() -
                new Date(match.timestamp.toDate?.() || match.timestamp).getTime() <
                3 * 24 * 60 * 60 * 1000;

            let distanceText = "";
            if (
              myProfile &&
              postcodeCoords[myProfile.postcode] &&
              postcodeCoords[match.postcode]
            ) {
              const myC = postcodeCoords[myProfile.postcode];
              const theirC = postcodeCoords[match.postcode];
              const dist = getDistanceFromLatLonInKm(
                myC.lat,
                myC.lng,
                theirC.lat,
                theirC.lng
              );
              distanceText = `📍 ~${dist} km away`;
            }

            return (
              <li
                key={match.id}
                className="border p-6 rounded-lg bg-white shadow-lg hover:shadow-xl transition-all ease-in-out flex items-start gap-6"
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
                  <h2 className="font-semibold text-xl text-gray-800 flex items-center gap-2">
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
                  {distanceText && <p className="text-sm text-gray-600">{distanceText}</p>}
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
                        aria-label={`Request match with ${match.name}`}
                        className="text-sm text-white bg-green-600 hover:bg-blue-700 px-3 py-2 rounded transition-all"
                      >
                        Request to Play
                      </button>
                    )}
                    <Link href={`/players/${match.id}`}> 
                      <button className="text-sm bg-gray-200 rounded px-3 py-2">View Profile</button>
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
