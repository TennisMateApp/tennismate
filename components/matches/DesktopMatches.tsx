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
import { auth, db } from "@/lib/firebaseConfig";
import { onAuthStateChanged } from "firebase/auth";
import { useRouter, useSearchParams } from "next/navigation";
import Image from "next/image";
import { MessageCircle, X, Search, ArrowRight, Trash2 } from "lucide-react";

import { suggestCourt } from "@/lib/suggestCourt";
import { track } from "@/lib/track";
import PlayerProfileView from "@/components/players/PlayerProfileView";
import TMDesktopSidebar from "@/components/desktop_layout/TMDesktopSidebar";

/* ---------------------------- Helpers (same as mobile) ---------------------------- */

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

type PlayerLite = {
  postcode?: string;
  lat?: number;
  lng?: number;
  photoURL?: string;
  photoThumbURL?: string;
  name?: string;

  skillBand?: string | null;
  skillBandLabel?: string | null;
  skillLevel?: string | null;
  availability?: string[] | null;
};

type ChipTone = "neutral" | "success" | "brand";

const Chip = ({
  tone = "neutral",
  children,
}: {
  tone?: ChipTone;
  children: React.ReactNode;
}) => {
  const toneCls =
    tone === "success"
      ? "bg-green-50 text-green-700 ring-green-200"
      : tone === "brand"
      ? "bg-blue-50 text-blue-700 ring-blue-200"
      : "bg-gray-100 text-gray-700 ring-gray-200";

  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-[3px] text-[11px] leading-[1] ring-1 ${toneCls}`}
    >
      {children}
    </span>
  );
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
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number
): number {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) *
      Math.cos(lat2 * Math.PI / 180) *
      Math.sin(dLon / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return Math.round(R * c);
}

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

// Try multiple collections because some courts live in `booking` not `courts`
async function fetchCourtDocById(dbRef: typeof db, id: string) {
  const cols = ["courts", "booking"];
  for (const col of cols) {
    const snap = await getDoc(doc(dbRef, col, id));
    if (snap.exists()) return snap.data() as any;
  }
  return null;
}

/* -------------------------------- Desktop Component -------------------------------- */

export default function DesktopMatches() {
  const router = useRouter();
  const searchParams = useSearchParams();

  // URL-driven defaults (same behavior as mobile)
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
  const [rematchingId, setRematchingId] = useState<string | null>(null);
  const [requestedRematches, setRequestedRematches] = useState<Record<string, boolean>>({});

  const [chatPrompt, setChatPrompt] = useState<{
    matchId: string;
    otherUserId: string;
    otherName: string;
  } | null>(null);

  const [profileOverlayUserId, setProfileOverlayUserId] = useState<string | null>(null);

  // Close profile modal on Escape
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && profileOverlayUserId) setProfileOverlayUserId(null);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [profileOverlayUserId]);

  // Lock scroll while profile modal open
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

  /* -------------------- Opponent cache ref (avoid stale closures) ------------------- */
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

  /* --------------------------- Court auto-suggestion logic -------------------------- */

  const suggestingRef = useRef<Set<string>>(new Set());

  const computeSuggestionSilently = useCallback(
    async (match: Match) => {
      if (suggestingRef.current.has(match.id)) return;
      suggestingRef.current.add(match.id);

      try {
        if (!myPlayer?.postcode) return;

        const otherId =
          match.playerId === currentUserId ? match.opponentId : match.playerId;
        const oppPostcode = await getOpponentPostcode(otherId);
        if (!oppPostcode) return;

        const myLatLng = await getPostcodeLatLng(myPlayer.postcode);
        const oppLatLng = await getPostcodeLatLng(oppPostcode);
        if (!myLatLng || !oppLatLng) return;

        const res = await suggestCourt(myLatLng, oppLatLng, {
          maxResults: 1,
          searchRadiusKm: 15,
        });

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
    [currentUserId, myPlayer, getOpponentPostcode]
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

  // Hydrate missing court details (accepted only)
  const hydratingRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    const targets = matches
      .filter((m) => {
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
          typeof c.address === "string"
            ? c.address
            : typeof c.location?.address === "string"
            ? c.location.address
            : typeof c.addressLine === "string"
            ? c.addressLine
            : null;

        const lat =
          typeof c.lat === "number"
            ? c.lat
            : typeof c.location?.lat === "number"
            ? c.location.lat
            : null;

        const lng =
          typeof c.lng === "number"
            ? c.lng
            : typeof c.location?.lng === "number"
            ? c.location.lng
            : null;

        const rawBooking =
          c.bookingUrl ??
          c.bookingURL ??
          c.booking_link ??
          c.bookingLink ??
          c.website ??
          c.url ??
          null;

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

  // Auto-suggest courts for accepted matches missing suggestion
  useEffect(() => {
    if (!currentUserId || !myPlayer?.postcode || matches.length === 0) return;

    const candidates = matches
      .filter((m) => isAcceptedStatus(m.status) && !m.suggestedCourtName)
      .slice(0, 3);

    candidates.forEach((m) => computeSuggestionSilently(m));
  }, [matches, currentUserId, myPlayer?.postcode, computeSuggestionSilently]);

  // Ensure postcode coords for me + opponents
  useEffect(() => {
    if (!myPlayer?.postcode) return;

    ensurePostcodeCoords(myPlayer.postcode);

    const opponentPostcodes = new Set<string>();
    matches.forEach((m) => {
      const otherId = m.playerId === currentUserId ? m.opponentId : m.playerId;
      const pc = oppCache[otherId]?.postcode;
      if (pc) opponentPostcodes.add(pc);
    });

    opponentPostcodes.forEach((pc) => ensurePostcodeCoords(pc));
  }, [matches, currentUserId, myPlayer?.postcode, oppCache, ensurePostcodeCoords]);

  // Sync toolbar state to URL (no history spam)
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);

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

  /* -------------------------- Auth + myPlayer load -------------------------- */

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

  // ✅ ADD THESE so TMDesktopSidebar can show skill on this page
  skillLevel: typeof d.skillLevel === "string" ? d.skillLevel : (typeof d.level === "string" ? d.level : null),
  skillBand: typeof d.skillBand === "string" ? d.skillBand : null,
  skillBandLabel: typeof d.skillBandLabel === "string" ? d.skillBandLabel : null,
});
      } catch (e) {
        console.error("Failed to load my player", e);
        setMyPlayer(null);
      }
    })();
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
        console.error("Failed to load desktop match history", error);
        setHistoryMatches([]);
        setHistoryLoading(false);
      }
    );

    return () => unsubHistory();
  }, [currentUserId]);

  /* -------------------------- Subscribe to my matches -------------------------- */

  useEffect(() => {
    if (!currentUserId) return;

    const fromQ = query(collection(db, "match_requests"), where("fromUserId", "==", currentUserId));
    const toQ = query(collection(db, "match_requests"), where("toUserId", "==", currentUserId));

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
    console.error("[TM DesktopMatches] onSnapshot(fromQ) FAILED", {
      code: (err as any)?.code,
      message: (err as any)?.message,
      uid: auth.currentUser?.uid,
      emailVerified: auth.currentUser?.emailVerified,
      projectId: (db as any)?.app?.options?.projectId,
    });
  }
);

const unsubTo = onSnapshot(
  toQ,
  proc,
  (err) => {
    console.error("[TM DesktopMatches] onSnapshot(toQ) FAILED", {
      code: (err as any)?.code,
      message: (err as any)?.message,
      uid: auth.currentUser?.uid,
      emailVerified: auth.currentUser?.emailVerified,
      projectId: (db as any)?.app?.options?.projectId,
    });
  }
);

    return () => {
      unsubFrom();
      unsubTo();
    };
  }, [currentUserId]);

  // Warm opponent cache
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
      if (uid in oppCache) return;

      try {
        const snap = await getDoc(doc(db, "players", uid));
        const d = snap.exists() ? (snap.data() as any) : null;

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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [matches, historyMatches, currentUserId]);

  /* -------------------------- Actions: accept / decline -------------------------- */

  const acceptMatch = async (matchId: string, uid: string) => {
    const prevStatus = matches.find((m) => m.id === matchId)?.status;
    let acceptedPersisted = false;

    try {
      // optimistic
      setMatches((prev) => prev.map((m) => (m.id === matchId ? { ...m, status: "accepted" } : m)));

      const matchRef = doc(db, "match_requests", matchId);
      const snap = await getDoc(matchRef);
      if (!snap.exists()) throw new Error("Match no longer exists");

      const data = snap.data() as any;
      const { fromUserId, toUserId } = data;
      const requestContext = typeof data.requestContext === "string" ? data.requestContext : null;
      const availabilityInstanceId =
        typeof data.availabilityInstanceId === "string" ? data.availabilityInstanceId : null;
      if (uid !== toUserId) throw new Error("Not the recipient");

      await updateDoc(matchRef, { status: "accepted", players: [fromUserId, toUserId] });
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

            const notifQ = query(
              collection(db, "notifications"),
              where("recipientId", "==", toUserId),
              where("matchId", "==", docSnap.id)
            );
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

      try {
        await setDoc(doc(db, "players", toUserId), { badges: arrayUnion("firstMatch") }, { merge: true });
        // TODO: Award the sender's first-match badge from a Cloud Function triggered by match_requests status changing to accepted.
      } catch (badgeError) {
        console.warn("Failed to award local first-match badge after accept:", badgeError);
      }

      // prompt to chat
      const localMatch = matches.find((m) => m.id === matchId);
      if (localMatch) {
        const isMine = localMatch.playerId === uid;
        const otherUserId = isMine ? localMatch.opponentId : localMatch.playerId;
        const cached = oppCache[otherUserId];

        const fallbackName = isMine
          ? localMatch.toName || "your opponent"
          : localMatch.fromName || "your opponent";

        setChatPrompt({
          matchId,
          otherUserId,
          otherName: cached?.name || fallbackName,
        });
      }
    } catch (err) {
      console.error("❌ Error accepting match:", err);
      if (!acceptedPersisted) {
        setMatches((prev) =>
          prev.map((m) => (m.id === matchId ? { ...m, status: prevStatus ?? "pending" } : m))
        );
        alert("Could not accept the request. Please try again.");
      }
    }
  };

 const deleteMatch = useCallback(async (id: string) => {
  if (!confirm("Are you sure you want to delete this request?")) return;
    await deleteDoc(doc(db, "match_requests", id));
    track("match_request_declined", { match_id: id });
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

      // Optional notify (same as mobile)
      await addDoc(collection(db, "notifications"), {
        recipientId: otherUserId,
        toUserId: otherUserId,
        fromUserId: currentUserId,
        matchId: match.id,
        message: `${otherName ? "Match ended." : "A match was ended."}`,
        timestamp: serverTimestamp(),
        read: false,
        type: "match_unmatched",
      });
    } catch (e) {
      console.error("Unmatch failed:", e);
      alert("Could not unmatch right now. Please try again.");
      // Snapshot listeners will re-add if delete failed
    }
  },
  [currentUserId]
);

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
        toUserId: opponentId,
        fromUserId: currentUserId,
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


  /* -------------------------- Sorting helpers -------------------------- */

  const distanceFor = useCallback(
    (m: Match): number | null => {
      try {
        if (
          typeof m.suggestedCourtLat === "number" &&
          typeof m.suggestedCourtLng === "number" &&
          myPlayer &&
          typeof myPlayer.lat === "number" &&
          typeof myPlayer.lng === "number"
        ) {
          return getDistanceFromLatLonInKm(myPlayer.lat, myPlayer.lng, m.suggestedCourtLat, m.suggestedCourtLng);
        }

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

  const accepted = useMemo(() => matches.filter((m) => isAcceptedStatus(m.status)), [matches]);
  const pending = useMemo(() => matches.filter((m) => isPendingStatus(m.status)), [matches]);
  const historyCount = useMemo(() => historyMatches.length, [historyMatches]);

const visibleMatches = useMemo(() => {
  let base: Match[] = tab === "accepted" ? accepted : pending;

  // Direction filter (only meaningful for pending)
  base = base.filter((m) => {
    if (tab === "pending") {
      if (direction === "sent" && m.playerId !== currentUserId) return false;
      if (direction === "received" && m.opponentId !== currentUserId) return false;
    }
    return true;
  });

  // Unread-only
  const byUnread = unreadOnly ? base.filter((m) => m.status === "unread") : base;

    // Search
    const q = queryText.trim().toLowerCase();
    const searched = !q
      ? byUnread
      : byUnread.filter((m) => {
          const a = (m.fromName || "").toLowerCase();
          const b = (m.toName || "").toLowerCase();
          return a.includes(q) || b.includes(q);
        });

    const enriched = searched.map((m) => {
      const createdMs =
        m.createdAt?.toDate ? m.createdAt.toDate().getTime() : m.createdAt ? new Date(m.createdAt).getTime() : 0;
      const dist = distanceFor(m);
      return { m, createdMs, dist };
    });

    enriched.sort((A, B) => {
      if (sortBy === "distance") {
        const a = A.dist ?? Number.POSITIVE_INFINITY;
        const b = B.dist ?? Number.POSITIVE_INFINITY;
        return a - b;
      }
      if (sortBy === "oldest") return A.createdMs - B.createdMs;
      return B.createdMs - A.createdMs;
    });

    return enriched.map((e) => e.m);
}, [tab, accepted, pending, direction, currentUserId, unreadOnly, queryText, sortBy, distanceFor]);

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


  /* -------------------------- Desktop UI derivations -------------------------- */

  // “Today’s Game” = first accepted match (sorted by your current sorting)
  const todaysGame = useMemo(() => {
    const list = accepted
      .map((m) => {
        const createdMs =
          m.createdAt?.toDate ? m.createdAt.toDate().getTime() : m.createdAt ? new Date(m.createdAt).getTime() : 0;
        return { m, createdMs };
      })
      .sort((a, b) => b.createdMs - a.createdMs)
      .map((x) => x.m);

    return list[0] || null;
  }, [accepted]);

  const upcomingGames = useMemo(() => {
    const list = accepted
      .filter((m) => (todaysGame ? m.id !== todaysGame.id : true))
      .slice(0, 6);
    return list;
  }, [accepted, todaysGame]);

  const getOther = useCallback(
    (m: Match) => {
      const isMine = m.playerId === currentUserId;
      const otherId = isMine ? m.opponentId : m.playerId;
      const otherName =
        oppCache[otherId]?.name ?? (isMine ? m.toName || "Opponent" : m.fromName || "Opponent");
      const avatarSrc = oppCache[otherId]?.photoThumbURL || oppCache[otherId]?.photoURL || "";
      const initials = (otherName || "?").trim().charAt(0).toUpperCase();

      const availabilityText =
        Array.isArray(oppCache[otherId]?.availability) && (oppCache[otherId]?.availability?.length || 0) > 0
          ? (oppCache[otherId]?.availability || []).slice(0, 2).join(", ") +
            ((oppCache[otherId]?.availability || []).length > 2
              ? ` +${(oppCache[otherId]?.availability || []).length - 2}`
              : "")
          : "—";

      const distance = distanceFor(m);

      return { otherId, otherName, avatarSrc, initials, availabilityText, distance };
    },
    [currentUserId, oppCache, distanceFor]
  );

  const openChat = useCallback(
    (otherId: string) => {
      if (!currentUserId) return;
      const sortedIDs = [currentUserId, otherId].sort().join("_");
      router.push(`/messages/${sortedIDs}`);
    },
    [currentUserId, router]
  );

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
    const resultTone: ChipTone = history.winnerId ? (won ? "success" : "neutral") : "brand";
    const summaryLine = `${formatHistoryDate(history.completedAt, history.playedDate)} · ${formatMatchType(history.matchType)}`;
    const detailsHref = `/matches/history/${history.id}`;
    const rematchRequested = !!requestedRematches[history.id];

    return (
      <div
        key={history.id}
        className="rounded-3xl border border-black/10 bg-white p-5 shadow-sm"
      >
        <div className="flex items-start gap-4">
          <div className="relative h-14 w-14 shrink-0 overflow-hidden rounded-full bg-black/5">
            {avatarSrc ? (
              <Image
                src={avatarSrc}
                alt={otherName}
                fill
                sizes="56px"
                className="object-cover"
              />
            ) : (
              <div className="grid h-full w-full place-items-center text-base font-extrabold text-black/45">
                {initials}
              </div>
            )}
          </div>

          <div className="min-w-0 flex-1">
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0">
                <div className="truncate text-base font-extrabold text-black">
                  {otherName}
                </div>
                <div className="mt-1 text-sm text-black/55">{summaryLine}</div>
                {history.location ? (
                  <div className="mt-1 truncate text-sm text-black/40">{history.location}</div>
                ) : null}
              </div>

              <div className="shrink-0 text-right">
                <Chip tone={resultTone}>{resultLabel}</Chip>
                <div className="mt-2 text-sm font-extrabold text-black/80">
                  {history.score?.trim() || "No score"}
                </div>
              </div>
            </div>

            <div className="mt-5 flex items-center justify-between gap-3">
              <button
                type="button"
                onClick={() => router.push(detailsHref)}
                className="inline-flex items-center gap-1.5 text-sm font-semibold text-black/55 hover:text-black/80"
              >
                Match Details
                <ArrowRight className="h-4 w-4" />
              </button>

              <button
                type="button"
                onClick={() => handleRequestRematch(history)}
                disabled={rematchRequested || rematchingId === history.id}
                className="rounded-full px-4 py-2 text-sm font-extrabold text-[#0B3D2E] disabled:bg-black/5 disabled:text-black/35"
                style={rematchRequested || rematchingId === history.id ? undefined : { background: "#39FF14" }}
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
      </div>
    );
  }, [currentUserId, handleRequestRematch, oppCache, rematchingId, requestedRematches, router]);

  /* ----------------------------------- RENDER ----------------------------------- */

  const TM = {
    forest: "#0B3D2E",
    neon: "#39FF14",
    bg: "#F7FAF8",
    ink: "#0F172A",
  };

  const userName = myPlayer?.name ?? "Me";
  const levelLabel =
    myPlayer?.skillBandLabel ||
    myPlayer?.skillLevel ||
    (typeof myPlayer?.skillBand === "string" ? myPlayer?.skillBand : null) ||
    "—";

  const avatarUrl = myPlayer?.photoThumbURL || myPlayer?.photoURL || null;

  return (
    <div className="min-h-screen" style={{ background: TM.bg }}>
      <div className="w-full px-8 2xl:px-12 py-8">
        <div className="grid gap-8 2xl:gap-10 xl:grid-cols-[300px_1fr]">
          {/* Sidebar (MATCHES DASHBOARD) */}
          <TMDesktopSidebar
            active="Chat"
            player={{
              name: userName,
              skillLevel: levelLabel,
              photoURL: avatarUrl,
              photoThumbURL: avatarUrl,
              avatar: avatarUrl,
            }}
          />

          {/* Main */}
          <main className="min-w-0 xl:pr-[460px] 2xl:pr-[520px]">
            <div className="mt-2 grid gap-8 2xl:gap-10">
              {/* LEFT COLUMN */}
              <section className="min-w-0">
                {/* Header row */}
                <div className="flex items-start justify-between gap-6">
                  <div>
                    <div className="flex items-center gap-3">
                      <div className="text-[22px] font-black tracking-tight text-gray-900">
                        Match Center
                      </div>

                      <span
                        className="rounded-full px-3 py-1 text-xs font-extrabold"
                        style={{
                          background: "rgba(11,61,46,0.10)",
                          border: "1px solid rgba(11,61,46,0.18)",
                          color: TM.forest,
                        }}
                      >
                        {tab === "accepted"
                          ? accepted.length
                          : tab === "history"
                          ? historyCount
                          : pending.length}{" "}
                        {tab === "accepted"
                          ? "matches"
                          : tab === "history"
                          ? "results"
                          : "requests"}
                      </span>
                    </div>

                    <div className="mt-1 text-[12px] text-gray-600">
                      Manage your confirmed games, pending requests, and match history.
                    </div>
                  </div>

                  <div className="flex items-center gap-3">
                    <div className="relative w-[360px]">
                      <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-black/40" />
                      <input
                        value={queryText}
                        onChange={(e) => setQueryText(e.target.value)}
                        placeholder="Search matches…"
                        className="h-10 w-full rounded-full bg-white pl-10 pr-4 text-sm ring-1 ring-black/10 focus:outline-none focus:ring-2 focus:ring-[#39FF14]"
                      />
                    </div>

                    <button
                      type="button"
                      onClick={() => {
                        track("desktop_find_a_match_clicked", { source: "match_center" });
                        router.push("/match");
                      }}
                      className="h-10 rounded-full px-4 text-sm font-extrabold text-[#0B3D2E]"
                      style={{ background: "#39FF14" }}
                    >
                      <span className="inline-flex items-center gap-2">
                        <ArrowRight className="h-4 w-4" /> Find a Match
                      </span>
                    </button>
                  </div>
                </div>

                <div className="mt-6 flex items-center gap-8 border-b border-black/10">
                  <button
                    className={`pb-3 text-sm font-semibold ${
                      tab === "accepted"
                        ? "text-[#0B3D2E] border-b-2 border-[#39FF14]"
                        : "text-black/40"
                    }`}
                    onClick={() => setTab("accepted")}
                  >
                    <span className="inline-flex items-center gap-2">
                      Confirmed Matches
                      <span
                        className="inline-flex h-5 min-w-[22px] items-center justify-center rounded-full px-2 text-[11px] font-extrabold"
                        style={{
                          background: tab === "accepted" ? "#39FF14" : "rgba(11,61,46,0.10)",
                          color: "#0B3D2E",
                          border: "1px solid rgba(11,61,46,0.18)",
                        }}
                      >
                        {accepted.length}
                      </span>
                    </span>
                  </button>

                  <button
                    className={`pb-3 text-sm font-semibold ${
                      tab === "pending"
                        ? "text-[#0B3D2E] border-b-2 border-[#39FF14]"
                        : "text-black/40"
                    }`}
                    onClick={() => setTab("pending")}
                  >
                    <span className="inline-flex items-center gap-2">
                      Pending Requests
                      <span
                        className="inline-flex h-5 min-w-[22px] items-center justify-center rounded-full px-2 text-[11px] font-extrabold"
                        style={{
                          background: tab === "pending" ? "#39FF14" : "rgba(11,61,46,0.10)",
                          color: "#0B3D2E",
                          border: "1px solid rgba(11,61,46,0.18)",
                        }}
                      >
                        {pending.length}
                      </span>
                    </span>
                  </button>

                  <button
                    className={`pb-3 text-sm font-semibold ${
                      tab === "history"
                        ? "text-[#0B3D2E] border-b-2 border-[#39FF14]"
                        : "text-black/40"
                    }`}
                    onClick={() => setTab("history")}
                  >
                    <span className="inline-flex items-center gap-2">
                      Match History
                      <span
                        className="inline-flex h-5 min-w-[22px] items-center justify-center rounded-full px-2 text-[11px] font-extrabold"
                        style={{
                          background: tab === "history" ? "#39FF14" : "rgba(11,61,46,0.10)",
                          color: "#0B3D2E",
                          border: "1px solid rgba(11,61,46,0.18)",
                        }}
                      >
                        {historyCount}
                      </span>
                    </span>
                  </button>
                </div>

                {/* Content */}
                {isTabLoading ? (
                  <div className="mt-6 space-y-4">
                    <div className="h-[180px] rounded-3xl bg-white/70 ring-1 ring-black/10 animate-pulse" />
                    <div className="h-[220px] rounded-3xl bg-white/70 ring-1 ring-black/10 animate-pulse" />
                  </div>
                ) : tab === "accepted" ? (
                  <div className="mt-6">
                    {visibleMatches.length === 0 ? (
                      <div className="rounded-3xl bg-white ring-1 ring-black/10 p-6 text-sm text-black/55">
                        No confirmed matches yet.
                      </div>
                    ) : (
                      <div className="grid grid-cols-3 2xl:grid-cols-4 gap-6">
                        {visibleMatches.map((m) => {
                          const o = getOther(m);

                          const pc = oppCache[o.otherId]?.postcode || "—";

                          const skill =
                            oppCache[o.otherId]?.skillBandLabel ||
                            oppCache[o.otherId]?.skillLevel ||
                            (typeof oppCache[o.otherId]?.skillBand === "string"
                              ? oppCache[o.otherId]?.skillBand
                              : "") ||
                            "—";

                          const skillLabel = String(skill).toUpperCase().includes("LEVEL")
                            ? String(skill)
                            : `LEVEL ${String(skill)}`.toUpperCase();

                          return (
                            <div
                              key={m.id}
                              className="relative rounded-3xl bg-white ring-1 ring-black/10 shadow-sm overflow-hidden"
                            >
                              <div className="p-5">
                                <div className="relative w-full aspect-square overflow-visible">
                                  <button
                                    type="button"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      unmatchMatch(m, o.otherName, o.otherId);
                                    }}
                                    className="absolute right-2 top-2 z-20 h-9 w-9 rounded-full grid place-items-center bg-white/95 text-red-700 ring-1 ring-black/10 shadow-md hover:bg-white"
                                    aria-label="Unmatch"
                                    title="Unmatch"
                                  >
                                    <Trash2 className="h-4 w-4" />
                                  </button>

                                  <div className="absolute inset-0 overflow-hidden rounded-2xl bg-black/5">
                                    {o.avatarSrc ? (
                                      <Image
                                        src={o.avatarSrc}
                                        alt={o.otherName}
                                        fill
                                        sizes="(min-width: 1536px) 260px, (min-width: 1280px) 240px, 100vw"
                                        className="object-cover"
                                      />
                                    ) : (
                                      <div className="h-full w-full grid place-items-center text-3xl font-extrabold text-black/40">
                                        {o.initials}
                                      </div>
                                    )}
                                  </div>
                                </div>

                                <div className="mt-4 flex items-center justify-between gap-3">
                                  <div className="min-w-0 font-extrabold text-[#0B3D2E] truncate">
                                    {o.otherName}
                                  </div>
                                  <div className="text-xs font-semibold text-black/40">{pc}</div>
                                </div>

                                <div className="mt-2">
                                  <span
                                    className="inline-flex items-center rounded-full px-3 py-1 text-[11px] font-extrabold text-[#0B3D2E]"
                                    style={{ background: "#39FF14" }}
                                  >
                                    {skillLabel}
                                  </span>
                                </div>

                                <div className="mt-3 space-y-1 text-xs text-black/60">
                                  <div className="flex items-center gap-2 min-w-0">
                                    <span className="shrink-0">📅</span>
                                    <span className="truncate">
                                      {o.availabilityText !== "—"
                                        ? o.availabilityText
                                        : "Availability not set"}
                                    </span>
                                  </div>

                                  <div className="flex items-center gap-2">
                                    <span className="shrink-0">📍</span>
                                    <span>
                                      {typeof o.distance === "number"
                                        ? `${o.distance.toFixed(1)} km away`
                                        : "— km away"}
                                    </span>
                                  </div>
                                </div>

                                <div className="mt-4 flex items-center gap-3">
                                  <button
                                    type="button"
                                    onClick={() => openChat(o.otherId)}
                                    className="h-10 flex-1 rounded-full text-sm font-extrabold text-[#0B3D2E]"
                                    style={{ background: "#39FF14" }}
                                  >
                                    Open chat
                                  </button>

                                  <button
                                    type="button"
                                    onClick={() => {
                                      track("view_profile_clicked_from_matches_desktop", {
                                        match_id: m.id,
                                        other_user_id: o.otherId,
                                        status: m.status,
                                      });
                                      handleViewProfile(o.otherId);
                                    }}
                                    className="h-10 flex-1 rounded-full text-sm font-extrabold bg-white text-[#0B3D2E] ring-1 ring-black/20 hover:bg-black/5"
                                  >
                                    View Profile
                                  </button>
                                </div>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                ) : tab === "pending" ? (
                  // PENDING
                  <div className="mt-6">
                    {visibleMatches.length === 0 ? (
                      <div className="rounded-3xl bg-white ring-1 ring-black/10 p-6 text-sm text-black/55">
                        No pending requests.
                      </div>
                    ) : (
                      <div className="grid grid-cols-3 2xl:grid-cols-4 gap-6">
                        {visibleMatches.map((m) => {
                          const isMine = m.playerId === currentUserId;
                          const otherId = isMine ? m.opponentId : m.playerId;

                          const otherName =
                            oppCache[otherId]?.name ??
                            (isMine ? m.toName || "Opponent" : m.fromName || "Opponent");

                          const avatarSrc =
                            oppCache[otherId]?.photoThumbURL ||
                            oppCache[otherId]?.photoURL ||
                            "";

                          const initials = (otherName || "?").trim().charAt(0).toUpperCase();
                          const pc = oppCache[otherId]?.postcode || "—";

                          const skill =
                            oppCache[otherId]?.skillBandLabel ||
                            oppCache[otherId]?.skillLevel ||
                            (typeof oppCache[otherId]?.skillBand === "string"
                              ? oppCache[otherId]?.skillBand
                              : "") ||
                            "—";

                          const skillLabel = String(skill).toUpperCase().includes("LEVEL")
                            ? String(skill)
                            : `LEVEL ${String(skill)}`.toUpperCase();

                          const availabilityText =
                            Array.isArray(oppCache[otherId]?.availability) &&
                            (oppCache[otherId]?.availability?.length || 0) > 0
                              ? (oppCache[otherId]?.availability || []).slice(0, 2).join(", ") +
                                ((oppCache[otherId]?.availability || []).length > 2
                                  ? ` +${(oppCache[otherId]?.availability || []).length - 2}`
                                  : "")
                              : "Availability not set";

                          const canAccept = m.opponentId === currentUserId;

                          return (
                            <div
                              key={m.id}
                              className="relative rounded-3xl bg-white ring-1 ring-black/10 shadow-sm overflow-hidden"
                            >
                              <div className="p-5">
                                <div className="relative w-full aspect-square overflow-visible">
                                  <button
                                    type="button"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      deleteMatch(m.id);
                                    }}
                                    className="absolute right-2 top-2 z-20 h-9 w-9 rounded-full grid place-items-center bg-white/95 text-black/70 ring-1 ring-black/10 shadow-md hover:bg-white"
                                    aria-label="Delete request"
                                    title="Delete request"
                                  >
                                    <Trash2 className="h-4 w-4" />
                                  </button>

                                  <div className="absolute inset-0 overflow-hidden rounded-2xl bg-black/5">
                                    {avatarSrc ? (
                                      <Image
                                        src={avatarSrc}
                                        alt={otherName}
                                        fill
                                        sizes="(min-width: 1536px) 260px, (min-width: 1280px) 240px, 100vw"
                                        className="object-cover"
                                      />
                                    ) : (
                                      <div className="h-full w-full grid place-items-center text-3xl font-extrabold text-black/40">
                                        {initials}
                                      </div>
                                    )}
                                  </div>
                                </div>

                                <div className="mt-4 flex items-center justify-between gap-3">
                                  <div className="min-w-0 font-extrabold text-[#0B3D2E] truncate">
                                    {otherName}
                                  </div>
                                  <div className="text-xs font-semibold text-black/40">{pc}</div>
                                </div>

                                <div className="mt-2">
                                  <span
                                    className="inline-flex items-center rounded-full px-3 py-1 text-[11px] font-extrabold text-[#0B3D2E]"
                                    style={{ background: "#39FF14" }}
                                  >
                                    {skillLabel}
                                  </span>
                                </div>

                                <div className="mt-3 space-y-1 text-xs text-black/60">
                                  <div className="flex items-center gap-2 min-w-0">
                                    <span className="shrink-0">💬</span>
                                    <span className="truncate">
                                      {m.message
                                        ? m.message
                                        : isMine
                                        ? "Request sent"
                                        : "Request received"}
                                    </span>
                                  </div>

                                  <div className="flex items-center gap-2 min-w-0">
                                    <span className="shrink-0">📅</span>
                                    <span className="truncate">{availabilityText}</span>
                                  </div>
                                </div>

                                <div className="mt-4 flex items-center gap-3">
                                  <button
                                    type="button"
                                    onClick={() => handleViewProfile(otherId)}
                                    className="h-10 flex-1 rounded-full text-sm font-extrabold bg-white text-[#0B3D2E] ring-1 ring-black/20 hover:bg-black/5"
                                  >
                                    View Profile
                                  </button>

                                  {canAccept ? (
                                    <button
                                      type="button"
                                      onClick={() =>
                                        currentUserId && acceptMatch(m.id, currentUserId)
                                      }
                                      className="h-10 flex-1 rounded-full text-sm font-extrabold text-[#0B3D2E]"
                                      style={{ background: "#39FF14" }}
                                    >
                                      Accept
                                    </button>
                                  ) : (
                                    <button
                                      type="button"
                                      disabled
                                      className="h-10 flex-1 rounded-full text-sm font-extrabold bg-black/5 text-black/40"
                                    >
                                      Pending…
                                    </button>
                                  )}
                                </div>

                                {canAccept && (
                                  <button
                                    type="button"
                                    onClick={() => deleteMatch(m.id)}
                                    className="mt-3 h-10 w-full rounded-full text-sm font-extrabold bg-black/5 text-black/70 hover:bg-black/10"
                                  >
                                    Decline
                                  </button>
                                )}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="mt-6">
                    {visibleHistoryMatches.length === 0 ? (
                      <div className="rounded-3xl bg-white ring-1 ring-black/10 p-6 text-sm text-black/55">
                        No past matches yet.
                      </div>
                    ) : (
                      <div className="space-y-4">
                        {visibleHistoryMatches.map((m) => renderHistoryMatch(m))}
                      </div>
                    )}
                  </div>
                )}

                {/* 🎾 Chat prompt modal (UNCHANGED) */}
                {chatPrompt && currentUserId && (
                  <div className="fixed inset-0 z-[10000] flex items-center justify-center bg-black/40 px-4">
                    <div className="relative w-full max-w-sm rounded-2xl bg-white p-5 shadow-xl">
                      <button
                        onClick={() => setChatPrompt(null)}
                        aria-label="Close"
                        className="absolute right-3 top-3 rounded-full p-1 text-black/40 hover:text-black/60 hover:bg-black/5"
                      >
                        <X className="h-4 w-4" />
                      </button>

                      <div className="text-center">
                        <p className="text-[11px] font-semibold tracking-[0.16em] text-[#0B3D2E] uppercase">
                          Match accepted
                        </p>
                        <h2 className="mt-1 text-lg font-extrabold text-black">
                          Rally ready with {chatPrompt.otherName}! 🎾
                        </h2>
                        <p className="mt-2 text-sm text-black/60">
                          Send a quick message to lock in the time, day, and court.
                        </p>
                      </div>

                      <div className="mt-5 flex justify-center">
                        <button
                          onClick={() => {
                            const sortedIDs = [currentUserId, chatPrompt.otherUserId]
                              .sort()
                              .join("_");
                            setChatPrompt(null);
                            router.push(`/messages/${sortedIDs}`);
                          }}
                          className="h-11 rounded-full px-6 text-sm font-extrabold text-[#0B3D2E]"
                          style={{ background: "#39FF14" }}
                        >
                          <span className="inline-flex items-center gap-2">
                            <MessageCircle className="h-4 w-4" />
                            Send a message
                          </span>
                        </button>
                      </div>
                    </div>
                  </div>
                )}

                {/* ✅ Profile overlay modal (UNCHANGED) */}
                {profileOverlayUserId && (
                  <div className="fixed inset-0 z-[12000]">
                    <div
                      className="absolute inset-0 bg-black/60"
                      onMouseDown={() => setProfileOverlayUserId(null)}
                    />
                    <div className="absolute inset-0 flex items-center justify-center p-6">
                      <div
                        className="w-full max-w-[860px] rounded-2xl shadow-2xl overflow-hidden"
                        style={{ background: "#071B15" }}
                        onMouseDown={(e) => e.stopPropagation()}
                      >
                        <div
                          className="h-full min-h-0"
                          style={{
                            height: "min(88dvh, 860px)",
                            maxHeight: "min(88dvh, 860px)",
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
              </section>

              {/* RIGHT RAIL (MATCHES DASHBOARD FIXED ASIDE) */}
              <aside
                className="
                  min-w-0
                  xl:fixed xl:top-8 xl:right-8 2xl:right-12
                  xl:w-[420px] 2xl:w-[480px]
                  xl:max-h-[calc(100vh-4rem)]
                  xl:overflow-auto
                "
              >
                <div className="rounded-3xl border border-black/10 bg-white p-7 2xl:p-8">
                  <div className="text-sm font-extrabold text-black/85">Filters</div>

                  <div className="mt-5 space-y-4">
                    <div>
                      <div className="text-xs font-extrabold tracking-wide text-black/50">
                        Sort
                      </div>
                      <select
                        value={sortBy}
                        onChange={(e) => setSortBy(e.target.value as any)}
                        className="mt-2 w-full rounded-2xl border border-black/10 bg-white px-3 py-2 text-sm"
                      >
                        <option value="recent">Most recent</option>
                        <option value="oldest">Oldest</option>
                        <option value="distance">Closest</option>
                      </select>
                    </div>

                    <div>
                      <div className="text-xs font-extrabold tracking-wide text-black/50">
                        Direction
                      </div>
                      <select
                        value={direction}
                        onChange={(e) => setDirection(e.target.value as any)}
                        className="mt-2 w-full rounded-2xl border border-black/10 bg-white px-3 py-2 text-sm"
                        disabled={tab !== "pending"}
                        title={tab !== "pending" ? "Only applies to pending requests" : ""}
                      >
                        <option value="all">All</option>
                        <option value="received">Received</option>
                        <option value="sent">Sent</option>
                      </select>
                    </div>

                    <label className="flex items-center gap-2 text-sm text-black/70">
                      <input
                        type="checkbox"
                        className="accent-[#39FF14]"
                        checked={unreadOnly}
                        onChange={(e) => setUnreadOnly(e.target.checked)}
                      />
                      Unread only
                    </label>
                  </div>
                </div>

                <div className="mt-6 rounded-3xl border border-black/10 bg-white p-7 2xl:p-8">
                  <div className="text-xs font-extrabold tracking-widest text-black/45">
                    COUNTS
                  </div>
                    <div className="mt-3 grid grid-cols-3 gap-3">
                      <div className="rounded-2xl bg-black/5 p-4">
                        <div className="text-xs font-extrabold text-black/50">Confirmed</div>
                        <div className="mt-1 text-2xl font-extrabold text-black/90">
                          {accepted.length}
                        </div>
                    </div>

                      <div className="rounded-2xl bg-black/5 p-4">
                        <div className="text-xs font-extrabold text-black/50">Pending</div>
                        <div className="mt-1 text-2xl font-extrabold text-black/90">
                          {pending.length}
                        </div>
                      </div>

                      <div className="rounded-2xl bg-black/5 p-4">
                        <div className="text-xs font-extrabold text-black/50">History</div>
                        <div className="mt-1 text-2xl font-extrabold text-black/90">
                          {historyCount}
                        </div>
                      </div>
                    </div>
                </div>
              </aside>
            </div>
          </main>
        </div>
      </div>
    </div>
  );

}
