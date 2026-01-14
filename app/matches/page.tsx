"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
import { auth, db } from "@/lib/firebase";
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
} from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { suggestCourt } from "@/lib/suggestCourt";
import { track } from "@/lib/track";


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
}: React.PropsWithChildren<{ tone?: ChipTone; className?: string }>) => {
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
  started?: boolean;
  startedAt?: any;
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
const searchParams = useSearchParams();

const initialTab = searchParams.get("tab") === "accepted" ? "accepted" : "pending";
const initialDir = ((): "all" | "received" | "sent" => {
  const v = searchParams.get("dir");
  return v === "received" || v === "sent" || v === "all" ? v : "all";
})();

const [tab, setTab] = useState<"pending" | "accepted">(initialTab);
const [direction, setDirection] = useState<"all" | "received" | "sent">(initialDir);

const [matches, setMatches] = useState<Match[]>([]);
const [currentUserId, setCurrentUserId] = useState<string | null>(null);

const [queryText, setQueryText] = useState(searchParams.get("q") || "");
const [myPlayer, setMyPlayer] = useState<PlayerLite | null>(null);
  const [postcodeCoords, setPostcodeCoords] = useState<PCMap>({});
  const [oppCache, setOppCache] = useState<Record<string, PlayerLite | null>>({});
  const [loading, setLoading] = useState(true);
const [acceptingId, setAcceptingId] = useState<string | null>(null);
const [decliningId, setDecliningId] = useState<string | null>(null);
const [startingId, setStartingId] = useState<string | null>(null);
const [chatPrompt, setChatPrompt] = useState<{
  matchId: string;
  otherUserId: string;
  otherName: string;
} | null>(null);

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
    if (m.status !== "accepted") return false;

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
    .filter((m) => m.status === "accepted" && !m.suggestedCourtName)
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
  if (tab === "accepted") params.set("tab", "accepted");
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

  const unsubFrom = onSnapshot(fromQ, proc);
  const unsubTo = onSnapshot(toQ, proc);
  return () => {
    unsubFrom();
    unsubTo();
  };
}, [currentUserId]);

// Warm opponent cache so avatars/names are available
useEffect(() => {
  if (!currentUserId || matches.length === 0) return;

  // Get each visible opponent id (the "other" person per card)
  const opponentIds = Array.from(
    new Set(
      matches.map(m => (m.playerId === currentUserId ? m.opponentId : m.playerId))
    )
  );

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
}, [matches, currentUserId]); // ← do NOT include oppCache here to avoid loops


// Accept a match and award badge + prompt to chat
const acceptMatch = async (matchId: string, currentUserId: string) => {
  // Snapshot of previous status (for revert)
  const prevStatus = matches.find((m) => m.id === matchId)?.status;

  try {
    setAcceptingId(matchId);

    // Optimistic UI
    setMatches((prev) =>
      prev.map((m) => (m.id === matchId ? { ...m, status: "accepted" } : m))
    );

    const matchRef = doc(db, "match_requests", matchId);
    const snap = await getDoc(matchRef);
    if (!snap.exists()) throw new Error("Match no longer exists");

    const { fromUserId, toUserId } = snap.data();
    if (currentUserId !== toUserId) throw new Error("Not the recipient");

    await updateDoc(matchRef, {
      status: "accepted",
      players: [fromUserId, toUserId],
    });

    track("match_request_accepted", {
  match_id: matchId,
  from_user_id: fromUserId,
  to_user_id: toUserId,
});

    await Promise.all([
      setDoc(
        doc(db, "players", toUserId),
        { badges: arrayUnion("firstMatch") },
        { merge: true }
      ),
      setDoc(
        doc(db, "players", fromUserId),
        { badges: arrayUnion("firstMatch") },
        { merge: true }
      ),
    ]);

    // ⭐ After success – set up the tennis-y chat prompt modal
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
    // Revert optimistic flip
    setMatches((prev) =>
      prev.map((m) =>
        m.id === matchId ? { ...m, status: prevStatus ?? "pending" } : m
      )
    );
    alert("Could not accept the request. Please try again.");
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

const deleteMatch = useCallback(async (id: string) => {
  if (!confirm("Delete this match?")) return;
  await deleteDoc(doc(db, "match_requests", id));
   track("match_request_declined", {
    match_id: id,
  });
  setMatches((prev) => prev.filter((m) => m.id !== id));
}, []);


  // Chat logic omitted for brevity

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


  const inProgress = match.status === "accepted" && !!match.started;

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
  <li
  key={match.id}
  className={
    "relative w-full overflow-hidden rounded-2xl bg-white ring-1 p-4 shadow-sm hover:shadow-md transition " +
    (match.status === "unread" ? "ring-green-200" : "ring-black/5")
  }
>

    {/* left accent for unread */}
    {match.status === "unread" && (
      <div className="absolute inset-y-0 left-0 w-1 bg-green-400/70" />
    )}

    {/* Top-right overlay: Unread + delete */}
    <div className="absolute top-2 right-2 z-10 flex items-center gap-2">
      {match.status === "unread" && <Chip tone="warning">Unread</Chip>}
      <button
        onClick={() => deleteMatch(match.id)}
        title="Delete request"
        aria-label="Delete request"
        className="p-1 rounded-md text-red-500/80 hover:text-red-600 hover:bg-red-50"
      >
        <Trash2 className="h-4 w-4" />
      </button>
    </div>

    <div className="flex items-start gap-3">

      <div className="min-w-0 flex-1">
        {/* Header (opponent-first) */}
        <div className="flex items-start gap-3 pr-24 sm:pr-12">
 {/* Avatar */}
<div className="relative h-10 w-10 rounded-full overflow-hidden bg-gray-100 ring-1 ring-black/5 shrink-0">
  {/* subtle placeholder while image loads/decodes */}
  <div className="absolute inset-0 animate-pulse bg-gray-200" />

  {avatarSrc ? (
    <Image
      src={avatarSrc}
      alt={otherName}
      fill
      sizes="40px"
      className="object-cover"
    />
  ) : (
    <div className="relative h-full w-full grid place-items-center text-sm text-gray-600">
      {initials}
    </div>
  )}
</div>



          {/* Name + status */}
          <div className="min-w-0 flex-1">
            <div className="flex items-start gap-2">
              <span className="font-semibold text-gray-900 truncate">{otherName}</span>
              <div className="ml-auto">
                {inProgress ? (
                  <Chip tone="brand">Game in progress</Chip>
                ) : match.status === "accepted" ? (
                  <Chip tone="success">Accepted</Chip>
                ) : match.status !== "unread" ? (
                  <Chip>{match.status}</Chip>
                ) : null}
              </div>
            </div>

            {/* Subtle route line */}
            <div className="mt-0.5 text-xs text-gray-500 truncate">
              {isMine ? (
                <>
                  You{" "}
                  <ArrowRight className="inline h-3 w-3 align-[-2px] text-gray-300" /> {otherName}
                </>
              ) : (
                <>
                  {otherName}{" "}
                  <ArrowRight className="inline h-3 w-3 align-[-2px] text-gray-300" /> You
                </>
              )}
            </div>
          </div>
        </div>

        {/* Message */}
        <p className="mt-2 text-sm text-gray-700 overflow-hidden text-ellipsis whitespace-nowrap block w-full">
          {match.message || "No message"}
        </p>
        {/* ✅ Pending-only meta chips (distance / skill / availability) */}
{match.status !== "accepted" && (
  <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-gray-600">
    <span className="rounded-full bg-gray-100 px-2.5 py-1 ring-1 ring-gray-200">
      Distance: {typeof distanceKm === "number" ? `${distanceKm} km` : "—"}
    </span>

    <span className="rounded-full bg-gray-100 px-2.5 py-1 ring-1 ring-gray-200">
      Skill: {skillText}
    </span>

    <span className="rounded-full bg-gray-100 px-2.5 py-1 ring-1 ring-gray-200">
      Availability: {availabilityText}
    </span>
  </div>
)}


{/* Meta — line 2 (court chip) */}
{match.status === "accepted" && (
  <div className="mt-4 flex items-center justify-center w-full">
    {match.suggestedCourtName ? (
      <CourtBadge
        name={match.suggestedCourtName}
        lat={match.suggestedCourtLat}
        lng={match.suggestedCourtLng}
        bookingUrl={match.suggestedCourtBookingUrl}
        address={match.suggestedCourtAddress}
        courtId={match.suggestedCourtId}
      />
    ) : (
      <span className="inline-flex items-center gap-1 text-xs text-gray-500">
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
        Finding court…
      </span>
    )}
  </div>
)}



      </div>
    </div>

    {/* Actions */}
    <div className="mt-3 pt-3 border-t border-gray-100 flex flex-col items-center justify-center sm:flex-row sm:flex-wrap sm:items-center sm:justify-center gap-2">
      {match.status === "accepted" ? (
        inProgress ? (
          <>
            <button
              onClick={() => handleCompleteGame(match)}
              aria-label="Complete game"
              className={`w-full sm:w-auto min-w-[140px] ${BTN.brand}`}
            >
              <Check className="h-4 w-4" />
              Complete Game
            </button>

            <button
              onClick={() => {
                const sortedIDs = [currentUserId!, other].sort().join("_");
                router.push(`/messages/${sortedIDs}`);
              }}
              aria-label="Open chat"
              className={`w-full sm:w-auto min-w-[110px] ${BTN.tertiary}`}
            >
              <MessageCircle className="h-4 w-4" />
              Chat
            </button>

            <Link
              href={profileHref}
              aria-label="View profile"
              className={`w-full sm:w-auto min-w-[120px] ${BTN.secondary}`}
            >
              View profile
            </Link>
          </>
        ) : (
          <>
            <button
              onClick={() => handleStartMatch(match)}
              disabled={startingId === match.id}
              aria-label="Start game"
              className={`w-full sm:w-auto min-w-[130px] ${BTN.primary} ${
                startingId === match.id ? "opacity-60 cursor-not-allowed" : ""
              }`}
            >
              {startingId === match.id ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Starting…
                </>
              ) : (
                <>
                  <Check className="h-4 w-4" />
                  Start Game
                </>
              )}
            </button>

            <button
              onClick={() => {
                const sortedIDs = [currentUserId!, other].sort().join("_");
                router.push(`/messages/${sortedIDs}`);
              }}
              aria-label="Open chat"
              className={`w-full sm:w-auto min-w-[110px] ${BTN.tertiary}`}
            >
              <MessageCircle className="h-4 w-4" />
              Chat
            </button>

            <Link
              href={profileHref}
              aria-label="View profile"
              className={`w-full sm:w-auto min-w-[120px] ${BTN.secondary}`}
            >
              View profile
            </Link>
          </>
        )
      ) : (
        <>
          {match.opponentId === currentUserId ? (
            <>
              <button
                onClick={() => currentUserId && acceptMatch(match.id, currentUserId)}
                aria-label="Accept request"
                className={`w-full sm:w-auto min-w-[120px] ${BTN.primary}`}
              >
                <Check className="h-4 w-4" />
                Accept
              </button>

            {tab !== "pending" && (
  <button
    onClick={() => {
      const sortedIDs = [currentUserId!, other].sort().join("_");
      router.push(`/messages/${sortedIDs}`);
    }}
    aria-label="Open chat"
    className={`w-full sm:w-auto min-w-[110px] ${BTN.tertiary}`}
  >
    <MessageCircle className="h-4 w-4" />
    Chat
  </button>
)}

              <Link
                href={profileHref}
                aria-label="View profile"
                className={`w-full sm:w-auto min-w-[120px] ${BTN.secondary}`}
              >
                View profile
              </Link>

              <button
                onClick={() => deleteMatch(match.id)}
                aria-label="Decline request"
                className={`w-full sm:w-auto min-w-[110px] ${BTN.tertiary}`}
              >
                <X className="h-4 w-4" />
                Decline
              </button>
            </>
          ) : (
            <>
           {tab !== "pending" && (
  <button
    onClick={() => {
      const sortedIDs = [currentUserId!, other].sort().join("_");
      router.push(`/messages/${sortedIDs}`);
    }}
    aria-label="Open chat"
    className={`w-full sm:w-auto min-w-[110px] ${BTN.tertiary}`}
  >
    <MessageCircle className="h-4 w-4" />
    Chat
  </button>
)}


              <Link
                href={profileHref}
                aria-label="View profile"
                className={`w-full sm:w-auto min-w-[120px] ${BTN.secondary}`}
              >
                View profile
              </Link>
            </>
          )}
        </>
      )}
    </div>
  </li>
);
}, [
  currentUserId,
  router,
  handleStartMatch,
  handleCompleteGame,
  handleSuggestCourt,
  deleteMatch,
  myPlayer,
  postcodeCoords,
  oppCache,
  tab,
]);


const pendingCount = useMemo(
  () => matches.filter((m) => m.status !== "accepted").length,
  [matches]
);
const acceptedCount = useMemo(
  () => matches.filter((m) => m.status === "accepted").length,
  [matches]
);

const incomingPendingCount = useMemo(
  () =>
    matches.filter(
      (m) => m.status !== "accepted" && m.opponentId === currentUserId
    ).length,
  [matches, currentUserId]
);

const outgoingPendingCount = useMemo(
  () =>
    matches.filter(
      (m) => m.status !== "accepted" && m.playerId === currentUserId
    ).length,
  [matches, currentUserId]
);

useEffect(() => {
  if (tab === "pending" && direction === "all" && incomingPendingCount > 0) {
    setDirection("received");
  }
}, [tab, direction, incomingPendingCount]);

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
      ? matches.filter((m) => m.status === "accepted")
      : matches.filter((m) => m.status !== "accepted");

  // Direction filter
  const byDirection = base.filter((m) => {
    if (direction === "sent" && m.playerId !== currentUserId) return false;
    if (direction === "received" && m.opponentId !== currentUserId) return false;
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


return (
  <div className="mx-auto w-full max-w-6xl px-4 sm:px-6 pt-4 sm:pt-6 pb-28 overflow-x-hidden">
    {/* Page title */}
{/* Header hero tile */}
<div className="-mx-4 sm:-mx-6 mb-4">
  <div className="relative h-40 sm:h-56 md:h-64 overflow-hidden rounded-2xl">
    <Image
      src="/images/matches.jpg"
      alt="Tennis players arranging match requests"
      fill
      priority
      className="object-cover"
    />
    <div className="absolute inset-0 bg-black/40" />
    <div className="absolute inset-0 flex items-center justify-center px-4">
      <div className="text-center text-white">
        <h1 className="text-2xl sm:text-3xl font-bold tracking-tight">Match Requests</h1>
        <p className="mt-1 text-sm sm:text-base opacity-90">
          Manage invitations you’ve sent and received — keep the rallies going.
        </p>
      </div>
    </div>
  </div>
</div>


         {/* Sticky toolbar */}
    <div className="sticky top-[56px] z-30 -mx-4 sm:-mx-6 px-4 sm:px-6 py-2 mb-3 bg-white/80 backdrop-blur supports-[backdrop-filter]:bg-white/60 border-b">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        {/* Centered tabs with big green buttons + counts */}
        <div className="w-full flex justify-center">
          <div className="inline-flex w-full max-w-md rounded-2xl bg-green-50 p-1 shadow-sm ring-1 ring-green-200">
            <button
              onClick={() => setTab("pending")}
              className={`relative flex-1 flex items-center justify-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold transition
                ${
                  tab === "pending"
                    ? "bg-green-600 text-white shadow-sm"
                    : "text-green-800 hover:bg-white"
                }`}
            >
              <span>Pending</span>
              <span
                className={`inline-flex items-center justify-center rounded-full px-2 py-0.5 text-xs font-semibold
                  ${
                    tab === "pending"
                      ? "bg-white/20"
                      : "bg-green-100 text-green-900"
                  }`}
              >
                {pendingCount}
              </span>
            </button>

            <button
              onClick={() => setTab("accepted")}
              className={`relative flex-1 flex items-center justify-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold transition
                ${
                  tab === "accepted"
                    ? "bg-green-600 text-white shadow-sm"
                    : "text-green-800 hover:bg-white"
                }`}
            >
              <span>Accepted</span>
              <span
                className={`inline-flex items-center justify-center rounded-full px-2 py-0.5 text-xs font-semibold
                  ${
                    tab === "accepted"
                      ? "bg-white/20"
                      : "bg-green-100 text-green-900"
                  }`}
              >
                {acceptedCount}
              </span>
            </button>
          </div>
        </div>

        {/* Filters */}
        <div className="w-full sm:w-auto sm:ml-auto flex flex-wrap items-center gap-3">
          {/* Direction */}
          <select
            value={direction}
            onChange={(e) =>
              setDirection(e.target.value as "all" | "received" | "sent")
            }
            className="text-sm border rounded-lg px-2 py-1 flex-none w-[120px] sm:w-auto"
            title="Filter direction"
          >
            <option value="all">All</option>
            <option value="received">Received</option>
            <option value="sent">Sent</option>
          </select>

          {/* Sort */}
          <select
            value={sortBy}
            onChange={(e) =>
              setSortBy(e.target.value as "recent" | "oldest" | "distance")
            }
            className="text-sm border rounded-lg px-2 py-1 flex-none w-[130px]"
            title="Sort"
          >
            <option value="recent">Newest</option>
            <option value="oldest">Oldest</option>
            <option value="distance">Closest</option>
          </select>

          {/* Search */}
          <input
            type="text"
            value={queryText}
            onChange={(e) => setQueryText(e.target.value)}
            placeholder="Search names…"
            aria-label="Search requests by name"
            className="text-sm border rounded-lg px-2 py-1 min-w-0 w-full sm:w-48 max-w-full flex-1"
          />
        </div>
      </div>
    </div>


{/* List / Loading / Empty */}
{loading ? (
  // Skeleton grid
  <ul className="grid grid-cols-1 gap-4 lg:grid-cols-2 lg:gap-5">
    {Array.from({ length: 4 }).map((_, i) => (
      <li key={i} className="rounded-2xl bg-white ring-1 ring-black/5 p-4 shadow-sm animate-pulse">
        <div className="flex items-start gap-3">
          <div className="h-9 w-9 rounded-full bg-gray-200" />
          <div className="flex-1 space-y-2">
            <div className="h-4 w-1/3 bg-gray-200 rounded" />
            <div className="h-3 w-2/3 bg-gray-200 rounded" />
            <div className="h-3 w-5/6 bg-gray-200 rounded" />
            <div className="mt-3 flex gap-2">
              <div className="h-8 w-28 bg-gray-200 rounded" />
              <div className="h-8 w-24 bg-gray-200 rounded" />
            </div>
          </div>
        </div>
      </li>
    ))}
  </ul>
) : visibleMatches.length === 0 ? (
  <div className="mt-6 rounded-xl border border-dashed border-gray-300 bg-white p-8 text-center">
    <p className="text-gray-800 font-medium">No matches in this view yet</p>
    <p className="text-gray-600 text-sm mt-1">Try switching tabs or filters.</p>
  </div>
) : (
  <ul className="grid grid-cols-1 gap-4 lg:grid-cols-2 lg:gap-5">
    {visibleMatches.map(renderMatch)}
  </ul>
)}

{/* 🎾 Post-accept chat prompt modal */}
{chatPrompt && currentUserId && (
  <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/40 px-4">
    <div className="relative w-full max-w-sm rounded-2xl bg-white p-5 shadow-xl">
      {/* Close X button */}
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
);


              // end return
}                // ← ADD THIS: closes MatchesPage component

export default MatchesPage;