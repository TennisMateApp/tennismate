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
import { GiTennisBall } from "react-icons/gi";
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

const setQuery = (key: string, value?: string) => {
  const p = new URLSearchParams(params.toString());
  if (value == null || value === "") p.delete(key);
  else p.set(key, value);
  router.replace(`?${p.toString()}`);
};

const [justVerified, setJustVerified] = useState(false);

const [hideContacted, setHideContacted] = useState(true);
const [onlySharedAvail, setOnlySharedAvail] = useState(false);
const [maxKm, setMaxKm] = useState<number>(Infinity); 

const [refreshing, setRefreshing] = useState(false);
const [lastUpdated, setLastUpdated] = useState<number | null>(null);

  const refreshMatches = async () => {
  if (!auth.currentUser) return;
  setRefreshing(true);
  try {
    // 1) Ensure user/profile
    const myRef = doc(db, "players", auth.currentUser.uid);
    const mySnap = await getDoc(myRef);
    if (!mySnap.exists()) return;
    const myData = mySnap.data() as Player;
    setMyProfile(myData);

    // 2) Postcode coords
    const postcodeSnap = await getDocs(collection(db, "postcodes"));
    const coords: PostcodeCoords = {};
    postcodeSnap.forEach((d) => { coords[d.id] = d.data() as { lat: number; lng: number }; });
    setPostcodeCoords(coords);

    // 3) Sent requests
    const reqQ = query(collection(db, "match_requests"), where("fromUserId", "==", auth.currentUser.uid));
    const reqSnap = await getDocs(reqQ);
    const sentTo = new Set<string>();
    reqSnap.forEach((d) => { const data = d.data() as any; if (data.toUserId) sentTo.add(data.toUserId); });
    setSentRequests(sentTo);

    // 4) All players + score
    const snapshot = await getDocs(collection(db, "players"));
    const allPlayers = snapshot.docs.map((d) => ({ ...(d.data() as Player), id: d.id }));

    const scoredPlayers = allPlayers
      .filter((p) => p.id !== auth.currentUser!.uid)
      .map((p) => {
        let score = 0;
        let distance = Infinity;

        if (p.skillLevel === myData.skillLevel) score += 2;
        else if (
          ["Beginner", "Intermediate"].includes(p.skillLevel) &&
          ["Beginner", "Intermediate"].includes(myData.skillLevel)
        ) score += 1;

        const shared = A(p.availability).filter((a) => A(myData.availability).includes(a)).length;
        score += shared;

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
    setLastUpdated(Date.now());
  } finally {
    setRefreshing(false);
  }
};


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

    await refreshMatches();
setLoading(false);


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

useEffect(() => {
  if (!user) return;

  const onFocus = () => { refreshMatches(); };
  const onVis = () => { if (document.visibilityState === "visible") refreshMatches(); };

  window.addEventListener("focus", onFocus);
  document.addEventListener("visibilitychange", onVis);
  return () => {
    window.removeEventListener("focus", onFocus);
    document.removeEventListener("visibilitychange", onVis);
  };
}, [user]); // user must be set


const [sendingIds, setSendingIds] = useState<Set<string>>(new Set());

// replace your current handler with this
const handleMatchRequest = async (match: Player) => {
  if (!myProfile || !user) return;
  // don't double-submit the same card
  if (sendingIds.has(match.id)) return;

  // mark THIS card as "sending…"
  setSendingIds((s) => new Set(s).add(match.id));

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

    // de-dupe notif for this match
    const notifQuery = query(
      collection(db, "notifications"),
      where("matchId", "==", matchRef.id),
      where("recipientId", "==", match.id)
    );
    const existingNotifs = await getDocs(notifQuery);
    if (!existingNotifs.empty) {
      console.log("⚠️ Notification already exists, skipping duplicate.");
    }

    setSentRequests((prev) => new Set(prev).add(match.id));
    alert(`✅ Request sent to ${match.name}`);
  } catch (err) {
    console.error("Failed to send match request:", err);
    alert("❌ Could not send request. Try again.");
  } finally {
    // clear "sending…" for THIS card only
    setSendingIds((s) => {
      const n = new Set(s);
      n.delete(match.id);
      return n;
    });
  }
};


  // Sort matches based on user choice
// Filter + sort matches
const filteredMatches = useMemo(() => {
  if (!myProfile) return rawMatches;

  return rawMatches.filter((m) => {
    // Hide already contacted?
    if (hideContacted && sentRequests.has(m.id)) return false;

    // Only show if there is at least one shared availability?
    if (onlySharedAvail) {
      const shared = A(m.availability).some((a) =>
        A(myProfile.availability).includes(a)
      );
      if (!shared) return false;
    }

    // Max distance filter (uses precomputed distance if present)
    if (Number.isFinite(maxKm)) {
      const d = typeof m.distance === "number" ? m.distance : Infinity;
      if (d > (maxKm as number)) return false;
    }

    return true;
  });
}, [rawMatches, hideContacted, onlySharedAvail, maxKm, myProfile, sentRequests]);

const sortedMatches = useMemo(() => {
  if (!myProfile) return filteredMatches;

  return [...filteredMatches].sort((a, b) => {
    if (sortBy === "distance") {
      const da = typeof a.distance === "number" ? a.distance! : Infinity;
      const db = typeof b.distance === "number" ? b.distance! : Infinity;
      return da - db;
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

    // default: best match score, tie-breaker: distance
    const diff = (b.score ?? 0) - (a.score ?? 0);
    if (diff !== 0) return diff;
    const da = typeof a.distance === "number" ? a.distance! : Infinity;
    const db = typeof b.distance === "number" ? b.distance! : Infinity;
    return da - db;
  });
}, [filteredMatches, sortBy, myProfile]);

useEffect(() => {
  const qSort   = params.get("sort");
  const qHide   = params.get("hide");     // "1" | "0"
  const qShared = params.get("shared");   // "1" | "0"
  const qMax    = params.get("maxKm");    // "any" | number string

  if (qSort) setSortBy(qSort);
  if (qHide === "0" || qHide === "1") setHideContacted(qHide === "1");
  if (qShared === "0" || qShared === "1") setOnlySharedAvail(qShared === "1");
  if (qMax) setMaxKm(qMax === "any" ? Infinity : Number(qMax));
  // eslint-disable-next-line react-hooks/exhaustive-deps
}, []); // run once on mount


if (loading) {
  return (
    <div className="max-w-2xl mx-auto p-6 space-y-3">
      {[...Array(4)].map((_, i) => (
        <div key={i} className="rounded-xl bg-white ring-1 ring-black/5 p-4 animate-pulse">
          <div className="flex items-start gap-3">
            <div className="w-14 h-14 rounded-full bg-gray-200" />
            <div className="flex-1 space-y-2">
              <div className="h-4 bg-gray-200 rounded w-1/3" />
              <div className="h-3 bg-gray-200 rounded w-2/3" />
              <div className="h-3 bg-gray-200 rounded w-1/2" />
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
  return (
    <div className="max-w-2xl mx-auto p-4 pb-28 sm:p-6">
     <div className="mb-3">
  <h1 className="text-2xl font-bold tracking-tight text-gray-900 flex items-center gap-2">
    <GiTennisBall className="h-6 w-6 text-green-600" />
    Your Top Matches
  </h1>
  <p className="text-sm text-gray-600">
    Players near {myProfile?.postcode ?? "you"} that match your skill & schedule
  </p>
</div>


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

{/* Sticky controls (mobile-first) */}
<div className="sticky top-[56px] z-10 mb-3 rounded-xl bg-white/90 backdrop-blur ring-1 ring-black/5 p-3">

  <div className="grid grid-cols-1 gap-2 sm:flex sm:flex-wrap sm:items-center sm:gap-3">
    <div className="flex items-center gap-2">
      <span className="text-sm text-gray-600">
        {sortedMatches.length} match{sortedMatches.length === 1 ? "" : "es"}
      </span>

      <label className="ml-2 text-sm font-medium">Sort</label>
      <select
  value={sortBy}
  onChange={(e) => { setSortBy(e.target.value); setQuery("sort", e.target.value); }}
  className="text-sm border rounded-lg px-2 py-1 w-full sm:w-auto"
>
        <option value="score">Best Match</option>
        <option value="distance">Closest</option>
        <option value="availability">Availability</option>
        <option value="skill">Skill fit</option>
      </select>
    </div>

    <div className="flex flex-wrap items-center gap-3">
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          className="accent-green-600"
          checked={hideContacted}
          onChange={(e) => { 
  setHideContacted(e.target.checked);
  setQuery("hide", e.target.checked ? "1" : "0");
}}
        />
        Hide contacted
      </label>

      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          className="accent-green-600"
          checked={onlySharedAvail}
          onChange={(e) => {
  setOnlySharedAvail(e.target.checked);
  setQuery("shared", e.target.checked ? "1" : "0");
}}

        />
        Shared only
      </label>

      <select
        value={Number.isFinite(maxKm) ? String(maxKm) : "any"}
       onChange={(e) => {
  const val = e.target.value;
  setMaxKm(val === "any" ? Infinity : Number(val));
  setQuery("maxKm", val);
}}

        className="text-sm border rounded-lg px-2 py-1 w-full sm:w-[140px]"
        title="Max distance"
      >
        <option value="any">Any distance</option>
        <option value="20">≤ 20 km</option>
        <option value="10">≤ 10 km</option>
        <option value="5">≤ 5 km</option>
      </select>
    </div>
  </div>
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

            return (
<li
  role="region"
  aria-label={`${match.name} match card`}
  key={match.id}
  className="rounded-2xl bg-white ring-1 ring-black/5 p-4 shadow-sm hover:shadow-md transition"
>
  <div className="flex items-start gap-3">
    {/* Avatar (smaller on mobile) */}
    {match.photoURL ? (
      <img
        src={match.photoURL}
        alt=""
        className="w-12 h-12 sm:w-14 sm:h-14 rounded-full object-cover bg-gray-100"
        loading="lazy"
        decoding="async"
      />
    ) : (
      <div className="w-12 h-12 sm:w-14 sm:h-14 rounded-full bg-gray-200 flex items-center justify-center text-[11px] text-gray-600">
        No Photo
      </div>
    )}

    <div className="min-w-0 flex-1">
      {/* Name + chips */}
      <div className="flex flex-wrap items-center gap-2">
       <h2 className="font-semibold text-gray-900 text-base sm:text-lg truncate max-w-[70%]">
          {match.name}
        </h2>

        {(() => {
          const maxScore = 9; // 2 skill + 4 avail + 3 distance
          const pct = Math.round(((match.score ?? 0) / maxScore) * 100);
          return (
            <span className="text-[10px] sm:text-[11px] px-2 py-[2px] rounded-full bg-green-50 text-green-700 ring-1 ring-green-200">
              {isNaN(pct) ? "Match" : `${pct}% match`}
            </span>
          );
        })()}

        {typeof match.distance === "number" && (
          <span className="text-[10px] sm:text-[11px] ml-auto px-2 py-[2px] rounded-full bg-gray-100 text-gray-700">
            ~{match.distance} km
          </span>
        )}
      </div>

      {/* Availability chips: limited on mobile, full on desktop */}
      {(() => {
        const avail = A(match.availability);
        const visible = avail.slice(0, 2);
        const remaining = avail.length - visible.length;

        return (
          <>
            {/* Mobile (limited) */}
            <div className="mt-1 flex flex-wrap gap-1.5 sm:hidden">
              <span className="text-[10px] px-2 py-[2px] rounded-full bg-gray-100 text-gray-700">
                Skill: {match.skillLevel}
              </span>
              {visible.map((slot) => {
                const shared = myProfile
                  ? A(myProfile.availability).includes(slot)
                  : false;
                return (
                  <span
                    key={slot}
                    className={
                      "text-[10px] px-2 py-[2px] rounded-full " +
                      (shared
                        ? "bg-green-50 text-green-700 ring-1 ring-green-200"
                        : "bg-gray-100 text-gray-700")
                    }
                  >
                    {slot}
                  </span>
                );
              })}
              {remaining > 0 && (
                <span className="text-[10px] px-2 py-[2px] rounded-full bg-gray-100 text-gray-700">
                  +{remaining} more
                </span>
              )}
            </div>

            {/* Desktop (full) */}
            <div className="mt-1 hidden sm:flex flex-wrap gap-1.5">
              <span className="text-[11px] px-2 py-[2px] rounded-full bg-gray-100 text-gray-700">
                Skill: {match.skillLevel}
              </span>
              {avail.map((slot) => {
                const shared = myProfile
                  ? A(myProfile.availability).includes(slot)
                  : false;
                return (
                  <span
                    key={slot}
                    className={
                      "text-[11px] px-2 py-[2px] rounded-full " +
                      (shared
                        ? "bg-green-50 text-green-700 ring-1 ring-green-200"
                        : "bg-gray-100 text-gray-700")
                    }
                  >
                    {slot}
                  </span>
                );
              })}
            </div>
          </>
        );
      })()}

      {/* Bio */}
      {match.bio && (
        <p className="mt-1 text-sm text-gray-700">
          {match.bio.slice(0, 160)}
          {match.bio.length > 160 && "…"}
        </p>
      )}

      {/* Actions: full-width on mobile, inline on desktop */}
      <div className="mt-3 flex flex-col sm:flex-row gap-2">
        <Link
          href={`/players/${match.id}`}
          className="text-sm w-full sm:w-auto px-3 py-2 rounded-lg bg-gray-100 hover:bg-gray-200 text-center"
        >
          View Profile
        </Link>

        {sentRequests.has(match.id) ? (
  <span className="w-full sm:w-auto text-green-700 text-sm font-medium flex items-center justify-center">
    ✅ Request Sent
  </span>
) : (
  <button
    onClick={() => handleMatchRequest(match)}
    disabled={sendingIds.has(match.id)}
    className="text-sm w-full sm:w-auto px-3 py-2 rounded-lg bg-green-600 text-white hover:bg-green-700 disabled:bg-gray-300 disabled:cursor-not-allowed"
    aria-label={`Request to play with ${match.name}`}
  >
    {sendingIds.has(match.id) ? "Sending…" : "Request to Play"}
  </button>
)}

      </div>
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
