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
import { CheckCircle2, SlidersHorizontal, CalendarDays, MapPin, ArrowLeft } from "lucide-react";
import Image from "next/image";
import { track } from "@/lib/track";
import { geohashQueryBounds } from "geofire-common";
import PlayerProfileView from "@/components/players/PlayerProfileView";
import { useIsDesktop } from "@/lib/useIsDesktop";
import DesktopMatchPage from "@/components/match/DesktopMatchPage";
import TMDesktopSidebar from "@/components/desktop_layout/TMDesktopSidebar";



// import { getContinueUrl } from "@/lib/auth/getContinueUrl";


interface Player {
  // ✅ "id" SHOULD be the UID / players docId
  id: string;
  userId?: string;

  // ✅ debug-only fields (safe to leave in; won’t break anything)
  docId?: string | null;
  dataId?: string | null;
  

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
  age?: number | null;
  gender?: string | null;
  isMatchable?: boolean | null;
  timestamp?: any;
  lastActiveAt?: any;
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


type LastActiveMeta =
  | { label: string; level: "hot" | "warm" | "cool" }
  | null;

const getLastActiveMeta = (ts: any): LastActiveMeta => {
  if (!ts) return null;

  const d: Date =
    typeof ts?.toDate === "function" ? ts.toDate() :
    ts instanceof Date ? ts :
    new Date(ts);

  const diffMs = Date.now() - d.getTime();
  if (!Number.isFinite(diffMs) || diffMs < 0) return null;

  const mins = Math.floor(diffMs / 60000);
  const hrs = Math.floor(mins / 60);
  const days = Math.floor(hrs / 24);

  // ✅ Hide if older than 3 days
  if (days > 3) return null;

  // ✅ CTA tiers
if (mins <= 5) return { label: "ONLINE NOW", level: "hot" };
if (mins < 30) return { label: `ACTIVE ${mins}M AGO`, level: "hot" };
  if (mins < 120) return { label: `Active ${mins}m ago`, level: "warm" };
  if (hrs < 24) return { label: `Active ${hrs}h ago`, level: "cool" };
  if (days === 1) return { label: "Active yesterday", level: "cool" };
  return { label: `Active ${days}d ago`, level: "cool" };
};

const formatAvailability = (slots: string[] | undefined | null) => {
  const a = Array.isArray(slots) ? slots : [];
  if (a.length === 0) return "Availability unknown";

  // show up to 2 slots like the screenshot
  const shown = a.slice(0, 2).join(" & ");
  const more = a.length > 2 ? ` +${a.length - 2}` : "";
  return `${shown}${more}`;
};


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
  const [profileOpenId, setProfileOpenId] = useState<string | null>(null);
  const isDesktop = useIsDesktop();


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

const [filtersOpen, setFiltersOpen] = useState(false);

const filtersActive =
  sortBy !== "score" ||
  matchMode !== "auto" ||
  ageBand !== "" ||
  genderFilter !== "" ||
  hideContacted !== true;

  useEffect(() => {
  if (typeof window === "undefined") return;

  // expose for DevTools
  (window as any).__TM_DB__ = db;
  (window as any).__TM_AUTH__ = auth;

  console.log("[TM DEBUG] projectId:", (db as any)?.app?.options?.projectId);
  console.log("[TM DEBUG] authDomain:", (auth as any)?.app?.options?.authDomain);
  console.log("[TM DEBUG] firestoreHost:", (db as any)?._settings?.host);
  console.log("[TM DEBUG] currentUser:", auth.currentUser?.uid);
}, []);

// Close filters OR profile modal on Escape
useEffect(() => {
  const onKey = (e: KeyboardEvent) => {
    if (e.key !== "Escape") return;

    // close profile first (higher priority)
    if (profileOpenId) {
      setProfileOpenId(null);
      return;
    }

    // otherwise close filters
    if (filtersOpen) {
      setFiltersOpen(false);
    }
  };

  document.addEventListener("keydown", onKey);
  return () => document.removeEventListener("keydown", onKey);
}, [filtersOpen, profileOpenId]);


// lock page scroll while profile modal is open
useEffect(() => {
  if (!profileOpenId) return;

  const prevOverflow = document.body.style.overflow;
  const prevTouch = document.body.style.touchAction;

  document.body.style.overflow = "hidden";
  document.body.style.touchAction = "none";

  return () => {
    document.body.style.overflow = prevOverflow;
    document.body.style.touchAction = prevTouch;
  };
}, [profileOpenId]);




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

  const docId = d.id;

// if the firestore data itself contains an "id" field, keep it but DO NOT let it override docId
const dataId =
  typeof (data as any)?.id === "string" ? (data as any).id : null;

  // ✅ IMPORTANT: auth uid used by match_requests (prod expects this)
const userId =
  typeof (data as any)?.userId === "string" ? (data as any).userId :
  typeof (data as any)?.uid === "string" ? (data as any).uid :
  docId; // fallback if your players doc id == auth uid

out.push({
  ...(data as Player),

  // keep a copy for debugging only (optional)
  docId,
  dataId,
    userId,

  birthYear,
  age: derivedAge ?? legacyAge ?? null,
  gender: typeof data.gender === "string" ? data.gender : null,
  lastActiveAt: data.lastActiveAt ?? null,
  isMatchable: typeof data.isMatchable === "boolean" ? data.isMatchable : true,
  lat: typeof data.lat === "number" ? data.lat : null,
  lng: typeof data.lng === "number" ? data.lng : null,
  geohash: typeof data.geohash === "string" ? data.geohash : null,
  photoURL: photoURL ?? undefined,
  photoThumbURL: typeof data.photoThumbURL === "string" ? data.photoThumbURL : null,
  avatar: typeof data.avatar === "string" ? data.avatar : null,

  // ✅ CRITICAL: force the true uid/doc id LAST so nothing can overwrite it
  id: docId,
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

    // Check for bad ID mismatch now, after scoredPlayers is created
    const bad = scoredPlayers.find((p: any) => p?.docId && p?.id !== p?.docId);
    if (bad) {
      console.warn("[MATCH] BAD ID MISMATCH (id !== docId)", {
        name: bad?.name,
        id: bad?.id,
        docId: bad?.docId,
        dataId: bad?.dataId,
      });
    }

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

// ✅ Always use AUTH UID for match_requests (matches production)
const uidOf = (p: any): string | null => {
  if (!p) return null;

  // if already a uid string
  if (typeof p === "string") return p.trim() || null;

  // ✅ prefer explicit auth uid fields
  const uid = p?.userId || p?.uid;

  // fallback only if your players doc id == auth uid
  const fallback = p?.id;

  const finalUid = (typeof uid === "string" && uid.trim())
    ? uid.trim()
    : (typeof fallback === "string" && fallback.trim())
    ? fallback.trim()
    : null;

  console.log("[TM] Derived AUTH UID from player:", {
    name: p?.name,
    userId: p?.userId,
    uid: p?.uid,
    id: p?.id,
    final: finalUid,
  });

  return finalUid;
};

const resolveRecipientUid = (target: Player | string): string | null => {
  return uidOf(target);
};
  // don't double-submit the same card
const handleMatchRequest = async (target: Player | string) => {
  if (!myProfile || !user) return;

  const toUid = resolveRecipientUid(target);
  if (!toUid) {
    console.error("[TM] Missing recipient UID", { target });
    alert("Could not send request (missing recipient id). Please refresh.");
    return;
  }

  // Prevent self-send
  if (toUid === user.uid) return;

  // Don't double-submit
  if (sendingIds.has(toUid)) return;

  setSendingIds((s) => new Set(s).add(toUid));

  try {
    // Optional: if Player object provided, use for display fields
    const matchPlayer = typeof target === "string" ? null : target;

    console.log("[TM] Creating match request", {
      from: user.uid,
      to: toUid,
      emailVerified: auth.currentUser?.emailVerified,
      match_name: matchPlayer?.name,
      match_id: matchPlayer?.id,
      match_docId: matchPlayer?.docId,
      match_dataId: matchPlayer?.dataId,
    });

    // ✅ Create match request doc
const ref = await addDoc(collection(db, "match_requests"), {
  fromUserId: user.uid,
  toUserId: toUid,
  status: "pending",
  timestamp: serverTimestamp(),

  // nice-to-have fields (safe if your rules allow)
  fromName: myProfile?.name ?? null,
  fromPostcode: myProfile?.postcode ?? null,
  fromPhotoURL:
    myProfile?.photoThumbURL || myProfile?.photoURL || myProfile?.avatar || null,

  toName: matchPlayer?.name ?? null,
  toPostcode: matchPlayer?.postcode ?? null,
  toPhotoURL:
    matchPlayer?.photoThumbURL || matchPlayer?.photoURL || matchPlayer?.avatar || null,
});

console.log("[TM] ✅ match_requests created:", ref.id, { toUid });

    // ✅ Update local state so UI immediately shows "sent"
setSentRequests((prev) => {
  const next = new Set(prev);
  next.add(toUid);

  if (auth.currentUser?.uid) {
    writeSentCache(auth.currentUser.uid, next);
  }

  return next;
});

    // ✅ Update localStorage cache so hideContacted works instantly
    if (auth.currentUser?.uid) {
      const merged = new Set(sentRequests);
      merged.add(toUid);
      writeSentCache(auth.currentUser.uid, merged);
    }

  } catch (err: any) {
    console.error("Failed to send match request:", err);
    alert(`❌ Could not send request: ${err?.message ?? String(err)}`);
  } finally {
    setSendingIds((s) => {
      const n = new Set(s);
      n.delete(toUid);
      return n;
    });
  }
};

  // Sort matches based on user choice
const filteredMatches = useMemo(() => {
  if (!myProfile) return rawMatches;

  return rawMatches.filter((m) => {
  const toUid = uidOf(m);
  if (!toUid) return false;

    // Hide already contacted?
    if (hideContacted && sentRequests.has(toUid)) return false;

    // Gender filter
    if (genderFilter !== "" && m.gender !== genderFilter) return false;

    // Age filter
    if (ageBand !== "" && (m.age == null || !inAgeBand(m.age, ageBand))) return false;

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

const TM = {
  forest: "#0B3D2E",
  neon: "#39FF14",
  ink: "#EAF7F0",
  sub: "rgba(234,247,240,0.75)",
};

const TILE_STYLE = {
  background: "#F1F3F5",                  // ✅ light grey card
  border: "1px solid rgba(15,23,42,0.10)", // subtle border
  boxShadow: "0 6px 18px rgba(15,23,42,0.08)",
};

const selectStyle: React.CSSProperties = {
  backgroundColor: "rgba(0,0,0,0.62)", // ✅ darker = clearer
  border: "1px solid rgba(255,255,255,0.18)",
  color: "rgba(234,247,240,0.95)",
  outline: "none",
};


const optionStyle: React.CSSProperties = {
  backgroundColor: "#071B15",   // deep green-black
  color: "#EAF7F0",            // TM.ink
};


if (loading) {
  return (
    <div className="w-full min-h-screen px-4 pb-28 pt-6 space-y-3 bg-white">
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
    <div className="w-full min-h-screen px-4 pb-28 pt-4 bg-white">
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

if (isDesktop) {
  return (
    <div className="min-h-screen bg-[#f6f7f8]">
      <div className="w-full px-4 lg:px-8 2xl:px-12 py-6">
        <div className="flex items-start gap-6">
          <TMDesktopSidebar player={myProfile} />
          <div className="flex-1 min-w-0">
            <DesktopMatchPage
              loading={loading}
              myProfileHidden={myProfileHidden}
              sortedMatches={sortedMatches}
              visibleMatches={visibleMatches}
              visibleCount={visibleCount}
              pageSize={PAGE_SIZE}
              refreshing={refreshing}
              filtersActive={filtersActive}
              filtersOpen={filtersOpen}
              setFiltersOpen={setFiltersOpen}
              // filters
              sortBy={sortBy}
              setSortBy={setSortBy}
              matchMode={matchMode}
              setMatchMode={setMatchMode}
              ageBand={ageBand}
              setAgeBand={setAgeBand}
              genderFilter={genderFilter}
              setGenderFilter={setGenderFilter}
              hideContacted={hideContacted}
              setHideContacted={setHideContacted}
              // actions
              onLoadMore={() => setVisibleCount((c) => c + PAGE_SIZE)}
              onInvite={(match) => handleMatchRequest(match)}
              onViewProfile={(id) => setProfileOpenId(id)}

              profileOpenId={profileOpenId}
  setProfileOpenId={setProfileOpenId}
            />
          </div>
        </div>
      </div>
    </div>
  );
}



return (
  <div className="w-full min-h-screen bg-white">
    <div
      className="w-full min-h-screen px-4 pb-28 pt-4 sm:px-6 bg-white"
      data-tour="match-page"
    >





{/* Mobile header (matches screenshot vibe) */}
<div
  className="-mx-4 sm:-mx-6 px-4 sm:px-6 pt-3 pb-4 sticky top-0 z-20"
  style={{
    background:
      "linear-gradient(180deg, rgba(255,255,255,0.96) 0%, rgba(255,255,255,0.78) 55%, #ffffff 100%)",
    backdropFilter: "blur(10px)",
  }}
>
  <div className="flex items-center justify-between">
    {/* Back */}
    <button
      onClick={() => router.push("/home")}
      className="h-10 w-10 rounded-full grid place-items-center"
      style={{
        background: "rgba(255,255,255,0.06)",
        border: "1px solid rgba(255,255,255,0.10)",
      }}
      aria-label="Back"
    >
      <ArrowLeft size={22} strokeWidth={3} style={{ color: TM.forest }} />
    </button>

    {/* Center title + subtitle */}
    <div className="text-center">
      <div
        className="font-black tracking-tight text-[20px] leading-none"
        style={{ color: TM.forest }}
      >
        Find a Match
      </div>
      <div
        className="text-[13px] font-semibold mt-1"
        style={{ color: "rgba(11,61,46,0.70)" }}
      >
        {sortedMatches.length} players nearby
      </div>
    </div>

    {/* Filters (circle) */}
    <button
      onClick={() => setFiltersOpen((v) => !v)}
      className="relative h-10 w-10 rounded-full grid place-items-center"
      style={{
        background: "rgba(11,61,46,0.08)",
        border: "1.5px solid rgba(11,61,46,0.22)",
        boxShadow: "0 6px 18px rgba(11,61,46,0.10)",
      }}
      aria-label="Filters"
      title="Filters"
    >
      <SlidersHorizontal size={18} strokeWidth={2.6} style={{ color: TM.forest }} />

      {filtersActive && (
        <span
          className="absolute -top-0.5 -right-0.5 h-2.5 w-2.5 rounded-full"
          style={{ background: TM.neon, boxShadow: `0 0 10px ${TM.neon}` }}
        />
      )}
    </button>
  </div>
</div>


{/* Filters overlay (floats, blurs background, doesn't push content) */}
{filtersOpen && (
  <div className="fixed inset-0 z-[60]">
{/* Backdrop: tint + blur. Clicking it closes */}
<div
  className="absolute inset-0"
  onMouseDown={() => setFiltersOpen(false)}
  style={{
    background: "rgba(0,0,0,0.35)",
    backdropFilter: "blur(8px)",
    WebkitBackdropFilter: "blur(8px)",
  }}
/>


    {/* Panel: anchored near top-right (below header) */}
    <div className="absolute right-4 sm:right-6 top-[76px] w-[calc(100%-2rem)] sm:w-[420px] max-w-[420px]">
      <div
        className="rounded-2xl p-3 shadow-2xl"
        style={{
          // ✅ darker “card” so controls pop (fixes washed-out white)
          background: "rgba(11,61,46,0.94)", // TM.forest with opacity
          border: "1px solid rgba(255,255,255,0.12)",
          backdropFilter: "blur(14px)",
          WebkitBackdropFilter: "blur(14px)",
        }}
        onMouseDown={(e) => e.stopPropagation()} // keep clicks inside panel from closing
      >
        <div className="space-y-3">
          {/* Row 1: Count */}
          <div className="text-sm text-white/80">
            Showing {Math.min(visibleCount, sortedMatches.length)} of {sortedMatches.length} match
            {sortedMatches.length === 1 ? "" : "es"}
          </div>

          {/* Row 2: Dropdowns */}
          <div className="grid grid-cols-2 gap-3 sm:flex sm:items-end sm:gap-4">
            <div className="min-w-0">
              <label className="block text-xs font-medium text-white/80 mb-1">Filter</label>
              <select
                value={sortBy}
                onChange={(e) => {
                  setSortBy(e.target.value);
                  setQuery("sort", e.target.value);
                }}
                className="w-full text-sm rounded-lg px-2 py-2 text-white appearance-none"
                style={selectStyle}
              >
                <option value="score" style={optionStyle}>Best match</option>
                <option value="availability" style={optionStyle}>Availability</option>
                <option value="skill" style={optionStyle}>Skill level</option>
                <option value="distance" style={optionStyle}>Distance</option>
              </select>
            </div>

            <div className="min-w-0">
              <label className="block text-xs font-medium text-white/80 mb-1">Match by</label>
              <select
                value={matchMode}
                onChange={(e) => {
                  const val = e.target.value as "auto" | "skill" | "utr";
                  setMatchMode(val);
                  setQuery("mode", val);
                  refreshMatches();
                }}
                className="w-full text-sm rounded-lg px-2 py-2 text-white appearance-none"
                style={selectStyle}
              >
                <option value="auto" style={optionStyle}>Auto</option>
                <option value="skill" style={optionStyle}>Skill level</option>
                <option value="utr" style={optionStyle}>TMR</option>
              </select>
            </div>
          </div>

          {/* Row 3: Age/Gender */}
          <div className="grid grid-cols-2 gap-3 sm:flex sm:items-end sm:gap-4">
            <div className="min-w-0">
              <label className="block text-xs font-medium text-white/80 mb-1">Age</label>
              <select
                value={ageBand}
                onChange={(e) => setAgeBand(e.target.value as any)}
                className="w-full text-sm rounded-lg px-2 py-2 text-white appearance-none"
                style={selectStyle}
              >
                <option value="" style={optionStyle}>Any</option>
                <option value="18-24" style={optionStyle}>18–24</option>
                <option value="25-34" style={optionStyle}>25–34</option>
                <option value="35-44" style={optionStyle}>35–44</option>
                <option value="45-54" style={optionStyle}>45–54</option>
                <option value="55+" style={optionStyle}>55+</option>
              </select>
            </div>

            <div className="min-w-0">
              <label className="block text-xs font-medium text-white/80 mb-1">Gender</label>
              <select
                value={genderFilter}
                onChange={(e) => setGenderFilter(e.target.value as any)}
                className="w-full text-sm rounded-lg px-2 py-2 text-white appearance-none"
                style={selectStyle}
              >
                <option value="" style={optionStyle}>Any</option>
                <option value="Male" style={optionStyle}>Male</option>
                <option value="Female" style={optionStyle}>Female</option>
                <option value="Non-binary" style={optionStyle}>Non-binary</option>
                <option value="Other" style={optionStyle}>Other</option>
              </select>
            </div>
          </div>

          {/* Row 4: Toggle + Done */}
          <div className="flex items-center justify-between gap-3">
            <label className="flex items-center gap-2 text-sm text-white/90">
              <input
                type="checkbox"
                className="accent-[#39FF14]"
                checked={hideContacted}
                onChange={(e) => {
                  setHideContacted(e.target.checked);
                  setQuery("hide", e.target.checked ? "1" : "0");
                }}
              />
              Hide contacted
            </label>

            <button
              onClick={() => setFiltersOpen(false)}
              className="rounded-lg px-3 py-2 text-xs font-extrabold"
              style={{ background: TM.neon, color: TM.forest }}
            >
              Done
            </button>
          </div>
        </div>
      </div>
    </div>
  </div>
)}




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

{/* Profile overlay modal */}
{profileOpenId && (
  <div className="fixed inset-0 z-[9999]">
    {/* Backdrop */}
    <div
      className="absolute inset-0 bg-black/60"
      onMouseDown={() => setProfileOpenId(null)}
    />

    {/* Panel (tall modal, NOT full screen) */}
    <div className="absolute inset-0 flex items-start justify-center px-3 pt-3 pb-4 sm:items-center sm:p-6">
      <div
        className="w-full max-w-[560px] rounded-2xl shadow-2xl overflow-hidden"
        style={{ background: "#071B15" }} // TM.forestDark
        onMouseDown={(e) => e.stopPropagation()}
      >
        {/* ✅ Taller than before, but capped so it doesn't feel full screen */}
        <div
          style={{
            height: "min(88dvh, 820px)",   // tweak: 84dvh/780px if you want smaller
            maxHeight: "min(88dvh, 820px)",
          }}
        >
          {/* IMPORTANT: PlayerProfileView manages its own scroll */}
          <PlayerProfileView
            playerId={profileOpenId}
            onClose={() => setProfileOpenId(null)}
          />
        </div>
      </div>
    </div>
  </div>
)}




 {sortedMatches.length === 0 ? (
<p>No matches found yet. Try adjusting your availability or skill level.</p>
) : (
  <>
    <ul className="space-y-3">
          {visibleMatches.map((match, index) => {
             const avatarSrc = match.photoThumbURL || match.photoURL || null;
  const initials = (match.name || "?").trim().charAt(0).toUpperCase();
            const toUid = uidOf(match); // ✅ auth uid (prod)
            if (!toUid) return null; // safety: skip broken entries
const alreadySent = sentRequests.has(toUid);
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
className="rounded-3xl p-5 shadow-sm relative"
style={{
  background: "#FFFFFF",
  border: "1px solid rgba(15,23,42,0.10)",
  boxShadow: "0 10px 30px rgba(15,23,42,0.08)",
}}
>
  {/* Avatar top-right */}
<div
  className="absolute top-5 left-5 w-16 h-16 rounded-full overflow-hidden"
  style={{
    background: "rgba(15,23,42,0.06)",
    border: "1px solid rgba(15,23,42,0.10)",
  }}
>
    {avatarSrc ? (
      <Image
        src={avatarSrc}
        alt={match.name ? `${match.name} profile photo` : "Profile photo"}
        fill
        sizes="64px"
        className="object-cover"
      />
    ) : (
      <div className="h-full w-full grid place-items-center text-[13px] font-bold text-white/80">
        {initials}
      </div>
    )}
  </div>

  {/* Content area (pad-right so text doesn't go under avatar) */}
  <div className="pl-24">
    {/* Name */}
    <div className="text-[16px] font-extrabold truncate" style={{ color: TM.forest }}>
      {match.name}
    </div>

{(() => {
  const numeric =
    typeof (match.skillRating ?? match.utr) === "number"
      ? (match.skillRating ?? match.utr)!
      : null;

  const bandLabel = labelForBand(
    match.skillBand ||
      skillFromUTR((match.skillRating ?? match.utr) ?? null) ||
      legacyToBand(match.skillLevel),
    match.skillBandLabel
  );

  const levelText = numeric != null ? numeric.toFixed(1) : bandLabel.toUpperCase();

  const distText =
    typeof match.distance === "number" ? `${match.distance} KM away` : null;

  const pcText = match.postcode ? String(match.postcode) : null;

  return (
    <div className="mt-2 flex items-center gap-2 flex-wrap">
      {/* Skill pill */}
      <span
        className="inline-flex items-center rounded-full px-2.5 py-1 text-[11px] font-extrabold"
        style={{
          background: "rgba(57,255,20,0.14)",
          border: "1px solid rgba(57,255,20,0.35)",
          color: TM.forest,
        }}
      >
        LEVEL {levelText}
      </span>

      {/* Distance + postcode */}
      <span
        className="text-[12px] font-semibold"
        style={{ color: "rgba(15,23,42,0.65)" }}
      >
        {distText ? distText : ""}
        {distText && pcText ? " • " : ""}
        {pcText ? pcText : ""}
      </span>
    </div>
  );
})()}


<div
  className="mt-1 text-[12px]"
  style={{ color: "rgba(15,23,42,0.65)" }}
>
  Availability: {formatAvailability(match.availability)}
</div>


    {/* CTA full width */}
    <div className="mt-3">
      {alreadySent ? (
  <div
    className="w-full rounded-xl py-2.5 text-center text-[13px] font-extrabold"
    style={{
      color: TM.neon,
      background: "rgba(57,255,20,0.10)",
      border: "1px solid rgba(57,255,20,0.20)",
    }}
  >
    ✅ Request Sent
  </div>
) : (
  <button
    onClick={() => {
      void track("match_request_click", {
        to_user_id: toUid,
        distance_km: typeof match.distance === "number" ? match.distance : null,
        match_mode: matchMode,
      });
      handleMatchRequest(match); // still fine
    }}
    disabled={sendingIds.has(toUid)}
    data-tour={index === 0 ? "send-request" : undefined}
    className="w-full rounded-full py-3.5 text-[14px] font-extrabold disabled:opacity-60"
    style={{
      background: TM.neon,
      color: TM.forest,
      boxShadow: "0 10px 30px rgba(57,255,20,0.18)",
    }}
  >
    {sendingIds.has(toUid) ? "Sending…" : "Invite to Play"}
  </button>
)}
    </div>

<div className="mt-3">
  <button
    type="button"
    onClick={() => setProfileOpenId(match.id)}
    className="w-full rounded-full py-3.5 text-[14px] font-extrabold"
    style={{
      background: "#EEF0F2",
      color: "#0F172A",
      border: "1px solid rgba(15,23,42,0.10)",
      boxShadow: "0 6px 18px rgba(15,23,42,0.06)",
    }}
  >
    View Profile
  </button>
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
  </div>
);
}
