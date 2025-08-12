"use client";

import { useEffect, useState, useMemo } from "react";
import { db, auth } from "@/lib/firebaseConfig";
import {
  collection, getDocs, doc, getDoc, addDoc,
  serverTimestamp, query, where, updateDoc,
} from "firebase/firestore";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { onAuthStateChanged, applyActionCode } from "firebase/auth";
import { CheckCircle2 } from "lucide-react";
// import { getContinueUrl } from "@/lib/auth/getContinueUrl";


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
  distance?: number;
}

interface PostcodeCoords {
  [postcode: string]: { lat: number; lng: number };
}

const A = <T,>(x: T[] | undefined | null): T[] => Array.isArray(x) ? x : [];


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

  const params = useSearchParams();
const [justVerified, setJustVerified] = useState(false);
  

  async function finalizeVerification() {
  if (!auth.currentUser) return;

  // Refresh local user + ID token so rules see email_verified=true
  await auth.currentUser.reload();
  await auth.currentUser.getIdToken(true);

  // If verified, clear your Firestore flag
  if (auth.currentUser.emailVerified) {
    try {
      await updateDoc(doc(db, "users", auth.currentUser.uid), {
        requireVerification: false,
        verifiedAt: serverTimestamp(),
      });
    } catch (e) {
      console.error("Failed to update requireVerification:", e);
    }
  }
}

useEffect(() => {
  const mode = params.get("mode");
  const code = params.get("oobCode");
  const verifiedFlag = params.get("verified");

  // Case 1: Firebase appended verify params to /match
  if (mode === "verifyEmail" && code) {
    (async () => {
      const key = `tm_oob_${code}`; // remember we've handled this one already

      // If we already processed this code in this browser, just clean the URL
      if (typeof window !== "undefined" && sessionStorage.getItem(key)) {
        router.replace("/match");
        return;
      }

      try {
        // If user already verified (e.g. refresh), don't try to consume again
        await auth.currentUser?.reload();
        if (auth.currentUser?.emailVerified) {
          await finalizeVerification(); // ensure Firestore flag is cleared
          router.replace("/match");
          return;
        }

        // Consume the code once
        await applyActionCode(auth, code);
        sessionStorage.setItem(key, "1");

        // Finalize: refresh token + clear Firestore flag
        await finalizeVerification();
        setJustVerified(true);
      } catch (e: any) {
        // If code is invalid/expired but user *is* verified, treat as success
        await auth.currentUser?.reload();
        if (e?.code === "auth/invalid-action-code" && auth.currentUser?.emailVerified) {
          await finalizeVerification();
          router.replace("/match");
          return;
        }
        console.error("applyActionCode failed", e);
        alert("Verification link is invalid or expired. Please resend the email.");
      } finally {
        // Clean the URL so refresh doesn't re-run this block
        router.replace("/match");
      }
    })();
    return;
  }

  // Case 2: Hosted handler redirected back with ?verified=1
  if (verifiedFlag === "1") {
    (async () => {
      await finalizeVerification();
      setJustVerified(true);
      router.replace("/match");
    })();
  }
}, [params, router]);

useEffect(() => {
if (!justVerified) return;
const { overflow } = document.body.style;
document.body.style.overflow = "hidden";
return () => { document.body.style.overflow = overflow; };
}, [justVerified]);

useEffect(() => {
  const unsub = onAuthStateChanged(auth, async (currentUser) => {
    const isVerifyAction = params.get("mode") === "verifyEmail" && !!params.get("oobCode");
    if (!currentUser) {
      router.push("/login");
      return;
    }
    setUser(currentUser);

    // 🚦 NEW: redirect unverified-but-required users
    const userDoc = await getDoc(doc(db, "users", currentUser.uid));
    const requireFlag =
      userDoc.exists() && (userDoc.data() as any)?.requireVerification === true;

  // Skip redirect if we are currently processing an email verify action on this page
if (requireFlag && !currentUser.emailVerified && !isVerifyAction) {
  router.replace("/verify-email");
  return;
}

    // Load my profile (only runs if user is allowed to be here)
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

    // Load sent match requests
    const reqQuery = query(
      collection(db, "match_requests"),
      where("fromUserId", "==", currentUser.uid)
    );
    const reqSnap = await getDocs(reqQuery);
    const sentTo = new Set<string>();
    reqSnap.forEach((d) => {
      const data = d.data() as any;
      if (data.toUserId) sentTo.add(data.toUserId);
    });
    setSentRequests(sentTo);

// Load players and compute match scores (safe)
try {
  const snapshot = await getDocs(collection(db, "players"));
  const allPlayers = snapshot.docs.map((d) => {
    const data = d.data() as Player;
    return { ...data, id: d.id };
  });

  const scoredPlayers = allPlayers
    .filter((p) => p.id !== currentUser.uid)
    .map((p) => {
      let score = 0;
      let distance = Infinity;

      // Skill match
      if (p.skillLevel === myData.skillLevel) {
        score += 2;
      } else if (
        ["Beginner", "Intermediate"].includes(p.skillLevel) &&
        ["Beginner", "Intermediate"].includes(myData.skillLevel)
      ) {
        score += 1;
      }

      // Availability match (SAFE)
      const shared = A(p.availability).filter((a) =>
        A(myData.availability).includes(a)
      ).length;
      score += shared;

      // Distance match
      const myC = coords[myData.postcode];
      const theirC = coords[p.postcode];
      if (myC && theirC) {
        distance = getDistanceFromLatLonInKm(myC.lat, myC.lng, theirC.lat, theirC.lng);
        if (distance < 5) score += 3;
        else if (distance < 10) score += 2;
        else if (distance < 20) score += 1;
      }

      return { ...p, score, distance };
    })
    .filter((p) => (p.score ?? 0) > 0);

  setRawMatches(scoredPlayers);
} catch (e) {
  console.error("Compute matches failed:", e);
  setRawMatches([]); // fail safe
} finally {
  setLoading(false);
}

  });

  return () => unsub();
}, [router, params]);

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
  const sa = A(a.availability).filter((t) =>
    A(myProfile.availability).includes(t)
  ).length;
  const sb = A(b.availability).filter((t) =>
    A(myProfile.availability).includes(t)
  ).length;
  return sb - sa;
}

    if (sortBy === "skill") {
      const scoreFn = (p: Player) =>
        p.skillLevel === myProfile.skillLevel
          ? 2
          : ["Beginner", "Intermediate"].includes(p.skillLevel) &&
            ["Beginner", "Intermediate"].includes(myProfile.skillLevel)
          ? 1
          : 0;
      return scoreFn(b) - scoreFn(a);
    }

    // Default: best match score
    if (sortBy === "score") {
      const scoreDiff = (b.score ?? 0) - (a.score ?? 0);

      if (scoreDiff !== 0) return scoreDiff;

      const distA = a.distance ?? Infinity;
      const distB = b.distance ?? Infinity;
      return distA - distB;
    }

    return 0;
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

{justVerified && (
  <div
    role="dialog"
    aria-modal="true"
    aria-labelledby="verified-title"
    className="fixed inset-0 z-[100] flex items-center justify-center p-4"
  >
    {/* Dim backdrop */}
    <div
      className="absolute inset-0 bg-black/50"
      onClick={() => setJustVerified(false)}
    />

    {/* Modal card */}
    <div className="relative z-[101] w-full max-w-sm rounded-2xl bg-white shadow-xl ring-1 ring-black/5 p-6">
      <div className="flex items-start gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-full bg-green-100">
          <CheckCircle2 className="h-6 w-6 text-green-600" aria-hidden="true" />
        </div>
        <div>
          <h2 id="verified-title" className="text-lg font-semibold">
            Email verified
          </h2>
          <p className="mt-1 text-sm text-gray-600">
            You can now send match requests.
          </p>
        </div>
      </div>

      <div className="mt-6 flex justify-end gap-2">
        <button
          onClick={() => setJustVerified(false)}
          className="inline-flex items-center rounded-lg bg-green-600 px-4 py-2 text-sm font-medium text-white hover:bg-green-700"
          autoFocus
        >
          Got it
        </button>
      </div>
    </div>
  </div>
)}

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
                  <strong>Availability:</strong> {A(match.availability).join(", ")}
                  </p>
                 <p className="mt-1 text-sm text-gray-700">
  {match.bio?.slice(0, 180)}
  {match.bio?.length > 180 && "..."}
</p>
                  <div className="mt-3 flex gap-3">
                    {alreadySent ? (
                      <span className="text-green-600 text-sm font-medium">✅ Request Sent</span>
                    ) : (
                     <button
  onClick={() => handleMatchRequest(match)}
  aria-label={`Request match with ${match.name}`}
className="text-sm text-white px-3 py-2 rounded transition-all bg-green-600 hover:bg-blue-700 disabled:bg-gray-400 disabled:cursor-not-allowed"
disabled={alreadySent || isSubmitting}
title=""
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
