"use client";

import { useEffect, useState, useMemo, useCallback } from "react";
import { db, auth } from "@/lib/firebaseConfig";
import { type SkillBand, SKILL_OPTIONS, skillFromUTR } from "../../lib/skills";
import {
  collection, getDocs, doc, getDoc, addDoc,
  serverTimestamp, query, where, updateDoc,
} from "firebase/firestore";
import { useRouter, useSearchParams } from "next/navigation";
import { onAuthStateChanged, applyActionCode } from "firebase/auth";
import Link from "next/link";
import { CheckCircle2 } from "lucide-react";
import Image from "next/image";
// import { getContinueUrl } from "@/lib/auth/getContinueUrl";


interface Player {
  id: string;
  name: string;
  postcode: string;
  skillLevel?: string;           // legacy (optional)
  skillBand?: SkillBand | "";    // new
  skillBandLabel?: string | null;
  utr?: number | null;           // new
  skillRating?: number | null;
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

// ---- Skill band + UTR helpers ----

const BAND_ORDER: SkillBand[] = [
  "lower_beginner","beginner","upper_beginner",
  "lower_intermediate","intermediate","upper_intermediate",
  "lower_advanced","advanced","upper_advanced",
];

function bandIndex(b?: SkillBand | "" | null) {
  return b ? BAND_ORDER.indexOf(b as SkillBand) : -1;
}
function bandDistance(a?: SkillBand | "" | null, b?: SkillBand | "" | null) {
  const ia = bandIndex(a);
  const ib = bandIndex(b);
  if (ia < 0 || ib < 0) return 99;
  return Math.abs(ia - ib);
}
function utrDelta(a?: number | null, b?: number | null) {
  if (a == null || b == null) return 99;
  return Math.abs(a - b);
}
// Map legacy "Beginner/Intermediate/Advanced" to a middle band
function legacyToBand(level?: string): SkillBand | null {
  if (!level) return null;
  const norm = level.toLowerCase();
  if (norm.includes("beginner")) return "beginner";
  if (norm.includes("intermediate")) return "intermediate";
  if (norm.includes("advanced") || norm.includes("advance")) return "advanced";
  return null;
}
// Pretty label for chips
function labelForBand(
  b?: SkillBand | "" | null,
  explicitLabel?: string | null | undefined
) {
  // If Firestore gave us a nice label, use that first
  if (explicitLabel) return explicitLabel;

  if (!b) return "Unknown";
  return SKILL_OPTIONS.find((x) => x.value === b)?.label ?? "Unknown";
}

// Points tables
function bandPoints(dist:number){
  if (dist === 0) return 4;
  if (dist === 1) return 2;
  if (dist === 2) return 1;
  return 0;
}
function utrPoints(gap:number){
  if (gap === 99) return 0;
  if (gap <= 0.40) return 4;
  if (gap <= 0.80) return 3;
  if (gap <= 1.20) return 2;
  if (gap <= 1.80) return 1;
  return 0;
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
  const [matchMode, setMatchMode] = useState<"auto"|"skill"|"utr">("auto");

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

 const refreshMatches = useCallback(async () => {
  if (!auth.currentUser) return;
  setRefreshing(true);
  try {
    // 1) Ensure user/profile
    const myRef = doc(db, "players", auth.currentUser.uid);
    const mySnap = await getDoc(myRef);
    if (!mySnap.exists()) return;
    const myData = mySnap.data() as Player;
   const myBand = (
  myData.skillBand ||
  skillFromUTR((myData.skillRating ?? myData.utr) ?? null) ||
  legacyToBand(myData.skillLevel) ||
  ""
) as SkillBand | "";
setMyProfile({ ...myData, skillBand: myBand });


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

    // 4) All players + score (mode-aware)
    const snapshot = await getDocs(collection(db, "players"));
    const allPlayers = snapshot.docs.map((d) => ({ ...(d.data() as Player), id: d.id }));

   const meBand   = myBand;
const meRating = (myData.skillRating ?? myData.utr) ?? null; // ✅ prefer skillRating


    const scoredPlayers = allPlayers
      .filter((p) => p.id !== auth.currentUser!.uid)
      .map((p) => {
        let score = 0;
        let distance = Infinity;
        const theirRating = (p.skillRating ?? p.utr) ?? null; // ✅ prefer skillRating
        const theirBand: SkillBand | "" =
  p.skillBand || skillFromUTR(theirRating) || legacyToBand(p.skillLevel) || "";

const bDist = bandDistance(meBand, theirBand);
const uGap  = utrDelta(meRating, theirRating);

if (matchMode === "utr" && meRating != null) {
  score += utrPoints(uGap);
  score += bandPoints(bDist) * 0.5;
} else if (matchMode === "skill") {
  score += bandPoints(bDist);
  score += utrPoints(uGap) * 0.5;
} else {
  if (meRating != null && theirRating != null) {
    score += utrPoints(uGap);
    score += bandPoints(bDist) * 0.5;
  } else {
    score += bandPoints(bDist);
    score += utrPoints(uGap) * 0.5;
  }
}


        // Availability (cap 4)
        const shared = A(p.availability).filter((a) =>
          A(myData.availability).includes(a)
        ).length;
        score += Math.min(shared, 4);

        // Distance bonus
        const myC = coords[myData.postcode];
        const theirC = coords[p.postcode];
        if (myC && theirC) {
          distance = getDistanceFromLatLonInKm(myC.lat, myC.lng, theirC.lat, theirC.lng);
          if (distance < 5) score += 3;
          else if (distance < 10) score += 2;
          else if (distance < 20) score += 1;
        }

        return { ...p, score, distance, skillBand: theirBand };
      })
      .filter((p) => (p.score ?? 0) > 0);

    setRawMatches(scoredPlayers);
    setLastUpdated(Date.now());
  } finally {
    setRefreshing(false);
  }
}, [matchMode]);

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

    // redirect unverified-but-required users (skip if we're consuming a verify action)
    const userDoc = await getDoc(doc(db, "users", currentUser.uid));
    const requireFlag = userDoc.exists() && (userDoc.data() as any)?.requireVerification === true;
    if (requireFlag && !currentUser.emailVerified && !isVerifyAction) {
      router.replace("/verify-email");
      return;
    }

    // ensure profile exists
    const myRef = doc(db, "players", currentUser.uid);
    const mySnap = await getDoc(myRef);
    if (!mySnap.exists()) {
      alert("Please complete your profile first.");
      router.push("/profile");
      return;
    }

    // one single compute path
    await refreshMatches();
    setLoading(false);
    window.dispatchEvent(new CustomEvent("tm:matchMeReady"));
  });

  return () => unsub();
}, [router, params, refreshMatches]);


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
}, [user, refreshMatches]); // user must be set


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
      nudgeSent: false,
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

// 🔔 Notify onboarding tour
window.dispatchEvent(new CustomEvent("tm:matchRequestSent"));

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
       const meBand = myProfile.skillBand ||
  skillFromUTR((myProfile.skillRating ?? myProfile.utr) ?? null) ||
  legacyToBand(myProfile.skillLevel) || "";
const meRating  = (myProfile.skillRating ?? myProfile.utr) ?? null;

const bandDelta = (p: Player) =>
  bandDistance(
    meBand as SkillBand | "",
    p.skillBand || skillFromUTR((p.skillRating ?? p.utr) ?? null) || legacyToBand(p.skillLevel) || ""
  );

const utrGap = (p: Player) => utrDelta(meRating, (p.skillRating ?? p.utr) ?? null);

        // Primary: band distance; Secondary: UTR gap; Tertiary: distance
        const bd = bandDelta(a) - bandDelta(b);
        if (bd !== 0) return bd;
        const ud = utrGap(a) - utrGap(b);
        if (ud !== 0) return ud;
        const da = typeof a.distance === "number" ? a.distance! : Infinity;
        const db = typeof b.distance === "number" ? b.distance! : Infinity;
        return da - db;
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
  const qMode   = params.get("mode");     // "auto" | "skill" | "utr"

  if (qSort) setSortBy(qSort);
  if (qHide === "0" || qHide === "1") setHideContacted(qHide === "1");
  if (qShared === "0" || qShared === "1") setOnlySharedAvail(qShared === "1");
  if (qMax) setMaxKm(qMax === "any" ? Infinity : Number(qMax));
  if (qMode === "auto" || qMode === "skill" || qMode === "utr") setMatchMode(qMode);
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
  <div
    className="max-w-2xl mx-auto p-4 pb-28 sm:p-6"
    data-tour="match-page"
  >

     {/* Header hero tile */}
<div className="-mx-4 sm:-mx-6 mb-4">
  <div className="relative h-40 sm:h-56 md:h-64 overflow-hidden rounded-2xl">
    <Image
      src="/images/match.jpg"
      alt="Tennis players getting matched for a game"
      fill
      priority
      className="object-cover"
    />
    <div className="absolute inset-0 bg-black/40" />
    <div className="absolute inset-0 flex items-center justify-center px-4">
      <div className="text-center text-white">
        <h1 className="text-2xl sm:text-3xl font-bold tracking-tight">Find Your Next Match</h1>
        <p className="mt-1 text-sm sm:text-base opacity-90">
          Smart matching by skill, TMR &amp; availability near {myProfile?.postcode ?? "you"}
        </p>
      </div>
    </div>
  </div>
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
      <label className="ml-3 text-sm font-medium">Match by</label>
      <select
      value={matchMode}
      onChange={(e) => {
        const val = e.target.value as "auto"|"skill"|"utr";
         setMatchMode(val);
         setQuery("mode", val);
         refreshMatches(); // recalc with new mode
         }}
         className="text-sm border rounded-lg px-2 py-1 w-full sm:w-auto"
         title="Primary matching method"
         >
          <option value="auto">Auto</option>
          <option value="skill">Skill level</option>
          <option value="utr">TMR</option>
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
          {sortedMatches.map((match, index) => {
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
  data-tour={index === 0 ? "top-match" : undefined}
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
          const maxScore = 15; // 4 band/4 UTR + 4 avail cap + 3 distance
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
  Skill: {labelForBand(
    match.skillBand ||
      skillFromUTR((match.skillRating ?? match.utr) ?? null) ||
      legacyToBand(match.skillLevel),
    match.skillBandLabel // 👈 prefer pretty label from Firestore
  )}
</span>

           {typeof (match.skillRating ?? match.utr) === "number" && (
            <span className="text-[10px] px-2 py-[2px] rounded-full bg-gray-100 text-gray-700">
              TMR: {(match.skillRating ?? match.utr)!.toFixed(2)}
              </span>
              )}

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
  Skill: {labelForBand(
    match.skillBand ||
      skillFromUTR((match.skillRating ?? match.utr) ?? null) ||
      legacyToBand(match.skillLevel),
    match.skillBandLabel // 👈 prefer pretty label from Firestore
  )}
</span>

         {typeof (match.skillRating ?? match.utr) === "number" && (
          <span className="text-[11px] px-2 py-[2px] rounded-full bg-gray-100 text-gray-700">
          TMR: {(match.skillRating ?? match.utr)!.toFixed(2)}
          </span>
          )}

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
  data-tour={index === 0 ? "send-request" : undefined}
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
