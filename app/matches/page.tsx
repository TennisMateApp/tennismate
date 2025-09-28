"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
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
} from "firebase/firestore";
import { auth, db } from "@/lib/firebase";
import { onAuthStateChanged } from "firebase/auth";
import { useRouter } from "next/navigation";
import {
  Trash2,
  MessageCircle,
  Check,
  X,
  ArrowRight,
  Clock,
  Loader2, 
} from "lucide-react";
import { GiTennisBall } from "react-icons/gi";
import Link from "next/link";


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
  createdAt?: any;
  started?: boolean;
  startedAt?: any;
};

type PCMap = Record<string, { lat: number; lng: number }>;
type PlayerLite = { postcode?: string; lat?: number; lng?: number; skillLevel?: string };

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


function MatchesPage() {
  const [direction, setDirection] = useState<"all" | "received" | "sent">("all");
  const [matches, setMatches] = useState<Match[]>([]);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [tab, setTab] = useState<"pending" | "accepted">("pending");
  const router = useRouter();
  const [queryText, setQueryText] = useState("");
  const [startingId, setStartingId] = useState<string | null>(null);
  const [myPlayer, setMyPlayer] = useState<PlayerLite | null>(null);
  const [postcodeCoords, setPostcodeCoords] = useState<PCMap>({});
  const [oppCache, setOppCache] = useState<Record<string, PlayerLite | null>>({});


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
      // me
      const me = await getDoc(doc(db, "players", currentUserId));
      if (me.exists()) {
        const d = me.data() as any;
        setMyPlayer({ postcode: d.postcode, lat: d.lat, lng: d.lng, skillLevel: d.skillLevel }); // lat/lng optional
      } else {
        setMyPlayer(null);
      }

      // postcode coords (same collection you use on /match)
      const pcSnap = await getDocs(collection(db, "postcodes"));
      const map: PCMap = {};
      pcSnap.forEach((p) => { map[p.id] = p.data() as { lat: number; lng: number }; });
      setPostcodeCoords(map);
    } catch (e) {
      console.error("Failed to load player/coords:", e);
    }
  })();
}, [currentUserId]);


  // Listen for match requests
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

    const all: Record<string, Match> = {};
   const proc = (snap: QuerySnapshot<DocumentData>) => {
  let updated = false;

  // ⬇️ add this block
  snap.docChanges().forEach((chg) => {
    if (chg.type === "removed" && all[chg.doc.id]) {
      delete all[chg.doc.id];
      updated = true;
    }
  });

  snap.docs.forEach((d) => {
    const data = d.data();
    const m: Match = {
      id: d.id,
      playerId: data.fromUserId,
      opponentId: data.toUserId,
      court: data.court,
      time: data.time,
      status: data.status,
      message: data.message,
      fromName: data.fromName,
      toName: data.toName,
      suggestedCourtName: data.suggestedCourtName,
      suggestedCourtLat: data.suggestedCourtLat,
      suggestedCourtLng: data.suggestedCourtLng,
      createdAt: data.createdAt ?? data.timestamp,
      started: data.started,
      startedAt: data.startedAt,
    };

    const prev = all[d.id];
    if (!prev || prev.status !== m.status || prev.started !== m.started) {
      all[d.id] = m;
      updated = true;
    }
  });

  if (updated) setMatches(Object.values(all));
};

    const unsubFrom = onSnapshot(fromQ, proc);
    const unsubTo = onSnapshot(toQ, proc);
    return () => { unsubFrom(); unsubTo(); };
  }, [currentUserId]);

  // Accept a match and award badge
  const acceptMatch = async (matchId: string, currentUserId: string) => {
    try {
      const matchRef = doc(db, "match_requests", matchId);
      const snap = await getDoc(matchRef);
      if (!snap.exists()) return;

      const { fromUserId, toUserId } = snap.data();
      if (currentUserId !== toUserId) return;

      // Mark accepted
      await updateDoc(matchRef, {
        status: "accepted",
        players: [fromUserId, toUserId],
      });

      // Award first match badge
      await setDoc(
        doc(db, "players", toUserId),
        { badges: arrayUnion("firstMatch") },
        { merge: true }
      );
      await setDoc(
  doc(db, "players", fromUserId),
  { badges: arrayUnion("firstMatch") },
  { merge: true }
);
    } catch (err) {
      console.error("❌ Error accepting match:", err);
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


const handleCompleteGame = useCallback((match: Match) => {
  router.push(`/matches/${match.id}/complete/details`);
}, [router]);

const deleteMatch = useCallback(async (id: string) => {
  if (!confirm("Delete this match?")) return;
  await deleteDoc(doc(db, "match_requests", id));
  setMatches((prev) => prev.filter((m) => m.id !== id));
}, []);


  // Chat logic omitted for brevity

const renderMatch = useCallback(
  (match: Match) => {
    const isMine = match.playerId === currentUserId;
    const isRec  = match.opponentId === currentUserId && match.status !== "accepted";
    const other  = isMine ? match.opponentId : match.playerId;
    const profileHref = `/players/${other}`;
    const initiator = isMine ? "You" : match.fromName;
    const recipient = isMine ? match.toName : "You";
    const inProgress = match.status === "accepted" && !!match.started;

    const created =
      match.createdAt?.toDate
        ? match.createdAt.toDate()
        : match.createdAt
        ? new Date(match.createdAt)
        : null;

        // add this after `const created = ...`
const startedAt =
  match.startedAt?.toDate
    ? match.startedAt.toDate()
    : match.startedAt
    ? new Date(match.startedAt)
    : null;

    const opp = oppCache[other];

    // ---- Distance (prefer exact court lat/lng; fallback to postcode→coords) ----
let distanceKm: number | null = null;

try {
  // A) If match has a suggested court with lat/lng AND I have my lat/lng:
  if (
    typeof match.suggestedCourtLat === "number" &&
    typeof match.suggestedCourtLng === "number" &&
    myPlayer &&
    typeof myPlayer.lat === "number" &&
    typeof myPlayer.lng === "number"
  ) {
    distanceKm = getDistanceFromLatLonInKm(
      myPlayer.lat, myPlayer.lng,
      match.suggestedCourtLat, match.suggestedCourtLng
    );
  } else if (myPlayer) {
    // B) Otherwise fallback to postcode→coords using opponent's postcode
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
      // first encounter of this opponent: fetch once and cache
      (async () => {
        try {
          const s = await getDoc(doc(db, "players", other));
          const d = s.exists() ? (s.data() as any) : null;
          setOppCache((prev) => ({
  ...prev,
  [other]: d ? { postcode: d.postcode, lat: d.lat, lng: d.lng, skillLevel: d.skillLevel } : null,
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


    return (
  <li
  key={match.id}
  className={
    "relative overflow-hidden pr-12 rounded-2xl bg-white ring-1 p-4 shadow-sm hover:shadow-md transition " +
    (match.status === "unread" ? "ring-green-200" : "ring-black/5")
  }
>
  {/* left accent for unread */}
  {match.status === "unread" && (
    <div className="absolute inset-y-0 left-0 w-1 bg-green-400/70" />
  )}
        {/* Top-right overlay: Unread + delete */}
        <div className="absolute top-2 right-2 flex items-center gap-2">
          {match.status === "unread" && (
            <span className="text-[10px] px-2 py-[2px] rounded-full bg-yellow-50 text-yellow-700 ring-1 ring-yellow-200">
              Unread
            </span>
          )}
          <button
            onClick={() => deleteMatch(match.id)}
            title="Delete request"
            aria-label="Delete request"
            className="p-1 rounded-md text-red-500 hover:text-red-700 hover:bg-red-50"
          >
            <Trash2 className="h-4 w-4" />
          </button>
        </div>

        <div className="flex items-start gap-3">
          <div className="min-w-0 flex-1">
            {/* Header */}
            <div className="flex items-center gap-2">
              <span className="font-medium text-gray-900 truncate">{initiator}</span>
              <ArrowRight className="h-4 w-4 text-gray-400" />
              <span className="font-medium text-gray-900 truncate">{recipient}</span>

              {/* Header status pill */}
{inProgress ? (
  <span className="ml-auto text-[10px] px-2 py-[2px] rounded-full bg-purple-50 text-purple-700 ring-1 ring-purple-200">
    Game in progress
  </span>
) : match.status === "accepted" ? (
  <span className="ml-auto text-[10px] px-2 py-[2px] rounded-full bg-green-50 text-green-700 ring-1 ring-green-200">
    Accepted
  </span>
) : match.status !== "unread" ? (
  <span className="ml-auto text-[10px] px-2 py-[2px] rounded-full bg-gray-100 text-gray-700">
    {match.status}
  </span>
) : null}
            </div>

            {/* Message */}
            <p className="mt-1 text-sm text-gray-700">
              {match.message || "No message"}
            </p>

            {/* Meta */}
  <div className="mt-1 flex items-center gap-3 text-xs text-gray-500">
  <Clock className="h-3.5 w-3.5" />
  {inProgress && startedAt ? (
    <span title={startedAt.toLocaleString()}>
      Started {formatRelativeTime(startedAt)}
    </span>
  ) : (
    <span title={created ? created.toLocaleString() : undefined}>
      {formatRelativeTime(created)}
    </span>
  )}

  {/* Opponent skill chip */}
  {opp?.skillLevel && (
    <span className="text-[10px] sm:text-[11px] px-2 py-[2px] rounded-full bg-gray-100 text-gray-700">
      Skill: {opp.skillLevel}
    </span>
  )}

  {/* Distance chip */}
  {typeof distanceKm === "number" && (
    <span className="text-[10px] sm:text-[11px] px-2 py-[2px] rounded-full bg-gray-100 text-gray-700">
      ~{distanceKm} km
    </span>
  )}

  <span className="ml-auto italic text-gray-400">
    🏟️ Court suggestion coming soon
  </span>
</div>


            {/* Actions */}
<div className="mt-3 flex flex-col sm:flex-row gap-2">
  {match.status === "accepted" ? (
    inProgress ? (
      <>
        <button
          onClick={() => handleCompleteGame(match)}
          className="w-full sm:w-auto inline-flex items-center justify-center gap-2 rounded-lg bg-purple-600 px-3 py-2 text-sm font-medium text-white hover:bg-purple-700"
        >
          <Check className="h-4 w-4" />
          Complete Game
        </button>

        <Link
          href={profileHref}
          className="w-full sm:w-auto inline-flex items-center justify-center gap-2 rounded-lg bg-white px-3 py-2 text-sm ring-1 ring-gray-200 hover:bg-gray-50"
        >
          View profile
        </Link>

        <button
          onClick={() => {
            const sortedIDs = [currentUserId!, other].sort().join("_");
            router.push(`/messages/${sortedIDs}`);
          }}
          className="w-full sm:w-auto inline-flex items-center justify-center gap-2 rounded-lg bg-gray-100 px-3 py-2 text-sm hover:bg-gray-200"
        >
          <MessageCircle className="h-4 w-4" />
          Chat
        </button>
      </>
    ) : (
      <>
        <button
          onClick={() => handleStartMatch(match)}
          disabled={startingId === match.id}
          className={
            "w-full sm:w-auto inline-flex items-center justify-center gap-2 rounded-lg px-3 py-2 text-sm font-medium text-white " +
            (startingId === match.id
              ? "bg-green-600 opacity-60 cursor-not-allowed"
              : "bg-green-600 hover:bg-green-700")
          }
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

        <Link
          href={profileHref}
          className="w-full sm:w-auto inline-flex items-center justify-center gap-2 rounded-lg bg-white px-3 py-2 text-sm ring-1 ring-gray-200 hover:bg-gray-50"
        >
          View profile
        </Link>

        <button
          onClick={() => {
            const sortedIDs = [currentUserId!, other].sort().join("_");
            router.push(`/messages/${sortedIDs}`);
          }}
          className="w-full sm:w-auto inline-flex items-center justify-center gap-2 rounded-lg bg-gray-100 px-3 py-2 text-sm hover:bg-gray-200"
        >
          <MessageCircle className="h-4 w-4" />
          Chat
        </button>
      </>
    )
  ) : (
    <>
      {match.opponentId === currentUserId ? (
        <>
          <button
            onClick={() => currentUserId && acceptMatch(match.id, currentUserId)}
            className="w-full sm:w-auto inline-flex items-center justify-center gap-2 rounded-lg bg-green-600 px-3 py-2 text-sm font-medium text-white hover:bg-green-700"
          >
            <Check className="h-4 w-4" />
            Accept
          </button>

          <button
            onClick={() => deleteMatch(match.id)}
            className="w-full sm:w-auto inline-flex items-center justify-center gap-2 rounded-lg bg-gray-100 px-3 py-2 text-sm hover:bg-gray-200"
          >
            <X className="h-4 w-4" />
            Decline
          </button>

          <Link
            href={profileHref}
            className="w-full sm:w-auto inline-flex items-center justify-center gap-2 rounded-lg bg-white px-3 py-2 text-sm ring-1 ring-gray-200 hover:bg-gray-50"
          >
            View profile
          </Link>
        </>
      ) : (
        <>
          <button
            onClick={() => deleteMatch(match.id)}
            className="w-full sm:w-auto inline-flex items-center justify-center gap-2 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 hover:bg-red-100"
          >
            <Trash2 className="h-4 w-4" />
            Withdraw
          </button>

          <Link
            href={profileHref}
            className="w-full sm:w-auto inline-flex items-center justify-center gap-2 rounded-lg bg-white px-3 py-2 text-sm ring-1 ring-gray-200 hover:bg-gray-50"
          >
            View profile
          </Link>
        </>
      )}
    </>
  )}
</div>

          </div>
        </div>
      </li>
    );
}, [
  currentUserId,
  router,
  handleStartMatch,
  handleCompleteGame,
  deleteMatch,
  myPlayer,
  postcodeCoords,
  oppCache,
]);

const pendingCount = useMemo(
  () => matches.filter((m) => m.status !== "accepted").length,
  [matches]
);
const acceptedCount = useMemo(
  () => matches.filter((m) => m.status === "accepted").length,
  [matches]
);

const visibleMatches = useMemo(() => {
  const base =
    tab === "accepted"
      ? matches.filter((m) => m.status === "accepted")
      : matches.filter((m) => m.status !== "accepted");

  const byDirection = base.filter((m) => {
    if (direction === "sent" && m.playerId !== currentUserId) return false;
    if (direction === "received" && m.opponentId !== currentUserId) return false;
    return true;
  });

  const q = queryText.trim().toLowerCase();
  if (!q) return byDirection;

  return byDirection.filter((m) => {
    const a = (m.fromName || "").toLowerCase();
    const b = (m.toName || "").toLowerCase();
    return a.includes(q) || b.includes(q);
  });
}, [matches, tab, direction, currentUserId, queryText]);


return (
  <div className="max-w-2xl mx-auto p-4 pb-28 sm:p-6">
    {/* Page title */}
    <div className="mb-3">
      {/* icon + title on one row */}
      <div className="flex items-center gap-3">
        <GiTennisBall className="h-6 w-6 text-green-600" aria-hidden="true" />
        <h1 className="text-2xl sm:text-3xl font-bold tracking-tight">
          Match Requests
        </h1>
      </div>
      {/* subtitle on its own row, lined up under the title */}
      <p className="mt-1 ml-9 text-sm text-gray-600">
        Manage invitations you’ve sent and received — keep the rallies going.
      </p>
    </div>

    {/* Sticky toolbar */}
    <div className="sticky top-[56px] z-10 mb-3 rounded-xl bg-white/90 backdrop-blur ring-1 ring-black/5 p-3">
      <div className="flex flex-wrap items-center gap-3">
        {/* Tabs */}
        <div className="inline-flex rounded-lg p-0.5 bg-gray-100">
          <button
            onClick={() => setTab("pending")}
            className={`px-3 py-1.5 rounded-md text-sm ${
              tab === "pending" ? "bg-blue-600 text-white" : "text-gray-800 hover:bg-white"
            }`}
          >
            Pending
          </button>
          <button
            onClick={() => setTab("accepted")}
            className={`px-3 py-1.5 rounded-md text-sm ${
              tab === "accepted" ? "bg-blue-600 text-white" : "text-gray-800 hover:bg-white"
            }`}
          >
            Accepted
          </button>
        </div>

        {/* Counts */}
        <span className="text-sm text-gray-600">
          {tab === "pending" ? pendingCount : acceptedCount} result
          {(tab === "pending" ? pendingCount : acceptedCount) === 1 ? "" : "s"}
        </span>

        {/* Filters */}
        <div className="w-full sm:w-auto sm:ml-auto flex items-center gap-3">
  <select
    value={direction}
    onChange={(e) =>
      setDirection(e.target.value as "all" | "received" | "sent")
    }
    className="text-sm border rounded-lg px-2 py-1 w-[120px] sm:w-auto"
    title="Filter direction"
  >
    <option value="all">All</option>
    <option value="received">Received</option>
    <option value="sent">Sent</option>
          </select>
          <input
  type="text"
  value={queryText}
  onChange={(e) => setQueryText(e.target.value)}
  placeholder="Search names…"
  className="text-sm border rounded-lg px-2 py-1 w-[160px]"
  aria-label="Search requests by name"
/>
        </div>
      </div>
    </div>

    {/* List / Empty state */}
    {visibleMatches.length === 0 ? (
      <div className="mt-6 rounded-xl border border-dashed border-gray-300 bg-white p-8 text-center">
        <p className="text-gray-800 font-medium">No matches in this view yet</p>
        <p className="text-gray-600 text-sm mt-1">Try switching tabs or filters.</p>
      </div>
    ) : (
     <ul className="space-y-3">{visibleMatches.map(renderMatch)}</ul>
    )}
  </div>
);

              // end return
}                // ← ADD THIS: closes MatchesPage component

export default MatchesPage;