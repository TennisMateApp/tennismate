"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import Image from "next/image";
import { useParams, useRouter } from "next/navigation";
import { onAuthStateChanged } from "firebase/auth";
import { addDoc, collection, doc, getDoc, serverTimestamp } from "firebase/firestore";
import { ArrowLeft, ArrowRight, MapPin, Trophy } from "lucide-react";
import { GiTennisBall } from "react-icons/gi";

import { auth, db } from "@/lib/firebaseConfig";
import { resolveProfilePhoto } from "@/lib/profilePhoto";

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
  sets?: Array<{ myGames?: number; opponentGames?: number; playerOne?: number; playerTwo?: number }>;
};

type PlayerCard = {
  id: string | null;
  name: string;
  photoURL?: string | null;
};

const TM = {
  forest: "#0B3D2E",
  neon: "#39FF14",
  bg: "#F3F5F7",
};

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

  return new Intl.DateTimeFormat("en-AU", {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(date);
};

const formatMatchType = (value?: string | null) => {
  if (!value) return "Social match";
  return value.charAt(0).toUpperCase() + value.slice(1);
};

function ResultPill({
  won,
  hasWinner,
}: {
  won: boolean;
  hasWinner: boolean;
}): ReactNode {
  const label = !hasWinner ? "Played" : won ? "Win" : "Loss";
  const cls = !hasWinner
    ? "bg-blue-50 text-blue-700 ring-blue-200"
    : won
    ? "bg-green-50 text-green-700 ring-green-200"
    : "bg-gray-100 text-gray-700 ring-gray-200";

  return (
    <span className={`inline-flex items-center rounded-full px-3 py-1 text-xs font-extrabold ring-1 ${cls}`}>
      {label}
    </span>
  );
}

function PlayerBadge({
  player,
  isWinner,
}: {
  player: PlayerCard;
  isWinner: boolean;
}) {
  const initials = (player.name || "?").trim().charAt(0).toUpperCase();

  return (
    <div className="flex flex-col items-center text-center">
      <div
        className={`relative h-20 w-20 overflow-hidden rounded-full bg-white ring-2 ring-offset-2 ${
          isWinner ? "ring-yellow-400" : "ring-black/10"
        }`}
      >
        {player.photoURL ? (
          <Image
            src={player.photoURL}
            alt={player.name}
            fill
            sizes="80px"
            className="object-cover"
          />
        ) : (
          <div className="grid h-full w-full place-items-center text-xl font-extrabold text-gray-500">
            {initials}
          </div>
        )}
      </div>

      <div className="mt-3 flex items-center gap-1 text-sm font-extrabold text-gray-900">
        {isWinner ? <Trophy className="h-4 w-4 text-yellow-500" /> : null}
        <span>{player.name}</span>
      </div>
    </div>
  );
}

export default function MatchHistoryDetailsPage() {
  const params = useParams();
  const router = useRouter();
  const historyId = Array.isArray(params.id) ? params.id[0] : params.id;

  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [history, setHistory] = useState<HistoryMatch | null>(null);
  const [currentPhotos, setCurrentPhotos] = useState<Record<string, string | null>>({});
  const [loading, setLoading] = useState(true);
  const [rematchRequested, setRematchRequested] = useState(false);
  const [requestingRematch, setRequestingRematch] = useState(false);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (user) => {
      setCurrentUserId(user?.uid ?? null);
    });
    return () => unsub();
  }, []);

  useEffect(() => {
    async function loadHistory() {
      if (!historyId) {
        setHistory(null);
        setLoading(false);
        return;
      }

      try {
        setLoading(true);
        const snap = await getDoc(doc(db, "match_history", historyId));
        if (!snap.exists()) {
          setHistory(null);
          return;
        }

        setHistory({
          id: snap.id,
          ...(snap.data() as Omit<HistoryMatch, "id">),
        });
      } catch (error) {
        console.error("Failed to load match history details", error);
        setHistory(null);
      } finally {
        setLoading(false);
      }
    }

    void loadHistory();
  }, [historyId]);

  useEffect(() => {
    async function loadCurrentPhotos() {
      if (!history) return;

      const ids = [history.fromUserId, history.toUserId].filter(
        (value): value is string => !!value
      );

      if (!ids.length) {
        setCurrentPhotos({});
        return;
      }

      const entries = await Promise.all(
        ids.map(async (uid) => {
          try {
            const snap = await getDoc(doc(db, "players", uid));
            return [uid, snap.exists() ? resolveProfilePhoto(snap.data()) : null] as const;
          } catch {
            return [uid, null] as const;
          }
        })
      );

      setCurrentPhotos(Object.fromEntries(entries));
    }

    void loadCurrentPhotos();
  }, [history]);

  const leftPlayer = useMemo<PlayerCard | null>(() => {
    if (!history) return null;
    return {
      id: history.fromUserId ?? null,
      name: history.fromName || "Player One",
      photoURL:
        (history.fromUserId ? currentPhotos[history.fromUserId] : null) ||
        history.fromPhotoURL ||
        null,
    };
  }, [history, currentPhotos]);

  const rightPlayer = useMemo<PlayerCard | null>(() => {
    if (!history) return null;
    return {
      id: history.toUserId ?? null,
      name: history.toName || "Player Two",
      photoURL:
        (history.toUserId ? currentPhotos[history.toUserId] : null) ||
        history.toPhotoURL ||
        null,
    };
  }, [history, currentPhotos]);

  const currentUserWon = !!history?.winnerId && history.winnerId === currentUserId;
  const hasWinner = !!history?.winnerId;

  const handleRematch = async () => {
    if (!currentUserId || !history) return;

    const opponentId =
      history.fromUserId === currentUserId ? history.toUserId : history.fromUserId;
    if (!opponentId) return;

    const myName =
      history.fromUserId === currentUserId
        ? history.fromName || "Player"
        : history.toName || "Player";
    const opponentName =
      history.fromUserId === currentUserId
        ? history.toName || "Opponent"
        : history.fromName || "Opponent";

    try {
      setRequestingRematch(true);

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

      setRematchRequested(true);
    } catch (error) {
      console.error("Failed to request rematch from history details", error);
      alert("Could not request a rematch right now. Please try again.");
    } finally {
      setRequestingRematch(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen" style={{ background: TM.bg }}>
        <div className="mx-auto w-full max-w-4xl px-4 py-6 sm:px-6">
          <div className="h-11 w-11 rounded-full bg-white/80 ring-1 ring-black/5 animate-pulse" />
          <div className="mt-4 h-40 rounded-3xl bg-white/80 ring-1 ring-black/5 animate-pulse" />
          <div className="mt-4 h-64 rounded-3xl bg-white/80 ring-1 ring-black/5 animate-pulse" />
        </div>
      </div>
    );
  }

  if (!history || !leftPlayer || !rightPlayer) {
    return (
      <div className="min-h-screen" style={{ background: TM.bg }}>
        <div className="mx-auto flex min-h-screen max-w-xl flex-col items-center justify-center px-4 text-center">
          <div className="text-xl font-extrabold text-gray-900">Match details unavailable</div>
          <p className="mt-2 text-sm text-gray-600">
            We couldn&apos;t find that history record.
          </p>
          <button
            type="button"
            onClick={() => router.push("/matches?tab=history")}
            className="mt-5 rounded-full px-5 py-3 text-sm font-extrabold text-[#0B3D2E]"
            style={{ background: TM.neon }}
          >
            Back to Matches
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen pb-24" style={{ background: TM.bg }}>
      <div className="sticky top-0 z-20 border-b border-black/5 bg-[#F3F5F7]/95 backdrop-blur">
        <div className="mx-auto flex w-full max-w-4xl items-center justify-between px-4 py-4 sm:px-6">
          <button
            type="button"
            onClick={() => router.back()}
            className="grid h-11 w-11 place-items-center rounded-full bg-white ring-1 ring-black/5 hover:bg-black/5"
            aria-label="Back"
          >
            <ArrowLeft className="h-5 w-5 text-gray-700" />
          </button>

          <div className="text-center">
            <div className="text-[11px] font-bold uppercase tracking-[0.18em] text-gray-500">
              Match History
            </div>
            <div className="mt-1 text-[15px] font-semibold text-gray-900">Match Details</div>
          </div>

          <div className="w-11" />
        </div>
      </div>

      <div className="mx-auto w-full max-w-4xl px-4 pt-5 sm:px-6 sm:pt-6">
        <div className="rounded-[28px] bg-white p-5 shadow-sm ring-1 ring-black/5 sm:p-7">
          <div className="flex items-center gap-3">
            <div
              className="grid h-11 w-11 place-items-center rounded-2xl"
              style={{ background: "rgba(57,255,20,0.16)", color: TM.forest }}
            >
              <GiTennisBall className="h-6 w-6" />
            </div>

            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <ResultPill won={currentUserWon} hasWinner={hasWinner} />
                <span className="text-xs font-bold uppercase tracking-[0.16em] text-gray-400">
                  {formatMatchType(history.matchType)}
                </span>
              </div>
              <div className="mt-2 text-2xl font-black tracking-tight text-gray-900">
                {formatHistoryDate(history.completedAt, history.playedDate)}
              </div>
              <div className="mt-1 text-sm text-gray-600">
                Archived from your match history
              </div>
            </div>
          </div>

          {history.location ? (
            <div className="mt-5 inline-flex max-w-full items-center gap-2 rounded-full bg-gray-100 px-3 py-2 text-sm text-gray-700">
              <MapPin className="h-4 w-4 shrink-0" />
              <span className="truncate">{history.location}</span>
            </div>
          ) : null}
        </div>

        <div className="mt-4 rounded-[28px] bg-white p-5 shadow-sm ring-1 ring-black/5 sm:p-7">
          <div className="flex items-center justify-between gap-4">
            <PlayerBadge player={leftPlayer} isWinner={history.winnerId === leftPlayer.id} />
            <div className="text-center">
              <div className="text-xs font-bold uppercase tracking-[0.16em] text-gray-400">Final Score</div>
              <div className="mt-2 rounded-full bg-[#0B3D2E] px-4 py-2 text-sm font-extrabold text-white">
                {history.score?.trim() || "No score"}
              </div>
            </div>
            <PlayerBadge player={rightPlayer} isWinner={history.winnerId === rightPlayer.id} />
          </div>
        </div>

        <div className="mt-4 rounded-[28px] bg-white p-5 shadow-sm ring-1 ring-black/5 sm:p-7">
          <div className="text-[11px] font-bold uppercase tracking-[0.18em] text-gray-500">
            Next Step
          </div>
          <div className="mt-2 text-lg font-extrabold text-gray-900">
            Want another hit with {history.fromUserId === currentUserId ? rightPlayer.name : leftPlayer.name}?
          </div>
          <p className="mt-2 text-sm text-gray-600">
            Send a rematch request straight from this history record.
          </p>

          <div className="mt-5 flex flex-col gap-3 sm:flex-row">
            <button
              type="button"
              onClick={handleRematch}
              disabled={rematchRequested || requestingRematch}
              className="inline-flex items-center justify-center gap-2 rounded-full px-5 py-3 text-sm font-extrabold text-[#0B3D2E] disabled:bg-gray-100 disabled:text-gray-400"
              style={rematchRequested || requestingRematch ? undefined : { background: TM.neon }}
            >
              <span>
                {rematchRequested
                  ? "Rematch Requested"
                  : requestingRematch
                  ? "Sending..."
                  : "Request Rematch"}
              </span>
              {!rematchRequested && !requestingRematch ? <ArrowRight className="h-4 w-4" /> : null}
            </button>

            <button
              type="button"
              onClick={() => router.push("/matches?tab=history")}
              className="rounded-full bg-gray-100 px-5 py-3 text-sm font-extrabold text-gray-700 hover:bg-gray-200"
            >
              Back to History
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
