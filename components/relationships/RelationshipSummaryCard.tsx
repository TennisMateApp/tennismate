"use client";

import { useEffect, useMemo, useState } from "react";
import {
  collection,
  doc,
  getDoc,
  getDocs,
  limit,
  query,
  where,
  type Firestore,
  type Query,
} from "firebase/firestore";
import { CalendarDays, MessageCircle, RotateCcw, Trophy } from "lucide-react";
import { getPairId } from "@/lib/playerRelationships";

type RelationshipSummaryCardProps = {
  db: Firestore;
  currentUserId: string | null;
  otherUserId: string | null;
  otherPlayerName?: string | null;
  variant?: "dark" | "light";
  showMessageAction?: boolean;
  showHistoryLink?: boolean;
  onScheduleMatch?: () => void;
  onRematch?: () => void;
  onViewHistory?: () => void;
  onMessage?: () => void;
};

type SummaryState = {
  loading: boolean;
  pairId: string | null;
  playedCount: number;
  wins: number;
  losses: number;
  lastPlayedAt: Date | null;
  latestScore: string | null;
  lastWinnerId: string | null;
  lastInteractionLabel: string | null;
};

const emptySummary: SummaryState = {
  loading: true,
  pairId: null,
  playedCount: 0,
  wins: 0,
  losses: 0,
  lastPlayedAt: null,
  latestScore: null,
  lastWinnerId: null,
  lastInteractionLabel: null,
};

function toDate(value: any): Date | null {
  if (!value) return null;
  if (typeof value?.toDate === "function") return value.toDate();
  if (value instanceof Date) return value;
  if (typeof value === "string" || typeof value === "number") {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }
  return null;
}

function newestDate(data: any): Date | null {
  return (
    toDate(data?.completedAt) ||
    toDate(data?.playedAt) ||
    toDate(data?.playedDate) ||
    toDate(data?.movedAt) ||
    toDate(data?.timestamp) ||
    toDate(data?.updatedAt) ||
    toDate(data?.createdAt)
  );
}

function formatShortDate(date: Date | null) {
  if (!date) return "";
  return date.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function formatScore(data: any) {
  if (typeof data?.score === "string" && data.score.trim()) return data.score.trim();
  if (!Array.isArray(data?.sets)) return null;

  const parts = data.sets
    .map((set: any) => {
      const a =
        typeof set?.A === "number"
          ? set.A
          : typeof set?.playerA === "number"
            ? set.playerA
            : typeof set?.player1 === "number"
              ? set.player1
              : null;
      const b =
        typeof set?.B === "number"
          ? set.B
          : typeof set?.playerB === "number"
            ? set.playerB
            : typeof set?.player2 === "number"
              ? set.player2
              : null;
      return a == null || b == null ? null : `${a}-${b}`;
    })
    .filter(Boolean);

  return parts.length ? parts.join(", ") : null;
}

function displayScore(score: string | null) {
  return score?.replace(/-/g, "-") || null;
}

function lastInteractionLabel(type: unknown) {
  switch (type) {
    case "completed_match":
      return "Completed match";
    case "match_score":
      return "Score saved";
    case "match_feedback":
      return "Feedback submitted";
    case "match_invite":
      return "Match invite";
    case "match_request":
      return "Match request";
    case "message":
      return "Message";
    case "conversation":
      return "Conversation";
    default:
      return null;
  }
}

function hasBothPlayers(data: any, currentUserId: string, otherUserId: string) {
  const players = Array.isArray(data?.players)
    ? data.players
    : Array.isArray(data?.participants)
      ? data.participants
      : [data?.fromUserId, data?.toUserId];

  return players.includes(currentUserId) && players.includes(otherUserId);
}

function isCompletedMatch(data: any) {
  return data?.completed !== false && data?.outcome !== "not_played";
}

function matchKey(data: any) {
  return data.matchId || data.matchRequestId || data.inviteId || data.completedMatchId || data.id;
}

export default function RelationshipSummaryCard({
  db,
  currentUserId,
  otherUserId,
  otherPlayerName,
  variant = "light",
  showMessageAction = true,
  showHistoryLink = false,
  onScheduleMatch,
  onRematch,
  onViewHistory,
  onMessage,
}: RelationshipSummaryCardProps) {
  const [summary, setSummary] = useState<SummaryState>(emptySummary);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      if (!currentUserId || !otherUserId || currentUserId === otherUserId) {
        setSummary({ ...emptySummary, loading: false });
        return;
      }

      try {
        const pairId = getPairId(currentUserId, otherUserId);

        const safeGetDocs = async (purpose: string, q: Query) => {
          try {
            return await getDocs(q);
          } catch (error) {
            console.warn("[RelationshipSummaryCard] optional query failed", { purpose, error });
            return null;
          }
        };

        let relationship: any = null;
        try {
          const relationshipSnap = await getDoc(doc(db, "player_relationships", pairId));
          relationship = relationshipSnap.exists() ? (relationshipSnap.data() as any) : null;
        } catch (error) {
          console.warn("[RelationshipSummaryCard] relationship read failed; continuing with history", {
            pairId,
            error,
          });
        }

        const byMatch = new Map<string, any>();
        const addMatch = (data: any) => {
          if (!hasBothPlayers(data, currentUserId, otherUserId)) return;
          if (!isCompletedMatch(data)) return;
          byMatch.set(matchKey(data), data);
        };

        const linkedHistorySnap = await safeGetDocs(
          "match_history by pairId and current user",
          query(
            collection(db, "match_history"),
            where("pairId", "==", pairId),
            where("players", "array-contains", currentUserId),
            limit(25)
          )
        );

        linkedHistorySnap?.docs.forEach((docSnap) => {
          addMatch({ id: docSnap.id, ...(docSnap.data() as any) });
        });

        if (byMatch.size === 0) {
          const [playersFallbackSnap, fromToSnap, toFromSnap] = await Promise.all([
            safeGetDocs(
              "match_history by current user players fallback",
              query(
                collection(db, "match_history"),
                where("players", "array-contains", currentUserId),
                limit(50)
              )
            ),
            safeGetDocs(
              "match_history from current user to other user fallback",
              query(
                collection(db, "match_history"),
                where("fromUserId", "==", currentUserId),
                where("toUserId", "==", otherUserId),
                limit(25)
              )
            ),
            safeGetDocs(
              "match_history from other user to current user fallback",
              query(
                collection(db, "match_history"),
                where("fromUserId", "==", otherUserId),
                where("toUserId", "==", currentUserId),
                limit(25)
              )
            ),
          ]);

          [...(playersFallbackSnap?.docs ?? []), ...(fromToSnap?.docs ?? []), ...(toFromSnap?.docs ?? [])].forEach((docSnap) => {
            addMatch({ id: docSnap.id, ...(docSnap.data() as any) });
          });
        }

        if (byMatch.size === 0) {
          const [fromCurrentSnap, toCurrentSnap] = await Promise.all([
            safeGetDocs(
              "match_history legacy sent by current user",
              query(
                collection(db, "match_history"),
                where("fromUserId", "==", currentUserId),
                limit(50)
              )
            ),
            safeGetDocs(
              "match_history legacy received by current user",
              query(
                collection(db, "match_history"),
                where("toUserId", "==", currentUserId),
                limit(50)
              )
            ),
          ]);

          [...(fromCurrentSnap?.docs ?? []), ...(toCurrentSnap?.docs ?? [])].forEach((docSnap) => {
            addMatch({ id: docSnap.id, ...(docSnap.data() as any) });
          });
        }

        const completedSnap = await safeGetDocs(
          "completed_matches by current user fallback",
          query(
            collection(db, "completed_matches"),
            where("players", "array-contains", currentUserId),
            limit(50)
          )
        );

        completedSnap?.docs.forEach((docSnap) => {
          addMatch({ id: docSnap.id, ...(docSnap.data() as any) });
        });

        const matches = Array.from(byMatch.values()).sort((a, b) => {
          const aTime = newestDate(a)?.getTime() || 0;
          const bTime = newestDate(b)?.getTime() || 0;
          return bTime - aTime;
        });

        const scoresSnap = await safeGetDocs(
          "match_scores by pairId and current user",
          query(
            collection(db, "match_scores"),
            where("pairId", "==", pairId),
            where("players", "array-contains", currentUserId),
            limit(10)
          )
        );
        const latestScoreDoc = (scoresSnap?.docs ?? [])
          .map((docSnap) => ({ id: docSnap.id, ...(docSnap.data() as any) }))
          .filter((row) => hasBothPlayers(row, currentUserId, otherUserId))
          .sort((a, b) => (newestDate(b)?.getTime() || 0) - (newestDate(a)?.getTime() || 0))
          .find((row) => formatScore(row));

        const latestMatch = matches[0] || null;
        const latestMatchScore = latestMatch ? formatScore(latestMatch) : null;
        const latestResultSource = latestMatchScore ? latestMatch : latestScoreDoc || null;
        const latestScore = latestMatchScore || formatScore(latestScoreDoc) || null;
        const lastWinnerId =
          typeof latestResultSource?.winnerId === "string"
            ? latestResultSource.winnerId
              : null;

        if (!cancelled) {
          setSummary({
            loading: false,
            pairId,
            playedCount: matches.length,
            wins: matches.filter((m) => m.winnerId === currentUserId).length,
            losses: matches.filter((m) => m.winnerId === otherUserId).length,
            lastPlayedAt: latestMatch ? newestDate(latestMatch) : null,
            latestScore,
            lastWinnerId,
            lastInteractionLabel: lastInteractionLabel(relationship?.lastInteraction?.type),
          });
        }
      } catch (error) {
        console.warn("[RelationshipSummaryCard] failed to load relationship summary", error);
        if (!cancelled) setSummary({ ...emptySummary, loading: false });
      }
    }

    void load();

    return () => {
      cancelled = true;
    };
  }, [currentUserId, db, otherUserId]);

  const theme = useMemo(
    () =>
      variant === "dark"
        ? {
            shell: "rgba(255,255,255,0.04)",
            border: "rgba(255,255,255,0.10)",
            text: "#EAF7F0",
            muted: "rgba(234,247,240,0.72)",
            chip: "rgba(255,255,255,0.07)",
            accent: "#39FF14",
            primaryText: "#0B3D2E",
            button: "rgba(255,255,255,0.08)",
          }
        : {
            shell: "#FFFFFF",
            border: "rgba(15,23,42,0.10)",
            text: "#0F172A",
            muted: "rgba(15,23,42,0.62)",
            chip: "rgba(15,23,42,0.04)",
            accent: "#0B3D2E",
            primaryText: "#FFFFFF",
            button: "rgba(15,23,42,0.04)",
          },
    [variant]
  );

  if (!currentUserId || !otherUserId || currentUserId === otherUserId) return null;
  if (summary.loading || summary.playedCount === 0) return null;

  const otherName = otherPlayerName?.trim() || "Opponent";
  const matchWord = summary.playedCount === 1 ? "time" : "times";
  const hasRecord = summary.wins > 0 || summary.losses > 0;
  const isRivalry = summary.playedCount >= 3 || (summary.playedCount >= 2 && summary.wins > 0 && summary.losses > 0);
  const statusChip = isRivalry
    ? "Rivalry"
    : summary.playedCount === 1
      ? "First match"
      : `Played ${summary.playedCount} times`;
  const recordLabel =
    hasRecord && summary.wins > summary.losses
      ? `You lead ${summary.wins}-${summary.losses}`
      : hasRecord && summary.losses > summary.wins
        ? `${otherName} leads ${summary.losses}-${summary.wins}`
        : hasRecord
          ? `Tied ${summary.wins}-${summary.losses}`
          : null;
  const scoreText = displayScore(summary.latestScore);
  const lastResultLabel =
    scoreText && summary.lastWinnerId === currentUserId
      ? `You won ${scoreText}`
      : scoreText && summary.lastWinnerId === otherUserId
        ? `${otherName} won ${scoreText}`
        : scoreText
          ? `Last result: ${scoreText}`
          : null;

  return (
    <div
      className="relative z-10 mx-3 mb-1 mt-2 rounded-xl px-3 py-2.5"
      style={{ background: theme.shell, border: `1px solid ${theme.border}` }}
    >
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-1.5 text-[10px] font-extrabold uppercase tracking-wide" style={{ color: theme.muted }}>
            <Trophy className="h-3.5 w-3.5" />
            Relationship
          </div>
          <div className="mt-0.5 truncate text-[15px] font-black leading-tight" style={{ color: theme.text }}>
            {recordLabel || `Played together ${summary.playedCount} ${matchWord}`}
          </div>
        </div>

        <span
          className="shrink-0 rounded-full px-2 py-1 text-[10px] font-extrabold"
          style={{
            background: isRivalry ? "rgba(57,255,20,0.16)" : theme.chip,
            color: isRivalry ? theme.accent : theme.muted,
            border: isRivalry ? `1px solid ${theme.accent}` : "1px solid transparent",
          }}
        >
          {statusChip}
        </span>
      </div>

      <div className="mt-2 grid grid-cols-2 gap-2 text-xs">
        <div className="rounded-lg px-2.5 py-1.5" style={{ background: theme.chip }}>
          <div className="text-[10px] font-bold uppercase" style={{ color: theme.muted }}>
            Matches
          </div>
          <div className="mt-0.5 font-extrabold" style={{ color: theme.text }}>
            {summary.playedCount}
          </div>
        </div>

        {summary.lastPlayedAt ? (
          <div className="rounded-lg px-2.5 py-1.5" style={{ background: theme.chip }}>
            <div className="text-[10px] font-bold uppercase" style={{ color: theme.muted }}>
              Last played
            </div>
            <div className="mt-0.5 truncate font-extrabold" style={{ color: theme.text }}>
              {formatShortDate(summary.lastPlayedAt)}
            </div>
          </div>
        ) : null}
      </div>

      {recordLabel ? (
        <div className="mt-2 rounded-lg px-2.5 py-1.5 text-xs" style={{ background: theme.chip }}>
          <div className="text-[10px] font-bold uppercase" style={{ color: theme.muted }}>
            Head-to-head
          </div>
          <div className="mt-0.5 truncate font-extrabold" style={{ color: theme.text }}>
            {recordLabel}
          </div>
        </div>
      ) : null}

      {lastResultLabel ? (
        <div className="mt-2 flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-xs" style={{ background: theme.chip, color: theme.text }}>
          <CalendarDays className="h-3.5 w-3.5 shrink-0" style={{ color: theme.accent }} />
          <span className="min-w-0 truncate font-bold">{lastResultLabel}</span>
        </div>
      ) : summary.lastInteractionLabel ? (
        <div className="mt-2 rounded-lg px-2.5 py-1.5 text-xs font-bold" style={{ background: theme.chip, color: theme.muted }}>
          Latest interaction: {summary.lastInteractionLabel}
        </div>
      ) : null}

      {(onScheduleMatch || onRematch || (showHistoryLink && onViewHistory) || showMessageAction) ? (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          {onScheduleMatch ? (
            <button
              type="button"
              onClick={onScheduleMatch}
              className="inline-flex min-w-[132px] flex-1 items-center justify-center gap-2 rounded-xl px-3 py-2 text-[12px] font-extrabold"
              style={{ background: theme.accent, color: theme.primaryText }}
            >
              <CalendarDays className="h-4 w-4" />
              Schedule Match
            </button>
          ) : null}

          {onRematch ? (
            <button
              type="button"
              onClick={onRematch}
              className="inline-flex min-w-[112px] flex-1 items-center justify-center gap-2 rounded-xl px-3 py-2 text-[12px] font-extrabold"
              style={{ background: theme.button, color: theme.text, border: `1px solid ${theme.border}` }}
            >
              <RotateCcw className="h-4 w-4" />
              Rematch
            </button>
          ) : null}

          {showHistoryLink && onViewHistory ? (
            <button
              type="button"
              onClick={onViewHistory}
              className="px-1 text-[12px] font-extrabold underline underline-offset-4"
              style={{ color: theme.muted }}
            >
              View Match History
            </button>
          ) : null}

          {showMessageAction ? (
            <button
              type="button"
              onClick={onMessage}
              className="inline-flex items-center justify-center gap-2 rounded-xl px-3 py-2 text-[12px] font-extrabold disabled:opacity-45"
              style={{ background: theme.button, color: theme.text, border: `1px solid ${theme.border}` }}
              disabled={!onMessage}
            >
              <MessageCircle className="h-4 w-4" />
              Message
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
