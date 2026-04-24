'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import MatchCheckInOverlay from "../../components/matches/MatchCheckInOverlay";
import {
  Swords,
  CalendarDays,
  MapPin,
  GraduationCap,
  ChevronRight,
} from 'lucide-react';
import { useEffect, useState, useRef } from 'react';
import Image from 'next/image';
import { auth, db } from '@/lib/firebaseConfig';
import {
  collection,
  onSnapshot, // ✅ ADD THIS
  query,
  where,
  limit,
  getDocs,
  getDoc,
  doc,
  updateDoc,
  serverTimestamp,
} from "firebase/firestore";
import NotificationBell from "@/components/notifications/NotificationBell";
import DesktopDashboardHome from "@/components/home/DesktopDashboardHome";

import { GiTennisBall } from "react-icons/gi";
import { onAuthStateChanged } from "firebase/auth";
import { useIsDesktop } from "@/lib/useIsDesktop";
import { Capacitor } from "@capacitor/core";
import InviteOverlayCard from "@/components/invites/InviteOverlayCard";
import PlayerProfileView from "@/components/players/PlayerProfileView";
import { trackEvent } from "@/lib/mixpanel";
import { resolveSmallProfilePhoto } from "@/lib/profilePhoto";
import { getNearbyPlayers } from "@/lib/nearbyPlayersClient";


const TM = {
  forest: '#0B3D2E',
  neon: '#39FF14',
  bg: '#F7FAF8',
};

const matchAccent = "#16A34A"; // main green

// ✅ unify card neutrals so green doesn't clash with cool grey
const CARD_BG = "#F3F8F4";      // warm green-tinted neutral (replaces #F5F7F9)
const CARD_BORDER = "rgba(11,61,46,0.10)"; // subtle forest-tinted border
const CARD_SHAPE_1 = "rgba(11,61,46,0.04)"; // subtle forest blobs
const CARD_SHAPE_2 = "rgba(57,255,20,0.08)"; // subtle neon blobs

function cn(...classes: (string | false | undefined | null)[]) {
  return classes.filter(Boolean).join(' ');
}

function Pill({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center rounded-full border border-black/10 bg-white px-2 py-0.5 text-[11px] font-semibold tracking-wide text-black/60">
      {children}
    </span>
  );
}


function ActionTile({
  title,
  subtitle,
  icon,
  onClick,
}: {
  title: string;
  subtitle: string;
  icon: React.ReactNode;
  onClick: () => void;
}) {

  return (
    <button
      onClick={onClick}
     className={cn(
  "group relative w-full overflow-hidden rounded-3xl border text-left transition",
  "active:scale-[0.985] focus:outline-none focus:ring-2 focus:ring-offset-2",
  "border-emerald-900/15 bg-emerald-900 text-white focus:ring-[#39FF14]/40"
)}
    >
      {/* soft sheen */}
      <div className="pointer-events-none absolute inset-0 bg-gradient-to-b from-white/10 to-transparent" />

      {/* subtle blobs */}
      <div className="pointer-events-none absolute -right-10 -top-10 h-36 w-36 rounded-full bg-white/5" />
      <div
        className="pointer-events-none absolute -right-14 top-10 h-44 w-44 rounded-full"
        style={{ background: "rgba(57,255,20,0.08)" }}
      />

      <div className="relative p-5">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-start gap-3">
            <div
              className="rounded-2xl border border-white/15 bg-white/10 p-2.5"
            >
              {icon}
            </div>

            <div className="min-w-0">
              <div className="text-base font-extrabold tracking-tight">{title}</div>
           <div className="mt-1 text-sm text-white/75">{subtitle}</div>
            </div>
          </div>

   <ChevronRight className="mt-1 h-5 w-5 text-white/60 transition group-hover:translate-x-0.5" />

        </div>

        <div className="mt-4 flex items-center gap-2">
          <div className="h-1.5 w-10 rounded-full" style={{ background: TM.neon }} />
        <div className="text-xs font-semibold text-white/70">Open</div>
        </div>
      </div>
    </button>
  );
}


const LAST_ACTIVE_WRITE_KEY = "tm_lastActiveWriteAt";
const LAST_ACTIVE_THROTTLE_MS = 10 * 60 * 1000; // 10 minutes

async function touchLastActive(uid: string) {
  try {
    const last =
  typeof window !== "undefined"
    ? Number(localStorage.getItem(LAST_ACTIVE_WRITE_KEY) || "0")
    : 0;
    if (Date.now() - last < LAST_ACTIVE_THROTTLE_MS) return;

    await updateDoc(doc(db, "players", uid), {
      lastActiveAt: serverTimestamp(),
    });

 if (typeof window !== "undefined") {
  localStorage.setItem(LAST_ACTIVE_WRITE_KEY, String(Date.now()));
}

  } catch (e) {
    console.warn("[Home] touchLastActive failed:", e);
  }
}

function getDistanceFromLatLonInKm(lat1:number, lon1:number, lat2:number, lon2:number) {
  const R = 6371;
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

const ACTIVE_RADIUS_KM = 10;
const ACTIVE_LOOKBACK_DAYS = 7;
const ACTIVE_LOOKBACK_HOURS = ACTIVE_LOOKBACK_DAYS * 24;
const MAX_BOUND_READS = 60;   // max docs per geohash bound query (read safety)
const MAX_ACTIVE_AVATARS = 10;

// -----------------------
// Nearby Active cache
// -----------------------
const NEARBY_ACTIVE_CACHE_KEY = "tm_nearbyActive_v3";
const NEARBY_ACTIVE_CACHE_TTL_MS = 10 * 60 * 1000; // 10 minutes



type NearbyActiveCache = {
  savedAt: number; // Date.now()
  uid: string;
  radiusKm: number;
  lookbackHours: number;
  data: ActivePlayer[];
};

function loadNearbyActiveCache(uid: string): ActivePlayer[] | null {
  if (typeof window === "undefined") return null;

  try {
    const raw = localStorage.getItem(NEARBY_ACTIVE_CACHE_KEY);
    if (!raw) return null;

    const parsed = JSON.parse(raw) as NearbyActiveCache;

    // invalidate if wrong user or settings changed
    if (parsed.uid !== uid) return null;
    if (parsed.radiusKm !== ACTIVE_RADIUS_KM) return null;
    if (parsed.lookbackHours !== ACTIVE_LOOKBACK_HOURS) return null;

    // invalidate if expired
    if (Date.now() - parsed.savedAt > NEARBY_ACTIVE_CACHE_TTL_MS) return null;

    return Array.isArray(parsed.data) ? parsed.data : null;
  } catch {
    return null;
  }
}

function saveNearbyActiveCache(uid: string, data: ActivePlayer[]) {
  if (typeof window === "undefined") return;

  const payload: NearbyActiveCache = {
    savedAt: Date.now(),
    uid,
    radiusKm: ACTIVE_RADIUS_KM,
    lookbackHours: ACTIVE_LOOKBACK_HOURS,
    data,
  };

  try {
    localStorage.setItem(NEARBY_ACTIVE_CACHE_KEY, JSON.stringify(payload));
  } catch {
    // ignore storage errors
  }
}

// -----------------------
// Next Events cache
// -----------------------
const NEXT_EVENTS_CACHE_KEY = "tm_nextEvents_v1";
const NEXT_EVENTS_CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

type NextEventsCache = {
  savedAt: number;
  uid: string;
  data: CalendarEvent[];
};

function loadNextEventsCache(uid: string): CalendarEvent[] | null {
  if (typeof window === "undefined") return null;

  try {
    const raw = localStorage.getItem(NEXT_EVENTS_CACHE_KEY);
    if (!raw) return null;

    const parsed = JSON.parse(raw) as NextEventsCache;

    if (parsed.uid !== uid) return null;
    if (Date.now() - parsed.savedAt > NEXT_EVENTS_CACHE_TTL_MS) return null;

    return Array.isArray(parsed.data) ? parsed.data : null;
  } catch {
    return null;
  }
}

function saveNextEventsCache(uid: string, data: CalendarEvent[]) {
  if (typeof window === "undefined") return;

  try {
    const payload: NextEventsCache = {
      savedAt: Date.now(),
      uid,
      data,
    };

    localStorage.setItem(NEXT_EVENTS_CACHE_KEY, JSON.stringify(payload));
  } catch {
    // ignore storage errors
  }
}

// -----------------------
// Opponent profile cache (localStorage) - name + avatar
// -----------------------
const OPP_PROFILE_CACHE_KEY = "tm_opponentProfile_v6";
const OPP_PROFILE_CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

type OpponentProfile = {
  name?: string;
  photoThumbURL?: string | null;
  photoURL?: string | null;      // players.photoURL
  avatar?: string | null;        // optional fallback
};


type OpponentProfileCache = {
  savedAt: number; // Date.now()
  data: Record<string, OpponentProfile>; // uid -> profile bits
};

function loadOpponentProfileCache(): Record<string, OpponentProfile> {
  if (typeof window === "undefined") return {};
  try {
    const raw = localStorage.getItem(OPP_PROFILE_CACHE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as OpponentProfileCache;

    if (!parsed?.savedAt || Date.now() - parsed.savedAt > OPP_PROFILE_CACHE_TTL_MS) {
      return {};
    }

    return parsed?.data && typeof parsed.data === "object" ? parsed.data : {};
  } catch {
    return {};
  }
}

function saveOpponentProfileCache(data: Record<string, OpponentProfile>) {
  if (typeof window === "undefined") return;
  const payload: OpponentProfileCache = { savedAt: Date.now(), data };
  try {
    localStorage.setItem(OPP_PROFILE_CACHE_KEY, JSON.stringify(payload));
  } catch {
    // ignore
  }
}



function toDateSafe(ts: any): Date | null {
  if (!ts) return null;
  if (typeof ts?.toDate === "function") return ts.toDate();
  if (ts instanceof Date) return ts;
  const d = new Date(ts);
  return Number.isFinite(d.getTime()) ? d : null;
}

type CalendarEvent = {
  id: string;
  title?: string | null;
  start?: string | null;        // ✅ ISO string like your calendar page
  end?: string | null;
  location?: string | null;
  courtName?: string | null;
  status?: string | null;
  eventId?: string | null;      // ✅ used by /events/${eventId} in your calendar page
   type?: string | null;         // "event" | "invite" (recommended)
  inviteId?: string | null;     // points to match_invites/{inviteId}
  source?: string | null;       // optional: "invite"
  conversationId?: string | null; // optional: if you stored it
  messageId?: string | null;      // optional: if you stored it
};

function isoToMs(iso?: string | null): number {
  if (!iso) return 0;
  const t = new Date(iso).getTime();
  return Number.isFinite(t) ? t : 0;
}

function formatWhenFromISO(iso?: string | null) {
  if (!iso) return "Time TBD";
  const d = new Date(iso);
  return d.toLocaleString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function getOpponentUidFromParticipants(e: any, myUid: string | null): string | null {
  const parts: string[] = Array.isArray(e?.participants) ? e.participants : [];
  if (!myUid) return parts[0] || null;
  return parts.find((pid) => pid && pid !== myUid) || null;
}

function getNextMatchHref(e: any): string | null {
  if (!e) return "/calendar";

  // ✅ Same invite routing as desktop
  if (e?.source === "cf:syncCalendarOnInviteAccepted" && e?.messageId) {
    return `/invites/${e.messageId}`;
  }

  // ✅ If you ever store inviteId directly, support it too
  if ((e?.type === "invite" || String(e?.source ?? "").includes("invite")) && e?.inviteId) {
    return `/invites/${e.inviteId}`;
  }

  // ✅ Normal event
  if (e?.eventId) return `/events/${e.eventId}`;

  // 🚫 IMPORTANT: do NOT fall back to /events/{docId}
  // because invites live in calendar_events too and will 404 as an event.
  return "/calendar";
}

function getInviteIdFromCalendarEvent(e: any): string | null {
  if (!e) return null;

  // direct invite id if you stored it
  if (typeof e?.inviteId === "string" && e.inviteId) {
    return e.inviteId;
  }

  // your synced invite calendar items appear to use messageId as the route id
  if (e?.source === "cf:syncCalendarOnInviteAccepted" && typeof e?.messageId === "string" && e.messageId) {
    return e.messageId;
  }

  // fallback if type/source marks it as invite
  if (
    (e?.type === "invite" || String(e?.source ?? "").includes("invite")) &&
    typeof e?.messageId === "string" &&
    e.messageId
  ) {
    return e.messageId;
  }

  return null;
}

function formatStartLikeCard(iso?: string | null) {
  if (!iso) return "Time TBD";
  const d = new Date(iso);

  const time = d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });

  const today = new Date();
  const isToday =
    d.getFullYear() === today.getFullYear() &&
    d.getMonth() === today.getMonth() &&
    d.getDate() === today.getDate();

  if (isToday) return `Today, ${time}`;

  const day = d.toLocaleDateString(undefined, { weekday: "short" });
  return `${day}, ${time}`;
}

type ActivePlayer = {
  id: string;
  name?: string;
  photoURL?: string | null;
  photoThumbURL?: string | null;
  avatar?: string | null;
  lastActiveAt?: any;
};

async function loadNearbyActivePlayers(uid: string): Promise<ActivePlayer[]> {
  const response = await getNearbyPlayers({
    radiusKm: ACTIVE_RADIUS_KM,
    activeWithinHours: ACTIVE_LOOKBACK_HOURS,
    limit: MAX_BOUND_READS,
  });

  return response.players
    .map((p) => ({
      id: p.uid,
      name: p.name,
      photoThumbURL: p.photoThumbURL ?? null,
      photoURL: p.photoURL ?? null,
      avatar: p.photoThumbURL ?? p.photoURL ?? null,
      lastActiveAt: p.lastActiveAt ?? null,
    }))
    .sort((a, b) => {
      const aMs = toDateSafe(a.lastActiveAt)?.getTime() ?? 0;
      const bMs = toDateSafe(b.lastActiveAt)?.getTime() ?? 0;
      return bMs - aMs;
    });
}

function getOtherUserId(m: any, myUid: string) {
  if (m.fromUserId === myUid) return m.toUserId;
  if (m.toUserId === myUid) return m.fromUserId;
  return null;
}

function getOpponentName(m: any, myUid: string) {
  // If I sent it, opponent is the "to" side
  if (m.fromUserId === myUid) {
    return m.toName || m.toUserName || m.toDisplayName || null;
  }

  // If I received it, opponent is the "from" side
  if (m.toUserId === myUid) {
    return m.fromName || m.fromUserName || m.fromDisplayName || null;
  }

  return null;
}

function TempDidPlayOverlay({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/40 px-4"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="w-full max-w-md rounded-3xl bg-white p-6 shadow-2xl">
        <div className="text-xl font-extrabold text-black">Test overlay</div>
        <div className="mt-2 text-sm text-black/60">
          If you can see this, the home page overlay rendering is fine.
        </div>

        <button
          type="button"
          onClick={onClose}
          className="mt-4 rounded-2xl px-4 py-3 text-sm font-extrabold"
          style={{ background: "#39FF14", color: "#0B3D2E" }}
        >
          Close
        </button>
      </div>
    </div>
  );
}


export default function TennisMateHomeReferenceStyle() {

  const router = useRouter();
  const searchParams = useSearchParams();

const [showDidPlayOverlay, setShowDidPlayOverlay] = useState(false);
const [didPlayConversationId, setDidPlayConversationId] = useState<string | null>(null);

const isDesktop = useIsDesktop(1024);
const isApp = Capacitor.isNativePlatform();
const showDesktopWeb = !isApp && isDesktop;

  const [userName, setUserName] = useState('Player');
  const [levelLabel, setLevelLabel] = useState('AMATEUR');
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);

  const [homeBootstrapping, setHomeBootstrapping] = useState(true);

  const [uid, setUid] = useState<string | null>(null);
  const [openInviteId, setOpenInviteId] = useState<string | null>(null);

  const [openPlayerId, setOpenPlayerId] = useState<string | null>(null);
const [openPlayerCanMessage, setOpenPlayerCanMessage] = useState(false);

const homeTrackedRef = useRef(false);
  
  const [nearbyActive, setNearbyActive] = useState<ActivePlayer[]>([]);
const [nearbyActiveLoading, setNearbyActiveLoading] = useState(true);
const [myMatches, setMyMatches] = useState<any[]>([]);
const [myMatchesLoading, setMyMatchesLoading] = useState(true);
const [myCalendarEvents, setMyCalendarEvents] = useState<CalendarEvent[]>([]);
const [myCalendarEventsLoading, setMyCalendarEventsLoading] = useState(true);
const [oppByUid, setOppByUid] = useState<Record<string, OpponentProfile>>(() => loadOpponentProfileCache());
const fetchingNamesRef = useRef<Set<string>>(new Set());

const oppByUidRef = useRef<Record<string, OpponentProfile>>({});
useEffect(() => {
  oppByUidRef.current = oppByUid;
}, [oppByUid]);

useEffect(() => {
  console.log("[HOME FLAGS]", {
    innerWidth: typeof window !== "undefined" ? window.innerWidth : null,
    isDesktop,
    isApp,
    showDesktopWeb,
    platform: Capacitor.getPlatform?.() ?? "unknown",
    isNative: Capacitor.isNativePlatform?.() ?? "unknown",
  });
}, [isDesktop, isApp, showDesktopWeb]);


useEffect(() => {
  if (!uid) return;

  const authUser = auth.currentUser;

  void touchLastActive(uid);

  // fast fallback while Firestore loads
  setUserName(authUser?.displayName || "Player");
  setAvatarUrl(null);

  const unsub = onSnapshot(
    doc(db, "players", uid),
    (snap) => {
      if (!snap.exists()) return;

      const p: any = snap.data();

      const playerName =
        typeof p.name === "string" && p.name.trim()
          ? p.name.trim()
          : null;

      const resolvedPhoto = resolveSmallProfilePhoto(p);

      const skill =
        (typeof p.skillLevel === "string" && p.skillLevel) ||
        (typeof p.level === "string" && p.level) ||
        (typeof p.ntrp === "string" && p.ntrp) ||
        null;

      if (playerName) setUserName(playerName);
      setAvatarUrl(resolvedPhoto || null);

      if (skill) {
        setLevelLabel(String(skill).toUpperCase());
      }
    },
    (e) => {
      console.warn("[Home] Failed to subscribe to player header:", e);
    }
  );

  return () => unsub();
}, [uid]);


useEffect(() => {
  const unsub = onAuthStateChanged(auth, (user) => {
    setUid(user?.uid ?? null);
  });
  return () => unsub();
}, []);

useEffect(() => {
  const overlay = searchParams.get("overlay");
  const conversationId = searchParams.get("conversationId");

  if (overlay === "didPlayPrompt" && conversationId) {
    setDidPlayConversationId(conversationId);
    setShowDidPlayOverlay(true);
  }
}, [searchParams]);

useEffect(() => {
  if (!uid) return;

  const lastTracked = sessionStorage.getItem("home_last_tracked");
  const now = Date.now();

  // 5 min cooldown (adjust if needed)
  if (lastTracked && now - Number(lastTracked) < 5 * 60 * 1000) {
    return;
  }

  sessionStorage.setItem("home_last_tracked", String(now));

  trackEvent("home_page_opened", {
    userId: uid,
    platform: Capacitor.isNativePlatform() ? "native" : "web",
    isDesktopWeb: showDesktopWeb,
  });
}, [uid, showDesktopWeb]);

useEffect(() => {
  if (!uid) return;

  let alive = true;

  (async () => {
    try {
      setMyMatchesLoading(true);

      const statusesToShow = ["unread", "pending", "accepted"];
      const baseLimit = 10;

      const qIncoming = query(
        collection(db, "match_requests"),
        where("toUserId", "==", uid),
        where("status", "in", statusesToShow),
        limit(baseLimit)
      );

      const qOutgoing = query(
        collection(db, "match_requests"),
        where("fromUserId", "==", uid),
        where("status", "in", statusesToShow),
        limit(baseLimit)
      );

      const [incomingSnap, outgoingSnap] = await Promise.all([
        getDocs(qIncoming),
        getDocs(qOutgoing),
      ]);

      if (!alive) return;

      const map = new Map<string, any>();
      incomingSnap.docs.forEach((d) => map.set(d.id, { id: d.id, ...d.data() }));
      outgoingSnap.docs.forEach((d) => map.set(d.id, { id: d.id, ...d.data() }));

      const rows = Array.from(map.values());

      rows.sort((a, b) => {
        const aMs = a.updatedAt?.toMillis?.() ?? a.createdAt?.toMillis?.() ?? 0;
        const bMs = b.updatedAt?.toMillis?.() ?? b.createdAt?.toMillis?.() ?? 0;
        return bMs - aMs;
      });

      const topRows = rows.slice(0, baseLimit);

      // ✅ Render matches immediately (no flash)
      setMyMatches(topRows);

      // ✅ stop skeleton once we have the rows
      setMyMatchesLoading(false);

      // ✅ Fetch missing names WITHOUT re-triggering this effect
      const opponentIds = Array.from(
        new Set(
          topRows
            .map((m) => getOtherUserId(m, uid))
            .filter(Boolean)
        )
      ) as string[];

const existing = oppByUidRef.current;

const missing = opponentIds.filter((id) => {
  const cached = existing[id];

 const hasName = !!cached?.name;
 const hasPhoto = !!(cached?.photoThumbURL || cached?.photoURL || cached?.avatar);


  // ✅ fetch if we are missing EITHER name OR photo
  if (hasName && hasPhoto) return false;

  if (fetchingNamesRef.current.has(id)) return false;
  return true;
});



// mark as in-flight
missing.forEach((id) => fetchingNamesRef.current.add(id));


      if (!missing.length) return;

const fetched: Record<string, OpponentProfile> = {};

try {
  await Promise.all(
    missing.map(async (otherUid) => {
      // ✅ SOURCE OF TRUTH: players doc
      const pSnap = await getDoc(doc(db, "players", otherUid));

      if (!pSnap.exists()) {
        fetched[otherUid] = { name: undefined, photoThumbURL: null, photoURL: null, avatar: null };
        return;
      }

      const p: any = pSnap.data();
      const resolvedPhoto = resolveSmallProfilePhoto(p);

      fetched[otherUid] = {
        name: typeof p.name === "string" ? p.name : undefined,
        photoThumbURL: resolvedPhoto,
        photoURL: typeof p.photoURL === "string" ? p.photoURL : null,
        avatar: resolvedPhoto,
      };
    })
  );
} finally {
  // ✅ always clear in-flight flags even if one read fails
  missing.forEach((id) => fetchingNamesRef.current.delete(id));
}




      if (!alive) return;

      // ✅ Merge into state; DOES NOT re-run this effect now
setOppByUid((prev) => {
  const next = { ...prev, ...fetched };
  saveOpponentProfileCache(next);
  return next;
});


    } catch (e) {
      console.warn("[Home] load my matches failed:", e);
      if (!alive) return;
      setMyMatches([]);
      setMyMatchesLoading(false);
    }
  })();

  return () => {
    alive = false;
  };
}, [uid]); // ✅ ONLY depends on uid

useEffect(() => {
  if (!uid) return;
  if (!myCalendarEvents.length) return;

  // collect opponent ids from calendar events
  const opponentIds = Array.from(
    new Set(
      myCalendarEvents
        .map((ev: any) => getOpponentUidFromParticipants(ev, uid))
        .filter(Boolean)
    )
  ) as string[];

  if (!opponentIds.length) return;

  const existing = oppByUidRef.current;

  // only fetch missing opponent profiles (name OR photo missing)
  const missing = opponentIds.filter((id) => {
    const cached = existing[id];
    const hasName = !!cached?.name;
    const hasPhoto = !!(cached?.photoThumbURL || cached?.photoURL || cached?.avatar);

    if (hasName && hasPhoto) return false;
    if (fetchingNamesRef.current.has(id)) return false;
    return true;
  });

  // mark as in-flight
  missing.forEach((id) => fetchingNamesRef.current.add(id));

  if (!missing.length) return;

  let cancelled = false;

  (async () => {
    const fetched: Record<string, OpponentProfile> = {};

    try {
      await Promise.all(
        missing.map(async (otherUid) => {
          try {
            const pSnap = await getDoc(doc(db, "players", otherUid));
            if (!pSnap.exists()) {
              fetched[otherUid] = { name: undefined, photoThumbURL: null, photoURL: null, avatar: null };
              return;
            }

            const p: any = pSnap.data();
      const resolvedPhoto = resolveSmallProfilePhoto(p);
            fetched[otherUid] = {
              name: typeof p.name === "string" ? p.name : undefined,
              photoThumbURL: resolvedPhoto,
              photoURL: typeof p.photoURL === "string" ? p.photoURL : null,
              avatar: resolvedPhoto,
            };
          } catch {
            fetched[otherUid] = { name: undefined, photoThumbURL: null, photoURL: null, avatar: null };
          }
        })
      );
    } finally {
      missing.forEach((id) => fetchingNamesRef.current.delete(id));
    }

    if (cancelled) return;

    setOppByUid((prev) => {
      const next = { ...prev, ...fetched };
      saveOpponentProfileCache(next);
      return next;
    });
  })();

  return () => {
    cancelled = true;
  };
}, [uid, myCalendarEvents]);

useEffect(() => {
  if (!uid) return;

  let alive = true;
  let offCalendar: (() => void) | null = null;

  setHomeBootstrapping(true);

  // -----------------------
  // Instant paint from cache: nearby active
  // -----------------------
  const cachedNearby = loadNearbyActiveCache(uid);
  if (cachedNearby) {
    setNearbyActive(cachedNearby);
    setNearbyActiveLoading(false);
  } else {
    setNearbyActive([]);
    setNearbyActiveLoading(true);
  }

  // -----------------------
  // Instant paint from cache: next events
  // -----------------------
  const cachedEvents = loadNextEventsCache(uid);
  if (cachedEvents) {
    setMyCalendarEvents(cachedEvents);
    setMyCalendarEventsLoading(false);
  } else {
    setMyCalendarEvents([]);
    setMyCalendarEventsLoading(true);
  }

  // -----------------------
  // Start real-time calendar immediately
  // -----------------------
  const qRef = query(
    collection(db, "calendar_events"),
    where("ownerId", "==", uid)
  );

  offCalendar = onSnapshot(
    qRef,
    (snap) => {
      if (!alive) return;

      const all = snap.docs.map((d) => ({ id: d.id, ...d.data() } as any));
      const now = Date.now();

      const upcoming = all
        .filter((e) => isoToMs(e?.start) >= now)
        .sort((a, b) => isoToMs(a?.start) - isoToMs(b?.start))
        .slice(0, 10);

      setMyCalendarEvents(upcoming);
      saveNextEventsCache(uid, upcoming);
      setMyCalendarEventsLoading(false);
    },
    (err) => {
      console.warn("[Home] calendar snapshot failed:", err);
      if (!alive) return;

      setMyCalendarEvents([]);
      setMyCalendarEventsLoading(false);
    }
  );

  // -----------------------
  // Fetch nearby active fresh in background
  // -----------------------
  (async () => {
    try {
      const players = await loadNearbyActivePlayers(uid);
      if (!alive) return;

      setNearbyActive(players);
      saveNearbyActiveCache(uid, players);
    } catch (e) {
      console.warn("[Home] loadNearbyActivePlayers failed:", e);
      if (!alive) return;

      if (!cachedNearby) {
        setNearbyActive([]);
      }
    } finally {
      if (alive) {
        setNearbyActiveLoading(false);
        setHomeBootstrapping(false);
      }
    }
  })();

  return () => {
    alive = false;
    if (offCalendar) offCalendar();
  };
}, [uid]);

function openConversationWithPlayer(otherUid: string) {
  if (!uid || !otherUid) return;

  const conversationId = [uid, otherUid].sort().join("_");
  router.push(`/messages/${conversationId}`);
}

function closeDidPlayOverlay() {
  setShowDidPlayOverlay(false);
  setDidPlayConversationId(null);

  const params = new URLSearchParams(searchParams.toString());
  params.delete("overlay");
  params.delete("conversationId");

  const next = params.toString() ? `/?${params.toString()}` : "/";
  router.replace(next);
}

const nextEvent = myCalendarEvents?.[0] ?? null;

// ✅ DESKTOP WEB (not app) layout
if (showDesktopWeb) {
  console.log("[HOME -> DESKTOP PROPS]", {
    myCalendarEventsLoading,
    myCalendarEventsCount: myCalendarEvents?.length ?? 0,
    firstEvent: myCalendarEvents?.[0] ?? null,
  });

  return (
       <DesktopDashboardHome
      userName={userName}
      levelLabel={levelLabel}
      avatarUrl={avatarUrl}
      myMatches={myMatches}
      myMatchesLoading={myMatchesLoading}
      oppByUid={oppByUid}
      uid={uid}
      router={router}
      nearbyActive={nearbyActive}
      nearbyActiveLoading={nearbyActiveLoading}
      myCalendarEvents={myCalendarEvents}
      myCalendarEventsLoading={myCalendarEventsLoading}
      homeBootstrapping={homeBootstrapping}
    />
  );
}

  // ✅ MOBILE / APP layout (your existing layout MUST be returned)
  return (
    <div className="min-h-screen bg-white">
      <div className="mx-auto max-w-lg px-4 py-5">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            {/* Avatar */}
            <div className="relative">
              <div className="relative h-12 w-12 overflow-hidden rounded-2xl border border-black/10 bg-white">
                {avatarUrl ? (
                  <>
                    <div className="absolute inset-0 animate-pulse bg-gray-200" />
                    <Image
                      src={avatarUrl}
                      alt="Profile"
                      fill
                      sizes="48px"
                      className="object-cover"
                      priority
                    />
                  </>
                ) : (
                  <div className="flex h-full w-full items-center justify-center text-black/30">
                    <div className="h-6 w-6 rounded-full border border-black/10" />
                  </div>
                )}
              </div>

              <div
                className="absolute -bottom-1 -right-1 h-4 w-4 rounded-full border-2 border-white"
                style={{ background: TM.neon }}
              />
            </div>

            <div>
              <div className="text-sm font-extrabold text-black/85">
                Hello, {userName}!
              </div>
              <div className="text-[11px] font-semibold tracking-widest text-black/45">
                {levelLabel}
              </div>
            </div>
          </div>

          <NotificationBell />
        </div>

{/* Active near you */}
<div className="mt-4">
  <div className="mb-2 text-sm font-extrabold text-black/85">
    Active near you
  </div>

  <div className="px-1">
    {nearbyActiveLoading ? (
      <div className="space-y-3">
        <div className="h-5 w-44 rounded bg-black/5 animate-pulse" />
        <div className="h-10 w-full rounded bg-black/5 animate-pulse" />
      </div>
    ) : nearbyActive.length > 0 ? (
      <>
        <Pill>
          <span
            className="mr-2 inline-block h-2 w-2 rounded-full"
            style={{ background: TM.neon }}
          />
          {nearbyActive.length} active within 10km
        </Pill>

        <div className="mt-2 flex -space-x-2">
  {nearbyActive.slice(0, MAX_ACTIVE_AVATARS).map((p) => {
    const src = p.photoThumbURL || p.photoURL || p.avatar || null;
    const initial = (p.name || "?").trim().charAt(0).toUpperCase();

    return (
      <div
        key={p.id}
        className="relative h-9 w-9 overflow-hidden rounded-full ring-2 ring-white bg-gray-100"
        title={p.name || "Player"}
      >
        {src ? (
          <Image
            src={src}
            alt={p.name || "Player"}
            fill
            sizes="40px"
            className="object-cover"
          />
        ) : (
          <div className="grid h-full w-full place-items-center text-[11px] text-gray-600">
            {initial}
          </div>
        )}
      </div>
    );
  })}

  {/* +X overflow indicator */}
  {nearbyActive.length > MAX_ACTIVE_AVATARS && (
    <div className="relative h-9 w-9 rounded-full ring-2 ring-white bg-black/5 grid place-items-center text-xs font-extrabold text-black/60">
      +{nearbyActive.length - MAX_ACTIVE_AVATARS}
    </div>
  )}
</div>

      </>
    ) : (
      <>
        <div className="text-lg font-extrabold text-black/90">
          No active players nearby
        </div>
        <div className="mt-1 text-sm text-black/60">
          We’ll show players here when they’ve been active recently within 10km.
        </div>
      </>
    )}
  </div>
</div>

{/* Next Match (single card like reference) */}
<div className="mt-6">
  <div className="mb-2 flex items-center justify-between">
    <div className="text-sm font-extrabold text-black/85">Next Game</div>

    <button
      onClick={() => router.push("/calendar")}
      className="text-xs font-extrabold tracking-wide"
      style={{ color: matchAccent }}
    >
      VIEW ALL
    </button>
  </div>

  {myCalendarEventsLoading ? (
    <div className="h-[124px] w-full rounded-3xl bg-black/5 animate-pulse" />
  ) : nextEvent ? (
    (() => {
      const otherUid = getOpponentUidFromParticipants(nextEvent as any, uid);
      const opp = otherUid ? oppByUid[otherUid] : null;

      const opponentName = opp?.name || "Opponent";
      const opponentPhoto = opp?.photoThumbURL || opp?.photoURL || opp?.avatar || null;

      const whenLabel = formatStartLikeCard(nextEvent.start);
      const whereLabel = nextEvent.courtName || nextEvent.location || "Court TBA";
      const href = getNextMatchHref(nextEvent as any);
      const inviteId = getInviteIdFromCalendarEvent(nextEvent as any);
const isInvite = !!inviteId;

      return (
        <div
          className="relative overflow-hidden rounded-3xl border p-4"
        style={{
  borderColor: CARD_BORDER,
  background: CARD_BG,
  color: "#0F172A",
}}
        >
          <div className="pointer-events-none absolute inset-0 bg-gradient-to-b from-white/80 to-transparent" />
          <div
  className="pointer-events-none absolute -right-12 -top-12 h-40 w-40 rounded-full"
  style={{ background: CARD_SHAPE_1 }}
/>

          <div className="relative flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div
                className="inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-extrabold tracking-widest"
                style={{
                  background: "rgba(22,163,74,0.12)",
                  color: matchAccent,
                  border: "1px solid rgba(22,163,74,0.25)",
                }}
              >
                UPCOMING
              </div>

              <div className="mt-2 text-[18px] font-extrabold truncate">
                {opponentName}
              </div>

              <div className="mt-1 text-xs font-semibold text-black/60 truncate">
                {whereLabel} · {whenLabel}
              </div>
            </div>

            <div className="relative h-12 w-12 shrink-0 overflow-hidden rounded-full ring-2 ring-white/70 bg-white">
              {opponentPhoto ? (
                <Image
                  src={opponentPhoto}
                  alt={opponentName}
                  fill
                  sizes="48px"
                  className="object-cover"
                />
              ) : (
                <div className="grid h-full w-full place-items-center text-[14px] font-extrabold text-black/60">
                  {(opponentName || "O").trim().charAt(0).toUpperCase()}
                </div>
              )}
            </div>
          </div>

<button
  type="button"
  onClick={() => {
    if (isInvite && inviteId) {
      setOpenInviteId(inviteId);
      return;
    }

    if (href) {
      router.push(href);
      return;
    }

    router.push("/calendar");
  }}
  className="mt-4 w-full rounded-2xl px-4 py-3 text-sm font-extrabold"
  style={{ background: matchAccent, color: "white" }}
>
  View Details ›
</button>
        </div>
      );
    })()
  ) : (
    <div className="rounded-3xl border border-black/10 bg-white p-4">
      <div className="text-sm font-extrabold text-black/85">No upcoming matches</div>
      <div className="mt-1 text-sm text-black/60">
        Join or host an event and it’ll appear here.
      </div>

      <button
        onClick={() => router.push("/events")}
        className="mt-3 inline-flex items-center gap-2 rounded-2xl px-4 py-2 text-xs font-extrabold"
        style={{ background: TM.neon, color: TM.forest }}
      >
        Browse events
      </button>
    </div>
  )}
</div>

{/* My Matches (horizontal scroll) */}
<div className="mt-6">
  <div className="mb-2 flex items-center justify-between">
    <div className="text-sm font-extrabold text-black/85">My TennisMates</div>

    <button
      onClick={() => router.push("/matches")}
      className="text-xs font-extrabold tracking-wide"
      style={{ color: matchAccent }}
    >
      VIEW ALL
    </button>
  </div>

  {myMatchesLoading ? (
    <div className="flex gap-3 overflow-x-auto pb-2 snap-x snap-mandatory [-webkit-overflow-scrolling:touch] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden px-1">

      {[...Array(3)].map((_, i) => (
        <div
          key={i}
          className="min-w-[240px] h-[104px] rounded-3xl bg-black/5 animate-pulse snap-start"
        />
      ))}
    </div>
  ) : myMatches.length > 0 ? (
    <div className="flex gap-3 overflow-x-auto pb-2 snap-x snap-mandatory [-webkit-overflow-scrolling:touch] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden px-1">

      {myMatches.slice(0, 10).map((m) => {
        // Basic safe fields — adjust once we confirm your schema:
const myUid = uid; // ✅ use uid state
const otherUserId = myUid ? getOtherUserId(m, myUid) : null;

// ✅ 1) prefer correct side-specific name from the doc
// ✅ 2) otherwise fallback to fetched lookup cache
const directName = myUid ? getOpponentName(m, myUid) : null;
const cached = otherUserId ? oppByUid[otherUserId] : null;
const cachedName = cached?.name || null;
const cachedPhoto = cached?.photoThumbURL || cached?.photoURL || cached?.avatar || null;



const isWaitingForName = false; // or remove the skeleton block entirely


const opponentName = directName || cachedName || "Player";


        const status =
          (typeof m.status === "string" ? m.status : "pending").toUpperCase();

        return (
         <button
  key={m.id}
  onClick={() => {
  if (!otherUserId) return;

  setOpenPlayerId(otherUserId);
  setOpenPlayerCanMessage(
    ["accepted", "confirmed"].includes(String(m.status || "").toLowerCase())
  );
}}
  className="group relative min-w-[240px] overflow-hidden rounded-3xl border text-left transition active:scale-[0.985] snap-start"
style={{
  borderColor: CARD_BORDER,
  background: CARD_BG,
  color: "#0F172A",
}}
>

           {/* subtle light sheen */}
<div className="pointer-events-none absolute inset-0 bg-gradient-to-b from-white/80 to-transparent" />

{/* subtle grey shapes */}
<div
  className="pointer-events-none absolute -right-10 -top-10 h-32 w-32 rounded-full"
  style={{ background: CARD_SHAPE_1 }}
/>
<div
  className="pointer-events-none absolute -right-16 top-8 h-40 w-40 rounded-full"
  style={{ background: CARD_SHAPE_2 }}
/>


            <div className="relative p-4 pb-5">
  {/* pill */}
 <div
  className="inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-extrabold tracking-widest"
  style={{
    background: "rgba(22,163,74,0.12)",
    color: matchAccent,
    border: "1px solid rgba(22,163,74,0.25)",
  }}
>
  {status}
</div>


  {/* ✅ opponent name (no placeholder flash) */}
{isWaitingForName ? (
  <div className="mt-2 h-4 w-32 rounded bg-white/10 animate-pulse" />
) : (
  <div className="mt-2 flex items-center justify-between gap-3">
    {/* LEFT: name (where avatar used to be) */}
    <div className="min-w-0 flex-1">
      <div className="text-sm font-extrabold truncate">{opponentName}</div>
    </div>

    {/* RIGHT: big avatar (fills tile more) */}
    <div className="relative h-[72px] w-[72px] shrink-0 overflow-hidden rounded-2xl bg-white/10 ring-2 ring-white/15">
      {cachedPhoto ? (
        <Image
          src={cachedPhoto}
          alt={opponentName}
          fill
          sizes="64px"
          className="object-cover"
        />
      ) : (
        <div className="grid h-full w-full place-items-center text-lg font-extrabold text-white/70">
          {(opponentName || "P").trim().charAt(0).toUpperCase()}
        </div>
      )}
    </div>
  </div>
)}



<div className="mt-2 flex items-center gap-2 text-xs text-black/60">
  <GiTennisBall className="h-4 w-4" style={{ color: matchAccent }} />
  <span>Tap to view profile</span>
          </div>
        </div>


            {/* neon underline */}
            <div className="h-1.5 w-full" style={{ background: matchAccent, opacity: 0.9 }} />

          </button>
        );
      })}
    </div>
  ) : (
    <div className="rounded-3xl border border-black/10 bg-white p-4">
      <div className="text-sm font-extrabold text-black/85">
        No matches yet
      </div>
      <div className="mt-1 text-sm text-black/60">
        Start matching and your pending & accepted matches will show up here.
      </div>

      <button
        onClick={() => router.push("/match")}
        className="mt-3 inline-flex items-center gap-2 rounded-2xl px-4 py-2 text-xs font-extrabold"
        style={{ background: TM.neon, color: TM.forest }}
      >
        Find a match
      </button>
    </div>
  )}
</div>


        {/* Quick Actions */}
        <div className="mt-6">
          <div className="mb-2 text-sm font-extrabold text-black/85">Quick Actions</div>

          <div className="grid grid-cols-2 gap-3">
<ActionTile
  title="Match Me"
  subtitle="Find a partner now"
  icon={<Swords className="h-5 w-5" style={{ color: TM.neon }} />}
  onClick={() => router.push('/match')}
/>


<ActionTile
  title="Events"
  subtitle="Games & social hits"
  icon={<CalendarDays className="h-5 w-5" style={{ color: TM.neon }} />}
  onClick={() => router.push('/events')}
/>



<ActionTile
  title="Courts"
  subtitle="Find courts near you"
  icon={<MapPin className="h-5 w-5" style={{ color: TM.neon }} />}
  onClick={() => router.push('/courts')}
/>



<ActionTile
  title="Coaches"
  subtitle="Level up your game"
  icon={<GraduationCap className="h-5 w-5" style={{ color: TM.neon }} />}
  onClick={() => router.push('/coaches')}
/>


          </div>
        </div>
      </div>

      {openPlayerId && (
  <div className="fixed inset-0 z-[999]">
    <div
      className="absolute inset-0 bg-black/40"
      onMouseDown={() => setOpenPlayerId(null)}
    />

    <div className="absolute inset-0 flex items-center justify-center p-4">
      <div
        className="w-full max-w-[560px] rounded-2xl overflow-hidden shadow-2xl"
        style={{ background: "#071B15" }}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div
          className="relative"
          style={{
            height: "min(88dvh, 820px)",
            maxHeight: "min(88dvh, 820px)",
          }}
        >
          <PlayerProfileView
            playerId={openPlayerId}
            onClose={() => setOpenPlayerId(null)}
          />

          {openPlayerCanMessage && (
            <div className="absolute bottom-0 left-0 right-0 p-4 bg-gradient-to-t from-black/35 to-transparent pointer-events-none">
              <div className="pointer-events-auto">
                <button
                  type="button"
                  onClick={() => {
                    const playerId = openPlayerId;
                    setOpenPlayerId(null);
                    if (playerId) openConversationWithPlayer(playerId);
                  }}
                  className="w-full rounded-2xl px-4 py-3 text-sm font-extrabold"
                  style={{
                    background: TM.neon,
                    color: TM.forest,
                  }}
                >
                  Send Message
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  </div>
)}

{openInviteId && (
  <div className="fixed inset-0 z-[999]">
    <div
      className="absolute inset-0 bg-black/40"
      onMouseDown={() => setOpenInviteId(null)}
    />

    <div className="absolute inset-0 flex items-center justify-center p-4">
      <div
        className="w-[900px] max-w-[95vw] h-[85vh] rounded-2xl overflow-hidden shadow-2xl bg-white border border-slate-200"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-4 py-3 border-b border-slate-200 bg-slate-50">
          <div className="text-sm font-bold text-slate-900">Match Invite</div>

          <button
            type="button"
            onClick={() => setOpenInviteId(null)}
            className="rounded-lg px-3 py-1.5 text-xs font-semibold border border-slate-200 bg-white hover:bg-slate-100"
          >
            Close
          </button>
        </div>

        <InviteOverlayCard
          inviteId={openInviteId}
          onClose={() => setOpenInviteId(null)}
        />
      </div>

    </div>
  </div>
)}

<MatchCheckInOverlay
  open={showDidPlayOverlay}
  conversationId={didPlayConversationId}
  currentUserId={uid}
  onClose={closeDidPlayOverlay}
/>
    </div>
  );
}
