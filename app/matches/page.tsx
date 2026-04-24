"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type PropsWithChildren } from "react";

import {
  onSnapshot,
  query,
  where,
  collection,
  doc,
  getDoc,
  getDocs, 
  updateDoc,
  deleteDoc,
  addDoc,
  serverTimestamp,
  DocumentData,
  QuerySnapshot,
  arrayUnion,
  setDoc,
  limit,  
  increment,            
} from "firebase/firestore";
import { auth, db } from "@/lib/firebaseConfig";
import { onAuthStateChanged } from "firebase/auth";
import { useRouter, useSearchParams } from "next/navigation";
import {
  Trash2,
  MessageCircle,
  Check,
  X,
  ArrowRight,
  Loader2,
  ExternalLink,
  ArrowLeft,
} from "lucide-react";

import Image from "next/image";
import Link from "next/link";
import { suggestCourt } from "@/lib/suggestCourt";
import { track } from "@/lib/track";
import PlayerProfileView from "@/components/players/PlayerProfileView";
import DesktopMatches from "@/components/matches/DesktopMatches";
import { trackEvent } from "@/lib/mixpanel";


// --- Helpers ---
const formatRelativeTime = (d?: Date | null) => {
  if (!d) return "—";
  const diff = d.getTime() - Date.now();
  const abs = Math.abs(diff);
  const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });

  const MIN = 60_000, HOUR = 3_600_000, DAY = 86_400_000;
  if (abs < HOUR) return rtf.format(Math.round(diff / MIN), "minute");
  if (abs < DAY)  return rtf.format(Math.round(diff / HOUR), "hour");
  return rtf.format(Math.round(diff / DAY), "day");
};

// --- UI helpers ---
type ChipTone = "neutral" | "success" | "brand" | "warning";
const Chip = ({
  tone = "neutral",
  className = "",
  children,
}: PropsWithChildren<{ tone?: ChipTone; className?: string }>) => {
  const toneCls =
    tone === "success"
      ? "bg-green-50 text-green-700 ring-green-200"
      : tone === "brand"
      ? "bg-blue-50 text-blue-700 ring-blue-200"
      : tone === "warning"
      ? "bg-yellow-50 text-yellow-700 ring-yellow-200"
      : "bg-gray-100 text-gray-700 ring-gray-200";
  return (
    <span className={`inline-flex items-center rounded-full text-[11px] leading-[1] px-2.5 py-[3px] ring-1 ${toneCls} ${className}`}>
      {children}
    </span>
  );
};


// --- Button helpers ---
const btnBase =
  "inline-flex items-center justify-center gap-2 rounded-lg px-3 py-2 text-sm font-medium transition focus:outline-none focus:ring-2 focus:ring-offset-1";

const BTN = {
  primary: `${btnBase} text-white bg-green-600 hover:bg-green-700 focus:ring-green-500`,
  brand:   `${btnBase} text-white bg-purple-600 hover:bg-purple-700 focus:ring-purple-500`,
  secondary: `${btnBase} bg-white ring-1 ring-gray-200 hover:bg-gray-50 focus:ring-gray-300`,
  tertiary:  `${btnBase} bg-gray-100 hover:bg-gray-200 focus:ring-gray-300`,
  danger:    `${btnBase} text-red-700 bg-red-50 hover:bg-red-100 focus:ring-red-300`,
};


type Match = {
  id: string;
  playerId: string;
  opponentId: string;
  court?: string;
  time?: string;
  status: string;
  message?: string;
  fromName?: string;
  toName?: string;
  suggestedCourtName?: string;
  suggestedCourtLat?: number;
  suggestedCourtLng?: number;
  suggestedCourtAddress?: string;
  suggestedCourtBookingUrl?: string;
  suggestedCourtId?: string;
  createdAt?: any;
  acceptedAt?: any;
  started?: boolean;
  startedAt?: any;
};

type HistoryMatch = {
  id: string;
  matchRequestId?: string | null;
  fromUserId?: string | null;
  toUserId?: string | null;
  fromName?: string | null;
  toName?: string | null;
  fromPhotoURL?: string | null;
  toPhotoURL?: string | null;
  winnerId?: string | null;
  score?: string | null;
  status?: string | null;
  completed?: boolean;
  completedAt?: any;
  updatedAt?: any;
  playedDate?: string | null;
  matchType?: string | null;
  location?: string | null;
};

type PCMap = Record<string, { lat: number; lng: number }>;

type LatLng = { lat: number; lng: number };

const getPostcodeLatLng = async (postcode?: string | null): Promise<LatLng | null> => {
  const pc = String(postcode || "").trim();
  if (!pc) return null;

  try {
    const snap = await getDoc(doc(db, "postcodes", pc));
    if (!snap.exists()) return null;

    const d = snap.data() as any;
    if (typeof d.lat !== "number" || typeof d.lng !== "number") return null;

    return { lat: d.lat, lng: d.lng };
  } catch (e) {
    console.error("Failed to load postcode lat/lng:", pc, e);
    return null;
  }
};

type PlayerLite = {
  postcode?: string;
  lat?: number;
  lng?: number;
  photoURL?: string;
  photoThumbURL?: string; 
  name?: string;

  // ✅ new
  skillBand?: string | null;
  skillBandLabel?: string | null;
  skillLevel?: string | null;          // legacy fallback
  availability?: string[] | null;
};

const isAcceptedStatus = (status?: string | null) =>
  status === "accepted" || status === "confirmed";

const isCompletedStatus = (status?: string | null) => status === "completed";

const isPendingStatus = (status?: string | null) =>
  !isAcceptedStatus(status) && !isCompletedStatus(status);

const toDateOrNull = (value: any): Date | null => {
  if (!value) return null;
  if (typeof value?.toDate === "function") return value.toDate();
  if (value instanceof Date) return value;
  if (typeof value === "string") {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }
  return null;
};

const formatHistoryDate = (completedAt?: any, playedDate?: string | null) => {
  const date = toDateOrNull(completedAt) ?? toDateOrNull(playedDate);
  if (!date) return "Date TBC";
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(date);
};

const formatMatchType = (value?: string | null) => {
  if (!value) return "Match";
  return value.charAt(0).toUpperCase() + value.slice(1);
};


function getDistanceFromLatLonInKm(
  lat1: number, lon1: number, lat2: number, lon2: number
): number {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a =
    Math.sin(dLat/2) ** 2 +
    Math.cos(lat1 * Math.PI/180) *
    Math.cos(lat2 * Math.PI/180) *
    Math.sin(dLon/2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
  return Math.round(R * c);
}

// --- URL & court fetch helpers ---
// --- URL & court fetch helpers ---
const normalizeUrl = (u?: string | null): string | undefined => {
  if (!u) return undefined;
  const s = String(u).trim();
  if (!s) return undefined;
  const href = /^https?:\/\//i.test(s) ? s : `https://${s}`;
  try {
    return new URL(href).toString();
  } catch {
    return undefined;
  }
};

// 🔢 Log court clicks (map / booking) per user + court
const logCourtClick = async (
  userId: string | null,
  courtId: string | null | undefined,
  type: "map" | "booking"
) => {
  if (!userId || !courtId) return; // nothing to log without both

  try {
    const ref = doc(db, "court_clicks", `${userId}_${courtId}`);
    await setDoc(
      ref,
      {
        userId,
        courtId,
        updatedAt: serverTimestamp(),
        totalClicks: increment(1),
        ...(type === "map"
          ? { mapClicks: increment(1) }
          : { bookingClicks: increment(1) }),
      },
      { merge: true }
    );
  } catch (e) {
    console.error("Failed to log court click", e);
  }
};

// Try multiple collections because some courts live in `booking` not `courts`
async function fetchCourtDocById(dbRef: typeof db, id: string) {

  const cols = ["courts", "booking"]; // add more if needed later
  for (const col of cols) {
    const snap = await getDoc(doc(dbRef, col, id));
    if (snap.exists()) return snap.data() as any;
  }
  return null;
}


const CourtBadge = ({
  name,
  lat,
  lng,
  bookingUrl,
  address,
  courtId,
}: {
  name: string;
  lat?: number | null;
  lng?: number | null;
  bookingUrl?: string | null;
  address?: string | null;
  courtId?: string | null;
}) => {
  const q = address?.trim() ? `${name}, ${address}` : name;
  const mapHref = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(
    q
  )}`;
  const safeBooking = normalizeUrl(bookingUrl || undefined);

  // 🔹 local click logger - reuse same collection
const handleClick = async (type: "map" | "booking") => {
  const user = auth.currentUser;
  if (!user || !courtId) return;

  // ✅ GA event (safe — won't crash if analytics isn't available)
  track(type === "map" ? "court_map_clicked" : "court_booking_clicked", {
    court_id: courtId,
    match_context: "match_requests", // optional: helps segment
    has_booking_url: type === "booking" ? true : undefined,
  });

  try {
    const ref = doc(db, "court_clicks", `${user.uid}_${courtId}`);
    await setDoc(
      ref,
      {
        userId: user.uid,
        courtId,
        updatedAt: serverTimestamp(),
        totalClicks: increment(1),
        ...(type === "map"
          ? { mapClicks: increment(1) }
          : { bookingClicks: increment(1) }),
      },
      { merge: true }
    );
  } catch (e) {
    console.error("Failed to log court click", e);
  }
};


  return (
    <div className="w-full max-w-[520px]">
      {/* label */}
      <div className="text-center text-[11px] font-semibold tracking-wide text-green-800/80 uppercase">
        Suggested court
      </div>

      <div className="mt-1 rounded-xl bg-green-50 ring-1 ring-green-200/80 shadow-sm px-3 py-2.5">
        <div className="flex items-center gap-3">
          <div className="min-w-0 flex-1">
            <div className="font-semibold text-green-900 truncate">{name}</div>
            {address && (
              <div className="text-xs text-green-900/80 truncate">{address}</div>
            )}
          </div>

          <div className="flex items-center gap-1.5">
            <a
              href={mapHref}
              target="_blank"
              rel="noopener noreferrer"
              onClick={() => handleClick("map")}
              className="inline-flex items-center gap-1 rounded-lg bg-white px-2.5 py-1.5 text-xs font-medium text-green-800 ring-1 ring-green-200 hover:bg-green-100"
              title="Open in Google Maps"
            >
              Map
            </a>

            {safeBooking && (
              <a
                href={safeBooking}
                target="_blank"
                rel="noopener noreferrer"
                onClick={() => handleClick("booking")}
                className="inline-flex items-center gap-1 rounded-lg bg-green-600 px-2.5 py-1.5 text-xs font-semibold text-white hover:bg-green-700"
                title="Open booking page"
              >
                Book <ExternalLink className="h-3.5 w-3.5" />
              </a>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};






function MatchesPage() {
  const router = useRouter();
  const [isDesktop, setIsDesktop] = useState(false);

useEffect(() => {
  const mq = window.matchMedia("(min-width: 1024px)");
  const apply = () => setIsDesktop(mq.matches);
  apply();
  mq.addEventListener("change", apply);
  return () => mq.removeEventListener("change", apply);
}, []);

const searchParams = useSearchParams();

const initialTab = ((): "pending" | "accepted" | "history" => {
  const value = searchParams.get("tab");
  if (value === "accepted" || value === "history") return value;
  return "pending";
})();
const initialDir = ((): "all" | "received" | "sent" => {
  const v = searchParams.get("dir");
  return v === "received" || v === "sent" || v === "all" ? v : "all";
})();

const [tab, setTab] = useState<"pending" | "accepted" | "history">(initialTab);
const [direction, setDirection] = useState<"all" | "received" | "sent">(initialDir);

const [matches, setMatches] = useState<Match[]>([]);
const [historyMatches, setHistoryMatches] = useState<HistoryMatch[]>([]);
const [currentUserId, setCurrentUserId] = useState<string | null>(null);

const [queryText, setQueryText] = useState(searchParams.get("q") || "");
const [myPlayer, setMyPlayer] = useState<PlayerLite | null>(null);
  const [postcodeCoords, setPostcodeCoords] = useState<PCMap>({});
  const [oppCache, setOppCache] = useState<Record<string, PlayerLite | null>>({});
  const [loading, setLoading] = useState(true);
const [historyLoading, setHistoryLoading] = useState(true);
const [acceptingId, setAcceptingId] = useState<string | null>(null);
const [decliningId, setDecliningId] = useState<string | null>(null);
const [startingId, setStartingId] = useState<string | null>(null);
const [rematchingId, setRematchingId] = useState<string | null>(null);
const [requestedRematches, setRequestedRematches] = useState<Record<string, boolean>>({});
const [chatPrompt, setChatPrompt] = useState<{
  matchId: string;
  otherUserId: string;
  otherName: string;
} | null>(null);

const [profileOverlayUserId, setProfileOverlayUserId] = useState<string | null>(null);

// ✅ Close profile modal on Escape (same as Directory)
useEffect(() => {
  const onKey = (e: KeyboardEvent) => {
    if (e.key === "Escape" && profileOverlayUserId) {
      setProfileOverlayUserId(null);
    }
  };
  document.addEventListener("keydown", onKey);
  return () => document.removeEventListener("keydown", onKey);
}, [profileOverlayUserId]);

// ✅ Lock page scroll while profile modal is open (same as Directory)
useEffect(() => {
  if (!profileOverlayUserId) return;

  const prevOverflow = document.body.style.overflow;
  const prevTouch = document.body.style.touchAction;

  document.body.style.overflow = "hidden";
  document.body.style.touchAction = "none";

  return () => {
    document.body.style.overflow = prevOverflow;
    document.body.style.touchAction = prevTouch;
  };
}, [profileOverlayUserId]);


const handleViewProfile = useCallback((id: string) => {
  setProfileOverlayUserId(id);
}, []);

  const [sortBy, setSortBy] = useState<"recent" | "oldest" | "distance">("recent");
const [unreadOnly, setUnreadOnly] = useState(false);

const suggestingRef = useRef<Set<string>>(new Set());

// 1) put this first
const oppCacheRef = useRef(oppCache);
useEffect(() => {
  oppCacheRef.current = oppCache;
}, [oppCache]);

const getOpponentPostcode = useCallback(async (opponentId: string): Promise<string | null> => {
  try {
    const cached = oppCacheRef.current[opponentId];
    if (cached?.postcode) return cached.postcode;

    const s = await getDoc(doc(db, "players", opponentId));
    const d = s.exists() ? (s.data() as any) : null;
    const pc = d?.postcode || null;

    setOppCache((prev) => ({
      ...prev,
      [opponentId]: d
        ? {
            postcode: d.postcode,
            lat: d.lat,
            lng: d.lng,
            photoURL: d.photoURL ?? d.photoUrl ?? d.avatarUrl ?? null,
            photoThumbURL: d.photoThumbURL ?? null,
            name: d.name,
            skillBand: d.skillBand ?? null,
            skillBandLabel: d.skillBandLabel ?? null,
            skillLevel: d.skillLevel ?? null,
            availability: Array.isArray(d.availability) ? d.availability : [],
          }
        : null,
    }));

    return pc;
  } catch (e) {
    console.error("Failed to load opponent postcode", e);
    setOppCache((prev) => ({ ...prev, [opponentId]: null }));
    return null;
  }
}, []);



// 2) then this
const computeSuggestionSilently = useCallback(
  async (match: Match) => {
    if (suggestingRef.current.has(match.id)) return;
    suggestingRef.current.add(match.id);
    try {
      if (!myPlayer?.postcode) return;
      const otherId = match.playerId === currentUserId ? match.opponentId : match.playerId;
      const oppPostcode = await getOpponentPostcode(otherId);
      if (!oppPostcode) return;
      const myLatLng = await getPostcodeLatLng(myPlayer.postcode);
const oppLatLng = await getPostcodeLatLng(oppPostcode);

if (!myLatLng || !oppLatLng) return;

const res = await suggestCourt(myLatLng, oppLatLng, { maxResults: 1, searchRadiusKm: 15 });

      const top = res.results?.[0];
      if (!top) return;

      const refMatch = doc(db, "match_requests", match.id);
      await updateDoc(refMatch, {
        suggestedCourtId: top.id,
        suggestedCourtName: top.name,
        suggestedCourtLat: top.lat,
        suggestedCourtLng: top.lng,
        suggestedCourtBookingUrl: normalizeUrl(top.bookingUrl) ?? null,
        suggestedCourtComputedAt: serverTimestamp(),
      });

      setMatches((prev) =>
        prev.map((m) =>
          m.id === match.id
            ? {
                ...m,
                suggestedCourtId: top.id,
                suggestedCourtName: top.name,
                suggestedCourtLat: top.lat,
                suggestedCourtLng: top.lng,
                suggestedCourtBookingUrl: normalizeUrl(top.bookingUrl) ?? undefined,
              }
            : m
        )
      );
    } catch (e) {
      console.debug("Auto suggest failed", e);
    } finally {
      suggestingRef.current.delete(match.id);
    }
  },
  [currentUserId, myPlayer, getOpponentPostcode, setMatches]
);

const postcodeCoordsRef = useRef(postcodeCoords);
useEffect(() => {
  postcodeCoordsRef.current = postcodeCoords;
}, [postcodeCoords]);

const ensurePostcodeCoords = useCallback(async (postcode: string) => {
  const pc = String(postcode || "").trim();
  if (!pc) return;

  if (postcodeCoordsRef.current[pc]) return;

  try {
    const snap = await getDoc(doc(db, "postcodes", pc));
    if (!snap.exists()) return;

    const d = snap.data() as any;
    if (typeof d.lat !== "number" || typeof d.lng !== "number") return;

    setPostcodeCoords((prev) => ({
      ...prev,
      [pc]: { lat: d.lat, lng: d.lng },
    }));
  } catch (e) {
    console.error("Failed to load postcode coords", pc, e);
  }
}, []);



// put this near the top with your other refs
const hydratingRef = useRef<Set<string>>(new Set());

// ⬇️ ADD THIS EFFECT right after the auto-suggest effect
useEffect(() => {
  // Find matches that have a court id but are missing exact lat/lng (or booking URL)
const targets = matches
  .filter((m) => {
    // ✅ Only hydrate for accepted matches
    if (!isAcceptedStatus(m.status)) return false;

    const missing =
      m.suggestedCourtLat == null ||
      m.suggestedCourtLng == null ||
      m.suggestedCourtBookingUrl == null ||
      m.suggestedCourtAddress == null;

    return missing && (m.suggestedCourtId || m.suggestedCourtName);
  })
  .slice(0, 5);



  targets.forEach(async (m) => {
    if (hydratingRef.current.has(m.id)) return;
    hydratingRef.current.add(m.id);
    try {

     // resolve by ID (courts/booking) or by name if no ID
async function resolveCourtData(id?: string | null, name?: string | null) {
  if (id) {
    const byId = await fetchCourtDocById(db, id);
    if (byId) return { data: byId, resolvedId: id };
  }
  if (name) {
    for (const col of ["courts", "booking"] as const) {
      const qy = query(collection(db, col), where("name", "==", name), limit(1));
      const snap = await getDocs(qy);
      if (!snap.empty) {
        const docSnap = snap.docs[0];
        return { data: docSnap.data() as any, resolvedId: docSnap.id };
      }
    }
  }
  return null;
}

const found = await resolveCourtData(m.suggestedCourtId, m.suggestedCourtName || null);
if (!found) return;
const c = found.data as any;
const resolvedId = found.resolvedId;


      const address =
        typeof c.address === "string" ? c.address
        : typeof c.location?.address === "string" ? c.location.address
        : typeof c.addressLine === "string" ? c.addressLine
        : null;

      const lat =
        typeof c.lat === "number" ? c.lat
        : typeof c.location?.lat === "number" ? c.location.lat
        : null;

      const lng =
        typeof c.lng === "number" ? c.lng
        : typeof c.location?.lng === "number" ? c.location.lng
        : null;

      const rawBooking =
        c.bookingUrl ?? c.bookingURL ?? c.booking_link ?? c.bookingLink ?? c.website ?? c.url ?? null;
      const bookingUrl = normalizeUrl(rawBooking) ?? null;

      const name = c.name ?? m.suggestedCourtName ?? null;

      await updateDoc(doc(db, "match_requests", m.id), {
  ...(resolvedId && !m.suggestedCourtId ? { suggestedCourtId: resolvedId } : {}),
  ...(name ? { suggestedCourtName: name } : {}),
  ...(lat != null ? { suggestedCourtLat: lat } : {}),
  ...(lng != null ? { suggestedCourtLng: lng } : {}),
  ...(address ? { suggestedCourtAddress: address } : {}),
  suggestedCourtBookingUrl: bookingUrl,
});

      setMatches((prev) =>
        prev.map((x) =>
          x.id === m.id
            ? {
                ...x,
                suggestedCourtName: name ?? x.suggestedCourtName,
                suggestedCourtLat: lat ?? x.suggestedCourtLat,
                suggestedCourtLng: lng ?? x.suggestedCourtLng,
                suggestedCourtAddress: address ?? x.suggestedCourtAddress,
                suggestedCourtBookingUrl: bookingUrl ?? x.suggestedCourtBookingUrl,
              }
            : x
        )
      );

    } finally {
      hydratingRef.current.delete(m.id);
    }
  });
}, [matches]);

// 3) then the effect that calls it
useEffect(() => {
  if (!currentUserId || !myPlayer?.postcode || matches.length === 0) return;

  // ✅ Only suggest courts for accepted matches (and only if missing)
  const candidates = matches
    .filter((m) => isAcceptedStatus(m.status) && !m.suggestedCourtName)
    .slice(0, 3);

  candidates.forEach((m) => computeSuggestionSilently(m));
}, [matches, currentUserId, myPlayer?.postcode, computeSuggestionSilently]);

useEffect(() => {
  if (!myPlayer?.postcode) return;

  // always ensure mine
  ensurePostcodeCoords(myPlayer.postcode);

  // ensure opponents (from cache) for visible matches
  const opponentPostcodes = new Set<string>();
  matches.forEach((m) => {
    const otherId = m.playerId === currentUserId ? m.opponentId : m.playerId;
    const pc = oppCache[otherId]?.postcode;
    if (pc) opponentPostcodes.add(pc);
  });

  opponentPostcodes.forEach((pc) => ensurePostcodeCoords(pc));
}, [matches, currentUserId, myPlayer?.postcode, oppCache, ensurePostcodeCoords]);



// Sync toolbar state to URL without adding history entries
useEffect(() => {
  const params = new URLSearchParams(window.location.search);

  // set if not default; otherwise remove for clean URLs
  if (tab === "accepted" || tab === "history") params.set("tab", tab);
  else params.delete("tab");

  if (direction !== "all") params.set("dir", direction);
  else params.delete("dir");

  const q = queryText.trim();
  if (q) params.set("q", q);
  else params.delete("q");

  const qs = params.toString();
  router.replace(qs ? `?${qs}` : "?", { scroll: false });
}, [tab, direction, queryText, router]);


  // Track auth state
  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (user) => {
      if (user) setCurrentUserId(user.uid);
    });
    return () => unsub();
  }, []);

  useEffect(() => {
  if (!currentUserId) return;

  (async () => {
    try {
      const snap = await getDoc(doc(db, "players", currentUserId));
      if (!snap.exists()) {
        setMyPlayer(null);
        return;
      }
      const d = snap.data() as any;

      setMyPlayer({
        postcode: d.postcode ?? undefined,
        lat: typeof d.lat === "number" ? d.lat : undefined,
        lng: typeof d.lng === "number" ? d.lng : undefined,
        name: d.name ?? undefined,
        photoURL: d.photoURL ?? d.photoUrl ?? d.avatarUrl ?? undefined,
        photoThumbURL: d.photoThumbURL ?? undefined,
      });
    } catch (e) {
      console.error("Failed to load my player", e);
      setMyPlayer(null);
    }
  })();
}, [currentUserId]);


useEffect(() => {
  if (!currentUserId) return;

  const fromQ = query(
    collection(db, "match_requests"),
    where("fromUserId", "==", currentUserId)
  );
  const toQ = query(
    collection(db, "match_requests"),
    where("toUserId", "==", currentUserId)
  );

  const state: Record<string, Match> = {};

const toMatch = (d: DocumentData, id: string): Match => ({
  id,
  playerId: d.fromUserId,
  opponentId: d.toUserId,
  court: d.court,
  time: d.time,
  status: d.status,
  message: d.message,
  fromName: d.fromName,
  toName: d.toName,
  suggestedCourtName: d.suggestedCourtName,
  suggestedCourtLat: d.suggestedCourtLat,
  suggestedCourtLng: d.suggestedCourtLng,
  suggestedCourtAddress: d.suggestedCourtAddress,
  suggestedCourtBookingUrl: d.suggestedCourtBookingUrl,
  suggestedCourtId: d.suggestedCourtId,
  createdAt: d.createdAt ?? d.timestamp,
  acceptedAt: d.acceptedAt ?? null,
  started: d.started,
  startedAt: d.startedAt,
});

  const proc = (snap: QuerySnapshot<DocumentData>) => {
    let changed = false;

    snap.docChanges().forEach((chg) => {
      const id = chg.doc.id;

      if (chg.type === "removed") {
        if (state[id]) {
          delete state[id];
          changed = true;
        }
        return;
      }

      // added or modified
      const m = toMatch(chg.doc.data(), id);
      const prev = state[id];
      if (!prev || JSON.stringify(prev) !== JSON.stringify(m)) {
        state[id] = m;
        changed = true;
      }
    });

    if (changed) setMatches(Object.values(state));
    setLoading(false);
  };

  const unsubFrom = onSnapshot(
    fromQ,
    proc,
    (err) => {
      console.error("[MatchesPage] onSnapshot(fromQ) failed", {
        code: (err as any)?.code,
        message: (err as any)?.message,
        uid: auth.currentUser?.uid,
        emailVerified: auth.currentUser?.emailVerified,
        projectId: (db as any)?.app?.options?.projectId,
      });
      setLoading(false);
    }
  );
  const unsubTo = onSnapshot(
    toQ,
    proc,
    (err) => {
      console.error("[MatchesPage] onSnapshot(toQ) failed", {
        code: (err as any)?.code,
        message: (err as any)?.message,
        uid: auth.currentUser?.uid,
        emailVerified: auth.currentUser?.emailVerified,
        projectId: (db as any)?.app?.options?.projectId,
      });
      setLoading(false);
    }
  );
  return () => {
    unsubFrom();
    unsubTo();
  };
}, [currentUserId]);

useEffect(() => {
  if (!currentUserId) return;

  setHistoryLoading(true);

  const historyQ = query(
    collection(db, "match_history"),
    where("players", "array-contains", currentUserId)
  );

  const unsubHistory = onSnapshot(
    historyQ,
    (snap) => {
      const next = snap.docs
        .map((docSnap) => {
          const d = docSnap.data() as DocumentData;
          return {
            id: docSnap.id,
            matchRequestId:
              typeof d.matchRequestId === "string" && d.matchRequestId.trim()
                ? d.matchRequestId
                : null,
            fromUserId: d.fromUserId ?? null,
            toUserId: d.toUserId ?? null,
            fromName: d.fromName ?? null,
            toName: d.toName ?? null,
            fromPhotoURL: d.fromPhotoURL ?? null,
            toPhotoURL: d.toPhotoURL ?? null,
            winnerId: d.winnerId ?? null,
            score: d.score ?? null,
            status: d.status ?? null,
            completed: d.completed === true || d.status === "completed",
            completedAt: d.completedAt ?? null,
            updatedAt: d.updatedAt ?? null,
            playedDate: d.playedDate ?? null,
            matchType: d.matchType ?? null,
            location: d.location ?? null,
          } as HistoryMatch;
        })
        .filter((m) => m.completed)
        .sort((a, b) => {
          const aTime =
            toDateOrNull(a.completedAt)?.getTime() ??
            toDateOrNull(a.playedDate)?.getTime() ??
            toDateOrNull(a.updatedAt)?.getTime() ??
            0;
          const bTime =
            toDateOrNull(b.completedAt)?.getTime() ??
            toDateOrNull(b.playedDate)?.getTime() ??
            toDateOrNull(b.updatedAt)?.getTime() ??
            0;
          return bTime - aTime;
        });

      setHistoryMatches(next);
      setHistoryLoading(false);
    },
    (error) => {
      console.error("Failed to load match history", error);
      setHistoryMatches([]);
      setHistoryLoading(false);
    }
  );

  return () => unsubHistory();
}, [currentUserId]);

// Warm opponent cache so avatars/names are available
useEffect(() => {
  if (!currentUserId) return;

  const opponentIds = Array.from(
    new Set([
      ...matches.map((m) => (m.playerId === currentUserId ? m.opponentId : m.playerId)),
      ...historyMatches
        .map((m) => (m.fromUserId === currentUserId ? m.toUserId : m.fromUserId))
        .filter((id): id is string => !!id),
    ])
  );

  if (opponentIds.length === 0) return;

  opponentIds.forEach(async (uid) => {
    // If we already looked this up (even if null), skip
    if (uid in oppCache) return;

    try {
      const snap = await getDoc(doc(db, "players", uid));
      const d = snap.exists() ? (snap.data() as any) : null;

      // Accept common field names for avatar
      const photo = d?.photoURL ?? d?.photoUrl ?? d?.avatarUrl ?? null;
      const thumb = d?.photoThumbURL ?? null;

setOppCache((prev) => ({
  ...prev,
  [uid]: d
    ? {
        postcode: d.postcode,
        lat: d.lat,
        lng: d.lng,
        photoURL: photo,
        photoThumbURL: thumb,
        name: d.name,

        // ✅ add these
        skillBand: d.skillBand ?? null,
        skillBandLabel: d.skillBandLabel ?? null,
        skillLevel: d.skillLevel ?? null,
        availability: Array.isArray(d.availability) ? d.availability : [],
      }
    : null,
}));

    } catch {
      setOppCache((prev) => ({ ...prev, [uid]: null }));
    }
  });
}, [matches, historyMatches, currentUserId]); // ← do NOT include oppCache here to avoid loops


// Accept a match and award badge + prompt to chat
const acceptMatch = async (matchId: string, currentUserId: string) => {
  const prevStatus = matches.find((m) => m.id === matchId)?.status;
  let acceptedPersisted = false;

  try {
    setAcceptingId(matchId);

    // Optimistic UI
    setMatches((prev) =>
      prev.map((m) => (m.id === matchId ? { ...m, status: "accepted" } : m))
    );

    const matchRef = doc(db, "match_requests", matchId);
    const snap = await getDoc(matchRef);
    if (!snap.exists()) throw new Error("Match no longer exists");

    const data = snap.data();
const { fromUserId, toUserId } = data;
const requestContext = typeof data.requestContext === "string" ? data.requestContext : null;
const availabilityInstanceId =
  typeof data.availabilityInstanceId === "string" ? data.availabilityInstanceId : null;

const created =
  data.createdAt?.toDate?.() ??
  data.timestamp?.toDate?.() ??
  null;

const responseHours =
  created ? (Date.now() - created.getTime()) / (1000 * 60 * 60) : null;
    if (currentUserId !== toUserId) throw new Error("Not the recipient");

   await updateDoc(matchRef, {
  status: "accepted",
  players: [fromUserId, toUserId],
  acceptedAt: serverTimestamp(),
});
acceptedPersisted = true;

if (requestContext === "availability_interest" && availabilityInstanceId) {
  const availabilityRef = doc(db, "availabilities", toUserId);
  const availabilitySnap = await getDoc(availabilityRef);

  if (availabilitySnap.exists()) {
    const availabilityData = availabilitySnap.data() as any;
    if (
      availabilityData?.status === "open" &&
      availabilityData?.instanceId === availabilityInstanceId
    ) {
      await updateDoc(availabilityRef, {
        status: "matched",
        matchedAt: serverTimestamp(),
        matchedRequestId: matchId,
        updatedAt: serverTimestamp(),
      });
    }
  }

  const relatedPendingQ = query(
    collection(db, "match_requests"),
    where("toUserId", "==", toUserId),
    where("status", "==", "pending")
  );
  const relatedPendingSnap = await getDocs(relatedPendingQ);

  const staleRequests = relatedPendingSnap.docs.filter((docSnap) => {
    if (docSnap.id === matchId) return false;
    const related = docSnap.data() as any;
    return (
      related?.requestContext === "availability_interest" &&
      related?.availabilityInstanceId === availabilityInstanceId
    );
  });

  await Promise.all(
    staleRequests.map(async (docSnap) => {
      await deleteDoc(docSnap.ref);

      const notifQ = query(collection(db, "notifications"), where("matchId", "==", docSnap.id));
      const notifSnap = await getDocs(notifQ);
      await Promise.all(notifSnap.docs.map((notifDoc) => deleteDoc(notifDoc.ref)));
    })
  );
}

    track("match_request_accepted", {
      match_id: matchId,
      from_user_id: fromUserId,
      to_user_id: toUserId,
    });

  trackEvent("match_request_accepted", {
  matchId,
  fromUserId,
  toUserId,
  responseHours,
});

    try {
      await setDoc(
        doc(db, "players", toUserId),
        { badges: arrayUnion("firstMatch") },
        { merge: true }
      );
      // TODO: Award the sender's first-match badge from a Cloud Function triggered by match_requests status changing to accepted.
    } catch (badgeError) {
      console.warn("Failed to award local first-match badge after accept:", badgeError);
    }

    const localMatch = matches.find((m) => m.id === matchId);
    if (localMatch) {
      const isMine = localMatch.playerId === currentUserId;
      const otherUserId = isMine ? localMatch.opponentId : localMatch.playerId;

      if (otherUserId) {
        const cached = oppCache[otherUserId];
        const fallbackName = isMine
          ? localMatch.toName || "your opponent"
          : localMatch.fromName || "your opponent";

        const otherName = cached?.name || fallbackName;

        setChatPrompt({
          matchId,
          otherUserId,
          otherName,
        });
      }
    }
  } catch (err) {
    console.error("❌ Error accepting match:", err);

    if (!acceptedPersisted) {
      setMatches((prev) =>
        prev.map((m) =>
          m.id === matchId ? { ...m, status: prevStatus ?? "pending" } : m
        )
      );

      alert("Could not accept the request. Please try again.");
    }
  } finally {
    setAcceptingId(null);
  }
};



  // Start match logic
const handleStartMatch = useCallback(async (match: Match) => {
  if (!currentUserId) return;

  // Optimistic UI: flip the card immediately
  setStartingId(match.id);
  setMatches((prev) =>
    prev.map((m) =>
      m.id === match.id ? { ...m, started: true, startedAt: new Date() } : m
    )
  );

  try {
    const refMatch = doc(db, "match_requests", match.id);
    await updateDoc(refMatch, { started: true, startedAt: serverTimestamp() });

    track("match_started", {
  match_id: match.id,
});

    const other = match.playerId === currentUserId ? match.opponentId : match.playerId;
    await addDoc(collection(db, "notifications"), {
      recipientId: other,
      matchId: match.id,
      message: "Your match has started!",
      timestamp: serverTimestamp(),
      read: false,
    });
  } catch (e) {
    // Roll back optimistic change on error
    setMatches((prev) =>
      prev.map((m) =>
        m.id === match.id ? { ...m, started: false, startedAt: undefined } : m
      )
    );
    console.error("Start match failed:", e);
    alert("Could not start the game. Please try again.");
  } finally {
    setStartingId(null);
  }
}, [currentUserId]);

const handleSuggestCourt = useCallback(async (match: Match) => {
  try {
    if (!myPlayer?.postcode) {
      alert("Your profile is missing a postcode. Please set it in your profile.");
      return;
    }
    const otherId = match.playerId === currentUserId ? match.opponentId : match.playerId;
    const oppPostcode = await getOpponentPostcode(otherId);
    if (!oppPostcode) {
      alert("Opponent postcode missing. Ask them to update their profile.");
      return;
    }

    // Ask the suggestor for the top result near the midpoint
const myLatLng = await getPostcodeLatLng(myPlayer.postcode);
const oppLatLng = await getPostcodeLatLng(oppPostcode);

if (!myLatLng || !oppLatLng) {
  alert("Could not find coordinates for one of the postcodes. Please check both profiles have valid postcodes.");
  return;
}

const res = await suggestCourt(myLatLng, oppLatLng, {
  maxResults: 3,
  searchRadiusKm: 15,
});

    const top = res.results?.[0];
    if (!top) {
      alert("No nearby courts found. Try widening the search radius later.");
      return;
    }

    // Cache onto match doc so both players see the same suggestion
    const refMatch = doc(db, "match_requests", match.id);
    await updateDoc(refMatch, {
      suggestedCourtId: top.id,
      suggestedCourtName: top.name,
      suggestedCourtLat: top.lat,
      suggestedCourtLng: top.lng,
      suggestedCourtAddress: top.address || null, 
      suggestedCourtBookingUrl: normalizeUrl(top.bookingUrl) ?? null,
      suggestedCourtComputedAt: serverTimestamp(),
    });

    // Optimistically update local UI
    setMatches((prev) =>
      prev.map((m) =>
        m.id === match.id
          ? {
              ...m,
              suggestedCourtId: top.id,
              suggestedCourtName: top.name,
              suggestedCourtLat: top.lat,
              suggestedCourtLng: top.lng,
              suggestedCourtBookingUrl: normalizeUrl(top.bookingUrl) ?? undefined,
            }
          : m
      )
    );
  } catch (e) {
    console.error("Suggest court failed:", e);
    alert("Could not suggest a court right now. Please try again.");
  }
}, [currentUserId, myPlayer, getOpponentPostcode, setMatches]);


const handleCompleteGame = useCallback((match: Match) => {
  track("match_completed_cta", {
    match_id: match.id,
  });
  router.push(`/matches/${match.id}/complete/details`);
}, [router]);

const handleRequestRematch = useCallback(async (history: HistoryMatch) => {
  if (!currentUserId) return;

  const opponentId =
    history.fromUserId === currentUserId ? history.toUserId : history.fromUserId;
  if (!opponentId) return;

  const myName =
    history.fromUserId === currentUserId
      ? history.fromName || myPlayer?.name || "Player"
      : history.toName || myPlayer?.name || "Player";
  const opponentName =
    history.fromUserId === currentUserId
      ? history.toName || "Opponent"
      : history.fromName || "Opponent";

  try {
    setRematchingId(history.id);

    const newMatchRef = await addDoc(collection(db, "match_requests"), {
      fromUserId: currentUserId,
      toUserId: opponentId,
      fromName: myName,
      toName: opponentName,
      status: "pending",
      score: "",
      winnerId: "",
      completed: false,
      createdAt: serverTimestamp(),
    });

    await addDoc(collection(db, "notifications"), {
      recipientId: opponentId,
      message: `${myName} wants a rematch!`,
      matchId: newMatchRef.id,
      timestamp: serverTimestamp(),
      read: false,
      type: "rematch_request",
    });

    setRequestedRematches((prev) => ({ ...prev, [history.id]: true }));
  } catch (error) {
    console.error("Failed to request rematch", error);
    alert("Could not request a rematch right now. Please try again.");
  } finally {
    setRematchingId(null);
  }
}, [currentUserId, myPlayer?.name]);

const deleteMatch = useCallback(async (id: string) => {
  if (!confirm("Are you sure you want to delete this request?")) return;
  await deleteDoc(doc(db, "match_requests", id));
   track("match_request_declined", {
    match_id: id,
  });
  setMatches((prev) => prev.filter((m) => m.id !== id));
}, []);

const unmatchMatch = useCallback(
  async (match: Match, otherName: string, otherUserId: string) => {
    if (!currentUserId) return;

   const ok = confirm(
  `Are you sure you want to unmatch with ${otherName}?\n\nThis will remove the match for both of you.`
);

    if (!ok) return;

    // Optimistic: remove immediately
    setMatches((prev) => prev.filter((m) => m.id !== match.id));

    try {
      await deleteDoc(doc(db, "match_requests", match.id));

      track("match_unmatched", {
        match_id: match.id,
        by_user_id: currentUserId,
        other_user_id: otherUserId,
      });

      // Optional: notify the other person
      await addDoc(collection(db, "notifications"), {
        recipientId: otherUserId,
        matchId: match.id,
        message: `${otherName ? "Match ended." : "A match was ended."}`,
        timestamp: serverTimestamp(),
        read: false,
        type: "match_unmatched",
      });
    } catch (e) {
      console.error("Unmatch failed:", e);
      alert("Could not unmatch right now. Please try again.");

      // Roll back by reloading snapshot state will happen automatically,
      // but we can also do nothing because onSnapshot will re-add if delete failed.
    }
  },
  [currentUserId]
);

  // Chat logic omitted for brevity

const renderHistoryMatch = useCallback((history: HistoryMatch) => {
  if (!currentUserId) return null;

  const otherId =
    history.fromUserId === currentUserId ? history.toUserId : history.fromUserId;
  if (!otherId) return null;

  const other = oppCache[otherId];
  const otherName =
    other?.name ||
    (history.fromUserId === currentUserId ? history.toName : history.fromName) ||
    "Opponent";
  const avatarSrc =
    other?.photoThumbURL ||
    other?.photoURL ||
    (history.fromUserId === currentUserId ? history.toPhotoURL : history.fromPhotoURL) ||
    "";
  const initials = (otherName || "?").trim().charAt(0).toUpperCase();
  const won = !!history.winnerId && history.winnerId === currentUserId;
  const resultLabel = history.winnerId ? (won ? "Win" : "Loss") : "Played";
  const resultTone = history.winnerId ? (won ? "success" : "neutral") : "brand";
  const summaryLine = `${formatHistoryDate(history.completedAt, history.playedDate)} • ${formatMatchType(history.matchType)}`;
  const detailsHref = `/matches/history/${history.id}`;
  const rematchRequested = !!requestedRematches[history.id];

  return (
    <li key={history.id} className="rounded-3xl bg-white shadow-sm ring-1 ring-black/5 p-5">
      <div className="flex items-start gap-3">
        <div className="shrink-0">
          <div className="relative h-12 w-12 overflow-hidden rounded-full bg-gray-100">
            {avatarSrc ? (
              <Image
                src={avatarSrc}
                alt={otherName}
                fill
                sizes="48px"
                className="object-cover"
              />
            ) : (
              <div className="grid h-full w-full place-items-center text-sm text-gray-600">
                {initials}
              </div>
            )}
          </div>
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="truncate text-[15px] font-extrabold text-gray-900">
                {otherName}
              </div>
              <div className="mt-1 text-[12px] text-gray-500">{summaryLine}</div>
              {history.location ? (
                <div className="mt-1 truncate text-[12px] text-gray-400">{history.location}</div>
              ) : null}
            </div>

            <div className="shrink-0 text-right">
              <Chip tone={resultTone}>{resultLabel}</Chip>
              <div className="mt-2 text-sm font-extrabold text-gray-900">
                {history.score?.trim() || "No score"}
              </div>
            </div>
          </div>

          <div className="mt-4 flex items-center justify-between gap-3 text-sm">
            <button
              type="button"
              onClick={() => router.push(detailsHref)}
              className="inline-flex items-center gap-1.5 font-semibold text-gray-500 hover:text-gray-700"
            >
              Match Details
              <ArrowRight className="h-4 w-4" />
            </button>

            <button
              type="button"
              onClick={() => handleRequestRematch(history)}
              disabled={rematchRequested || rematchingId === history.id}
              className="font-extrabold text-[#7CFF4F] disabled:text-gray-300"
            >
              {rematchRequested
                ? "Requested"
                : rematchingId === history.id
                ? "Sending..."
                : "Rematch"}
            </button>
          </div>
        </div>
      </div>
    </li>
  );
}, [currentUserId, handleRequestRematch, oppCache, rematchingId, requestedRematches, router]);

const renderMatch = useCallback((match: Match) => {
  const isMine = match.playerId === currentUserId;
  const other  = isMine ? match.opponentId : match.playerId;
  const profileHref = `/players/${other}`;
    // ✅ Opponent meta for pending card
  const opp = oppCache[other];

  const skillText =
    opp?.skillBandLabel ||
    opp?.skillLevel ||
    (typeof opp?.skillBand === "string" ? opp.skillBand : null) ||
    "—";

  const availabilityText =
    Array.isArray(opp?.availability) && opp.availability.length > 0
      ? opp.availability.slice(0, 2).join(", ") +
        (opp.availability.length > 2 ? ` +${opp.availability.length - 2}` : "")
      : "—";

const otherName =
  oppCache[other]?.name ??
  (isMine ? (match.toName || "Opponent") : (match.fromName || "Opponent"));

const avatarSrc =
  oppCache[other]?.photoThumbURL ||
  oppCache[other]?.photoURL ||
  "";

const initials = (otherName || "?").trim().charAt(0).toUpperCase();


  const inProgress = isAcceptedStatus(match.status) && !!match.started;

  const created =
    match.createdAt?.toDate
      ? match.createdAt.toDate()
      : match.createdAt
      ? new Date(match.createdAt)
      : null;

  const startedAt =
    match.startedAt?.toDate
      ? match.startedAt.toDate()
      : match.startedAt
      ? new Date(match.startedAt)
      : null;

  // ---- Distance (prefer exact court lat/lng; fallback to postcode→coords) ----
  let distanceKm: number | null = null;

  try {
    if (
      typeof match.suggestedCourtLat === "number" &&
      typeof match.suggestedCourtLng === "number" &&
      myPlayer &&
      typeof myPlayer.lat === "number" &&
      typeof myPlayer.lng === "number"
    ) {
      distanceKm = getDistanceFromLatLonInKm(
        myPlayer.lat,
        myPlayer.lng,
        match.suggestedCourtLat,
        match.suggestedCourtLng
      );
    } else if (myPlayer) {
      const computeFromPC = (theirPostcode?: string | null) => {
        const mine = myPlayer.postcode ? postcodeCoords[myPlayer.postcode] : undefined;
        const theirs = theirPostcode ? postcodeCoords[theirPostcode] : undefined;
        if (mine && theirs) {
          distanceKm = getDistanceFromLatLonInKm(mine.lat, mine.lng, theirs.lat, theirs.lng);
        }
      };

      const cached = oppCache[other];
      if (cached) {
        computeFromPC(cached.postcode);
      } else if (cached === undefined) {
        (async () => {
          try {
            const s = await getDoc(doc(db, "players", other));
            const d = s.exists() ? (s.data() as any) : null;
            setOppCache((prev) => ({
  ...prev,
  [other]: d
    ? {
        postcode: d.postcode,
        lat: d.lat,
        lng: d.lng,
        photoURL: d.photoURL ?? d.photoUrl ?? d.avatarUrl ?? null,
        photoThumbURL: d.photoThumbURL ?? null, // ✅ ADD
        name: d.name,

        skillBand: d.skillBand ?? null,
        skillBandLabel: d.skillBandLabel ?? null,
        skillLevel: d.skillLevel ?? null,
        availability: Array.isArray(d.availability) ? d.availability : [],
      }
    : null,
}));


          } catch {
            setOppCache((prev) => ({ ...prev, [other]: null }));
          }
        })();
      }
    }
  } catch {
    // ignore; distanceKm stays null
  }


// 👇 THIS is the important part the parser was complaining about:
return (
  <li key={match.id} className="relative rounded-3xl bg-white shadow-sm ring-1 ring-black/5 p-5">
    <div className="flex items-start gap-3">
{/* Avatar (no ring, no rating) */}
<div className="shrink-0">
  <div className="relative h-12 w-12 overflow-hidden rounded-full bg-gray-100">
    {avatarSrc ? (
      <Image
        src={avatarSrc}
        alt={otherName}
        fill
        sizes="48px"
        className="object-cover"
      />
    ) : (
      <div className="h-full w-full grid place-items-center text-sm text-gray-600">
        {initials}
      </div>
    )}
  </div>
</div>


      {/* Text + actions */}
      <div className="min-w-0 flex-1">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="text-[15px] font-extrabold text-gray-900 truncate">
              {otherName}
            </div>

            <div className="mt-1 text-[12px] text-gray-500 space-y-0.5">
              <div className="truncate">
                {typeof distanceKm === "number" ? `${distanceKm} KM away` : "— KM away"}
                {opp?.postcode ? ` • ${opp.postcode}` : ""}
              </div>

              <div className="truncate">Availability: {availabilityText}</div>
            </div>
          </div>
          <button
  type="button"
  onClick={(e) => {
    e.stopPropagation();

    // ✅ if accepted → unmatch, else → delete (cancel/decline request)
    if (isAcceptedStatus(match.status)) {
      unmatchMatch(match, otherName, other);
    } else {
      deleteMatch(match.id);
    }
  }}
  className="shrink-0 h-10 w-10 rounded-full grid place-items-center bg-gray-100 hover:bg-gray-200 text-gray-700"
  aria-label={isAcceptedStatus(match.status) ? "Unmatch" : "Delete request"}
  title={isAcceptedStatus(match.status) ? "Unmatch" : "Delete request"}
>
  <Trash2 className="h-5 w-5" />
</button>

        </div>

{/* Chat / Pending row + View Profile */}
<div className="mt-3">
  {/* Row 1: Chat OR Accept/Decline OR Pending */}
  <div className="flex items-center gap-2">
{isAcceptedStatus(match.status) ? (
  <div className="w-full flex gap-2">
    {/* Chat */}
    <button
      type="button"
      onClick={() => {
        const sortedIDs = [currentUserId!, other].sort().join("_");
        router.push(`/messages/${sortedIDs}`);
      }}
      className="flex-1 rounded-full py-3 text-sm font-extrabold text-[#0B3D2E]"
      style={{ background: "#39FF14" }}
    >
      <span className="inline-flex items-center justify-center gap-2">
        <MessageCircle className="h-4 w-4" />
        Chat
      </span>
    </button>
  </div>
) : (

      <div className="w-full flex gap-2">
        {match.opponentId === currentUserId ? (
          <>
            <button
              type="button"
              onClick={() => currentUserId && acceptMatch(match.id, currentUserId)}
              className="flex-1 rounded-full py-3 text-sm font-extrabold text-[#0B3D2E]"
              style={{ background: "#39FF14" }}
            >
              Accept
            </button>

            <button
              type="button"
              onClick={() => deleteMatch(match.id)}
              className="flex-1 rounded-full py-3 text-sm font-extrabold text-gray-700 bg-gray-100"
            >
              Decline
            </button>
          </>
        ) : (
         <button
  type="button"
  className="w-full rounded-full py-3 text-sm font-extrabold text-[#7A3E00]"
  style={{ background: "#FFB020" }}   // ✅ orange pill
  disabled
>
  Pending…
</button>
        )}
      </div>
    )}
  </div>

  {/* Row 2: View Profile */}
<button
  type="button"
  onClick={() => {
    track("view_profile_clicked_from_matches", {
      match_id: match.id,
      other_user_id: other,
      status: match.status,
    });
    handleViewProfile(other); // ✅ same pattern as Directory
  }}
  className="mt-2 w-full rounded-full py-3 text-sm font-extrabold text-gray-700 bg-gray-100 hover:bg-gray-200"
>
  View Profile
</button>

</div>

      </div>
    </div>
  </li>
);

}, [
  currentUserId,
  router,
  acceptMatch,    
  handleViewProfile, 
  handleStartMatch,
  handleCompleteGame,
  handleSuggestCourt,
  deleteMatch,
  myPlayer,
  postcodeCoords,
  oppCache,
  tab,
  unmatchMatch,
]);


const pendingCount = useMemo(
  () => matches.filter((m) => isPendingStatus(m.status)).length,
  [matches]
);
const acceptedCount = useMemo(
  () => matches.filter((m) => isAcceptedStatus(m.status)).length,
  [matches]
);
const historyCount = useMemo(() => historyMatches.length, [historyMatches]);

const incomingPendingCount = useMemo(
  () =>
    matches.filter(
      (m) => isPendingStatus(m.status) && m.opponentId === currentUserId
    ).length,
  [matches, currentUserId]
);

const outgoingPendingCount = useMemo(
  () =>
    matches.filter(
      (m) => isPendingStatus(m.status) && m.playerId === currentUserId
    ).length,
  [matches, currentUserId]
);

const distanceFor = useCallback(
  (m: Match): number | null => {
    try {
      // Prefer exact court coords if available
      if (
        typeof m.suggestedCourtLat === "number" &&
        typeof m.suggestedCourtLng === "number" &&
        myPlayer &&
        typeof myPlayer.lat === "number" &&
        typeof myPlayer.lng === "number"
      ) {
        return getDistanceFromLatLonInKm(
          myPlayer.lat,
          myPlayer.lng,
          m.suggestedCourtLat,
          m.suggestedCourtLng
        );
      }

      // Fallback: my postcode vs opponent postcode
      if (myPlayer) {
        const otherId = m.playerId === currentUserId ? m.opponentId : m.playerId;
        const mine = myPlayer.postcode ? postcodeCoords[myPlayer.postcode] : undefined;
        const theirsPC = oppCache[otherId]?.postcode;
        const theirs = theirsPC ? postcodeCoords[theirsPC] : undefined;
        if (mine && theirs) {
          return getDistanceFromLatLonInKm(mine.lat, mine.lng, theirs.lat, theirs.lng);
        }
      }
    } catch {
      // ignore
    }
    return null;
  },
  [myPlayer, postcodeCoords, oppCache, currentUserId]
);


const visibleMatches = useMemo(() => {
  const base =
    tab === "accepted"
      ? matches.filter((m) => isAcceptedStatus(m.status))
      : matches.filter((m) => isPendingStatus(m.status));

const byDirection = base.filter((m) => {
  if (tab === "pending") {
    if (direction === "sent" && m.playerId !== currentUserId) return false;
    if (direction === "received" && m.opponentId !== currentUserId) return false;
  }
  return true;
});

  // Unread-only filter
  const byUnread = unreadOnly ? byDirection.filter((m) => m.status === "unread") : byDirection;

  // Search
  const q = queryText.trim().toLowerCase();
  const searched = !q
    ? byUnread
    : byUnread.filter((m) => {
        const a = (m.fromName || "").toLowerCase();
        const b = (m.toName || "").toLowerCase();
        return a.includes(q) || b.includes(q);
      });

  // Enrich for sorting
  const enriched = searched.map((m) => {
    const createdMs =
      m.createdAt?.toDate ? m.createdAt.toDate().getTime() :
      m.createdAt ? new Date(m.createdAt).getTime() : 0;
    const dist = distanceFor(m);
    return { m, createdMs, dist };
  });

  // Sort
  enriched.sort((A, B) => {
    if (sortBy === "distance") {
      const a = A.dist ?? Number.POSITIVE_INFINITY;
      const b = B.dist ?? Number.POSITIVE_INFINITY;
      return a - b; // closest first
    }
    if (sortBy === "oldest") return A.createdMs - B.createdMs;
    // "recent"
    return B.createdMs - A.createdMs;
  });

  return enriched.map((e) => e.m);
}, [matches, tab, direction, currentUserId, queryText, unreadOnly, sortBy, distanceFor]);

const visibleHistoryMatches = useMemo(() => {
  const q = queryText.trim().toLowerCase();

  const searched = !q
    ? historyMatches
    : historyMatches.filter((m) => {
        const a = (m.fromName || "").toLowerCase();
        const b = (m.toName || "").toLowerCase();
        return a.includes(q) || b.includes(q);
      });

  const enriched = searched.map((m) => {
    const createdMs =
      toDateOrNull(m.completedAt)?.getTime() ??
      toDateOrNull(m.playedDate)?.getTime() ??
      toDateOrNull(m.updatedAt)?.getTime() ??
      0;
    return { m, createdMs };
  });

  enriched.sort((A, B) =>
    sortBy === "oldest" ? A.createdMs - B.createdMs : B.createdMs - A.createdMs
  );

  return enriched.map((e) => e.m);
}, [historyMatches, queryText, sortBy]);

const isTabLoading = tab === "history" ? historyLoading : loading;

if (isDesktop) {
  return <DesktopMatches />;
}

return (
  <div className="min-h-screen bg-[#F3F5F7] pb-28">
    {/* Top bar + segmented control */}
    <div className="sticky top-0 z-30 bg-[#F3F5F7]">
      <div className="mx-auto w-full max-w-xl px-3 sm:px-4 pt-4">
        <div className="relative flex items-center justify-between">
          {/* Back */}
          <button
            type="button"
            onClick={() => router.back()}
            className="h-10 w-10 grid place-items-center rounded-full hover:bg-black/5"
            aria-label="Back"
          >
            <ArrowLeft className="h-5 w-5 text-gray-700" />
          </button>

          {/* Title */}
          <div className="absolute left-1/2 -translate-x-1/2 text-[15px] font-semibold text-gray-900">
            My Matches
          </div>

       <div className="h-10 w-10" />
        </div>
{/* Segmented control */}
<div className="mt-3 rounded-full bg-white/80 p-1 ring-1 ring-black/5">
  <div className="grid grid-cols-3 gap-1">
    <button
      type="button"
      onClick={() => setTab("accepted")}
      className="h-9 rounded-full text-xs font-extrabold transition"
      style={
        tab === "accepted"
          ? { background: "#39FF14", color: "#0B3D2E" }
          : { background: "transparent", color: "rgba(15,23,42,0.55)" }
      }
    >
      Confirmed ({acceptedCount})
    </button>

    <button
      type="button"
      onClick={() => setTab("pending")}
      className="h-9 rounded-full text-xs font-extrabold transition"
      style={
        tab === "pending"
          ? { background: "#39FF14", color: "#0B3D2E" }
          : { background: "transparent", color: "rgba(15,23,42,0.55)" }
      }
    >
      Pending ({pendingCount})
    </button>

    <button
      type="button"
      onClick={() => setTab("history")}
      className="h-9 rounded-full text-xs font-extrabold transition"
      style={
        tab === "history"
          ? { background: "#39FF14", color: "#0B3D2E" }
          : { background: "transparent", color: "rgba(15,23,42,0.55)" }
      }
    >
      History ({historyCount})
    </button>
  </div>
</div>

{tab === "pending" && (
  <div className="mt-3 flex items-center gap-2 overflow-x-auto px-0.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
    <button
      type="button"
      onClick={() => setDirection("all")}
      className="shrink-0 rounded-full px-3 py-2 text-[12px] font-extrabold transition"
      style={
        direction === "all"
          ? { background: "#0B3D2E", color: "white" }
          : { background: "white", color: "rgba(15,23,42,0.7)" }
      }
    >
      All ({pendingCount})
    </button>

    <button
      type="button"
      onClick={() => setDirection("received")}
      className="shrink-0 rounded-full px-3 py-2 text-[12px] font-extrabold transition"
      style={
        direction === "received"
          ? { background: "#0B3D2E", color: "white" }
          : { background: "white", color: "rgba(15,23,42,0.7)" }
      }
    >
      Received ({incomingPendingCount})
    </button>

    <button
      type="button"
      onClick={() => setDirection("sent")}
      className="shrink-0 rounded-full px-3 py-2 text-[12px] font-extrabold transition"
      style={
        direction === "sent"
          ? { background: "#0B3D2E", color: "white" }
          : { background: "white", color: "rgba(15,23,42,0.7)" }
      }
    >
      Sent ({outgoingPendingCount})
    </button>
  </div>
)}

      </div>
    </div>

    {/* List */}
    <div className="mx-auto w-full max-w-xl px-3 sm:px-4 pt-4">
      {isTabLoading ? (
        <div className="space-y-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <div
              key={i}
              className="h-[92px] rounded-3xl bg-white/80 ring-1 ring-black/5 animate-pulse"
            />
          ))}
        </div>
      ) : tab === "history" ? (
        visibleHistoryMatches.length === 0 ? (
          <div className="rounded-3xl bg-white ring-1 ring-black/5 p-6 text-center text-sm text-gray-600">
            No past matches yet.
          </div>
        ) : (
          <>
            <div className="mb-3 px-1 text-[11px] font-bold uppercase tracking-[0.18em] text-gray-500">
              Past Matches
            </div>
            <ul className="space-y-3">
              {visibleHistoryMatches.map((m) => renderHistoryMatch(m))}
            </ul>
          </>
        )
      ) : visibleMatches.length === 0 ? (
        <div className="rounded-3xl bg-white ring-1 ring-black/5 p-6 text-center text-sm text-gray-600">
          {tab === "accepted" ? "No confirmed matches yet." : "No pending requests yet."}
        </div>
      ) : (
        <ul className="space-y-3">
  {visibleMatches.map((m) => renderMatch(m))}
</ul>
      )}


      {/* 🎾 Post-accept chat prompt modal (KEEP your existing modal markup) */}
      {chatPrompt && currentUserId && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/40 px-4">
          <div className="relative w-full max-w-sm rounded-2xl bg-white p-5 shadow-xl">
            <button
              onClick={() => setChatPrompt(null)}
              aria-label="Close"
              className="absolute right-3 top-3 rounded-full p-1 text-gray-400 hover:text-gray-600 hover:bg-gray-100"
            >
              <X className="h-4 w-4" />
            </button>

            <div className="text-center">
              <p className="text-[11px] font-semibold tracking-[0.16em] text-green-700 uppercase">
                Match accepted
              </p>
              <h2 className="mt-1 text-lg font-bold text-gray-900">
                Rally ready with {chatPrompt.otherName}! 🎾
              </h2>
              <p className="mt-2 text-sm text-gray-600">
                Send a quick message to lock in the time, day, and court.
              </p>
            </div>

            <div className="mt-5 flex flex-col gap-2 sm:flex-row sm:justify-center">
              <button
                onClick={() => {
                  const sortedIDs = [currentUserId!, chatPrompt.otherUserId]
                    .sort()
                    .join("_");
                  setChatPrompt(null);
                  router.push(`/messages/${sortedIDs}`);
                }}
                className={`w-full sm:w-auto ${BTN.brand}`}
              >
                <MessageCircle className="h-4 w-4" />
                Send a message
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
{/* ✅ Profile overlay modal (same logic as Directory) */}
{profileOverlayUserId && (
  <div className="fixed inset-0 z-[9999]">
    {/* Backdrop */}
    <div
      className="absolute inset-0 bg-black/60"
      onMouseDown={() => setProfileOverlayUserId(null)}
    />

    {/* Panel */}
    <div className="absolute inset-0 flex items-start justify-center px-3 pt-3 pb-4 sm:items-center sm:p-6">
      <div
        className="w-full max-w-[560px] rounded-2xl shadow-2xl overflow-hidden"
        style={{ background: "#071B15" }}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div
          style={{
            height: "min(88dvh, 820px)",
            maxHeight: "min(88dvh, 820px)",
          }}
        >
          <PlayerProfileView
            playerId={profileOverlayUserId}
            onClose={() => setProfileOverlayUserId(null)}
          />
        </div>
      </div>
    </div>
  </div>
)}

  </div>
);



              // end return
}                // ← ADD THIS: closes MatchesPage component

export default MatchesPage;
