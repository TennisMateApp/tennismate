"use client";

import { useEffect, useState, useMemo, useCallback, useRef } from "react";
import { db, auth } from "@/lib/firebaseConfig";
import { type SkillBand, SKILL_OPTIONS, skillFromUTR } from "../../lib/skills";
import {
  collection,
  getDocs,
  doc,
  getDoc,
  addDoc,
  serverTimestamp,
  query,
  where,
  updateDoc,
  Timestamp,
  orderBy,
  startAt,
  endAt,
  limit,
} from "firebase/firestore";
import { useRouter, useSearchParams } from "next/navigation";
import { onAuthStateChanged, applyActionCode } from "firebase/auth";
import Link from "next/link";
import { CheckCircle2 } from "lucide-react";
import Image from "next/image";
import { track } from "@/lib/track";
import { geohashQueryBounds } from "geofire-common";

// import { getContinueUrl } from "@/lib/auth/getContinueUrl";


interface Player {
  id: string;
  name: string;
  postcode: string;
  skillLevel?: string;
  skillBand?: SkillBand | "";
  skillBandLabel?: string | null;
  utr?: number | null;
  skillRating?: number | null;
  availability: string[];
  bio: string;
  email: string;
  photoURL?: string;
  photoThumbURL?: string | null;
  avatar?: string | null;
  birthYear?: number | null;
  age?: number | null;        // ✅ NEW
  gender?: string | null;     // ✅ NEW
  isMatchable?: boolean | null; // ✅ NEW
  timestamp?: any;
  score?: number;
  distance?: number;
  lat?: number | null;
  lng?: number | null;
  geohash?: string | null;
}

type ScoredPlayer = Player & {
  score: number;
  distance: number;
  skillBand: SkillBand | "";
};


const A = <T,>(x: T[] | undefined | null): T[] => Array.isArray(x) ? x : [];

const deriveAgeFromBirthYear = (birthYear: unknown) => {
  if (typeof birthYear !== "number" || !Number.isFinite(birthYear)) return null;
  const currentYear = new Date().getFullYear();
  const age = currentYear - birthYear;

  // sanity bounds to avoid typos
  if (birthYear < 1900 || birthYear > currentYear) return null;
  if (age < 0 || age > 110) return null;

  return age;
};


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

type AgeBand = "" | "18-24" | "25-34" | "35-44" | "45-54" | "55+";

const inAgeBand = (age: number, band: AgeBand) => {
  if (band === "") return true; // Any
  if (band === "18-24") return age >= 18 && age <= 24;
  if (band === "25-34") return age >= 25 && age <= 34;
  if (band === "35-44") return age >= 35 && age <= 44;
  if (band === "45-54") return age >= 45 && age <= 54;
  if (band === "55+") return age >= 55;
  return true;
};



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

const MAX_NEARBY_READS = 600; // max docs per geohash bound query (safety cap)
const SENT_CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24h
const SENT_LOOKBACK_DAYS = 14; // when cache expires, only read last 14 days


export default function MatchPage() {
  const [user, setUser] = useState<any>(null);
  const [myProfile, setMyProfile] = useState<Player | null>(null);
  const [rawMatches, setRawMatches] = useState<Player[]>([]);
  const [sentRequests, setSentRequests] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [sortBy, setSortBy] = useState<string>("score");
  const PAGE_SIZE = 10;
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  const MAX_DISTANCE_KM = 50; // hard cutoff to prevent interstate matches
  const [matchMode, setMatchMode] = useState<"auto"|"skill"|"utr">("auto");
  const [myProfileHidden, setMyProfileHidden] = useState(false);
  const refreshingRef = useRef(false);

type GenderFilter = "" | "Male" | "Female" | "Non-binary" | "Other";

const [ageBand, setAgeBand] = useState<AgeBand>("");
const [genderFilter, setGenderFilter] = useState<GenderFilter>("");

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

const [refreshing, setRefreshing] = useState(false);
const [lastUpdated, setLastUpdated] = useState<number | null>(null);


const REFRESH_MIN_MS = 2 * 60 * 1000; // 2 minutes

const sentCacheKey = (uid: string) => `tm_sentRequests_v2_${uid}`;

const readSentCache = (uid: string): { ts: number; ids: string[] } | null => {
  try {
    const raw = localStorage.getItem(sentCacheKey(uid));
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed.ts !== "number" || !Array.isArray(parsed.ids)) return null;
    return parsed;
  } catch {
    return null;
  }
};

const writeSentCache = (uid: string, ids: Set<string>) => {
  try {
    localStorage.setItem(
      sentCacheKey(uid),
      JSON.stringify({ ts: Date.now(), ids: Array.from(ids) })
    );
  } catch {
    // ignore
  }
};

const loadNearbyPlayers = useCallback(
  async (myLat: number, myLng: number, radiusKm: number) => {
    const bounds = geohashQueryBounds([myLat, myLng], radiusKm * 1000);

    const seen = new Set<string>();
    const out: Player[] = [];

    await Promise.all(
      bounds.map(async ([start, end]) => {
        const q = query(
          collection(db, "players"),
          orderBy("geohash"),
          startAt(start),
          endAt(end),
          limit(MAX_NEARBY_READS)
        );

        const snap = await getDocs(q);

        snap.forEach((d) => {
          if (seen.has(d.id)) return;
          seen.add(d.id);

          const data = d.data() as any;

          const birthYear =
            typeof data.birthYear === "number" && Number.isFinite(data.birthYear)
              ? data.birthYear
              : null;

          const derivedAge = deriveAgeFromBirthYear(birthYear);
          const legacyAge =
            typeof data.age === "number" && Number.isFinite(data.age) ? data.age : null;

            const photoURL =
            typeof data.photoThumbURL === "string" ? data.photoThumbURL :
            typeof data.photoURL === "string" ? data.photoURL :
            typeof data.photoUrl === "string" ? data.photoUrl :
            typeof data.avatar === "string" ? data.avatar :
            typeof data.avatarUrl === "string" ? data.avatarUrl :
            null;

          out.push({
            ...(data as Player),
            id: d.id,
            birthYear,
            age: derivedAge ?? legacyAge ?? null,
            gender: typeof data.gender === "string" ? data.gender : null,
            isMatchable: typeof data.isMatchable === "boolean" ? data.isMatchable : true,
            lat: typeof data.lat === "number" ? data.lat : null,
            lng: typeof data.lng === "number" ? data.lng : null,
            geohash: typeof data.geohash === "string" ? data.geohash : null,
            photoURL: photoURL ?? undefined,
            photoThumbURL: typeof data.photoThumbURL === "string" ? data.photoThumbURL : null,
            avatar: typeof data.avatar === "string" ? data.avatar : null,
          });
        });
      })
    );

    return out;
  },
  [db]
);


const refreshMatches = useCallback(async () => {
  if (!auth.currentUser) return;

  // ✅ throttle refresh frequency (do this BEFORE locking the ref)
  if (lastUpdated && Date.now() - lastUpdated < REFRESH_MIN_MS) {
    return;
  }

  // ✅ prevent duplicate refresh calls while one is already running
  if (refreshingRef.current) return;
  refreshingRef.current = true;

  setRefreshing(true);

  try {
    // 1) Load my profile
    const myRef = doc(db, "players", auth.currentUser.uid);
    const mySnap = await getDoc(myRef);
    if (!mySnap.exists()) return;

    const myData = mySnap.data() as any;

    const myBirthYear =
      typeof myData.birthYear === "number" && Number.isFinite(myData.birthYear)
        ? myData.birthYear
        : null;

    const myAge =
      deriveAgeFromBirthYear(myBirthYear) ??
      (typeof myData.age === "number" && Number.isFinite(myData.age) ? myData.age : null);

    const hidden = myData?.isMatchable === false;
    setMyProfileHidden(hidden);

    if (hidden) {
      setRawMatches([]);
      setLastUpdated(Date.now());
      return;
    }

    const myLat = typeof myData.lat === "number" ? myData.lat : null;
    const myLng = typeof myData.lng === "number" ? myData.lng : null;

    const myBand = (
      myData.skillBand ||
      skillFromUTR((myData.skillRating ?? myData.utr) ?? null) ||
      legacyToBand(myData.skillLevel) ||
      ""
    ) as SkillBand | "";

    setMyProfile({
      ...(myData as Player),
      id: mySnap.id,
      skillBand: myBand,
      birthYear: myBirthYear,
      age: myAge,
      lat: myLat,
      lng: myLng,
      geohash: typeof myData.geohash === "string" ? myData.geohash : null,
    });

// 2) Sent requests (prefer local cache)
let sentTo = new Set<string>();

const cached = readSentCache(auth.currentUser.uid);
if (cached && Date.now() - cached.ts < SENT_CACHE_TTL_MS) {
  sentTo = new Set(cached.ids);
} else {
  const lookbackMs = SENT_LOOKBACK_DAYS * 24 * 60 * 60 * 1000;
  const since = Timestamp.fromMillis(Date.now() - lookbackMs);

  const reqQ = query(
    collection(db, "match_requests"),
    where("fromUserId", "==", auth.currentUser.uid),
    where("timestamp", ">=", since)
  );

  const reqSnap = await getDocs(reqQ);

  reqSnap.forEach((d) => {
    const data = d.data() as any;
    if (data.toUserId) sentTo.add(data.toUserId);
  });

  writeSentCache(auth.currentUser.uid, sentTo);
}

setSentRequests(sentTo);


  // 3) Load nearby players only (geohash bounds)
if (myLat == null || myLng == null) {
  setRawMatches([]);
  setLastUpdated(Date.now());
  return;
}

const allPlayers = await loadNearbyPlayers(myLat, myLng, MAX_DISTANCE_KM);


    const meRating = (myData.skillRating ?? myData.utr) ?? null;

    // 4) Score + distance filter
    const scoredPlayers: ScoredPlayer[] = allPlayers
      .filter((p) => p.id !== auth.currentUser!.uid)
      .filter((p) => p.isMatchable !== false)
      .map((p) => {
        let score = 0;
        let distance = Infinity;

        const theirRating = (p.skillRating ?? p.utr) ?? null;
        const theirBand: SkillBand | "" =
          p.skillBand || skillFromUTR(theirRating) || legacyToBand(p.skillLevel) || "";

        const bDist = bandDistance(myBand, theirBand);
        const uGap = utrDelta(meRating, theirRating);

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
        const shared = A(p.availability).filter((a) => A(myData.availability).includes(a)).length;
        score += Math.min(shared, 4);

        // Distance bonus + HARD FILTER
        const theirLat = typeof p.lat === "number" ? p.lat : null;
        const theirLng = typeof p.lng === "number" ? p.lng : null;

        if (myLat != null && myLng != null && theirLat != null && theirLng != null) {
          distance = getDistanceFromLatLonInKm(myLat, myLng, theirLat, theirLng);

          if (distance > MAX_DISTANCE_KM) return null;

          if (distance < 5) score += 3;
          else if (distance < 10) score += 2;
          else if (distance < 20) score += 1;
        } else {
          return null;
        }

        return { ...p, score, distance, skillBand: theirBand };
      })
      .filter((p): p is ScoredPlayer => p !== null)
      .filter((p) => (p.score ?? 0) > 0);

    setRawMatches(scoredPlayers);
    setLastUpdated(Date.now());
  } finally {
    refreshingRef.current = false;
    setRefreshing(false);
  }
}, [matchMode, lastUpdated, loadNearbyPlayers]);


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

    // ✅ GA4: track match request sent
void track("match_request_sent", {
  match_id: matchRef.id,
  from_user_id: user.uid,
  to_user_id: match.id,
  distance_km: typeof match.distance === "number" ? match.distance : null,
  from_postcode: myProfile.postcode ?? null,
  to_postcode: match.postcode ?? null,
  match_mode: matchMode, // "auto" | "skill" | "utr"
  skill_band_me: myProfile.skillBand || null,
  skill_band_them: match.skillBand || null,
  tmr_me: typeof (myProfile.skillRating ?? myProfile.utr) === "number" ? (myProfile.skillRating ?? myProfile.utr) : null,
  tmr_them: typeof (match.skillRating ?? match.utr) === "number" ? (match.skillRating ?? match.utr) : null,
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

   setSentRequests((prev) => {
  const next = new Set(prev);
  next.add(match.id);
  writeSentCache(user.uid, next);
  return next;
});


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

    // ✅ Gender filter:
    // - If "Any" (""), include everyone (including unknown gender)
    // - If specific gender chosen, only include exact matches (unknown excluded)
    if (genderFilter !== "") {
      if (!m.gender) return false;
      if (m.gender !== genderFilter) return false;
    }

    // ✅ Age filter:
    // - If "Any" (""), include everyone (including unknown age)
    // - If specific band chosen, only include ages within band (unknown excluded)
    if (ageBand !== "") {
      if (typeof m.age !== "number") return false;
      if (!inAgeBand(m.age, ageBand)) return false;
    }

    return true;
  });
}, [rawMatches, hideContacted, myProfile, sentRequests, ageBand, genderFilter]);




const sortedMatches = useMemo(() => {
  if (!myProfile) return filteredMatches;

  return [...filteredMatches].sort((a, b) => {
   if (sortBy === "distance_desc") {
  const da = typeof a.distance === "number" ? a.distance! : -Infinity;
  const db = typeof b.distance === "number" ? b.distance! : -Infinity;
  return db - da; // farthest first
}
  if (sortBy === "distance") {
    const da = typeof a.distance === "number" ? a.distance! : Infinity;
    const db = typeof b.distance === "number" ? b.distance! : Infinity;
    return da - db; // closest first
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
const visibleMatches = useMemo(
  () => sortedMatches.slice(0, visibleCount),
  [sortedMatches, visibleCount]
);
useEffect(() => {
  setVisibleCount(PAGE_SIZE);
}, [sortBy, hideContacted, sortedMatches.length]);

useEffect(() => {
  const qSort   = params.get("sort");
  const qHide   = params.get("hide");     // "1" | "0"
  const qMode   = params.get("mode");     // "auto" | "skill" | "utr"

  if (qSort) setSortBy(qSort);
  if (qHide === "0" || qHide === "1") setHideContacted(qHide === "1");
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

if (myProfileHidden) {
  return (
    <div className="max-w-2xl mx-auto p-4 pb-28 sm:p-6">
      <div className="rounded-2xl border bg-white p-5 shadow-sm">
        <h1 className="text-xl font-semibold">Match Me is turned off</h1>
        <p className="mt-2 text-sm text-gray-700">
          Your profile is hidden — turn it back on to use Match Me.
        </p>

        <div className="mt-4 flex flex-wrap gap-2">
          <button
            onClick={() => router.push("/profile?edit=true")}
            className="px-4 py-2 rounded-lg bg-green-600 text-white hover:bg-green-700"
          >
            Turn it on in Profile
          </button>

          <button
            onClick={() => router.push("/profile")}
            className="px-4 py-2 rounded-lg border hover:bg-gray-50"
          >
            Back to Profile
          </button>
        </div>
      </div>
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
  <div className="space-y-3">
    {/* Row 1: Count */}
    <div className="text-sm text-gray-600">
      Showing {Math.min(visibleCount, sortedMatches.length)} of {sortedMatches.length} match
      {sortedMatches.length === 1 ? "" : "es"}
    </div>

    {/* Row 2: Dropdowns */}
    <div className="grid grid-cols-2 gap-3 sm:flex sm:items-end sm:gap-4">
      <div className="min-w-0">
        <label className="block text-xs font-medium text-gray-600 mb-1">
          Filter
        </label>
        <select
          value={sortBy}
          onChange={(e) => {
            setSortBy(e.target.value);
            setQuery("sort", e.target.value);
          }}
          className="w-full text-sm border rounded-lg px-2 py-2"
        >
          <option value="score">Best match</option>
          <option value="availability">Availability</option>
          <option value="skill">Skill level</option>
          <option value="distance">Distance</option>
        </select>
      </div>

      <div className="min-w-0">
        <label className="block text-xs font-medium text-gray-600 mb-1">
          Match by
        </label>
        <select
          value={matchMode}
          onChange={(e) => {
            const val = e.target.value as "auto" | "skill" | "utr";
            setMatchMode(val);
            setQuery("mode", val);
            refreshMatches();
          }}
          className="w-full text-sm border rounded-lg px-2 py-2"
          title="Primary matching method"
        >
          <option value="auto">Auto</option>
          <option value="skill">Skill level</option>
          <option value="utr">TMR</option>
        </select>
      </div>
    </div>

        {/* Row 2.5: Age/Gender filters */}
<div className="grid grid-cols-2 gap-3 sm:flex sm:items-end sm:gap-4">
  <div className="min-w-0">
    <label className="block text-xs font-medium text-gray-600 mb-1">
      Age
    </label>
    <select
      value={ageBand}
      onChange={(e) => setAgeBand(e.target.value as any)}
      className="w-full text-sm border rounded-lg px-2 py-2"
    >
      <option value="">Any</option>
      <option value="18-24">18–24</option>
      <option value="25-34">25–34</option>
      <option value="35-44">35–44</option>
      <option value="45-54">45–54</option>
      <option value="55+">55+</option>
    </select>
  </div>

  <div className="min-w-0">
    <label className="block text-xs font-medium text-gray-600 mb-1">
      Gender
    </label>
    <select
      value={genderFilter}
      onChange={(e) => setGenderFilter(e.target.value as any)}
      className="w-full text-sm border rounded-lg px-2 py-2"
    >
      <option value="">Any</option>
      <option value="Male">Male</option>
      <option value="Female">Female</option>
      <option value="Non-binary">Non-binary</option>
      <option value="Other">Other</option>
    </select>
  </div>
</div>

    {/* Row 3: Toggle */}
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

  </div>
</div>


 {sortedMatches.length === 0 ? (
<p>No matches found yet. Try adjusting your availability or skill level.</p>
) : (
  <>
    <ul className="space-y-4">
          {visibleMatches.map((match, index) => {
             const avatarSrc = match.photoThumbURL || match.photoURL || null;
  const initials = (match.name || "?").trim().charAt(0).toUpperCase();
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
      <div className="relative w-12 h-12 sm:w-14 sm:h-14 rounded-full overflow-hidden bg-gray-100 ring-1 ring-black/5 shrink-0">
        {avatarSrc ? (
          <Image
            src={avatarSrc}
            alt={match.name ? `${match.name} profile photo` : "Profile photo"}
            fill
            sizes="56px"
            className="object-cover"
          />
        ) : (
          <div className="h-full w-full grid place-items-center text-[11px] text-gray-600">
            {initials}
          </div>
        )}
      </div>

      <div className="min-w-0 flex-1">
        {/* Name + chips */}
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="font-semibold text-gray-900 text-base sm:text-lg truncate max-w-[70%]">
            {match.name}
          </h2>

          {typeof match.distance === "number" && (
            <span className="text-[10px] sm:text-[11px] ml-auto px-2 py-[2px] rounded-full bg-gray-100 text-gray-700">
              {match.postcode} · ~{match.distance} km
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
                  Skill:{" "}
                  {labelForBand(
                    match.skillBand ||
                      skillFromUTR((match.skillRating ?? match.utr) ?? null) ||
                      legacyToBand(match.skillLevel),
                    match.skillBandLabel
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
                  Skill:{" "}
                  {labelForBand(
                    match.skillBand ||
                      skillFromUTR((match.skillRating ?? match.utr) ?? null) ||
                      legacyToBand(match.skillLevel),
                    match.skillBandLabel
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

        {/* Actions */}
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
              onClick={() => {
                void track("match_request_click", {
                  to_user_id: match.id,
                  distance_km:
                    typeof match.distance === "number" ? match.distance : null,
                  match_mode: matchMode,
                });

                handleMatchRequest(match);
              }}
              disabled={sendingIds.has(match.id)}
              data-tour={index === 0 ? "send-request" : undefined}
              className="text-sm w-full sm:w-auto px-3 py-2 rounded-lg bg-green-600 text-white hover:bg-green-700 disabled:bg-gray-300 disabled:cursor-not-allowed"
              aria-label={`Request to play with ${match.name}`}
            >
              {sendingIds.has(match.id) ? "Sending…" : "Invite to Play"}
            </button>
          )}
        </div>
      </div>
    </div>
  </li>
);

          })}
    </ul>

{sortedMatches.length > visibleCount && (
  <div className="flex justify-center">
    <button
      onClick={() => setVisibleCount((c) => c + PAGE_SIZE)}
      disabled={refreshing}
      className="mt-6 px-4 py-2.5 rounded-lg bg-green-600 text-white hover:bg-green-700 disabled:opacity-60"
    >
      {refreshing ? "Loading…" : "Load more"}
    </button>
  </div>
)}

  </>
)}

  </div>
);
}
