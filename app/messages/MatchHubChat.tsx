"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import debounce from "lodash.debounce";
import {
  ArrowLeft,
  CalendarCheck,
  History,
  MessageSquare,
  MoreVertical,
  Send,
  Trash2,
  Trophy,
  User,
} from "lucide-react";
import InviteOverlayCard from "@/components/invites/InviteOverlayCard";
import PlayerProfileView from "@/components/players/PlayerProfileView";
import { getSuggestedCourtsForInvite } from "@/lib/suggestedCourtsClient";
import { resolveSmallProfilePhoto } from "@/lib/profilePhoto";
import { trackEvent } from "@/lib/mixpanel";
import { shouldTrackRematchInviteAccepted } from "@/lib/rematchAnalytics";
import {
  createRematchInviteFromPrevious,
  dismissRematchPrompt,
  findEligibleRematchInvite,
  markRematchPromptShown,
  type RematchPrefill,
} from "@/lib/rematchInvites";
import {
  ensureOneToOneConversationRelationship,
  getPairId,
  getRelationshipRefPath,
  relationshipFieldsForParticipants,
  upsertMatchInviteRelationship,
  upsertMessageRelationship,
} from "@/lib/playerRelationships";

import { db, auth } from "@/lib/firebaseConfig";
import {
  doc,
  deleteField,
  getDoc,
  getDocs,
  setDoc,
  collection,
  addDoc,
  onSnapshot,
  serverTimestamp,
  orderBy,
  query,
  where,
  limit,
  updateDoc,
  writeBatch,
} from "firebase/firestore";

const TM = {
  ink: "#0B3D2E",
  navyBubble: "#0B1F3A",        // your “me” bubble (dark blue like mock)
  otherBubble: "#F1F3F5",       // their bubble
  neon: "#39FF14",
};

function mapsUrlForAddress(address?: string | null) {
  const q = (address || "").trim();
  if (!q) return null;
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(q)}`;
}

function mapsEmbedUrlForAddress(address?: string | null) {
  const q = (address || "").trim();
  if (!q) return null;
  return `https://www.google.com/maps?q=${encodeURIComponent(q)}&output=embed`;
}

// NOTE: This uses Google Static Maps WITHOUT an API key (works but may rate-limit).
// If your coach page uses a key, tell me and I’ll match that exact pattern.
function staticMapImgUrl(lat?: number | null, lng?: number | null) {
  if (typeof lat !== "number" || typeof lng !== "number") return null;

  const size = "640x260"; // nice wide preview
  const zoom = 14;
  const marker = `color:red|${lat},${lng}`;

  return `https://maps.googleapis.com/maps/api/staticmap?center=${lat},${lng}&zoom=${zoom}&size=${size}&maptype=roadmap&markers=${encodeURIComponent(
    marker
  )}`;
}

function mapsEmbedUrlFor(
  labelOrAddress?: string | null,
  lat?: number | null,
  lng?: number | null
) {
  // Prefer lat/lng when present (more accurate)
  if (typeof lat === "number" && typeof lng === "number") {
    return `https://www.google.com/maps?q=${lat},${lng}&output=embed`;
  }

  // Fallback to address/name text
  const q = (labelOrAddress || "").trim();
  if (!q) return null;

  return `https://www.google.com/maps?q=${encodeURIComponent(q)}&output=embed`;
}

function formatInviteWhen(startISO: string) {
  const d = new Date(startISO);
  if (isNaN(d.getTime())) return "Invalid date";
  const date = d.toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
  const time = d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  return `${date} • ${time}`;
}

const DEFAULT_SYSTEM_AVATAR = "/images/default-avatar.jpg";

type MatchHubTab = "chat" | "matches" | "profile";
type MatchHubActionSheet = "lastMatch" | null;

function isIOSViewportPlatform() {
  if (typeof window === "undefined") return false;

  const nav = window.navigator;
  const platform = nav.platform || "";
  const ua = nav.userAgent || "";
  const maxTouchPoints = nav.maxTouchPoints || 0;

  return (
    /iPad|iPhone|iPod/.test(platform) ||
    /iPad|iPhone|iPod/.test(ua) ||
    (platform === "MacIntel" && maxTouchPoints > 1)
  );
}

type HubMatch = {
  id: string;
  source: string;
  data: any;
  playedAt: Date | null;
  score: string | null;
  winnerId: string | null;
  court: string | null;
  durationLabel: string | null;
  acesLabel: string | null;
  breakPointsLabel: string | null;
};

type AvailabilityOverlap = {
  summary: string;
  slots: string[];
  preferredSlot?: string | null;
  preferredDate?: string | null;
  preferredTime?: string | null;
  suggestions?: SuggestedAvailabilitySlot[];
};

type SuggestedAvailabilitySlot = {
  id: string;
  broadLabel: string;
  date: string;
  time: string;
  dateLabel: string;
  timeLabel: string;
  ctaLabel: string;
  reason?: string;
  score: number;
  start: Date;
};

function asDate(value: any): Date | null {
  if (!value) return null;
  if (typeof value?.toDate === "function") return value.toDate();
  if (value instanceof Date) return value;
  if (typeof value === "string" || typeof value === "number") {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }
  return null;
}

function matchDate(data: any): Date | null {
  return (
    asDate(data?.completedAt) ||
    asDate(data?.playedAt) ||
    asDate(data?.playedDate) ||
    asDate(data?.date) ||
    asDate(data?.timestamp) ||
    asDate(data?.updatedAt) ||
    asDate(data?.createdAt)
  );
}

function formatHubDate(date: Date | null) {
  if (!date) return null;
  return date.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function formatMatchScore(data: any): string | null {
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
              : typeof set?.myGames === "number"
                ? set.myGames
                : typeof set?.playerOne === "number"
                  ? set.playerOne
                  : null;
      const b =
        typeof set?.B === "number"
          ? set.B
          : typeof set?.playerB === "number"
            ? set.playerB
            : typeof set?.player2 === "number"
              ? set.player2
              : typeof set?.opponentGames === "number"
                ? set.opponentGames
                : typeof set?.playerTwo === "number"
                  ? set.playerTwo
                  : null;
      return a == null || b == null ? null : `${a}-${b}`;
    })
    .filter(Boolean);

  return parts.length ? parts.join(", ") : null;
}

function hasBothHubPlayers(data: any, currentUserId: string, otherUserId: string) {
  const players = Array.isArray(data?.players)
    ? data.players
    : Array.isArray(data?.participants)
      ? data.participants
      : [data?.fromUserId, data?.toUserId, data?.senderId, data?.receiverId];

  return players.includes(currentUserId) && players.includes(otherUserId);
}

function hasHubPlayer(data: any, playerId: string) {
  const players = Array.isArray(data?.players)
    ? data.players
    : Array.isArray(data?.participants)
      ? data.participants
      : [data?.fromUserId, data?.toUserId, data?.senderId, data?.receiverId];

  return players.includes(playerId);
}

function matchIsCompleted(data: any) {
  if (data?.completed === false || data?.outcome === "not_played") return false;
  return !!(
    data?.winnerId ||
    data?.score ||
    data?.sets ||
    data?.completedAt ||
    data?.playedAt ||
    data?.playedDate ||
    data?.timestamp
  );
}

function hubMatchKey(data: any) {
  return (
    data?.matchId ||
    data?.matchRequestId ||
    data?.inviteId ||
    data?.completedMatchId ||
    data?.scoreId ||
    data?.id
  );
}

function courtLabel(data: any): string | null {
  const court = data?.court || data?.invite?.court || null;
  const parts = [
    court?.name,
    data?.courtName,
    data?.location,
    data?.invite?.location,
    court?.suburb,
  ].filter((value) => typeof value === "string" && value.trim());
  return parts.length ? String(parts[0]).trim() : null;
}

function durationLabel(data: any): string | null {
  const mins =
    typeof data?.durationMins === "number"
      ? data.durationMins
      : typeof data?.durationMinutes === "number"
        ? data.durationMinutes
        : typeof data?.invite?.durationMins === "number"
          ? data.invite.durationMins
          : null;
  if (!mins || !Number.isFinite(mins)) return null;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return h > 0 ? `${h}h${m ? ` ${m}m` : ""}` : `${m}m`;
}

function statPairLabel(value: any, currentUserId: string, otherUserId: string): string | null {
  if (!value || typeof value !== "object") return null;
  const mine = value[currentUserId];
  const theirs = value[otherUserId];
  if (typeof mine === "number" && typeof theirs === "number") return `${mine} - ${theirs}`;
  return null;
}

function acesLabel(data: any, currentUserId: string, otherUserId: string) {
  return statPairLabel(data?.aces, currentUserId, otherUserId);
}

function breakPointsLabel(data: any, currentUserId: string, otherUserId: string) {
  return (
    statPairLabel(data?.breakPoints, currentUserId, otherUserId) ||
    statPairLabel(data?.breakPointsWon, currentUserId, otherUserId)
  );
}

function buildHubMatch(row: { id: string; source: string; data: any }, currentUserId: string, otherUserId: string): HubMatch {
  return {
    id: row.id,
    source: row.source,
    data: row.data,
    playedAt: matchDate(row.data),
    score: formatMatchScore(row.data),
    winnerId: typeof row.data?.winnerId === "string" ? row.data.winnerId : null,
    court: courtLabel(row.data),
    durationLabel: durationLabel(row.data),
    acesLabel: acesLabel(row.data, currentUserId, otherUserId),
    breakPointsLabel: breakPointsLabel(row.data, currentUserId, otherUserId),
  };
}

function availabilitySlotsFrom(value: any): string[] {
  if (Array.isArray(value)) {
    return value.map((slot) => String(slot).trim()).filter(Boolean);
  }
  if (typeof value === "string" && value.trim()) return [value.trim()];
  return [];
}

function formatAvailabilityDate(value: any): string | null {
  if (typeof value !== "string" || !value.trim()) return null;
  const parsed = new Date(`${value.trim()}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) return value.trim();
  return parsed.toLocaleDateString(undefined, { weekday: "short" });
}

function availabilitySlotsFromDoc(data: any): string[] {
  if (!data || (data.status && data.status !== "open")) return [];
  const structured = [formatAvailabilityDate(data.date), data.timeSlot]
    .filter((value) => typeof value === "string" && value.trim())
    .join(" ");
  return [
    ...(structured ? [structured] : []),
    ...availabilitySlotsFrom(data.availability),
    ...availabilitySlotsFrom(data.timeSlot),
  ];
}

function overlapAvailabilityDocs(a: any, b: any): AvailabilityOverlap | null {
  if (!a || !b) return null;
  if ((a.status && a.status !== "open") || (b.status && b.status !== "open")) return null;
  if (a.date && b.date && a.date === b.date && a.timeSlot && b.timeSlot && a.timeSlot === b.timeSlot) {
    const label = [formatAvailabilityDate(a.date), a.timeSlot].filter(Boolean).join(" ");
    return {
      slots: [label],
      summary: label,
      preferredSlot: label,
      preferredDate: a.date,
      preferredTime: typeof a.timeSlot === "string" ? a.timeSlot : null,
    };
  }
  return overlapAvailability(availabilitySlotsFromDoc(a), availabilitySlotsFromDoc(b));
}

function overlapAvailability(a: any, b: any): AvailabilityOverlap | null {
  const aSlots = availabilitySlotsFrom(a);
  const bSet = new Set(availabilitySlotsFrom(b).map((slot) => slot.toLowerCase()));
  const overlap = aSlots.filter((slot) => bSet.has(slot.toLowerCase()));
  if (!overlap.length) return null;
  return {
    slots: overlap,
    summary: overlap.slice(0, 2).join(", ") + (overlap.length > 2 ? ` +${overlap.length - 2}` : ""),
    preferredSlot: overlap[0] || null,
  };
}

function parseAvailabilitySlotStart(slot?: string | null): { date: string; time: string } | null {
  if (!slot) return null;
  const dayMatch = slot.match(/\b(mon|tue|wed|thu|fri|sat|sun)(day)?\b/i);
  const timeMatch = slot.match(/\b(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b/i);
  if (!dayMatch || !timeMatch) return null;

  const dayIndex: Record<string, number> = {
    sun: 0,
    mon: 1,
    tue: 2,
    wed: 3,
    thu: 4,
    fri: 5,
    sat: 6,
  };
  const targetDay = dayIndex[dayMatch[1].slice(0, 3).toLowerCase()];
  if (targetDay == null) return null;

  const next = new Date();
  const delta = (targetDay - next.getDay() + 7) % 7;
  next.setDate(next.getDate() + delta);

  let hour = Number(timeMatch[1]);
  const minute = Number(timeMatch[2] || 0);
  const meridiem = timeMatch[3].toLowerCase();
  if (meridiem === "pm" && hour < 12) hour += 12;
  if (meridiem === "am" && hour === 12) hour = 0;
  next.setHours(hour, minute, 0, 0);

  const yyyy = next.getFullYear();
  const mm = String(next.getMonth() + 1).padStart(2, "0");
  const dd = String(next.getDate()).padStart(2, "0");
  const hh = String(next.getHours()).padStart(2, "0");
  const min = String(next.getMinutes()).padStart(2, "0");

  return { date: `${yyyy}-${mm}-${dd}`, time: `${hh}:${min}` };
}

function parseAvailabilityStartTime(value?: string | null): string | null {
  if (!value) return null;
  const timeMatch = value.match(/\b(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b/i);
  if (!timeMatch) return null;
  let hour = Number(timeMatch[1]);
  const minute = Number(timeMatch[2] || 0);
  const meridiem = timeMatch[3].toLowerCase();
  if (meridiem === "pm" && hour < 12) hour += 12;
  if (meridiem === "am" && hour === 12) hour = 0;
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

const BROAD_AVAILABILITY_OPTIONS = ["Weekday AM", "Weekday PM", "Weekend AM", "Weekend PM"] as const;

const SUGGESTION_TEMPLATES: Record<
  string,
  Array<{ day: number; hour: number; minute: number }>
> = {
  "Weekday AM": [
    { day: 2, hour: 7, minute: 0 },
    { day: 2, hour: 8, minute: 0 },
    { day: 4, hour: 7, minute: 0 },
    { day: 4, hour: 8, minute: 0 },
  ],
  "Weekday PM": [
    { day: 2, hour: 18, minute: 0 },
    { day: 2, hour: 19, minute: 0 },
    { day: 4, hour: 18, minute: 0 },
    { day: 4, hour: 19, minute: 0 },
  ],
  "Weekend AM": [
    { day: 6, hour: 8, minute: 0 },
    { day: 6, hour: 9, minute: 30 },
    { day: 0, hour: 8, minute: 0 },
    { day: 0, hour: 9, minute: 30 },
  ],
  "Weekend PM": [
    { day: 6, hour: 13, minute: 0 },
    { day: 6, hour: 15, minute: 0 },
    { day: 0, hour: 13, minute: 0 },
    { day: 0, hour: 15, minute: 0 },
  ],
};

function normalizeBroadAvailabilitySlot(value: any): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toLowerCase().replace(/\s+/g, " ");
  const isWeekday = normalized.includes("weekday");
  const isWeekend = normalized.includes("weekend");
  const isAM = /\bam\b/.test(normalized) || normalized.includes("morning");
  const isPM = /\bpm\b/.test(normalized) || normalized.includes("afternoon") || normalized.includes("evening");
  if (isWeekday && isAM) return "Weekday AM";
  if (isWeekday && isPM) return "Weekday PM";
  if (isWeekend && isAM) return "Weekend AM";
  if (isWeekend && isPM) return "Weekend PM";
  return null;
}

function broadAvailabilitySlotsFrom(value: any): string[] {
  const seen = new Set<string>();
  availabilitySlotsFrom(value).forEach((slot) => {
    const broad = normalizeBroadAvailabilitySlot(slot);
    if (broad) seen.add(broad);
  });
  return BROAD_AVAILABILITY_OPTIONS.filter((slot) => seen.has(slot));
}

function overlappingBroadAvailability(a: any, b: any): string[] {
  const aSet = new Set(broadAvailabilitySlotsFrom(a));
  return broadAvailabilitySlotsFrom(b).filter((slot) => aSet.has(slot));
}

function nextDateForTemplate(day: number, hour: number, minute: number) {
  const next = new Date();
  const delta = (day - next.getDay() + 7) % 7;
  next.setDate(next.getDate() + delta);
  next.setHours(hour, minute, 0, 0);
  if (next.getTime() <= Date.now()) next.setDate(next.getDate() + 7);
  return next;
}

function isoDateFromDate(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function hhmmFromDate(date: Date) {
  return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

function minutesOfDay(date: Date) {
  return date.getHours() * 60 + date.getMinutes();
}

function broadBlockFromDate(date: Date): string {
  const weekend = date.getDay() === 0 || date.getDay() === 6;
  const half = date.getHours() < 12 ? "AM" : "PM";
  return `${weekend ? "Weekend" : "Weekday"} ${half}`;
}

function hasSimilarTime(matches: Array<{ playedAt: Date | null }>, target: Date) {
  const targetMinutes = minutesOfDay(target);
  return matches.some((match) => {
    if (!match.playedAt) return false;
    return Math.abs(minutesOfDay(match.playedAt) - targetMinutes) <= 90;
  });
}

function hasSameDay(matches: Array<{ playedAt: Date | null }>, target: Date) {
  return matches.some((match) => !!match.playedAt && match.playedAt.getDay() === target.getDay());
}

function hasSameDayAndSimilarTime(matches: Array<{ playedAt: Date | null }>, target: Date) {
  const targetMinutes = minutesOfDay(target);
  return matches.some((match) => {
    if (!match.playedAt) return false;
    return match.playedAt.getDay() === target.getDay() && Math.abs(minutesOfDay(match.playedAt) - targetMinutes) <= 90;
  });
}

function hasSameBroadBlock(matches: Array<{ playedAt: Date | null }>, broadLabel: string) {
  return matches.some((match) => !!match.playedAt && broadBlockFromDate(match.playedAt) === broadLabel);
}

function buildSuggestedAvailabilityOverlap({
  myAvailability,
  opponentAvailability,
  pairMatches,
  myMatches,
  opponentMatches,
}: {
  myAvailability: any;
  opponentAvailability: any;
  pairMatches: HubMatch[];
  myMatches: HubMatch[];
  opponentMatches: HubMatch[];
}): AvailabilityOverlap | null {
  const overlap = overlappingBroadAvailability(myAvailability, opponentAvailability);
  if (!overlap.length) return null;

  const suggestions = overlap
    .flatMap((broadLabel) =>
      (SUGGESTION_TEMPLATES[broadLabel] || []).map((template) => {
        const start = nextDateForTemplate(template.day, template.hour, template.minute);
        const pairSameDayAndTime = hasSameDayAndSimilarTime(pairMatches, start);
        const pairSameDay = hasSameDay(pairMatches, start);
        const currentSimilarTime = hasSimilarTime(myMatches, start);
        const opponentSimilarTime = hasSimilarTime(opponentMatches, start);
        const pairSameBroad = hasSameBroadBlock(pairMatches, broadLabel);
        let score = 40;
        if (pairSameDayAndTime) score += 30;
        if (currentSimilarTime) score += 20;
        if (opponentSimilarTime) score += 20;
        if (pairSameDay) score += 15;
        if (pairSameBroad) score += 15;

        const dateLabel = start.toLocaleDateString(undefined, {
          weekday: "short",
          month: "short",
          day: "numeric",
        });
        const timeLabel = start.toLocaleTimeString([], {
          hour: "numeric",
          minute: "2-digit",
        });
        const dayPart = start.toLocaleDateString(undefined, { weekday: "long" });
        const half = start.getHours() < 12 ? "mornings" : "afternoons";
        const reason = pairSameDayAndTime
          ? `You've played ${dayPart} ${half} before`
          : pairSameDay
            ? `You've played on ${dayPart}s before`
            : currentSimilarTime && opponentSimilarTime
              ? "You both tend to play around this time"
              : currentSimilarTime
                ? "You often play around this time"
                : opponentSimilarTime
                  ? "They often play around this time"
                  : pairSameBroad
                    ? `You have played in ${broadLabel} before`
                    : `Matches your shared ${broadLabel} availability`;

        return {
          id: `${broadLabel}-${isoDateFromDate(start)}-${hhmmFromDate(start)}`,
          broadLabel,
          date: isoDateFromDate(start),
          time: hhmmFromDate(start),
          dateLabel,
          timeLabel,
          ctaLabel: `${dateLabel} at ${timeLabel}`,
          reason,
          score,
          start,
        };
      })
    )
    .sort((a, b) => b.score - a.score || a.start.getTime() - b.start.getTime())
    .slice(0, 3);

  if (!suggestions.length) return null;
  const preferred = suggestions[0];
  return {
    slots: suggestions.map((slot) => `${slot.dateLabel} ${slot.timeLabel}`),
    summary: overlap.join(", "),
    preferredSlot: `${preferred.dateLabel} ${preferred.timeLabel}`,
    preferredDate: preferred.date,
    preferredTime: preferred.time,
    suggestions,
  };
}

function isSystemMessage(msg: any) {
  return (
    msg?.type === "system" ||
    msg?.system === true ||
    msg?.senderId === "system" ||
    !msg?.senderId
  );
}

function safeCourtLine(inv: any) {
  const court = inv?.court || null;
  const courtAddress = court
    ? [court?.address, court?.suburb, court?.state, court?.postcode].filter(Boolean).join(", ")
    : "";

  const where = court?.name || courtAddress || inv?.location || "Court TBA";

  return { court, where, courtAddress };
}

function formatInviteWhenSafe(startISO?: string | null) {
  if (!startISO) return "Time TBD";
  try {
    return formatInviteWhen(startISO);
  } catch {
    return "Time TBD";
  }
}

function InviteCard({
  msg,
  isOther,
  isMe,
  onRespond,
  onConfirmBooked,
  currentUid,
  nameByUid,
  onOpenInvite,
}: {
  msg: any;
  isOther: boolean;
  isMe: boolean;
  onRespond: (status: "accepted" | "declined") => void;
  onConfirmBooked: () => void;
  currentUid: string | null;
  nameByUid: Record<string, string>;
  onOpenInvite: (inviteId: string) => void;
}) {

  const inv = msg?.invite || {};
  const when = inv?.startISO ? formatInviteWhen(inv.startISO) : "";
  const duration = inv?.durationMins ? `${inv.durationMins} min` : "";
  const location = inv?.location || "";
  const note = inv?.note || "";
  const status = msg?.inviteStatus || "pending";
  const isRematch =
    msg?.inviteType === "rematch" ||
    msg?.type === "rematch" ||
    msg?.source === "post_match_prompt" ||
    !!msg?.previousInviteId;

  // ✅ NEW: render court map + booking link from stored invite.court
const court = inv?.court || null;

const courtAddressLine = court
  ? [court?.address, court?.suburb, court?.state, court?.postcode].filter(Boolean).join(", ")
  : "";

const mapsHref = court
  ? mapsUrlForAddress(courtAddressLine || court?.name)
  : mapsUrlForAddress(location);

const mapsEmbedUrl = court
  ? mapsEmbedUrlForAddress(courtAddressLine || court?.name)
  : mapsEmbedUrlForAddress(location);

  const canRespond = !isMe && status === "pending";

  const bookingStatus = msg?.inviteBookingStatus || "not_confirmed";
  const showBookingLink = bookingStatus !== "confirmed";
  const bookedBy = typeof msg?.inviteBookedBy === "string" ? msg.inviteBookedBy : null;

  const bookedByLabel =
    bookingStatus === "confirmed"
      ? bookedBy === currentUid
        ? "You"
        : nameByUid[bookedBy || ""] || "Opponent"
      : null;

  const canConfirmBooking = status === "accepted" && bookingStatus !== "confirmed";

  return (
    <div className="w-full min-w-0 max-w-full overflow-hidden">
      <div
        className="text-[12px] font-extrabold mb-2"
        style={{ color: isOther ? "#111827" : "white" }}
      >
        {isRematch ? "🎾 Rematch Invite" : "🎾 Match Invite"}
      </div>

      {isRematch && (
        <div
          className="text-[11px] font-semibold mb-2"
          style={{
            color: isOther ? "rgba(17,24,39,0.68)" : "rgba(255,255,255,0.78)",
          }}
        >
          You played recently - same again?
        </div>
      )}

      <div
        className="text-[13px] font-semibold"
        style={{ color: isOther ? "#111827" : "white" }}
      >
        {when}
      </div>

      <div
  className="text-[12px] mt-1 break-words"
  style={{
    color: isOther ? "rgba(17,24,39,0.75)" : "rgba(255,255,255,0.85)",
  }}
>
  {duration}
  {duration && location ? " • " : ""}
  {location}
</div>

      {/* ✅ NEW: Court + Map + Booking link (from invite.court if present) */}
{(court || mapsEmbedUrl) && (
  <div
    className="mt-3 rounded-2xl p-2.5 sm:p-3"
    style={{
      background: isOther ? "rgba(17,24,39,0.04)" : "rgba(255,255,255,0.10)",
      border: isOther ? "1px solid rgba(17,24,39,0.10)" : "1px solid rgba(255,255,255,0.20)",
    }}
  >
    {/* Court name/address */}
    {court?.name && (
      <div
        className="text-[12px] font-extrabold"
        style={{ color: isOther ? "#111827" : "white" }}
      >
        {court.name}
      </div>
    )}

    {(courtAddressLine || location) && (
      <div
  className="mt-1 text-[12px] break-words leading-snug"
  style={{
    color: isOther ? "rgba(17,24,39,0.75)" : "rgba(255,255,255,0.85)",
  }}
>
  {courtAddressLine || location}
</div>
    )}

    {/* Map iframe (clicking opens google maps) */}
    {mapsEmbedUrl && mapsHref && (
      <a href={mapsHref} target="_blank" rel="noreferrer" className="block mt-3">
        <div
          className="overflow-hidden rounded-2xl"
          style={{
            border: isOther
              ? "1px solid rgba(11,61,46,0.12)"
              : "1px solid rgba(255,255,255,0.20)",
          }}
        >
          <iframe
            src={mapsEmbedUrl}
            width="100%"
            height="160"
            loading="lazy"
            referrerPolicy="no-referrer-when-downgrade"
            className="block w-full pointer-events-none"
          />
        </div>
      </a>
    )}

  {/* Clickable booking link button (hide once confirmed) */}
{showBookingLink && court?.bookingUrl && (
  <a
    href={court.bookingUrl}
    target="_blank"
    rel="noreferrer"
    className="mt-3 inline-flex w-full items-center justify-center rounded-xl px-4 py-2 text-[12px] font-extrabold"
    style={{
      background: TM.neon,
      color: TM.ink,
      boxShadow: "0 6px 18px rgba(57,255,20,0.22)",
    }}
  >
    Book Court ↗
  </a>
)}
  </div>
)}

      {note && (
        <div
          className="text-[12px] mt-2 italic"
          style={{
            color: isOther ? "rgba(17,24,39,0.75)" : "rgba(255,255,255,0.85)",
          }}
        >
          “{note}”
        </div>
      )}

      <div className="mt-3">
        {status === "pending" && (
         <span
  className="text-[12px] font-bold"
  style={{
    color: isOther ? "rgba(17,24,39,0.75)" : "rgba(255,255,255,0.85)",
  }}
>
  Status: Pending
</span>
        )}
        {status === "accepted" && (
          <span className="text-[12px] font-extrabold" style={{ color: "#16a34a" }}>
            ✅ Accepted
          </span>
        )}
        {status === "declined" && (
          <span className="text-[12px] font-extrabold" style={{ color: "#dc2626" }}>
            ❌ Declined
          </span>
        )}
      </div>

      {/* ✅ View Details Button */}
{(msg?.inviteId || msg?.id) && (
  <button
    type="button"
    onClick={() => onOpenInvite(String(msg?.inviteId || msg?.id))}
    className="mt-3 w-full rounded-xl py-2 text-[12px] font-extrabold"
    style={{
      background: TM.neon,
      color: TM.ink,
      boxShadow: "0 6px 18px rgba(57,255,20,0.22)",
    }}
  >
    View Details →
  </button>
)}

      {status === "accepted" && (
        <div className="mt-3 rounded-xl p-3 border">
          <div className="text-[12px] font-extrabold">
            Court Booking
          </div>

          {bookingStatus === "confirmed" ? (
            <div className="mt-1 text-[12px] font-extrabold" style={{ color: "#16a34a" }}>
              🟢 Confirmed {bookedByLabel && `(by ${bookedByLabel})`}
            </div>
          ) : (
            <div className="mt-1 text-[12px] font-extrabold" style={{ color: "#dc2626" }}>
              🔴 Not confirmed
            </div>
          )}

          {canConfirmBooking && (
            <button
              onClick={onConfirmBooked}
              className="mt-3 w-full rounded-xl py-2 text-[12px] font-extrabold"
              style={{ background: TM.neon, color: TM.ink }}
            >
              I’ve booked the court ✅
            </button>
          )}
        </div>
      )}

      {canRespond && (
        <div className="mt-3 flex gap-2">
          <button
            onClick={() => onRespond("accepted")}
            className="flex-1 rounded-xl py-2 text-[12px] font-extrabold"
            style={{ background: "#16a34a", color: "white" }}
          >
            Accept
          </button>
          <button
            onClick={() => onRespond("declined")}
            className="flex-1 rounded-xl py-2 text-[12px] font-extrabold"
            style={{ background: "#ef4444", color: "white" }}
          >
            Decline
          </button>
        </div>
      )}
    </div>
  );
}

function SystemInviteCancelled({
  msg,
  router,
}: {
  msg: any;
  router: ReturnType<typeof useRouter>;
}) {
  // 1) figure out which invite doc to fetch
  const inviteId =
    msg?.inviteId ||
    msg?.messageId ||
    msg?.refInviteId ||
    null;

  const [inviteDoc, setInviteDoc] = useState<any>(null);

  // 2) fetch the match_invites doc if we have an id
  useEffect(() => {
    let cancelled = false;

    (async () => {
      if (!inviteId) return;

      try {
        const snap = await getDoc(doc(db, "match_invites", String(inviteId)));
        if (!cancelled) {
          setInviteDoc(snap.exists() ? snap.data() : null);
        }
      } catch (e) {
        console.error("Failed to load match_invites for cancelled card:", e);
        if (!cancelled) setInviteDoc(null);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [inviteId]);

  // 3) prefer snapshot on message, fallback to match_invites.invite
  const inv =
    msg?.invite ||
    msg?.inviteSnapshot ||
    msg?.inviteData ||
    inviteDoc?.invite ||
    null;

  const when = formatInviteWhenSafe(inv?.startISO || null);
  const duration =
    typeof inv?.durationMins === "number" ? `${inv.durationMins} min` : null;

  const { where } = safeCourtLine(inv || {});

  return (
    <div className="min-w-[240px]">
      <div className="text-[12px] font-extrabold mb-2" style={{ color: "#111827" }}>
        🚫 Invite cancelled
      </div>

      <div className="text-[13px] font-semibold" style={{ color: "#111827" }}>
        {when}
      </div>

      <div className="text-[12px] mt-1" style={{ color: "rgba(17,24,39,0.75)" }}>
        {duration ? `${duration} • ` : ""}
        {where}
      </div>

      <div className="mt-2 text-[12px]" style={{ color: "rgba(17,24,39,0.65)" }}>
        This match invite has been cancelled and is no longer available.
      </div>

      {/* ✅ Removed "View cancelled invite" button */}
    </div>
  );
}


type MatchHubChatProps = {
  conversationId?: string;
  embeddedDesktop?: boolean;
};

export function MatchHubChat({ conversationId, embeddedDesktop = false }: MatchHubChatProps) {
  const params = useParams();
  const conversationID = String(conversationId || params.conversationID || "");
  const router = useRouter();

  // ===== STATE (keep all useState together) =====
  const [user, setUser] = useState<any>(null);
  const [messages, setMessages] = useState<any[]>([]);
  const [input, setInput] = useState("");
  const [userAvatar, setUserAvatar] = useState<string | null>(null);

  const [participants, setParticipants] = useState<string[]>([]);
  const [profiles, setProfiles] = useState<
    Record<
      string,
      {
        name?: string;
        photoURL?: string;
        photoThumbURL?: string;
        avatar?: string;
        availability?: string[];
      }
    >
  >({});
    const nameByUid = useMemo(() => {
    const out: Record<string, string> = {};
    Object.entries(profiles || {}).forEach(([uid, p]) => {
      out[uid] = (p as any)?.name || "Player";
    });
    return out;
  }, [profiles]);
  const [typingUsers, setTypingUsers] = useState<string[]>([]);
  const [isEventChat, setIsEventChat] = useState(false);
  const [eventTitle, setEventTitle] = useState<string | null>(null);

const [lastReadAt, setLastReadAt] = useState<number | null>(null);
const [showScrollDown, setShowScrollDown] = useState(false);
const [vvBottomInset, setVvBottomInset] = useState(0);
const [vvTopInset, setVvTopInset] = useState(0);
const [mobileViewportHeight, setMobileViewportHeight] = useState<number | null>(null);
const [inputBarH, setInputBarH] = useState(56); // measured later
const [inputBarMeasured, setInputBarMeasured] = useState(false);
const [isComposerFocused, setIsComposerFocused] = useState(false);
const [isKeyboardOpen, setIsKeyboardOpen] = useState(false);

const headerTopOffset = Math.max(vvTopInset, embeddedDesktop ? 0 : 12);

  const [otherUserId, setOtherUserId] = useState<string | null>(null);
const [isOtherOnline, setIsOtherOnline] = useState(false);

const [profileOpenId, setProfileOpenId] = useState<string | null>(null);
const [inviteOverlayId, setInviteOverlayId] = useState<string | null>(null);
const [activeTab, setActiveTab] = useState<MatchHubTab>("chat");
const [activeActionSheet, setActiveActionSheet] = useState<MatchHubActionSheet>(null);
const [showHeaderOptions, setShowHeaderOptions] = useState(false);
const [showDeleteMatchConfirm, setShowDeleteMatchConfirm] = useState(false);
const [deleteMatchBusy, setDeleteMatchBusy] = useState(false);
const [successToast, setSuccessToast] = useState<string | null>(null);
const [hubMatches, setHubMatches] = useState<HubMatch[]>([]);
const [availabilityOverlap, setAvailabilityOverlap] = useState<AvailabilityOverlap | null>(null);
const [selectedNextMatchSuggestionId, setSelectedNextMatchSuggestionId] = useState<string | null>(null);
const [matchHubReady, setMatchHubReady] = useState(false);

const [showMatchPrompt, setShowMatchPrompt] = useState(false);
const [rematchPromptInvite, setRematchPromptInvite] = useState<RematchPrefill | null>(null);
const [rematchPromptBusy, setRematchPromptBusy] = useState(false);
const rematchViewedRef = useRef<Set<string>>(new Set());
const isTypingCompact =
  !embeddedDesktop && activeTab === "chat" && (isComposerFocused || isKeyboardOpen);

const profileTargetId = useMemo(() => {
  if (isEventChat) return null;
  return otherUserId || participants.find((p) => p !== user?.uid) || null;
}, [isEventChat, otherUserId, participants, user?.uid]);

const profileAvailabilityKey = useMemo(() => {
  const mine = user?.uid ? availabilitySlotsFrom(profiles[user.uid]?.availability) : [];
  const theirs = otherUserId ? availabilitySlotsFrom(profiles[otherUserId]?.availability) : [];
  return `${mine.join("|")}::${theirs.join("|")}`;
}, [otherUserId, profiles, user?.uid]);

const profileReadyKey = useMemo(() => {
  const meReady = !!(user?.uid && profiles[user.uid]);
  const otherReady = !!(otherUserId && profiles[otherUserId]);
  return `${meReady}:${otherReady}`;
}, [otherUserId, profiles, user?.uid]);

useEffect(() => {
  const suggestions = availabilityOverlap?.suggestions || [];
  if (!suggestions.length) {
    setSelectedNextMatchSuggestionId(null);
    return;
  }
  setSelectedNextMatchSuggestionId((current) =>
    current && suggestions.some((suggestion) => suggestion.id === current)
      ? current
      : suggestions[0].id
  );
}, [availabilityOverlap]);

useEffect(() => {
  if (!profileOpenId) return;

  const onKey = (e: KeyboardEvent) => {
    if (e.key === "Escape") setProfileOpenId(null);
  };

  window.addEventListener("keydown", onKey);
  return () => window.removeEventListener("keydown", onKey);
}, [profileOpenId]);

const MIN_TOTAL_MESSAGES_FOR_MATCH_INTENT = 6;
const MIN_MESSAGES_PER_USER_FOR_MATCH_INTENT = 2;
const MATCH_PROMPT_COOLDOWN_MS = 72 * 60 * 60 * 1000; // 72 hours
const MATCH_CHECK_IN_LAUNCH_AT_MS = new Date("2026-04-14T00:00:00+10:00").getTime();
const MIN_HOURS_SINCE_LAST_MESSAGE = 24;
const MAX_HOURS_SINCE_LAST_MESSAGE = 72;
const MAX_MATCH_PROMPT_SENDS = 1;

const shouldCreateMatchIntent = (
  msgs: any[],
  currentUid: string,
  otherUid: string | null
) => {
  if (!otherUid) return false;
  if (msgs.length < MIN_TOTAL_MESSAGES_FOR_MATCH_INTENT) return false;

  let mine = 0;
  let theirs = 0;

  for (const m of msgs) {
    // ignore system / invite messages
    if (m?.type === "system" || m?.type === "invite") continue;
    if (!m?.senderId) continue;

    if (m.senderId === currentUid) mine++;
    if (m.senderId === otherUid) theirs++;
  }

  return (
    mine >= MIN_MESSAGES_PER_USER_FOR_MATCH_INTENT &&
    theirs >= MIN_MESSAGES_PER_USER_FOR_MATCH_INTENT
  );
};

const hasTwoWayConversation = (
  msgs: any[],
  currentUid: string,
  otherUid: string | null
) => {
  if (!otherUid) return false;

  let mine = 0;
  let theirs = 0;

  for (const m of msgs) {
    if (m?.type === "system" || m?.type === "invite") continue;
    if (!m?.senderId) continue;

    if (m.senderId === currentUid) mine++;
    if (m.senderId === otherUid) theirs++;
  }

  return mine >= 1 && theirs >= 1;
};

const getLastRealMessageMs = (msgs: any[]) => {
  const realMsgs = msgs
    .filter((m) => m?.type !== "system" && m?.type !== "invite" && m?.timestamp?.toDate)
    .sort((a, b) => a.timestamp.toDate().getTime() - b.timestamp.toDate().getTime());

  const last = realMsgs[realMsgs.length - 1];
  return last?.timestamp?.toDate ? last.timestamp.toDate().getTime() : null;
};

const hasMatchHistory = async () => {
  if (!user?.uid) return false;

  const snap = await getDocs(
    query(
      collection(db, "match_history"),
      where("conversationId", "==", String(conversationID)),
      where("players", "array-contains", user.uid),
      limit(1)
    )
  );

  return !snap.empty;
};


const hasUpcomingAcceptedInvite = async () => {
  if (!user?.uid || !otherUserId) return false;

  const snap = await getDocs(
    query(
      collection(db, "match_invites"),
      where("conversationId", "==", String(conversationID)),
      where("participants", "array-contains", user.uid),
      where("inviteStatus", "==", "accepted")
    )
  );

  const docs = snap.docs.filter((d) => {
    const data = d.data() as any;
    return data?.fromUserId === otherUserId || data?.toUserId === otherUserId;
  });

  if (!docs.length) return false;

  const now = Date.now();

  return docs.some((d) => {
    const data = d.data() as any;
    const startISO = data?.invite?.startISO || data?.inviteStart || null;
    if (!startISO) return false;

    const startMs = new Date(startISO).getTime();
    if (!Number.isFinite(startMs)) return false;

    return startMs > now;
  });
};

const hasAnyAcceptedInvite = async () => {
  if (!user?.uid || !otherUserId) return false;

  const snap = await getDocs(
    query(
      collection(db, "match_invites"),
      where("conversationId", "==", String(conversationID)),
      where("participants", "array-contains", user.uid),
      where("inviteStatus", "==", "accepted"),
      limit(10)
    )
  );

  return snap.docs.some((d) => {
    const data = d.data() as any;
    return data?.fromUserId === otherUserId || data?.toUserId === otherUserId;
  });
};

const createMatchCheckInNotification = async (
  recipientId: string,
  otherPlayerName: string,
  conversationId: string
) => {
  const route = `/home?overlay=didPlayPrompt&conversationId=${conversationId}`;

  await addDoc(collection(db, "notifications"), {
    recipientId,
    toUserId: recipientId,
    fromUserId: user.uid,
    type: "match_check_in",
    read: false,
    conversationId,

    title: "Did you play your match?",
    body: `Did you and ${otherPlayerName} end up having a game?`,
    message: `Did you and ${otherPlayerName} end up having a game?`,

    route,
    url: `https://tennismate.vercel.app${route}`,

    timestamp: serverTimestamp(),
    pushDisabled: false,
    source: "chat:match_check_in",
  });
};

const maybeUpsertMatchIntent = async (msgs: any[]) => {
  if (!user || isEventChat) return;
  if (!otherUserId) return;

  const convoRef = doc(db, "conversations", String(conversationID));
  const convoSnap = await getDoc(convoRef);
  const convoData = convoSnap.data() || {};

  const createdAtMs = convoData.createdAt?.toMillis?.() ?? null;
  if (!createdAtMs || createdAtMs < MATCH_CHECK_IN_LAUNCH_AT_MS) return;

  if (convoData.matchCheckInResolved === true) return;
  if (convoData.matchCheckInSuppressed === true) return;
  if ((convoData.matchPromptSendCount || 0) >= MAX_MATCH_PROMPT_SENDS) return;

  // stop if a real match already exists
  if (convoData.activeMatchId) return;

  // both users must have actually chatted
  if (!hasTwoWayConversation(msgs, user.uid, otherUserId)) return;

  // only continue if this chat clearly looks like match planning
  const shouldSetIntent = shouldCreateMatchIntent(msgs, user.uid, otherUserId);
  if (!shouldSetIntent) return;

  const lastRealMessageMs = getLastRealMessageMs(msgs);
  if (!lastRealMessageMs) return;

  const hoursSinceLastMessage = (Date.now() - lastRealMessageMs) / (1000 * 60 * 60);

  if (hoursSinceLastMessage < MIN_HOURS_SINCE_LAST_MESSAGE) return;
  if (hoursSinceLastMessage > MAX_HOURS_SINCE_LAST_MESSAGE) return;

const [acceptedInviteExists, matchHistoryExists] = await Promise.all([
  hasAnyAcceptedInvite(),
  hasMatchHistory(),
]);

if (acceptedInviteExists) return;
if (matchHistoryExists) return;

const now = Date.now();
const lastPromptShownMs =
  convoData.matchPromptLastShownAt?.toMillis?.() ?? null;

if (
  lastPromptShownMs &&
  now - lastPromptShownMs < MATCH_PROMPT_COOLDOWN_MS
) {
  return;
}

const [currentPlayerSnap, otherPlayerSnap] = await Promise.all([
  getDoc(doc(db, "players", user.uid)),
  getDoc(doc(db, "players", otherUserId)),
]);

const currentPlayer = currentPlayerSnap.exists()
  ? (currentPlayerSnap.data() as any)
  : {};
const otherPlayer = otherPlayerSnap.exists()
  ? (otherPlayerSnap.data() as any)
  : {};

const currentPlayerName = currentPlayer?.name || "your opponent";
const otherPlayerName = otherPlayer?.name || "your opponent";

await Promise.all([
  createMatchCheckInNotification(
    user.uid,
    otherPlayerName,
    String(conversationID)
  ),
  createMatchCheckInNotification(
    otherUserId,
    currentPlayerName,
    String(conversationID)
  ),
]);

await updateDoc(convoRef, {
  matchIntentAt: convoData.matchIntentAt || serverTimestamp(),
  matchPromptLastShownAt: serverTimestamp(),
  matchPromptSendCount: (convoData.matchPromptSendCount || 0) + 1,
  [`matchPromptDismissedAt.${user.uid}`]: null,
  updatedAt: serverTimestamp(),
});
};

useEffect(() => {
  if (!inviteOverlayId) return;

  const onKey = (e: KeyboardEvent) => {
    if (e.key === "Escape") setInviteOverlayId(null);
  };

  window.addEventListener("keydown", onKey);
  return () => window.removeEventListener("keydown", onKey);
}, [inviteOverlayId]);

  // ===== INVITE MODAL STATE =====
  const [showInvite, setShowInvite] = useState(false);
  const [inviteDate, setInviteDate] = useState<string>(""); // YYYY-MM-DD
  const [inviteTime, setInviteTime] = useState<string>(""); // HH:MM
  const [inviteDuration, setInviteDuration] = useState<number>(60);
  const [inviteLocation, setInviteLocation] = useState<string>("");
  const [inviteNote, setInviteNote] = useState<string>("");
  const [inviteFlow, setInviteFlow] = useState<"standard" | "rematch">("standard");
  const [inviteStep, setInviteStep] = useState<"time" | "details">("time");
  const [nextMatchTimeMode, setNextMatchTimeMode] = useState<"suggested" | "custom">("suggested");
  const [rematchContext, setRematchContext] = useState<RematchPrefill | null>(null);

    // ===== COURT SUGGESTION STATE =====
  const [courtLoading, setCourtLoading] = useState(false);
  const [suggestedCourt, setSuggestedCourt] = useState<any>(null);
  const [courtError, setCourtError] = useState<string | null>(null);

  // ===== COURT OVERRIDE (SEARCH + SELECT) =====
const [courtQuery, setCourtQuery] = useState("");
const [courtMatches, setCourtMatches] = useState<any[]>([]);
const [courtMatchesLoading, setCourtMatchesLoading] = useState(false);
const [selectedCourt, setSelectedCourt] = useState<any>(null); // manual override

// whichever court we should show + attach to invite
const activeCourt = selectedCourt || suggestedCourt || null;

  // ===== REFS =====
  const bottomRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const inputBarRef = useRef<HTMLDivElement>(null);

  // --- auto-scroll helpers ---
const hasInitialScrolledRef = useRef(false);
const pendingAutoScrollRef = useRef<"auto" | "smooth" | null>(null);
const forceNextSnapshotScrollRef = useRef(false);
const wasNearBottomOnTabLeaveRef = useRef(true);
const chatScrollTopRef = useRef(0);
const pendingChatTabReturnRef = useRef(false);

const isNearBottom = () => {
  const el = listRef.current;
  if (!el) return true;
  return el.scrollHeight - el.scrollTop - el.clientHeight < 120;
};

const scrollToBottom = (smooth = false) => {
  const el = listRef.current;
  if (!el) return;
  el.scrollTo({
    top: el.scrollHeight,
    behavior: smooth ? "smooth" : "auto",
  });
};

useEffect(() => {
  hasInitialScrolledRef.current = false;
  pendingAutoScrollRef.current = null;
  forceNextSnapshotScrollRef.current = false;
  wasNearBottomOnTabLeaveRef.current = true;
  chatScrollTopRef.current = 0;
  pendingChatTabReturnRef.current = false;
  setShowScrollDown(false);
}, [conversationID]);



  // ===== HELPERS =====

  const dismissMatchPrompt = async () => {
  if (!user) return;

  try {
    await updateDoc(doc(db, "conversations", String(conversationID)), {
      [`matchPromptDismissedAt.${user.uid}`]: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });

    setShowMatchPrompt(false);
  } catch (e) {
    console.error("Failed to dismiss match prompt:", e);
  }
};

    const setInviteDateTimeFromISO = (startISO: string) => {
    const d = new Date(startISO);
    if (Number.isNaN(d.getTime())) return;

    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, "0");
    const dd = String(d.getDate()).padStart(2, "0");
    const hh = String(d.getHours()).padStart(2, "0");
    const min = String(d.getMinutes()).padStart(2, "0");

    setInviteDate(`${yyyy}-${mm}-${dd}`);
    setInviteTime(`${hh}:${min}`);
  };

    const openInviteModal = (opts?: {
    flow?: "standard" | "rematch";
    rematch?: RematchPrefill | null;
  }) => {
    const flow = opts?.flow || "standard";
    const rematch = opts?.rematch || null;

    setInviteFlow(flow);
    setRematchContext(rematch);
    setInviteStep(flow === "rematch" ? "details" : "time");
    setNextMatchTimeMode(nextMatchSuggestions.length ? "suggested" : "custom");

    if (flow === "rematch" && rematch) {
      setInviteDateTimeFromISO(rematch.startISO);
      setInviteDuration(rematch.durationMins || 60);
      setInviteLocation(rematch.location || rematch.courtName || "");
      setInviteNote(rematch.note || "");
      setSuggestedCourt(null);
      setCourtError(null);
      setCourtLoading(false);
      setCourtQuery(rematch.courtName || rematch.location || "");
      setCourtMatches([]);
      setSelectedCourt(rematch.court || null);
      setShowInvite(true);
      return;
    }

    const now = new Date();
    const yyyy = now.getFullYear();
    const mm = String(now.getMonth() + 1).padStart(2, "0");
    const dd = String(now.getDate()).padStart(2, "0");
    setInviteDate(`${yyyy}-${mm}-${dd}`);

    const hh = String(now.getHours()).padStart(2, "0");
    const rounded = Math.ceil(now.getMinutes() / 5) * 5;
    const min = String(rounded === 60 ? 0 : rounded).padStart(2, "0");
    setInviteTime(`${hh}:${min}`);

setInviteDuration(60);
setInviteLocation("");
setInviteNote("");



// reset override search every time modal opens
setCourtQuery("");
setCourtMatches([]);
setSelectedCourt(null);
setSuggestedCourt(null);
setCourtError(null);

setShowInvite(true);
  };

  const closeInviteModal = () => {
    setShowInvite(false);
    setInviteFlow("standard");
    setInviteStep("time");
    setNextMatchTimeMode("suggested");
    setRematchContext(null);
  };

  const combineDateTimeISO = (dateStr: string, timeStr: string) => {
    const [y, m, d] = dateStr.split("-").map(Number);
    const [hh, mm] = timeStr.split(":").map(Number);
    const dt = new Date(y, (m || 1) - 1, d || 1, hh || 0, mm || 0, 0, 0);
    return dt.toISOString();
  };

 const fetchSuggestedCourt = async () => {
  if (!user) return null;
  if (isEventChat) return null;

  const otherId =
    otherUserId ||
    String(conversationID || "").split("_").find((id) => id !== user.uid) ||
    null;

  if (!otherId) return null;

  setCourtLoading(true);
  setCourtError(null);
  setSuggestedCourt(null);

 try {
    const res = await getSuggestedCourtsForInvite({
      conversationId: String(conversationID),
      maxResults: 1,
    });

    const best = res?.courts?.[0] || null;

    if (!best) {
      setCourtError("No suitable court found.");
      return null;
    }

    setSuggestedCourt(best);

    const locationLine =
      best?.name ||
      [best?.suburb, best?.postcode].filter(Boolean).join(" ") ||
      "";

    if (locationLine) setInviteLocation(locationLine);

    return best;
  } catch (e: any) {
    console.error("fetchSuggestedCourt error:", e);
    setCourtError(e?.message ? `Court suggestion error: ${e.message}` : "Couldn’t suggest a court right now.");
    return null;
  } finally {
    setCourtLoading(false);
  }
};

// ===== COURT SEARCH (prefix search using courts.nameLower) =====
const searchCourtsPrefix = async (text: string) => {
  const qText = text.trim().toLowerCase();

  if (qText.length < 2) {
    setCourtMatches([]);
    return;
  }

  setCourtMatchesLoading(true);
  try {
    const courtsRef = collection(db, "courts");

    const qs = query(
      courtsRef,
      orderBy("nameLower"),
      where("nameLower", ">=", qText),
      where("nameLower", "<", qText + "\uf8ff"),
      limit(8)
    );

    const snap = await getDocs(qs);
    setCourtMatches(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
  } catch (e) {
    console.error("searchCourtsPrefix error:", e);
    setCourtMatches([]);
  } finally {
    setCourtMatchesLoading(false);
  }
};

const debouncedCourtSearch = useMemo(
  () => debounce((val: string) => searchCourtsPrefix(val), 250),
  []
);

useEffect(() => {
  return () => debouncedCourtSearch.cancel();
}, [debouncedCourtSearch]);

  const focusWithoutScroll = () => {
    const el = inputRef.current;
    if (!el) return;
    try { el.focus({ preventScroll: true }); } catch { el.focus(); }
  };


  const ts = (m: any) => (m?.timestamp?.toDate ? m.timestamp.toDate().getTime() : 0);
  const isSameDay = (a: Date, b: Date) =>
    a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
  const dayLabel = (d: Date) => {
    const today = new Date();
    const yest = new Date(); yest.setDate(today.getDate() - 1);
    if (isSameDay(d, today)) return "Today";
    if (isSameDay(d, yest)) return "Yesterday";
    return d.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
  };
  const timeLabel = (d: Date) => d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

  const ONLINE_WINDOW_MS = 2 * 60 * 1000; // 2 minutes (tweak as you like)

const isOnlineFrom = (lastActiveAt: any) => {
  // lastActiveAt can be Firestore Timestamp, number, or null
  const ms =
    lastActiveAt?.toMillis?.() ??
    (typeof lastActiveAt === "number" ? lastActiveAt : null);

  if (!ms) return false;
  return Date.now() - ms <= ONLINE_WINDOW_MS;
};

// ✅ Clear unread MESSAGE notifications for this conversation (fix desktop sidebar pill)
const clearMessageNotifsForConversation = async (uid: string, convoId: string) => {
  try {
    const qy = query(
      collection(db, "notifications"),
      where("recipientId", "==", uid),
      where("conversationId", "==", convoId),
      where("type", "==", "message"),
      where("read", "==", false)
    );

    const snap = await getDocs(qy);
    if (snap.empty) return;

    const batch = writeBatch(db);
    snap.docs.forEach((d) => {
      batch.update(d.ref, {
        read: true,
        readAt: serverTimestamp(),
      });
    });

    await batch.commit();
  } catch (e) {
    console.error("Failed to clear message notifications for conversation", e);
  }
};

const handleDeleteMatchForMe = async () => {
  if (!user?.uid || !conversationID || isEventChat) return;

  const currentUid = user.uid;
  const convoId = String(conversationID);
  const opponentId =
    otherUserId ||
    participants.find((id) => id !== currentUid) ||
    convoId.split("_").find((id) => id !== currentUid) ||
    null;

  setDeleteMatchBusy(true);

  try {
    const batch = writeBatch(db);
    const convoRef = doc(db, "conversations", convoId);

    batch.set(
      convoRef,
      {
        hiddenFor: { [currentUid]: serverTimestamp() },
        matchConnectionHiddenFor: { [currentUid]: serverTimestamp() },
        matchConnectionDeletedFor: { [currentUid]: serverTimestamp() },
        matchConnectionDeletedBy: currentUid,
        matchConnectionDeletedAt: serverTimestamp(),
        lastRead: { [currentUid]: serverTimestamp() },
        updatedAt: serverTimestamp(),
      },
      { merge: true }
    );

    if (opponentId) {
      const relationshipRef = doc(db, "player_relationships", getPairId(currentUid, opponentId));
      batch.set(
        relationshipRef,
        {
          chatHiddenFor: { [currentUid]: serverTimestamp() },
          matchConnectionHiddenFor: { [currentUid]: serverTimestamp() },
          matchConnectionDeletedFor: { [currentUid]: serverTimestamp() },
          updatedAt: serverTimestamp(),
        },
        { merge: true }
      );
    }

    await batch.commit();
    await clearMessageNotifsForConversation(currentUid, convoId);

    setShowHeaderOptions(false);
    setShowDeleteMatchConfirm(false);
    setSuccessToast("Match removed from your app.");

    window.setTimeout(() => {
      router.push("/messages");
    }, 450);
  } catch (error) {
    console.error("Failed to delete match for current user:", error);
    alert("Could not delete this match right now. Please try again.");
  } finally {
    setDeleteMatchBusy(false);
  }
};

  useEffect(() => {
    if (!user?.uid || !conversationID || isEventChat || rematchPromptInvite) return;

    let cancelled = false;

    const checkEligibleRematch = async () => {
      try {
        const eligible = await findEligibleRematchInvite({
          conversationId: String(conversationID),
          currentUserId: user.uid,
        });

        if (!eligible || cancelled) return;

        await markRematchPromptShown(eligible.previousInviteId, user.uid);
        if (cancelled) return;

        setRematchPromptInvite(eligible);
        trackEvent("rematch_prompt_shown", {
          conversationId: String(conversationID),
          previousInviteId: eligible.previousInviteId,
          opponentId: eligible.opponentId,
        });
      } catch (e) {
        console.error("Failed to check rematch prompt eligibility:", e);
      }
    };

    void checkEligibleRematch();
    const timer = window.setInterval(() => {
      void checkEligibleRematch();
    }, 60_000);

    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [conversationID, isEventChat, rematchPromptInvite, user?.uid]);

  useEffect(() => {
    if (!messages.length) return;

    for (const msg of messages) {
      const inviteId = typeof msg?.inviteId === "string" ? msg.inviteId : typeof msg?.id === "string" ? msg.id : null;
      const isRematch =
        msg?.inviteType === "rematch" ||
        msg?.type === "rematch" ||
        msg?.source === "post_match_prompt" ||
        !!msg?.previousInviteId;

      if (!inviteId || !isRematch) continue;
      if (rematchViewedRef.current.has(inviteId)) continue;

      const sessionKey = `tm_rematch_invite_viewed_${inviteId}`;
      if (typeof window !== "undefined" && sessionStorage.getItem(sessionKey)) {
        rematchViewedRef.current.add(inviteId);
        continue;
      }

      rematchViewedRef.current.add(inviteId);
      if (typeof window !== "undefined") {
        sessionStorage.setItem(sessionKey, "1");
      }

      trackEvent("rematch_invite_viewed", {
        inviteId,
        previousInviteId: msg?.previousInviteId || null,
        conversationId: String(conversationID),
        startISO: msg?.invite?.startISO || null,
        source: msg?.source || null,
        type: msg?.inviteType || msg?.type || "invite",
      });
    }
  }, [conversationID, messages]);

  // ===== AUTH / CONVO SNAPSHOT =====
  useEffect(() => {
  let unsubscribeTyping: () => void = () => {};
  let currentUserId: string | null = null;
  let heartbeatTimer: any = null;

  const updateOwnLastActiveAt = async (uid: string, reason: string) => {
    const signedInUid = auth.currentUser?.uid ?? null;

    if (!signedInUid || signedInUid !== uid) {
      console.warn("[ChatPage] skipped lastActiveAt update for non-current player", {
        requestedUid: uid,
        signedInUid,
        reason,
      });
      return;
    }

    try {
      const playerRef = doc(db, "players", signedInUid);
      const playerSnap = await getDoc(playerRef);

      if (!playerSnap.exists()) {
        console.warn("[ChatPage] skipped lastActiveAt update because player doc is missing", {
          uid: signedInUid,
          reason,
        });
        return;
      }

      await updateDoc(playerRef, { lastActiveAt: serverTimestamp() });
    } catch (err) {
      console.warn("[ChatPage] optional lastActiveAt update failed", {
        uid: signedInUid,
        reason,
        code: (err as any)?.code,
        message: (err as any)?.message,
      });
    }
  };

    const unsubscribeAuth = auth.onAuthStateChanged(async (u) => {
      if (!u) return;
      setUser(u);
      currentUserId = u.uid;

      await updateOwnLastActiveAt(u.uid, "messages_page_enter");

// keep it fresh while this page is open
heartbeatTimer = setInterval(async () => {
  await updateOwnLastActiveAt(u.uid, "messages_page_heartbeat");
}, 30_000);


      const convoRef = doc(db, "conversations", String(conversationID));
      console.log("[ChatPage] reading conversation", {
        uid: auth.currentUser?.uid ?? null,
        conversationID: String(conversationID),
      });
      let convoSnap = await getDoc(convoRef);
      console.log("[ChatPage] conversation read success", {
        conversationID: String(conversationID),
        exists: convoSnap.exists(),
        participants: convoSnap.exists()
          ? Array.isArray(convoSnap.data()?.participants)
            ? convoSnap.data()?.participants
            : []
          : [],
      });

      // Only auto-create 1:1 conversations (IDs that look like "<uid>_<uid>")
      const parts = String(conversationID || "").split("_");
      const looksLikeOneToOne = parts.length === 2 && parts.every(Boolean);
      const otherUserId = looksLikeOneToOne ? (parts.find((id) => id !== u.uid) ?? null) : null;
setOtherUserId(otherUserId);

if (!convoSnap.exists() && looksLikeOneToOne && otherUserId) {
  const relationshipFields = relationshipFieldsForParticipants([u.uid, otherUserId]);
  await setDoc(convoRef, {
    participants: [u.uid, otherUserId],
    ...(relationshipFields
      ? {
          pairId: relationshipFields.pairId,
          relationshipRefPath: relationshipFields.relationshipRefPath,
        }
      : {}),
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
    typing: {},
    lastRead: { [u.uid]: serverTimestamp() },

    // match prompt tracking
    matchIntentAt: null,
    matchPromptLastShownAt: null,
    matchPromptSendCount: 0,
    matchCheckInResolved: false,
    matchCheckInSuppressed: false,
    activeMatchId: null,
  });

  if (relationshipFields) {
    try {
      await ensureOneToOneConversationRelationship(
        db,
        String(conversationID),
        relationshipFields.players,
        u.uid,
        relationshipFields.pairId,
        relationshipFields.relationshipRefPath
      );
    } catch (error) {
      console.warn("[player_relationships:stage4] conversation relationship upsert failed", {
        conversationId: String(conversationID),
        pairId: relationshipFields.pairId,
        actorId: u.uid,
        error,
      });
    }
  }
} else if (convoSnap.exists()) {
  await updateDoc(convoRef, { [`lastRead.${u.uid}`]: serverTimestamp() });
}

      // ✅ IMPORTANT: also mark unread message notifications as read (desktop pill)
await clearMessageNotifsForConversation(u.uid, String(conversationID));

      // refresh after potential creation/update
      convoSnap = await getDoc(convoRef);
      console.log("[ChatPage] conversation refresh success", {
        conversationID: String(conversationID),
        exists: convoSnap.exists(),
        participants: convoSnap.exists()
          ? Array.isArray(convoSnap.data()?.participants)
            ? convoSnap.data()?.participants
            : []
          : [],
      });

      // load my avatar
      const meRef = doc(db, "players", u.uid);
      const meSnap = await getDoc(meRef);
      if (meSnap.exists()) setUserAvatar(resolveSmallProfilePhoto(meSnap.data()) || null);

      // conversation snapshot (context/participants/typing/lastRead)
unsubscribeTyping = onSnapshot(convoRef, (snap) => {
  const data = snap.data() || {};

  const ctx = data.context || {};
  const isEvent = ctx.type === "event";
  setIsEventChat(!!isEvent);
  setEventTitle(isEvent ? (ctx.title || "Event Chat") : null);

  const ps: string[] = Array.isArray(data.participants) ? data.participants : [];
  setParticipants(ps);

  const typingMap = data.typing || {};
  const me = auth.currentUser?.uid;
  const othersTyping = ps.filter((id: string) => id !== me && typingMap[id] === true);
  setTypingUsers(othersTyping);

  const lr = data.lastRead?.[me || ""];
  setLastReadAt(lr?.toMillis ? lr.toMillis() : null);

const hasMatchIntent = !!data.matchIntentAt;
const hasActiveMatch = !!data.activeMatchId;
const dismissedAt = me ? data.matchPromptDismissedAt?.[me] : null;
const isResolved = data.matchCheckInResolved === true;
const isSuppressed = data.matchCheckInSuppressed === true;

setShowMatchPrompt(
  !isEventChat &&
  hasMatchIntent &&
  !hasActiveMatch &&
  !dismissedAt &&
  !isResolved &&
  !isSuppressed
);
}, (err) => {
  console.error("[CHAT SNAPSHOT ERROR] conversation doc listener", err);
});
    });

    return () => {
  unsubscribeAuth();
  unsubscribeTyping();

  if (heartbeatTimer) clearInterval(heartbeatTimer);

  if (currentUserId) {
    updateOwnLastActiveAt(currentUserId, "messages_page_exit");
  }
};

  }, [conversationID]);

  // ===== INPUT BAR MEASUREMENT =====
  
  useEffect(() => {
    const el = inputBarRef.current;
    if (!el) return;

    const setH = () => {
      setInputBarH(el.clientHeight || 56);
      setInputBarMeasured(true);
    };
    setH();

    let ro: ResizeObserver | null = null;
    if ("ResizeObserver" in window) {
      ro = new ResizeObserver(setH);
      ro.observe(el);
    }
    window.addEventListener("resize", setH);
    return () => {
      ro?.disconnect();
      window.removeEventListener("resize", setH);
    };
  }, []);

  // ===== VISUAL VIEWPORT (iOS mobile keyboards) =====
  useEffect(() => {
  if (typeof window === "undefined") return;

  const vv = window.visualViewport;
  const isIOS = isIOSViewportPlatform();

  if (!isIOS || !vv) {
    // Android Chrome already behaves correctly with h-dvh and focus-based compact mode.
    // Avoid applying iOS visualViewport math there because it can introduce layout jumps.
    setVvTopInset(0);
    setVvBottomInset(0);
    setMobileViewportHeight(null);
    setIsKeyboardOpen(false);
    return;
  }

  const computeInset = () => {
    const visibleHeight = Math.max(320, vv.height);
    const topInset = Math.max(0, vv.offsetTop);
    const keyboardDelta = Math.max(0, window.innerHeight - visibleHeight);
    const bottomInset = Math.max(0, window.innerHeight - (visibleHeight + vv.offsetTop));

    // iOS Safari/PWA keeps layout viewport and visual viewport out of sync while the
    // keyboard animates. On iOS, visualViewport.height is the reliable visible area.
    setVvTopInset(topInset);
    setVvBottomInset(bottomInset);
    setMobileViewportHeight(visibleHeight);
    setIsKeyboardOpen(keyboardDelta > 80);
  };

  computeInset();
  vv.addEventListener("resize", computeInset);
  vv.addEventListener("scroll", computeInset);
  window.addEventListener("resize", computeInset);

  return () => {
    vv.removeEventListener("resize", computeInset);
    vv.removeEventListener("scroll", computeInset);
    window.removeEventListener("resize", computeInset);
  };
}, []);

 useEffect(() => {
  // If the textarea is focused (keyboard up), always keep latest visible.
  // Otherwise, only stick if user was already near bottom.
  if (document.activeElement === inputRef.current) {
    scrollToBottom(false);
  } else if (isNearBottom()) {
    scrollToBottom(false);
  }
}, [vvBottomInset, mobileViewportHeight, inputBarH]);


  // ===== LOAD PARTICIPANT PROFILES (TOP-LEVEL EFFECT) =====
  useEffect(() => {
    if (!participants.length) return;

    const unsubs = participants.map((uid) =>
      onSnapshot(
        doc(db, "players", uid),
        (pSnap) => {
          const d = pSnap.exists() ? (pSnap.data() as any) : {};
          setProfiles((prev) => ({
            ...prev,
            [uid]: {
              name: d.name,
              photoURL: d.photoURL,
              photoThumbURL: d.photoThumbURL,
              avatar: d.avatar,
              availability: Array.isArray(d.availability) ? d.availability : [],
            },
          }));

          if (uid === auth.currentUser?.uid) {
            setUserAvatar(resolveSmallProfilePhoto(d) || null);
          }
        },
        () => {
          setProfiles((prev) => ({ ...prev, [uid]: prev[uid] || {} }));
        }
      )
    );

    return () => {
      unsubs.forEach((unsub) => unsub());
    };
  }, [participants]);

    // ===== OTHER USER ONLINE STATUS (TOP-LEVEL EFFECT) =====
  useEffect(() => {
    if (!otherUserId || isEventChat) {
      setIsOtherOnline(false);
      return;
    }

    const pref = doc(db, "players", otherUserId);

    const unsub = onSnapshot(
      pref,
      (snap) => {
        const data = snap.data() as any;
        setIsOtherOnline(isOnlineFrom(data?.lastActiveAt ?? null));
      },
      (err) => {
        console.error("[CHAT SNAPSHOT ERROR] other player profile listener", err);
        setIsOtherOnline(false);
      }
    );

    return () => unsub();
  }, [otherUserId, isEventChat]);

  useEffect(() => {
    let cancelled = false;
    setMatchHubReady(false);

    async function loadMatchHubData() {
      if (!user?.uid || !otherUserId || isEventChat) {
        setHubMatches([]);
        setAvailabilityOverlap(null);
        setMatchHubReady(true);
        return;
      }

      if (!profiles[user.uid] || !profiles[otherUserId]) {
        setHubMatches([]);
        setAvailabilityOverlap(null);
        setMatchHubReady(false);
        return;
      }

      const safeDocs = async (purpose: string, q: any) => {
        try {
          return await getDocs(q);
        } catch (error) {
          console.warn("[MatchHub] optional query failed", { purpose, error });
          return null;
        }
      };

      try {
        const pairId = getPairId(user.uid, otherUserId);
        const byMatch = new Map<string, { id: string; source: string; data: any }>();
        const myHistory = new Map<string, { id: string; source: string; data: any }>();
        const opponentHistory = new Map<string, { id: string; source: string; data: any }>();
        const addRow = (id: string, source: string, data: any) => {
          if (!hasBothHubPlayers(data, user.uid, otherUserId)) return;
          if (!matchIsCompleted(data)) return;
          const key = String(hubMatchKey({ id, ...data }) || `${source}:${id}`);
          const existing = byMatch.get(key);
          if (existing?.source === "match_history") return;
          byMatch.set(key, { id, source, data: { id, ...data } });
        };
        const addPlayerHistory = (
          target: Map<string, { id: string; source: string; data: any }>,
          playerId: string,
          id: string,
          source: string,
          data: any
        ) => {
          if (!hasHubPlayer(data, playerId)) return;
          if (!matchIsCompleted(data)) return;
          const key = String(hubMatchKey({ id, ...data }) || `${source}:${id}`);
          if (!target.has(key)) target.set(key, { id, source, data: { id, ...data } });
        };

        const [
          pairHistorySnap,
          currentHistorySnap,
          opponentHistorySnap,
          historyFromMeSnap,
          historyToMeSnap,
          scoreSnap,
          currentScoreSnap,
          opponentScoreSnap,
          completedSnap,
          opponentCompletedSnap,
          completedFromMeSnap,
          completedToMeSnap,
        ] = await Promise.all([
          safeDocs(
            "match_history by pairId",
            query(
              collection(db, "match_history"),
              where("pairId", "==", pairId),
              where("players", "array-contains", user.uid),
              limit(50)
            )
          ),
          safeDocs(
            "match_history by current player",
            query(
              collection(db, "match_history"),
              where("players", "array-contains", user.uid),
              limit(75)
            )
          ),
          safeDocs(
            "match_history by opponent player",
            query(
              collection(db, "match_history"),
              where("players", "array-contains", otherUserId),
              limit(75)
            )
          ),
          safeDocs(
            "match_history from current to opponent",
            query(
              collection(db, "match_history"),
              where("fromUserId", "==", user.uid),
              where("toUserId", "==", otherUserId),
              limit(50)
            )
          ),
          safeDocs(
            "match_history from opponent to current",
            query(
              collection(db, "match_history"),
              where("fromUserId", "==", otherUserId),
              where("toUserId", "==", user.uid),
              limit(50)
            )
          ),
          safeDocs(
            "match_scores by pairId",
            query(
              collection(db, "match_scores"),
              where("pairId", "==", pairId),
              where("players", "array-contains", user.uid),
              limit(25)
            )
          ),
          safeDocs(
            "match_scores by current player",
            query(
              collection(db, "match_scores"),
              where("players", "array-contains", user.uid),
              limit(50)
            )
          ),
          safeDocs(
            "match_scores by opponent player",
            query(
              collection(db, "match_scores"),
              where("players", "array-contains", otherUserId),
              limit(50)
            )
          ),
          safeDocs(
            "completed_matches by current player array",
            query(
              collection(db, "completed_matches"),
              where("players", "array-contains", user.uid),
              limit(50)
            )
          ),
          safeDocs(
            "completed_matches by opponent player array",
            query(
              collection(db, "completed_matches"),
              where("players", "array-contains", otherUserId),
              limit(50)
            )
          ),
          safeDocs(
            "completed_matches from current to opponent",
            query(
              collection(db, "completed_matches"),
              where("fromUserId", "==", user.uid),
              where("toUserId", "==", otherUserId),
              limit(50)
            )
          ),
          safeDocs(
            "completed_matches from opponent to current",
            query(
              collection(db, "completed_matches"),
              where("fromUserId", "==", otherUserId),
              where("toUserId", "==", user.uid),
              limit(50)
            )
          ),
        ]);

        [
          ...(pairHistorySnap?.docs ?? []),
          ...(currentHistorySnap?.docs ?? []),
          ...(opponentHistorySnap?.docs ?? []),
          ...(historyFromMeSnap?.docs ?? []),
          ...(historyToMeSnap?.docs ?? []),
        ].forEach((docSnap) => {
          addRow(docSnap.id, "match_history", docSnap.data() as any);
        });

        [...(scoreSnap?.docs ?? []), ...(currentScoreSnap?.docs ?? []), ...(opponentScoreSnap?.docs ?? [])].forEach((docSnap) => {
          addRow(docSnap.id, "match_scores", docSnap.data() as any);
        });

        [
          ...(completedSnap?.docs ?? []),
          ...(opponentCompletedSnap?.docs ?? []),
          ...(completedFromMeSnap?.docs ?? []),
          ...(completedToMeSnap?.docs ?? []),
        ].forEach((docSnap) => {
          addRow(docSnap.id, "completed_matches", docSnap.data() as any);
        });

        [
          ...(currentHistorySnap?.docs ?? []),
          ...(historyFromMeSnap?.docs ?? []),
          ...(historyToMeSnap?.docs ?? []),
        ].forEach((docSnap) => {
          addPlayerHistory(myHistory, user.uid, docSnap.id, "match_history", docSnap.data() as any);
        });
        [...(currentScoreSnap?.docs ?? []), ...(scoreSnap?.docs ?? [])].forEach((docSnap) => {
          addPlayerHistory(myHistory, user.uid, docSnap.id, "match_scores", docSnap.data() as any);
        });
        [
          ...(completedSnap?.docs ?? []),
          ...(completedFromMeSnap?.docs ?? []),
          ...(completedToMeSnap?.docs ?? []),
        ].forEach((docSnap) => {
          addPlayerHistory(myHistory, user.uid, docSnap.id, "completed_matches", docSnap.data() as any);
        });

        [
          ...(opponentHistorySnap?.docs ?? []),
          ...(historyFromMeSnap?.docs ?? []),
          ...(historyToMeSnap?.docs ?? []),
        ].forEach((docSnap) => {
          addPlayerHistory(opponentHistory, otherUserId, docSnap.id, "match_history", docSnap.data() as any);
        });
        [...(opponentScoreSnap?.docs ?? []), ...(scoreSnap?.docs ?? [])].forEach((docSnap) => {
          addPlayerHistory(opponentHistory, otherUserId, docSnap.id, "match_scores", docSnap.data() as any);
        });
        [
          ...(opponentCompletedSnap?.docs ?? []),
          ...(completedFromMeSnap?.docs ?? []),
          ...(completedToMeSnap?.docs ?? []),
        ].forEach((docSnap) => {
          addPlayerHistory(opponentHistory, otherUserId, docSnap.id, "completed_matches", docSnap.data() as any);
        });

        const matches = Array.from(byMatch.values())
          .map((row) => buildHubMatch(row, user.uid, otherUserId))
          .sort((a, b) => (b.playedAt?.getTime() || 0) - (a.playedAt?.getTime() || 0));
        const myMatches = Array.from(myHistory.values())
          .map((row) => buildHubMatch(row, user.uid, otherUserId))
          .sort((a, b) => (b.playedAt?.getTime() || 0) - (a.playedAt?.getTime() || 0));
        const opponentMatches = Array.from(opponentHistory.values())
          .map((row) => buildHubMatch(row, user.uid, otherUserId))
          .sort((a, b) => (b.playedAt?.getTime() || 0) - (a.playedAt?.getTime() || 0));

        const overlap = buildSuggestedAvailabilityOverlap({
          myAvailability: profiles[user.uid]?.availability,
          opponentAvailability: profiles[otherUserId]?.availability,
          pairMatches: matches,
          myMatches,
          opponentMatches,
        });

        if (!cancelled) {
          setHubMatches(matches);
          setAvailabilityOverlap(overlap);
          setMatchHubReady(true);
        }
      } catch (error) {
        console.warn("[MatchHub] failed to load data", error);
        if (!cancelled) {
          setHubMatches([]);
          setAvailabilityOverlap(null);
          setMatchHubReady(true);
        }
      }
    }

    void loadMatchHubData();

    return () => {
      cancelled = true;
    };
  }, [conversationID, isEventChat, otherUserId, profileAvailabilityKey, profileReadyKey, user?.uid]);


  // ===== MESSAGES SUBSCRIPTION =====
  useEffect(() => {
    if (!conversationID) return;
    const msgRef = collection(db, "conversations", String(conversationID), "messages");
    const q = query(msgRef, orderBy("timestamp"));

const unsub = onSnapshot(q, async (snap) => {
  const msgs = snap.docs.map((d) => ({ id: d.id, ...d.data() }));

  const shouldStick =
    forceNextSnapshotScrollRef.current ||
    (hasInitialScrolledRef.current && isNearBottom());
  forceNextSnapshotScrollRef.current = false;
  setMessages(msgs);

  if (shouldStick) pendingAutoScrollRef.current = "smooth";

  if (!user) return;

   await maybeUpsertMatchIntent(msgs);


  // Per-message read flags for 1:1 only
  if (!isEventChat) {
    const batch = writeBatch(db);
    let needsCommit = false;

    snap.docs.forEach((d) => {
      const msg = d.data();
      if (msg.recipientId === user.uid && msg.read !== true) {
        batch.update(d.ref, { read: true });
        needsCommit = true;
      }
    });

    if (needsCommit) await batch.commit();
  }

  // Always bump my lastRead
  await updateDoc(doc(db, "conversations", String(conversationID)), {
    [`lastRead.${user.uid}`]: serverTimestamp(),
  });

  // ✅ Also clear "message" notifications tied to this convo (desktop sidebar)
  await clearMessageNotifsForConversation(user.uid, String(conversationID));
}, (err) => {
  console.error("[CHAT SNAPSHOT ERROR] messages listener", err);
});

return () => unsub();

 }, [conversationID, user, isEventChat, otherUserId]);

  // ===== SEND =====
  const sendMessage = async () => {
    if (!input.trim() || !user) return;

    let recipientId: string | null = null;
    if (!isEventChat) {
      const allIds = String(conversationID || "").split("_");
      recipientId = allIds.find((id) => id !== user.uid) ?? null;
      if (!recipientId) return; // ensure valid 1:1
    }

    let conversationRelationship: ReturnType<typeof relationshipFieldsForParticipants> = null;
    if (!isEventChat && recipientId) {
      const convoRef = doc(db, "conversations", String(conversationID));
      const convoSnap = await getDoc(convoRef);
      const convoData = convoSnap.exists() ? (convoSnap.data() as any) : {};
      const convoParticipants = Array.isArray(convoData.participants)
        ? convoData.participants
        : participants;

      try {
        conversationRelationship = await ensureOneToOneConversationRelationship(
          db,
          String(conversationID),
          convoParticipants,
          user.uid,
          typeof convoData.pairId === "string" ? convoData.pairId : null,
          typeof convoData.relationshipRefPath === "string" ? convoData.relationshipRefPath : null
        );
      } catch (error) {
        conversationRelationship = relationshipFieldsForParticipants(convoParticipants);
        console.warn("[player_relationships:stage4] conversation repair/upsert failed before message send", {
          conversationId: String(conversationID),
          senderId: user.uid,
          pairId: conversationRelationship?.pairId ?? null,
          error,
        });
      }
    }

    const newMessage: any = {
      senderId: user.uid,
      recipientId, // null for event chats
      text: input,
      timestamp: serverTimestamp(),
      ...(conversationRelationship
        ? {
            pairId: conversationRelationship.pairId,
            relationshipRefPath: conversationRelationship.relationshipRefPath,
          }
        : {}),
    };
    if (!isEventChat) newMessage.read = false;

    console.log("[ChatPage] sending message payload", {
      conversationID: String(conversationID),
      payload: newMessage,
    });
    forceNextSnapshotScrollRef.current = true;
    const msgRef = await addDoc(collection(db, "conversations", String(conversationID), "messages"), newMessage);
    console.log("[ChatPage] message addDoc success", {
      conversationID: String(conversationID),
    });

    if (conversationRelationship) {
      try {
        await upsertMessageRelationship(
          db,
          conversationRelationship.players[0],
          conversationRelationship.players[1],
          String(conversationID),
          msgRef.id,
          user.uid
        );
      } catch (error) {
        console.warn("[player_relationships:stage4] message relationship upsert failed", {
          conversationId: String(conversationID),
          messageId: msgRef.id,
          pairId: conversationRelationship.pairId,
          senderId: user.uid,
          error,
        });
      }
    }

    setInput("");

    try {
      await updateDoc(doc(db, "conversations", String(conversationID)), {
        [`lastRead.${user.uid}`]: serverTimestamp(),
        [`typing.${user.uid}`]: false,
        [`hiddenFor.${user.uid}`]: deleteField(),
        [`matchConnectionHiddenFor.${user.uid}`]: deleteField(),
        [`matchConnectionDeletedFor.${user.uid}`]: deleteField(),
        latestMessage: { text: newMessage.text, senderId: user.uid, timestamp: serverTimestamp() },
        updatedAt: serverTimestamp(),
      });
      console.log("[ChatPage] parent conversation update success", {
        conversationID: String(conversationID),
      });
    } catch (error) {
      console.error("[ChatPage] parent conversation update failed", {
        conversationID: String(conversationID),
        error,
      });
      throw error;
    }

    if (conversationRelationship) {
      try {
        await updateDoc(doc(db, "player_relationships", conversationRelationship.pairId), {
          [`chatHiddenFor.${user.uid}`]: deleteField(),
          [`matchConnectionHiddenFor.${user.uid}`]: deleteField(),
          [`matchConnectionDeletedFor.${user.uid}`]: deleteField(),
          updatedAt: serverTimestamp(),
        });
      } catch (error) {
        console.warn("[player_relationships] failed to clear current user's hidden state after message send", {
          conversationId: String(conversationID),
          pairId: conversationRelationship.pairId,
          senderId: user.uid,
          error,
        });
      }
    }

  };

  const handleDismissRematchPrompt = async () => {
    if (!user || !rematchPromptInvite) return;

    try {
      setRematchPromptBusy(true);
      await dismissRematchPrompt(rematchPromptInvite.previousInviteId, user.uid);
      trackEvent("rematch_prompt_dismissed", {
        conversationId: String(conversationID),
        previousInviteId: rematchPromptInvite.previousInviteId,
        opponentId: rematchPromptInvite.opponentId,
      });
      setRematchPromptInvite(null);
    } catch (error) {
      console.error("Failed to dismiss rematch prompt:", error);
    } finally {
      setRematchPromptBusy(false);
    }
  };

  const handlePlayedRematchPrompt = () => {
    if (!rematchPromptInvite) return;

    trackEvent("rematch_prompt_yes_played", {
      conversationId: String(conversationID),
      previousInviteId: rematchPromptInvite.previousInviteId,
      opponentId: rematchPromptInvite.opponentId,
    });

    openInviteModal({
      flow: "rematch",
      rematch: rematchPromptInvite,
    });
  };

  const openNextMatchScheduler = async () => {
    const selectedSuggestion = selectedNextMatchSuggestion || null;
    trackEvent("match_hub_next_match_clicked", {
      conversationId: String(conversationID),
      opponentId: otherUserId,
      slot: selectedSuggestion?.id || availabilityOverlap?.preferredSlot || null,
      broadAvailability: selectedSuggestion?.broadLabel || null,
      hasMatchHistory: hubMatches.length > 0,
    });

    openInviteModal();
  };

  const handleNextMatchTimeNext = async () => {
    const selectedSuggestion =
      nextMatchTimeMode === "suggested" ? selectedNextMatchSuggestion : null;

    if (inviteFlow === "rematch") {
      setInviteStep("details");
      return;
    }

    if (nextMatchTimeMode === "suggested") {
      if (!selectedSuggestion) return;
      setInviteDate(selectedSuggestion.date);
      setInviteTime(selectedSuggestion.time);
      setInviteNote(`Suggested from shared availability: ${selectedSuggestion.broadLabel}`);
    } else if (!inviteDate || !inviteTime) {
      return;
    }

    setInviteStep("details");

    try {
      await fetchSuggestedCourt();
    } catch (error) {
      console.warn("[MatchHub] suggested court prefill failed", error);
    }
  };

  const handleRelationshipRematch = async () => {
    if (!user?.uid || !conversationID || isEventChat) return;

    try {
      const eligible = rematchPromptInvite || await findEligibleRematchInvite({
        conversationId: String(conversationID),
        currentUserId: user.uid,
      });

      if (eligible) {
        trackEvent("relationship_card_rematch_clicked", {
          conversationId: String(conversationID),
          previousInviteId: eligible.previousInviteId,
          opponentId: eligible.opponentId,
        });
        openInviteModal({
          flow: "rematch",
          rematch: eligible,
        });
        return;
      }

      trackEvent("relationship_card_rematch_fallback_schedule", {
        conversationId: String(conversationID),
        opponentId: otherUserId,
      });
      openInviteModal();
    } catch (error) {
      console.warn("[RelationshipSummaryCard] rematch action fell back to schedule", error);
      openInviteModal();
    }
  };

    // ===== SEND INVITE (1:1 chats only) =====
  const sendInvite = async () => {
    if (!user) return;
    if (isEventChat) return;
    if (!inviteDate || !inviteTime || !inviteLocation.trim()) return;

    const allIds = String(conversationID || "").split("_");
    const recipientId = allIds.find((id) => id !== user.uid) ?? null;
    if (!recipientId) return;

    const startISO = combineDateTimeISO(inviteDate, inviteTime);

    if (inviteFlow === "rematch" && rematchContext) {
      try {
        const inviteId = await createRematchInviteFromPrevious({
          currentUserId: user.uid,
          previousInviteId: rematchContext.previousInviteId,
          conversationId: String(conversationID),
          startISO,
          durationMins: inviteDuration,
          location: inviteLocation.trim(),
          note: inviteNote.trim() || rematchContext.note,
          court: activeCourt || rematchContext.court || null,
        });

        trackEvent("rematch_invite_created", {
          conversationId: String(conversationID),
          previousInviteId: rematchContext.previousInviteId,
          inviteId,
          opponentId: rematchContext.opponentId,
        });

        setShowInvite(false);
        setInviteFlow("standard");
        setRematchContext(null);
        setRematchPromptInvite(null);
        return;
      } catch (error: any) {
        console.error("Failed to create rematch invite:", error);
        alert(error?.message || "Could not create rematch invite right now.");
        return;
      }
    }

    let conversationParticipants = participants;
    if (!conversationParticipants.length) {
      const convoSnap = await getDoc(doc(db, "conversations", String(conversationID)));
      const dataParticipants = convoSnap.exists() ? convoSnap.data()?.participants : null;
      conversationParticipants = Array.isArray(dataParticipants) ? dataParticipants : [];
    }

    const shouldLinkRelationship =
      conversationParticipants.length === 2 &&
      conversationParticipants.includes(user.uid) &&
      conversationParticipants.includes(recipientId);

    const relationshipFields = shouldLinkRelationship
      ? {
          pairId: getPairId(user.uid, recipientId),
          relationshipRefPath: getRelationshipRefPath(user.uid, recipientId),
        }
      : {};

    if (shouldLinkRelationship) {
      try {
        await ensureOneToOneConversationRelationship(
          db,
          String(conversationID),
          conversationParticipants,
          user.uid
        );
      } catch (error) {
        console.warn("[player_relationships:stage4] conversation relationship upsert failed before invite send", {
          conversationId: String(conversationID),
          pairId: relationshipFields.pairId,
          senderId: user.uid,
          error,
        });
      }
    }

    const newMessage: any = {
      senderId: user.uid,
      recipientId,
      type: "invite",
invite: {
  startISO,
  durationMins: inviteDuration,
  location: inviteLocation.trim(),
  note: inviteNote.trim() || null,

  // ✅ attach suggested court (optional but powerful)
court: activeCourt
  ? {
      id: activeCourt.id || null,
      name: activeCourt.name || null,
      address: activeCourt.address || null,
      suburb: activeCourt.suburb || null,
      state: activeCourt.state || null,
      postcode: activeCourt.postcode || null,
      bookingUrl: activeCourt.bookingUrl || null,
      lat: activeCourt.lat ?? null,
      lng: activeCourt.lng ?? null,
    }
  : null,
},
      inviteStatus: "pending", // pending | accepted | declined
      timestamp: serverTimestamp(),
      read: false,
      ...relationshipFields,
    };

    // 1) Create the message first so we get messageId
const msgRef = await addDoc(
  collection(db, "conversations", String(conversationID), "messages"),
  newMessage
);

// 2) Create a dedicated invite doc (this is what /invites/[id] will read)
const inviteId = msgRef.id;

await setDoc(doc(db, "match_invites", inviteId), {
  inviteId,
  conversationId: String(conversationID),
  messageId: inviteId, // same as msg id
  fromUserId: user.uid,
  toUserId: recipientId,
  participants: [user.uid, recipientId],
  ...relationshipFields,

  // copy the invite payload so the details page is stable
  invite: newMessage.invite,

  // status + booking fields mirror the message (easy to query later)
  inviteStatus: "pending",
  inviteBookingStatus: "not_confirmed",
  inviteBookedBy: null,
  inviteBookedAt: null,

  createdAt: serverTimestamp(),
  updatedAt: serverTimestamp(),
});

if (shouldLinkRelationship) {
  try {
    await upsertMatchInviteRelationship(db, user.uid, recipientId, inviteId, user.uid);
  } catch (error) {
    console.error("[player_relationships:stage2] match invite relationship upsert failed", {
      inviteId,
      fromUserId: user.uid,
      toUserId: recipientId,
      pairId: relationshipFields.pairId,
      error,
    });
  }

  try {
    await upsertMessageRelationship(db, user.uid, recipientId, String(conversationID), msgRef.id, user.uid);
  } catch (error) {
    console.warn("[player_relationships:stage4] invite message relationship upsert failed", {
      conversationId: String(conversationID),
      messageId: msgRef.id,
      pairId: relationshipFields.pairId,
      senderId: user.uid,
      error,
    });
  }
}

// 3) (Optional but recommended) write inviteId onto the message itself
await updateDoc(msgRef, { inviteId });

    await updateDoc(doc(db, "conversations", String(conversationID)), {
      latestMessage: {
        text: "🎾 Match invite",
        senderId: user.uid,
        timestamp: serverTimestamp(),
        type: "invite",
      },
      updatedAt: serverTimestamp(),
      [`lastRead.${user.uid}`]: serverTimestamp(),
      [`typing.${user.uid}`]: false,
    });

    setShowInvite(false);
  };

  const hoursFromNow = (h: number) => new Date(Date.now() + h * 60 * 60 * 1000);

  // ✅ Keep invite doc + message doc in sync (single place to do dual-write)
const updateInviteEverywhere = async (messageId: string, patch: Record<string, any>) => {
  if (!user) return;

  // message ref
  const msgRef = doc(db, "conversations", String(conversationID), "messages", messageId);

  // find the message in local state (we need inviteId + invite payload sometimes)
  const msg = messages.find((m) => m.id === messageId);
  if (!msg) return;

  // invite ref (prefer explicit inviteId, fallback to messageId)
  const inviteId = msg.inviteId || messageId;
  const inviteRef = doc(db, "match_invites", String(inviteId));

  // 1) Update the invite doc (source of truth)
  await updateDoc(inviteRef, { ...patch, updatedAt: serverTimestamp() });

  // 2) Mirror key fields onto the message doc for chat rendering
  const mirror: Record<string, any> = {};
  if ("inviteStatus" in patch) mirror.inviteStatus = patch.inviteStatus;
  if ("inviteBookingStatus" in patch) mirror.inviteBookingStatus = patch.inviteBookingStatus;
  if ("inviteBookedBy" in patch) mirror.inviteBookedBy = patch.inviteBookedBy;
  if ("inviteBookedAt" in patch) mirror.inviteBookedAt = patch.inviteBookedAt;

  if (Object.keys(mirror).length) {
    await updateDoc(msgRef, mirror);
  }
};

  // ===== ACCEPT / DECLINE INVITE =====
const respondToInvite = async (messageId: string, status: "accepted" | "declined") => {
  if (!user) return;
  if (isEventChat) return;

  // Pull invite details from the message (needed for accepted helper fields)
  const msg = messages.find((m) => m.id === messageId);
  const inv = msg?.invite || {};
  const isRematchInvite =
    msg?.inviteType === "rematch" ||
    msg?.type === "rematch" ||
    msg?.source === "post_match_prompt" ||
    !!msg?.previousInviteId;

  await updateInviteEverywhere(messageId, {
    inviteStatus: status,
    inviteRespondedAt: serverTimestamp(),
    inviteRespondedBy: user.uid,

    ...(status === "accepted"
      ? {
          inviteStart: inv?.startISO || null,
          inviteDurationMins: typeof inv?.durationMins === "number" ? inv.durationMins : null,
          inviteTitle: "Match Invite",
          courtName: inv?.court?.name || inv?.location || null,

          // optional booking fields
          inviteBookingStatus: "not_confirmed",
          inviteBookedBy: null,
          inviteBookedAt: null,

          // optional reminders
          inviteBookingReminderAt: hoursFromNow(24),
          inviteBookingReminderSent: false,
          calendarSynced: false,
        }
      : {}),
  });

  // Keep your convo latestMessage updates (fine as-is)
  await updateDoc(doc(db, "conversations", String(conversationID)), {
    latestMessage: {
      text: status === "accepted" ? "✅ Invite accepted" : "❌ Invite declined",
      senderId: user.uid,
      timestamp: serverTimestamp(),
      type: "invite_response",
    },
    updatedAt: serverTimestamp(),
  });

  const acceptedInviteId = String(msg?.inviteId || messageId);

  if (
    status === "accepted" &&
    isRematchInvite &&
    shouldTrackRematchInviteAccepted(acceptedInviteId)
  ) {
    trackEvent("rematch_invite_accepted", {
      inviteId: acceptedInviteId,
      previousInviteId: msg?.previousInviteId || null,
      conversationId: String(conversationID),
      accepterId: user.uid,
      senderId: msg?.senderId || null,
      startISO: inv?.startISO || null,
      source: msg?.source || null,
      type: msg?.inviteType || msg?.type || "invite",
    });
  }
};

    // ✅ CONFIRM COURT BOOKING (one-click)
  const confirmInviteBooking = async (messageId: string) => {
    if (!user) return;
    if (isEventChat) return;

    const msgRef = doc(db, "conversations", String(conversationID), "messages", messageId);

    const msg = messages.find((m) => m.id === messageId);
if (!msg) return;

// Only allow sender or recipient of this invite to confirm booking
const participantOk = msg.senderId === user.uid || msg.recipientId === user.uid;
if (!participantOk) return;

    await updateInviteEverywhere(messageId, {
      inviteBookingStatus: "confirmed",
      inviteBookedBy: user.uid,
      inviteBookedAt: serverTimestamp(),

      // stop reminders
      inviteBookingReminderSent: true,
      inviteBookingReminderSentAt: serverTimestamp(),
    });

    await updateDoc(doc(db, "conversations", String(conversationID)), {
      latestMessage: {
        text: "🟢 Court booking confirmed",
        senderId: user.uid,
        timestamp: serverTimestamp(),
        type: "invite_booking_confirmed",
      },
      updatedAt: serverTimestamp(),
    });
  };

  // ===== TYPING =====
  const updateTypingStatus = debounce(async (isTyping: boolean) => {
    if (!user) return;
    await updateDoc(doc(db, "conversations", String(conversationID)), {
      [`typing.${user.uid}`]: isTyping,
    });
  }, 300);

  useEffect(() => {
  return () => updateTypingStatus.cancel();
}, [updateTypingStatus]);

  // ===== TEXTAREA AUTOGROW =====
useEffect(() => {
  const el = inputRef.current;
  if (!el) return;
  el.style.height = "0px";
  el.style.height = Math.min(el.scrollHeight, isTypingCompact ? 96 : 160) + "px";
}, [input, isTypingCompact]);

useEffect(() => {
  if (embeddedDesktop) return;

  const prevBodyOverflow = document.body.style.overflow;
  const prevHtmlOverflow = document.documentElement.style.overflow;
  const prevBodyOverscroll = document.body.style.overscrollBehavior;
  const prevHtmlOverscroll = document.documentElement.style.overscrollBehavior;

  document.body.style.overflow = "hidden";
  document.documentElement.style.overflow = "hidden";
  document.body.style.overscrollBehavior = "none";
  document.documentElement.style.overscrollBehavior = "none";

  return () => {
    document.body.style.overflow = prevBodyOverflow;
    document.documentElement.style.overflow = prevHtmlOverflow;
    document.body.style.overscrollBehavior = prevBodyOverscroll;
    document.documentElement.style.overscrollBehavior = prevHtmlOverscroll;
  };
}, [embeddedDesktop]);

useEffect(() => {
  if (!isTypingCompact) return;

  const raf = requestAnimationFrame(() => scrollToBottom(false));
  return () => cancelAnimationFrame(raf);
}, [isTypingCompact]);

useEffect(() => {
  // Focus once when the page loads (or when conversation changes),
  // without hijacking subsequent taps/clicks.
  focusWithoutScroll();
  // eslint-disable-next-line react-hooks/exhaustive-deps
}, [conversationID]);

// ===== LOCK BODY SCROLL WHEN INVITE MODAL OPEN =====
useEffect(() => {
  if (!showInvite) return;

  const prev = document.body.style.overflow;
  document.body.style.overflow = "hidden";

  return () => {
    document.body.style.overflow = prev;
  };
}, [showInvite]);

  // ===== ROWS =====
  const rows = useMemo(() => {
    const out: Array<
      | { type: "day"; key: string; label: string }
      | { type: "unread"; key: string }
      | { type: "msg"; key: string; msg: any; isOther: boolean; isTail: boolean }
    > = [];

    let lastDayKey = "";
    let unreadInserted = false;

    messages.forEach((m, i) => {
      const curDate = m.timestamp?.toDate ? m.timestamp.toDate() : new Date(0);
      const dayKey = curDate.toDateString();

      if (dayKey !== lastDayKey) {
        out.push({ type: "day", key: `day-${dayKey}`, label: dayLabel(curDate) });
        lastDayKey = dayKey;
      }

      if (!unreadInserted && lastReadAt && ts(m) > lastReadAt && m.senderId !== user?.uid) {
        out.push({ type: "unread", key: `unread-${ts(m)}` });
        unreadInserted = true;
      }

      const next = messages[i + 1];
      const isTail = !next || next.senderId !== m.senderId || ts(next) - ts(m) > 2 * 60 * 1000;

      out.push({
        type: "msg",
        key: m.id,
        msg: m,
        isOther: m.senderId !== user?.uid,
        isTail,
      });
    });

    return out;
  }, [messages, lastReadAt, user?.uid]);

  const latestMatch = hubMatches[0] || null;
  const hubWins = user?.uid ? hubMatches.filter((match) => match.winnerId === user.uid).length : 0;
  const hubLosses = otherUserId ? hubMatches.filter((match) => match.winnerId === otherUserId).length : 0;
  const hubTotalDecided = hubWins + hubLosses;
  const hubLeadLabel =
    hubTotalDecided > 0 && hubWins > hubLosses
      ? "You lead"
      : hubTotalDecided > 0 && hubLosses > hubWins
        ? "They lead"
        : hubTotalDecided > 0
          ? "Tied"
          : null;
  const opponentName = otherUserId ? profiles[otherUserId]?.name || "Player" : "Player";
  const canShowLastMatchAction = !isEventChat && !!latestMatch;
  const canShowNextMatchAction = !isEventChat && !!user?.uid && !!otherUserId;
  const showMatchHubToolbar =
    activeTab === "chat" &&
    !isTypingCompact &&
    (canShowLastMatchAction || canShowNextMatchAction);
  const nextMatchSuggestions = availabilityOverlap?.suggestions || [];
  const visibleNextMatchSuggestions = nextMatchSuggestions.slice(0, 3);
  const selectedNextMatchSuggestion =
    nextMatchSuggestions.find((suggestion) => suggestion.id === selectedNextMatchSuggestionId) ||
    nextMatchSuggestions[0] ||
    null;
  const selectedInviteDateTimeLabel = useMemo(() => {
    if (!inviteDate || !inviteTime) return "No time selected";
    const parsed = new Date(`${inviteDate}T${inviteTime}`);
    if (Number.isNaN(parsed.getTime())) return `${inviteDate} ${inviteTime}`;

    return parsed.toLocaleString(undefined, {
      weekday: "short",
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
  }, [inviteDate, inviteTime]);
  const changeActiveTab = (nextTab: MatchHubTab) => {
    if (nextTab === activeTab) return;

    if (activeTab === "chat") {
      const el = listRef.current;
      if (el) {
        chatScrollTopRef.current = el.scrollTop;
        wasNearBottomOnTabLeaveRef.current = isNearBottom();
      }
    }

    if (nextTab === "chat" && activeTab !== "chat") {
      pendingChatTabReturnRef.current = true;
    }

    setActiveTab(nextTab);
  };

  useEffect(() => {
    if (activeTab !== "chat") return;
    if (hasInitialScrolledRef.current) return;
    if (!messages.length) return;
    if (!inputBarMeasured) return;
    if (!matchHubReady) return;

    let raf1 = 0;
    let raf2 = 0;
    let timer: number | null = null;

    raf1 = requestAnimationFrame(() => {
      raf2 = requestAnimationFrame(() => {
        scrollToBottom(false);
        hasInitialScrolledRef.current = true;
        setShowScrollDown(false);
        timer = window.setTimeout(() => scrollToBottom(false), 80);
      });
    });

    return () => {
      cancelAnimationFrame(raf1);
      cancelAnimationFrame(raf2);
      if (timer) window.clearTimeout(timer);
    };
  }, [
    activeTab,
    inputBarMeasured,
    matchHubReady,
    messages.length,
    showMatchHubToolbar,
  ]);

  useEffect(() => {
    if (activeTab !== "chat") return;
    if (!hasInitialScrolledRef.current) return;
    const pending = pendingAutoScrollRef.current;
    if (!pending) return;
    pendingAutoScrollRef.current = null;

    const raf = requestAnimationFrame(() => {
      scrollToBottom(pending === "smooth");
    });

    return () => cancelAnimationFrame(raf);
  }, [activeTab, inputBarH, messages.length, showMatchHubToolbar]);

  useEffect(() => {
    if (activeTab !== "chat") return;
    if (!pendingChatTabReturnRef.current) return;
    if (!hasInitialScrolledRef.current) return;
    if (!messages.length) return;

    pendingChatTabReturnRef.current = false;
    let raf1 = 0;
    let raf2 = 0;

    raf1 = requestAnimationFrame(() => {
      raf2 = requestAnimationFrame(() => {
        const el = listRef.current;
        if (!el) return;

        if (wasNearBottomOnTabLeaveRef.current) {
          scrollToBottom(false);
          setShowScrollDown(false);
        } else {
          el.scrollTop = chatScrollTopRef.current;
          setShowScrollDown(true);
        }
      });
    });

    return () => {
      cancelAnimationFrame(raf1);
      cancelAnimationFrame(raf2);
    };
  }, [activeTab, conversationID, messages.length, showMatchHubToolbar]);

  // ===== RENDER =====
  return (
   <div
    className={
      embeddedDesktop
        ? "flex h-full min-h-0 flex-col bg-white overflow-hidden"
        : "flex h-dvh min-h-0 flex-col bg-white overflow-hidden"
    }
    style={
      embeddedDesktop
        ? undefined
        : {
            height: mobileViewportHeight ? `${mobileViewportHeight}px` : "100dvh",
            maxHeight: mobileViewportHeight ? `${mobileViewportHeight}px` : "100dvh",
          }
    }
  >
    {/* Header */}
<div
  className="relative z-20 border-b bg-white px-3"
  style={{
    paddingTop: embeddedDesktop
      ? `${headerTopOffset}px`
      : `calc(env(safe-area-inset-top, 0px) + ${headerTopOffset}px)`,
  }}
>
  <div className={`${isTypingCompact ? "min-h-[52px] py-1" : "min-h-[68px] py-2"} flex items-center gap-3`}>
    {/* Back */}
    {!embeddedDesktop && (
      <button
        onClick={() => router.push("/messages")}
        aria-label="Back"
        className="h-10 w-10 rounded-full grid place-items-center hover:bg-black/5"
      >
        <ArrowLeft className="w-5 h-5 text-gray-800" />
      </button>
    )}

    <button
  type="button"
  onClick={() => {
    if (profileTargetId) changeActiveTab("profile");
  }}
  disabled={!profileTargetId}
  className="flex flex-1 min-w-0 items-center gap-3 text-left disabled:cursor-default"
  aria-label="Open player profile"
>
  {(() => {
    const others = participants.filter((p) => p !== user?.uid);
    const first = others[0];
    const photo = first ? resolveSmallProfilePhoto(profiles[first]) : null;

    return (
      <div className="relative shrink-0">
        <div
          className="h-11 w-11 rounded-full p-[2px]"
          style={{ background: isOtherOnline ? TM.neon : "transparent" }}
        >
          <div
            className="h-full w-full rounded-full bg-white grid place-items-center overflow-hidden"
            style={{
              border: isOtherOnline ? "none" : "2px solid rgba(15,23,42,0.10)",
            }}
          >
            {photo ? (
              <img src={photo} alt="avatar" className="h-full w-full object-cover" />
            ) : (
              <div className="h-full w-full bg-gray-200" />
            )}
          </div>
        </div>

        {isOtherOnline && (
          <div
            className="absolute -right-0.5 -bottom-0.5 h-3.5 w-3.5 rounded-full border-2 border-white"
            style={{ background: "#22c55e" }}
          />
        )}
      </div>
    );
  })()}

  <div className="flex-1 min-w-0">
    <div className="truncate text-[18px] font-extrabold text-gray-900 leading-tight">
      {isEventChat
        ? (eventTitle || "Event Chat")
        : (() => {
            const names = participants
              .filter((p) => p !== user?.uid)
              .map((uid) => profiles[uid]?.name || "Player");
            return names[0] || "Chat";
          })()}
    </div>

    {!isTypingCompact && !isEventChat && (
      <div className="mt-1">
        {isOtherOnline ? (
          <span className="inline-flex items-center gap-1 text-[12px] font-semibold text-green-700">
            <span className="h-2 w-2 rounded-full bg-green-500" />
            Online
          </span>
        ) : (
          <span className="text-[12px] font-semibold text-gray-500">Tap for profile</span>
        )}
      </div>
    )}

    {!isTypingCompact && typingUsers.length > 0 && (
      <div className="text-[11px] text-gray-500 mt-1">
        {typingUsers.length === 1
          ? `${profiles[typingUsers[0]]?.name || "Someone"} is typing…`
          : `${profiles[typingUsers[0]]?.name || "Someone"} and ${
              typingUsers.length - 1
            } other${typingUsers.length > 2 ? "s" : ""} are typing…`}
      </div>
    )}
  </div>
</button>

    {/* Right actions */}
    {!isTypingCompact && (
    <div className="relative flex items-center gap-2">
<button
  type="button"
  className="h-11 w-11 rounded-full grid place-items-center hover:bg-black/5 disabled:opacity-40"
  aria-label="Options"
  title="Options"
  disabled={!user?.uid || isEventChat}
  onClick={() => {
    setShowHeaderOptions((open) => !open);
  }}
>
  <MoreVertical className="w-5 h-5 text-gray-800" />
</button>
      {showHeaderOptions && !isEventChat && (
        <div
          className="absolute right-0 top-full z-40 mt-2 w-48 overflow-hidden rounded-xl border bg-white py-1 shadow-xl"
          style={{ borderColor: "rgba(15,23,42,0.10)" }}
        >
          <button
            type="button"
            onClick={() => {
              setShowHeaderOptions(false);
              setShowDeleteMatchConfirm(true);
            }}
            className="flex w-full items-center gap-2 px-3 py-3 text-left text-sm font-bold text-red-600 hover:bg-red-50"
          >
            <Trash2 className="h-4 w-4" />
            Delete Match
          </button>
        </div>
      )}
    </div>
    )}
  </div>
</div>

{successToast && (
  <div className="fixed left-1/2 top-5 z-[80] -translate-x-1/2 rounded-full bg-slate-950 px-4 py-2 text-sm font-bold text-white shadow-xl">
    {successToast}
  </div>
)}

{showDeleteMatchConfirm && (
  <div
    className="fixed inset-0 z-[70] flex items-center justify-center bg-black/45 px-4"
    onMouseDown={(e) => {
      if (e.target === e.currentTarget && !deleteMatchBusy) setShowDeleteMatchConfirm(false);
    }}
  >
    <div className="w-full max-w-sm rounded-2xl bg-white p-5 shadow-2xl">
      <div className="mx-auto grid h-11 w-11 place-items-center rounded-full bg-red-100 text-red-600">
        <Trash2 className="h-5 w-5" />
      </div>
      <div className="mt-3 text-center text-lg font-black text-gray-900">
        Delete Match?
      </div>
      <p className="mt-2 text-center text-sm leading-5 text-gray-600">
        This will remove the chat and match connection from your app. Messages and completed match history will be preserved.
      </p>
      <div className="mt-5 grid grid-cols-2 gap-2">
        <button
          type="button"
          onClick={() => setShowDeleteMatchConfirm(false)}
          disabled={deleteMatchBusy}
          className="rounded-xl border px-3 py-3 text-sm font-extrabold text-gray-800 disabled:opacity-50"
          style={{ borderColor: "rgba(15,23,42,0.12)" }}
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={() => void handleDeleteMatchForMe()}
          disabled={deleteMatchBusy}
          className="rounded-xl bg-red-600 px-3 py-3 text-sm font-extrabold text-white disabled:opacity-50"
        >
          {deleteMatchBusy ? "Deleting..." : "Delete Match"}
        </button>
      </div>
    </div>
  </div>
)}

{activeTab === "chat" && showMatchPrompt && !isEventChat && false && (
  <div className="relative z-20 bg-white px-3 pt-2 pb-1">
    <div className="relative ml-auto w-[260px] max-w-[calc(100%-16px)]">
      <div
        className="absolute -top-2 right-14 h-4 w-4 rotate-45"
        style={{
          background: "white",
          borderLeft: "1px solid rgba(15,23,42,0.10)",
          borderTop: "1px solid rgba(15,23,42,0.10)",
        }}
      />

      <div
  className="relative rounded-2xl border bg-white px-3 py-3 shadow-lg overflow-hidden"
  style={{
    borderColor: "rgba(57,255,20,0.28)",
    boxShadow: "0 10px 28px rgba(57,255,20,0.16), 0 6px 18px rgba(15,23,42,0.08)",
  }}
>
  <div
    className="absolute left-0 top-0 h-full w-1.5"
    style={{ background: TM.neon }}
  />
        <div className="flex items-start justify-between gap-3">
  <div className="min-w-0 pl-1">
    <div className="flex items-center gap-2">
      <div
        className="h-6 w-6 rounded-full grid place-items-center text-[12px] font-black"
        style={{
          background: "rgba(57,255,20,0.18)",
          color: TM.ink,
        }}
      >
        🎾
      </div>

      <div className="text-[14px] font-black" style={{ color: TM.ink }}>
        Track your match
      </div>
    </div>

    <div
      className="mt-1 text-[12px] leading-snug"
      style={{ color: "rgba(17,24,39,0.78)" }}
    >
      Create a Match Invite to track your Match!
    </div>
  </div>

          <button
            type="button"
            onClick={dismissMatchPrompt}
            className="shrink-0 rounded-full px-2 py-1 text-[12px] font-bold hover:bg-black/5"
            style={{ color: "rgba(17,24,39,0.55)" }}
            aria-label="Dismiss match prompt"
          >
            ✕
          </button>
        </div>
      </div>
    </div>
  </div>
)}

{activeTab === "chat" && rematchPromptInvite && !isEventChat && false && (
  <div className="relative z-20 bg-white px-3 pt-2 pb-1">
    <div className="relative ml-auto w-[320px] max-w-[calc(100%-16px)]">
      <div
        className="absolute -top-2 right-14 h-4 w-4 rotate-45"
        style={{
          background: "white",
          borderLeft: "1px solid rgba(15,23,42,0.10)",
          borderTop: "1px solid rgba(15,23,42,0.10)",
        }}
      />

      <div
        className="relative rounded-2xl border bg-white px-4 py-4 shadow-lg overflow-hidden"
        style={{
          borderColor: "rgba(57,255,20,0.28)",
          boxShadow: "0 10px 28px rgba(57,255,20,0.16), 0 6px 18px rgba(15,23,42,0.08)",
        }}
      >
        <div
          className="absolute left-0 top-0 h-full w-1.5"
          style={{ background: TM.neon }}
        />

        <div className="pl-1">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <div
                  className="h-6 w-6 rounded-full grid place-items-center text-[12px] font-black"
                  style={{
                    background: "rgba(57,255,20,0.18)",
                    color: TM.ink,
                  }}
                >
                  🎾
                </div>

                <div className="text-[14px] font-black" style={{ color: TM.ink }}>
                  {otherUserId && profiles[otherUserId ?? ""]?.name
                    ? `Lock in your next game with ${profiles[otherUserId ?? ""]?.name}?`
                    : "Lock in your next game?"}
                </div>
              </div>

              <div
                className="mt-1 text-[12px] leading-snug"
                style={{ color: "rgba(17,24,39,0.78)" }}
              >
                Same time and place next week?
              </div>

              <div className="mt-2 text-[11px] text-gray-500">
                {formatInviteWhenSafe(rematchPromptInvite!.startISO)}{" "}
                {rematchPromptInvite!.courtName || rematchPromptInvite!.location
                  ? `• ${rematchPromptInvite!.courtName || rematchPromptInvite!.location}`
                  : ""}
              </div>
            </div>

            <button
              type="button"
              onClick={handleDismissRematchPrompt}
              disabled={rematchPromptBusy}
              className="shrink-0 rounded-full px-2 py-1 text-[12px] font-bold hover:bg-black/5 disabled:opacity-50"
              style={{ color: "rgba(17,24,39,0.55)" }}
              aria-label="Dismiss rematch prompt"
            >
              ✕
            </button>
          </div>

          <div className="mt-4 grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={handleDismissRematchPrompt}
              disabled={rematchPromptBusy}
              className="rounded-xl border px-3 py-2 text-[12px] font-extrabold disabled:opacity-50"
              style={{ borderColor: "rgba(15,23,42,0.12)", color: TM.ink }}
            >
              Not now
            </button>

            <button
              type="button"
              onClick={handlePlayedRematchPrompt}
              disabled={rematchPromptBusy}
              className="rounded-xl px-3 py-2 text-[12px] font-extrabold disabled:opacity-50"
              style={{ background: TM.neon, color: TM.ink }}
            >
              Yes, send rematch
            </button>
          </div>
        </div>
      </div>
    </div>
  </div>
)}

{user?.uid && otherUserId && !isEventChat && !isTypingCompact && hubMatches.length > 0 && (
  <div className="relative z-10 bg-white px-3 pt-2 pb-2 sm:px-4">
    <div
      className="rounded-2xl px-3 py-3 text-white shadow-sm sm:px-4"
      style={{
        background: "#102D22",
        border: "1px solid rgba(255,255,255,0.08)",
      }}
    >
      <div className="flex min-w-0 items-center gap-3">
        <div className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-white/10">
          <Trophy className="h-4 w-4" style={{ color: TM.neon }} />
        </div>
        <div className="min-w-0">
          <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
            <div className="text-xl font-black leading-none">{hubWins} - {hubLosses}</div>
            {hubLeadLabel && (
              <div className="text-xs font-black" style={{ color: TM.neon }}>
                {hubLeadLabel}
              </div>
            )}
          </div>
          {latestMatch && (
            <div className="mt-1 truncate text-[12px] font-semibold text-white/70">
              Last match
              {latestMatch.score ? `: ${latestMatch.score}` : ""}
              {formatHubDate(latestMatch.playedAt) ? ` - ${formatHubDate(latestMatch.playedAt)}` : ""}
            </div>
          )}
        </div>
      </div>
    </div>
  </div>
)}

{!isEventChat && !isTypingCompact && (
  <div className="relative z-10 grid grid-cols-3 border-b bg-white px-4">
    {[
      { id: "chat" as const, label: "Chat", icon: MessageSquare },
      { id: "matches" as const, label: "Matches", icon: History },
      { id: "profile" as const, label: "Profile", icon: User },
    ].map((tab) => {
      const Icon = tab.icon;
      const selected = activeTab === tab.id;
      return (
        <button
          key={tab.id}
          type="button"
          onClick={() => changeActiveTab(tab.id)}
          className="relative flex h-14 items-center justify-center gap-2 text-sm font-semibold"
          style={{ color: selected ? TM.ink : "rgba(17,24,39,0.72)" }}
        >
          <Icon className="h-4 w-4" />
          {tab.label}
          {selected && (
            <span className="absolute bottom-0 left-4 right-4 h-0.5 rounded-full" style={{ background: TM.ink }} />
          )}
        </button>
      );
    })}
  </div>
)}

{/* Messages */}
{activeTab === "chat" && (
<div
  ref={listRef}

  onScroll={() => {
    const el = listRef.current;
    if (!el) return;
    chatScrollTopRef.current = el.scrollTop;
    const nearBottom = isNearBottom();
    wasNearBottomOnTabLeaveRef.current = nearBottom;
    setShowScrollDown(!nearBottom);
  }}
  className="flex-1 overflow-y-auto overscroll-contain px-3 pt-3 pb-2 bg-gradient-to-b from-emerald-50/40 to-white"
>
  {/* ⬇️ Anchor short threads to the bottom */}
  <div className="min-h-full flex flex-col justify-end">
    <div>
      {rows.map((row) => {
        // ... paste your existing row render EXACTLY as-is ...
        if (row.type === "day") {
          return (
            <div key={row.key} className="my-3 text-center">
              <span className="inline-block px-3 py-1 text-[12px] font-extrabold tracking-[0.22em]"
  style={{ color: "rgba(15,23,42,0.35)" }}
>
  {String(row.label).toUpperCase()}
</span>

            </div>
          );
        }

        if (row.type === "unread") {
          return (
            <div key={row.key} className="my-2 flex items-center gap-3">
              <div className="h-px flex-1 bg-red-200" />
              <span className="text-[11px] font-medium text-red-600">New</span>
              <div className="h-px flex-1 bg-red-200" />
            </div>
          );
        }

       const { msg, isOther, isTail } = row as any;

const system = isSystemMessage(msg);
const senderProfile = profiles[msg.senderId] || {};
const d = msg.timestamp?.toDate ? msg.timestamp.toDate() : new Date();

// ✅ pick avatar URL safely (and avoid crashing)
const avatarURL = system
  ? DEFAULT_SYSTEM_AVATAR
  : isOther
    ? (resolveSmallProfilePhoto(senderProfile) || DEFAULT_SYSTEM_AVATAR)
    : (userAvatar || DEFAULT_SYSTEM_AVATAR);

        return (
          <div
  key={row.key}
  className={[
    "mb-1.5 flex",
    system ? "justify-center" : isOther ? "justify-start" : "justify-end",
  ].join(" ")}
>
            {/* Avatar only on cluster tail */}
            {!system && isOther && isTail ? (
  <img src={avatarURL} alt="avatar" className="mr-2 h-6 w-6 rounded-full object-cover" />
) : !system && isOther ? (
  <div className="mr-8" />
) : null}

            <div className={system ? "max-w-[92%] sm:max-w-lg min-w-0" : "max-w-[86%] sm:max-w-md min-w-0"}>
  <div
  className={[
    "px-4 py-3 text-[16px] leading-snug shadow-[0_2px_6px_rgba(0,0,0,0.06)] min-w-0 overflow-hidden",
    isOther
      ? "rounded-[22px] rounded-bl-[10px]"
      : "rounded-[22px] rounded-br-[10px]",
  ].join(" ")}
style={{
  background: system
    ? "rgba(17,24,39,0.06)"
    : isOther
      ? TM.otherBubble
      : TM.navyBubble,
  color: system
    ? "rgba(17,24,39,0.75)"
    : isOther
      ? "#111827"
      : "white",
}}

              >
{msg.type === "invite" ? (
  <InviteCard
    msg={msg}
    isOther={isOther}
    isMe={msg.senderId === user?.uid}
    onRespond={(status) => respondToInvite(msg.id, status)}
    onConfirmBooked={() => confirmInviteBooking(msg.id)}
    currentUid={user?.uid || null}
    nameByUid={nameByUid}
    onOpenInvite={(id) => setInviteOverlayId(id)}
  />
) : msg.type === "system" && msg.systemType === "invite_cancelled" ? (
  <SystemInviteCancelled msg={msg} router={router} />
) : (
  msg.text
)}
              </div>

              {isTail && (
                <>
                  <div className={`mt-1 text-[11px] text-gray-400 ${isOther ? "text-left" : "text-right"}`}>
                    {timeLabel(d)}
                  </div>
                  {isOther && isEventChat && (
                    <div className="mt-0.5 text-[11px] text-gray-500">
                      {senderProfile.name || "Player"}
                    </div>
                  )}
                </>
              )}
            </div>

            {!system && !isOther && isTail ? (
  <img src={avatarURL} alt="me" className="ml-2 h-6 w-6 rounded-full object-cover" />
) : !system && !isOther ? (
  <div className="ml-8" />
) : null}
          </div>
        );
      })}

    </div>

    {/* Bottom sentinel for scroll-to-bottom */}
    <div
      ref={bottomRef}
      style={{
        height: 1,
      }}
    />
  </div>
</div>
)}

{activeTab === "matches" && (
  <div className="flex-1 overflow-y-auto bg-slate-50 px-4 py-4 pb-28">
    <div className="rounded-2xl bg-white p-4 shadow-sm">
      <div className="text-sm font-black text-gray-900">Head-to-head record</div>
      <div className="mt-3 flex items-end justify-between">
        <div>
          <div className="text-3xl font-black" style={{ color: TM.ink }}>
            {hubWins} - {hubLosses}
          </div>
          {hubLeadLabel && <div className="mt-1 text-sm font-bold text-gray-600">{hubLeadLabel}</div>}
        </div>
        <div className="text-right">
          <div className="text-sm font-bold text-gray-500">Total matches</div>
          <div className="mt-1 text-xl font-black text-gray-900">{hubMatches.length}</div>
        </div>
      </div>
    </div>

    {hubMatches.length > 0 ? (
      <div className="mt-4 space-y-3">
        {hubMatches.map((match) => {
          const won = match.winnerId === user?.uid;
          const lost = match.winnerId === otherUserId;
          return (
            <div key={`${match.source}-${match.id}`} className="rounded-2xl bg-white p-4 shadow-sm">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-sm font-black text-gray-900">
                    {won ? "You won" : lost ? `${opponentName} won` : "Match played"}
                  </div>
                  {formatHubDate(match.playedAt) && (
                    <div className="mt-1 text-xs font-semibold text-gray-500">{formatHubDate(match.playedAt)}</div>
                  )}
                </div>
                {match.score && (
                  <div className="shrink-0 rounded-full bg-emerald-50 px-3 py-1 text-sm font-black" style={{ color: TM.ink }}>
                    {match.score}
                  </div>
                )}
              </div>
              {match.court && <div className="mt-3 text-sm text-gray-600">{match.court}</div>}
            </div>
          );
        })}
      </div>
    ) : (
      <div className="mt-8 text-center text-sm text-gray-500">
        No recorded matches yet.
      </div>
    )}
  </div>
)}

{activeTab === "profile" && profileTargetId && (
  <div className="flex-1 overflow-hidden bg-slate-950">
    <PlayerProfileView playerId={profileTargetId} />
  </div>
)}


      {/* Scroll-to-bottom FAB */}
{activeTab === "chat" && showScrollDown && (
  <button
    onClick={() => scrollToBottom(true)}
    className="fixed right-4 rounded-full bg-white border shadow px-3 py-1.5 text-xs text-gray-700"
    style={{ bottom: inputBarH + 16 }}
  >
    Jump to latest
  </button>
)}


      {/* Input */}
{activeTab === "chat" && (
      <div
  ref={inputBarRef}
  className="shrink-0 border-t bg-white px-3"
  style={{
    paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + 10px)",
    paddingTop: 10,
  }}
>
  {showMatchHubToolbar && (
    <div className="-mx-1 mb-2 overflow-x-auto pb-1">
      <div className="flex min-w-max items-center gap-2 px-1">
        {canShowLastMatchAction && (
          <button
            type="button"
            onClick={() => setActiveActionSheet("lastMatch")}
            className="inline-flex h-10 items-center gap-2 rounded-full border bg-white px-3 text-[13px] font-bold text-gray-800 shadow-sm"
            style={{ borderColor: "rgba(15,23,42,0.10)" }}
          >
            <History className="h-4 w-4" style={{ color: TM.ink }} />
            Last Match
          </button>
        )}

        {canShowNextMatchAction && (
          <button
            type="button"
            onClick={() => void openNextMatchScheduler()}
            className="inline-flex h-10 items-center gap-2 rounded-full border bg-white px-3 text-[13px] font-bold text-gray-800 shadow-sm"
            style={{ borderColor: "rgba(15,23,42,0.10)" }}
          >
            <CalendarCheck className="h-4 w-4" style={{ color: TM.ink }} />
            Next Match
          </button>
        )}
      </div>
    </div>
  )}

  <div className="flex items-end gap-3">

    {/* Pill input */}
    <div
      className="flex-1 rounded-full border px-4 py-2"
      style={{ borderColor: "rgba(15,23,42,0.10)", background: "rgba(15,23,42,0.03)" }}
    >
      <textarea
        ref={inputRef}
        rows={1}
        className="w-full resize-none bg-transparent outline-none text-[16px] leading-snug"
        placeholder="Type a message..."
        value={input}
        onFocus={() => {
          setIsComposerFocused(true);
          requestAnimationFrame(() => scrollToBottom(false));
        }}
        onChange={(e) => {
          setInput(e.target.value);
          updateTypingStatus(true);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            sendMessage();
          }
        }}
        onBlur={() => {
          setIsComposerFocused(false);
          updateTypingStatus(false);
        }}
      />
    </div>

    {/* Send circle */}
    <button
      type="button"
      onClick={sendMessage}
      disabled={!input.trim()}
      className="h-11 w-11 rounded-full grid place-items-center disabled:opacity-40"
      style={{ background: TM.neon, color: TM.ink }}
      aria-label="Send"
      title="Send"
    >
      <Send className="w-5 h-5" />
    </button>
  </div>
</div>
)}

{activeTab === "chat" && activeActionSheet && (
  <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/35 px-3 pb-3" onMouseDown={() => setActiveActionSheet(null)}>
    <div
      className="w-full max-w-md rounded-t-[24px] rounded-b-2xl bg-white p-4 shadow-2xl"
      style={{
        paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + 16px)",
      }}
      onMouseDown={(e) => e.stopPropagation()}
    >
      <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-gray-300" />
      <div className="mb-3 flex items-center justify-between gap-3">
        <div className="text-base font-black text-gray-900">
          Last Match Summary
        </div>
        <button
          type="button"
          onClick={() => setActiveActionSheet(null)}
          className="grid h-9 w-9 place-items-center rounded-full hover:bg-black/5"
          aria-label="Close"
          title="Close"
        >
          x
        </button>
      </div>

      {activeActionSheet === "lastMatch" && latestMatch && (
        <div>
          <div className="flex items-start gap-3">
            <div className="grid h-11 w-11 shrink-0 place-items-center rounded-full" style={{ background: "rgba(57,255,20,0.18)", color: TM.ink }}>
              <History className="h-5 w-5" />
            </div>
            <div className="min-w-0">
              <div className="text-sm font-bold text-gray-900">
                {latestMatch.winnerId === user?.uid
                  ? "You won"
                  : latestMatch.winnerId === otherUserId
                    ? `${opponentName} won`
                    : "Match played"}
              </div>
            </div>
          </div>

          {(latestMatch.score || formatHubDate(latestMatch.playedAt) || latestMatch.court || latestMatch.durationLabel || latestMatch.acesLabel || latestMatch.breakPointsLabel) && (
            <div className="mt-4 divide-y rounded-2xl border" style={{ borderColor: "rgba(15,23,42,0.10)" }}>
              {latestMatch.score && (
                <div className="flex items-center justify-between px-4 py-3 text-sm">
                  <span className="text-gray-600">Score</span>
                  <span className="font-bold text-gray-900">{latestMatch.score}</span>
                </div>
              )}
              {formatHubDate(latestMatch.playedAt) && (
                <div className="flex items-center justify-between px-4 py-3 text-sm">
                  <span className="text-gray-600">Date</span>
                  <span className="font-bold text-gray-900">{formatHubDate(latestMatch.playedAt)}</span>
                </div>
              )}
              {latestMatch.court && (
                <div className="flex items-center justify-between gap-4 px-4 py-3 text-sm">
                  <span className="text-gray-600">Court</span>
                  <span className="text-right font-bold text-gray-900">{latestMatch.court}</span>
                </div>
              )}
              {latestMatch.durationLabel && (
                <div className="flex items-center justify-between px-4 py-3 text-sm">
                  <span className="text-gray-600">Duration</span>
                  <span className="font-bold text-gray-900">{latestMatch.durationLabel}</span>
                </div>
              )}
              {latestMatch.acesLabel && (
                <div className="flex items-center justify-between px-4 py-3 text-sm">
                  <span className="text-gray-600">Aces</span>
                  <span className="font-bold text-gray-900">{latestMatch.acesLabel}</span>
                </div>
              )}
              {latestMatch.breakPointsLabel && (
                <div className="flex items-center justify-between px-4 py-3 text-sm">
                  <span className="text-gray-600">Break points</span>
                  <span className="font-bold text-gray-900">{latestMatch.breakPointsLabel}</span>
                </div>
              )}
            </div>
          )}

          <button
            type="button"
            onClick={() => {
              setActiveActionSheet(null);
              changeActiveTab("matches");
            }}
            className="mt-4 flex w-full items-center justify-center gap-2 rounded-xl border bg-white py-3 text-sm font-black text-gray-800"
            style={{ borderColor: "rgba(15,23,42,0.12)" }}
          >
            <History className="h-4 w-4" />
            View Match History
          </button>
        </div>
      )}

    </div>
  </div>
)}

    {showInvite && (
  <div
    className="fixed inset-0 z-[60] flex items-center justify-center px-4"
    style={{ background: "rgba(0,0,0,0.35)" }}
    onMouseDown={(e) => {
      if (e.target === e.currentTarget) closeInviteModal();
    }}
  >
    <div
  className="w-full max-w-lg rounded-2xl bg-white shadow-xl overflow-hidden flex flex-col"
  style={{
    maxHeight: "calc(100dvh - 48px)",
  }}
>
  
 
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b">
        <button
          className="h-9 w-9 rounded-full grid place-items-center hover:bg-black/5"
          onClick={closeInviteModal}
          aria-label="Close"
          title="Close"
        >
          ✕
        </button>
        <div className="font-extrabold text-[16px] text-gray-900">
          {inviteFlow === "rematch" ? "Send Rematch Invite" : "Next Match"}
        </div>
        <div className="h-9 w-9" />
      </div>

      {/* Body */}
<div
  className="px-4 py-3 overflow-y-auto overscroll-contain"
  style={{
    WebkitOverflowScrolling: "touch",
    paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + 12px)",
  }}
>
        {(inviteFlow === "rematch" || inviteStep === "details") && (
          <div className="text-[12px] font-bold text-gray-700 mb-2">
            {inviteFlow === "rematch" ? "Rematch Details" : "Send invite"}
          </div>
        )}

        {inviteFlow === "rematch" && rematchContext && (
          <div
            className="mb-4 rounded-2xl border px-4 py-3 text-[12px]"
            style={{
              borderColor: "rgba(57,255,20,0.28)",
              background: "rgba(57,255,20,0.08)",
              color: TM.ink,
            }}
          >
            Linked to your previous accepted invite. We prefilled the same location and
            the same time next week.
          </div>
        )}

        {inviteFlow !== "rematch" && inviteStep === "time" && (
          <>
            {nextMatchTimeMode === "suggested" && visibleNextMatchSuggestions.length > 0 && (
              <div className="mb-2.5 space-y-2.5">
                  {visibleNextMatchSuggestions.map((suggestion) => {
                    const selected =
                      nextMatchTimeMode === "suggested" &&
                      selectedNextMatchSuggestion?.id === suggestion.id;
                    return (
                      <button
                        key={suggestion.id}
                        type="button"
                        onClick={() => {
                          setNextMatchTimeMode("suggested");
                          setSelectedNextMatchSuggestionId(suggestion.id);
                        }}
                        className="flex min-h-[58px] w-full items-center gap-2.5 rounded-xl border px-3.5 py-3 text-left"
                        style={{
                          borderColor: selected ? "rgba(11,61,46,0.55)" : "rgba(15,23,42,0.10)",
                          background: selected ? "rgba(57,255,20,0.10)" : "white",
                        }}
                      >
                        <div className="min-w-0 flex-1">
                          <div className="text-[13px] font-black leading-tight text-gray-900">
                            {suggestion.dateLabel} {suggestion.timeLabel}
                          </div>
                          {suggestion.reason && (
                            <div className="mt-0.5 text-[11px] font-semibold leading-tight text-gray-600">
                              {suggestion.reason}
                            </div>
                          )}
                        </div>
                        <div
                          className="h-3.5 w-3.5 shrink-0 rounded-full border"
                          style={{
                            borderColor: selected ? TM.ink : "rgba(15,23,42,0.25)",
                            background: selected ? TM.ink : "transparent",
                          }}
                        />
                      </button>
                    );
                  })}
              </div>
            )}

            <button
              type="button"
              onClick={() => setNextMatchTimeMode("custom")}
              className="mb-2.5 flex min-h-[48px] w-full items-center justify-between rounded-xl border px-3.5 py-2.5 text-left"
              style={{
                borderColor:
                  nextMatchTimeMode === "custom" ? "rgba(11,61,46,0.55)" : "rgba(15,23,42,0.10)",
                background: nextMatchTimeMode === "custom" ? "rgba(57,255,20,0.10)" : "white",
              }}
            >
              <span className="text-[13px] font-black text-gray-900">Choose another time</span>
              <span
                className="h-3.5 w-3.5 rounded-full border"
                style={{
                  borderColor: nextMatchTimeMode === "custom" ? TM.ink : "rgba(15,23,42,0.25)",
                  background: nextMatchTimeMode === "custom" ? TM.ink : "transparent",
                }}
              />
            </button>

            {nextMatchTimeMode === "custom" && (
              <div className="mb-3 grid grid-cols-2 gap-2">
                <div>
                  <div className="mb-1 text-[11px] font-semibold text-gray-700">Date</div>
                  <input
                    type="date"
                    value={inviteDate}
                    onChange={(e) => setInviteDate(e.target.value)}
                    className="w-full rounded-xl border px-2 py-2 text-[13px] outline-none"
                  />
                </div>

                <div>
                  <div className="mb-1 text-[11px] font-semibold text-gray-700">Time</div>
                  <input
                    type="time"
                    value={inviteTime}
                    onChange={(e) => setInviteTime(e.target.value)}
                    className="w-full rounded-xl border px-2 py-2 text-[13px] outline-none"
                  />
                </div>
              </div>
            )}

            <button
              type="button"
              onClick={() => void handleNextMatchTimeNext()}
              disabled={
                nextMatchTimeMode === "suggested"
                  ? !selectedNextMatchSuggestion
                  : !inviteDate || !inviteTime
              }
              className="w-full rounded-xl py-2.5 text-[14px] font-extrabold disabled:opacity-40"
              style={{ background: TM.neon, color: TM.ink }}
            >
              Next
            </button>
          </>
        )}

        {(inviteFlow === "rematch" || inviteStep === "details") && (
          <>
            <div
              className="mb-4 rounded-2xl border px-4 py-3"
              style={{
                borderColor: "rgba(15,23,42,0.10)",
                background: "rgb(248,250,252)",
              }}
            >
              <div className="text-[12px] font-extrabold" style={{ color: TM.ink }}>
                Selected time
              </div>
              <div className="mt-1 text-sm font-black text-gray-900">
                {selectedInviteDateTimeLabel}
              </div>
              {inviteFlow !== "rematch" && (
                <button
                  type="button"
                  onClick={() => setInviteStep("time")}
                  className="mt-2 text-[12px] font-bold underline"
                  style={{ color: TM.ink }}
                >
                  Back to change time
                </button>
              )}
            </div>

                {/* Suggested court */}
        {!isEventChat && (
          <div className="mb-4 rounded-2xl border px-4 py-3" style={{ borderColor: "rgba(15,23,42,0.10)" }}>
            <div className="text-[12px] font-extrabold" style={{ color: TM.ink }}>
              Suggested court
            </div>

            {/* Override: search a different court */}
<div className="mt-2 relative">
  <div className="text-[12px] font-semibold text-gray-700 mb-1">
    Use a different court
  </div>

  <input
    value={courtQuery}
    onChange={(e) => {
      const v = e.target.value;
      setCourtQuery(v);
      setSelectedCourt(null); // if typing again, we’re searching again
      debouncedCourtSearch(v);
    }}
    placeholder="Start typing a court name..."
    className="w-full rounded-xl border px-3 py-2 text-[14px] outline-none"
    style={{ borderColor: "rgba(15,23,42,0.12)" }}
  />

  {(courtMatchesLoading || courtMatches.length > 0) && (
<div
  className="absolute left-0 right-0 top-full mt-2 rounded-xl border bg-white overflow-hidden shadow-lg z-50"
  style={{
    borderColor: "rgba(15,23,42,0.12)",
    maxHeight: 240,
    overflowY: "auto",
  }}
>
      {courtMatchesLoading && (
        <div className="px-3 py-2 text-[12px] text-gray-600">Searching…</div>
      )}

      {!courtMatchesLoading &&
        courtMatches.map((c) => (
          <button
            key={c.id}
            type="button"
          onClick={() => {
  setSelectedCourt(c);
  setCourtMatches([]);
  setCourtQuery(c.name || "");

  // Prefill location only (do NOT put booking URL into the message)
  if (c?.name) setInviteLocation(c.name);
}}
            className="w-full text-left px-3 py-2 hover:bg-black/5"
          >
            <div className="text-[13px] font-bold text-gray-900 truncate">
              {c?.name || "Court"}
            </div>
            <div className="text-[12px] text-gray-600 truncate">
              {[c?.suburb, c?.postcode].filter(Boolean).join(" ")}
            </div>
          </button>
        ))}
    </div>
  )}

  {selectedCourt && (
    <button
      type="button"
      onClick={() => {
        setSelectedCourt(null);
        setCourtQuery("");
        setCourtMatches([]);
      }}
      className="mt-3 text-[12px] font-bold underline"
      style={{ color: TM.ink }}
    >
      Clear selection (use suggested)
    </button>
  )}
</div>

            {courtLoading && (
              <div className="mt-1 text-[12px] text-gray-600">Finding the best court for you both…</div>
            )}

            {!courtLoading && courtError && (
              <div className="mt-1 text-[12px] text-red-600">{courtError}</div>
            )}

{!courtLoading && !courtError && activeCourt && (() => {
  const fullAddress = [
    activeCourt?.address,
    activeCourt?.suburb,
    activeCourt?.state,
    activeCourt?.postcode,
  ]
    .filter(Boolean)
    .join(", ");

  const mapsHref = mapsUrlForAddress(fullAddress || activeCourt?.name);
  const mapsEmbedUrl = mapsEmbedUrlForAddress(fullAddress || activeCourt?.name);

  return (
    <div className="mt-3 text-[12px] text-gray-700">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="font-bold truncate">{activeCourt?.name}</div>
          <div className="opacity-80">
            {[
              activeCourt?.address,
              activeCourt?.suburb,
              activeCourt?.state,
              activeCourt?.postcode,
            ]
              .filter(Boolean)
              .join(", ")}
          </div>
        </div>

        {mapsHref && (
          <a
            href={mapsHref}
            target="_blank"
            rel="noreferrer"
            className="shrink-0 rounded-full border px-3 py-1.5 text-[11px] font-extrabold"
            style={{
              borderColor: "rgba(15,23,42,0.12)",
              background: "white",
              color: TM.ink,
            }}
          >
            Open in Maps
          </a>
        )}
      </div>

      {mapsEmbedUrl && mapsHref && (
        <a href={mapsHref} target="_blank" rel="noreferrer" className="block mt-3">
          <div
            className="overflow-hidden rounded-2xl border"
            style={{ borderColor: "rgba(11,61,46,0.12)" }}
          >
            <iframe
              src={mapsEmbedUrl}
              width="100%"
              height="160"
              loading="lazy"
              referrerPolicy="no-referrer-when-downgrade"
              className="block w-full pointer-events-none"
            />
          </div>
        </a>
      )}

      {activeCourt?.bookingUrl && (
        <a
          href={activeCourt.bookingUrl}
          target="_blank"
          rel="noreferrer"
          className="mt-3 inline-flex items-center justify-center rounded-xl px-4 py-2 text-[12px] font-extrabold"
          style={{
            background: TM.neon,
            color: TM.ink,
            boxShadow: "0 6px 18px rgba(57,255,20,0.22)",
          }}
        >
          Book Now
        </a>
      )}
    </div>
  );
})()}

       
          </div>
        )}

        {/* Duration */}
        <div className="mb-3">
          <div className="text-[12px] font-semibold text-gray-700 mb-1">Duration</div>
          <div className="flex gap-2">
            {[60, 90, 120].map((mins) => (
              <button
                key={mins}
                type="button"
                onClick={() => setInviteDuration(mins)}
                className="flex-1 rounded-xl border px-2 py-2 text-[13px] font-bold"
                style={{
                  background: inviteDuration === mins ? "rgba(57,255,20,0.18)" : "white",
                  borderColor:
                    inviteDuration === mins ? "rgba(57,255,20,0.55)" : "rgba(15,23,42,0.12)",
                  color: TM.ink,
                }}
              >
                {mins}m
              </button>
            ))}
          </div>
        </div>

        {/* Location */}
        <div className="mb-3">
          <div className="text-[12px] font-semibold text-gray-700 mb-1">Court Location</div>
          <input
            type="text"
            value={inviteLocation}
            onChange={(e) => setInviteLocation(e.target.value)}
            placeholder="e.g. Riverside Tennis Complex"
            className="w-full rounded-xl border px-3 py-2 text-[14px] outline-none"
          />
        </div>

        {/* Optional note */}
        <div className="mb-4">
          <div className="text-[12px] font-semibold text-gray-700 mb-1">Message (Optional)</div>
          <textarea
            value={inviteNote}
            onChange={(e) => setInviteNote(e.target.value)}
            placeholder="Add a note to your invite..."
            className="w-full rounded-xl border px-3 py-2 text-[14px] outline-none min-h-[84px]"
          />
        </div>

        <button
          type="button"
          onClick={sendInvite}
          disabled={!inviteDate || !inviteTime || !inviteLocation.trim()}
          className="w-full rounded-xl py-3 text-[14px] font-extrabold disabled:opacity-40"
          style={{ background: TM.neon, color: TM.ink }}
        >
          {inviteFlow === "rematch" ? "Send Rematch Invite" : "Send Match Invite"}
        </button>

        <button
          type="button"
          onClick={closeInviteModal}
          className="w-full py-3 text-[13px] font-semibold text-gray-600"
        >
          Cancel
        </button>
          </>
        )}
      </div>
    </div>
  </div>
)}

  {inviteOverlayId && (
      <div className="fixed inset-0 z-[999]">
        <div
          className="absolute inset-0 bg-black/40"
          onMouseDown={() => setInviteOverlayId(null)}
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
                onClick={() => setInviteOverlayId(null)}
                className="rounded-lg px-3 py-1.5 text-xs font-semibold border border-slate-200 bg-white hover:bg-slate-100"
              >
                Close
              </button>
            </div>

            <InviteOverlayCard inviteId={inviteOverlayId} onClose={() => setInviteOverlayId(null)} />
          </div>
        </div>
      </div>
    )}

    {profileOpenId && (
  <div className="fixed inset-0 z-[1000]">
    <div
      className="absolute inset-0 bg-black/40"
      onMouseDown={() => setProfileOpenId(null)}
    />

    <div className="absolute inset-0 flex items-center justify-center p-4">
      <div
        className="w-[560px] max-w-[95vw] h-[85vh] rounded-2xl overflow-hidden shadow-2xl bg-white border border-slate-200"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <PlayerProfileView
          playerId={profileOpenId}
          onClose={() => setProfileOpenId(null)}
        />
      </div>
    </div>
  </div>
)}

    </div>

  );
}

export default MatchHubChat;
