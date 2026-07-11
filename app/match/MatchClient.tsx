"use client";

import { useEffect, useState, useMemo, useCallback, useRef } from "react";
import { db, auth } from "@/lib/firebaseConfig";
import { type SkillBand, SKILL_OPTIONS, skillFromUTR } from "../../lib/skills";
import { resolveProfilePhoto } from "@/lib/profilePhoto";
import {
  collection,
  getCountFromServer,
  getDocs,
  doc,
  getDoc,
  addDoc,
  setDoc,
  serverTimestamp,
  writeBatch,
  increment,
  query,
  where,
  updateDoc,
  deleteDoc,
  Timestamp,
  limit,
  onSnapshot,
} from "firebase/firestore";
import { useRouter, useSearchParams } from "next/navigation";
import { applyActionCode, signOut } from "firebase/auth";
import Link from "next/link";
import { CheckCircle2, SlidersHorizontal, CalendarDays, MapPin, ArrowLeft, X } from "lucide-react";
import Image from "next/image";
import { track } from "@/lib/track";
import PlayerProfileView from "@/components/players/PlayerProfileView";
import { useIsDesktop } from "@/lib/useIsDesktop";
import DesktopMatchPage from "@/components/match/DesktopMatchPage";
import TMDesktopSidebar from "@/components/desktop_layout/TMDesktopSidebar";
import { trackEvent } from "@/lib/mixpanel";
import { getNearbyPlayers } from "@/lib/nearbyPlayersClient";
import AgeGateModal from "@/components/AgeGateModal";
import { useRequireBirthYear } from "@/lib/useRequireBirthYear";
import { createMatchRequestWithRelationship } from "@/lib/playerRelationships";
import { useOnboardingProgress } from "@/lib/useOnboardingProgress";
import NotificationPrompt from "@/components/notifications/NotificationPrompt";
import { shouldShowNotificationPrompt } from "@/lib/notificationPromptState";
import { registerTennisMateNotifications } from "@/lib/registerNotifications";
import {
  analyticsDistanceBand,
  trackEvent as trackAnalyticsEvent,
} from "@/lib/analytics";
import { ANALYTICS_EVENTS } from "@/lib/analyticsEvents";



// import { getContinueUrl } from "@/lib/auth/getContinueUrl";


interface Player {
  // âœ… "id" SHOULD be the UID / players docId
  id: string;
  userId?: string;

  // âœ… debug-only fields (safe to leave in; wonâ€™t break anything)
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
  profileComplete?: boolean | null;
  timestamp?: any;
  lastActiveAt?: any;
  score?: number;
  baseScore?: number;
  finalScore?: number;
  freshnessAdjustment?: number;
  activityAdjustment?: number;
  distance?: number;
  lat?: number | null;
  lng?: number | null;
}

type ScoredPlayer = Player & {
  score: number;
  distance: number;
  skillBand: SkillBand | "";
  baseScore?: number;
  finalScore?: number;
  freshnessAdjustment?: number;
  activityAdjustment?: number;
};

type MatchRecommendationImpression = {
  candidateId: string;
  lastSeenAt?: Timestamp | Date | string | number | null;
  timesShown?: number | null;
  firstSeenAt?: Timestamp | Date | string | number | null;
  lastBaseScore?: number | null;
  lastFinalScore?: number | null;
};

const MATCH_RECOMMENDATION_IMPRESSIONS_COLLECTION = "match_recommendation_impressions";
const DAY_MS = 24 * 60 * 60 * 1000;
const PROTECTED_RELEVANCE_COUNT = 2;
const TOP_RECENT_ACTIVITY_GUARD_COUNT = 20;
const RECOMMENDATION_SCORE_SCALE = 5;
const CLOSE_SCORE_ROTATION_THRESHOLD = 15;
const RECOMMENDATION_BANDS = [
  { key: "excellent", min: 80 },
  { key: "good", min: 60 },
  { key: "possible", min: 40 },
] as const;

type RecommendedMatchPlayer = Player & {
  recommendationReasons: string[];
  recommendationScore?: number | null;
  notificationId?: string | null;
};

type AvailabilityFormState = {
  date: string;
  timeSlot: "morning" | "afternoon" | "evening";
  postcode: string;
  radiusKm: string;
  matchType: "singles" | "casual_hit";
  note: string;
};

type AvailabilityRecord = {
  id: string;
  userId: string;
  instanceId: string;
  status: string;
  date: string;
  timeSlot: string;
  postcode: string;
  radiusKm: number;
  matchType: string;
  note: string;
  name: string;
  photoURL: string | null;
  photoThumbURL: string | null;
  skillBand: SkillBand | "";
  skillBandLabel: string | null;
  skillLevel: string | null;
  skillRating: number | null;
  utr: number | null;
  lat: number | null;
  lng: number | null;
  createdAt: any;
  updatedAt: any;
  expiresAt: any;
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

const MAX_NEARBY_READS = 600; // max callable result cap for nearby players
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

  // âœ… Hide if older than 3 days
  if (days > 3) return null;

  // âœ… CTA tiers
if (mins <= 5) return { label: "ONLINE NOW", level: "hot" };
if (mins < 30) return { label: `ACTIVE ${mins}M AGO`, level: "hot" };
  if (mins < 120) return { label: `Active ${mins}m ago`, level: "warm" };
  if (hrs < 24) return { label: `Active ${hrs}h ago`, level: "cool" };
  if (days === 1) return { label: "Active yesterday", level: "cool" };
  return { label: `Active ${days}d ago`, level: "cool" };
};

type ActivityLevel = "online" | "recent" | "inactive";

const getActivityLevel = (ts: any): ActivityLevel => {
  const days = getDaysSinceActive(ts);
  if (days == null) return "inactive";

  const mins = days * 24 * 60;

  if (mins <= 5) return "online";
  if (days <= 14) return "recent";
  return "inactive";
};

const getDaysSinceActive = (ts: any): number | null => {
  if (!ts) return null;

  const d: Date =
    typeof ts?.toDate === "function"
      ? ts.toDate()
      : ts instanceof Date
      ? ts
      : new Date(ts);

  const diffMs = Date.now() - d.getTime();
  if (!Number.isFinite(diffMs) || diffMs < 0) return null;

  return diffMs / DAY_MS;
};

const activityFreshnessPenalty = (ts: any): number => {
  const days = getDaysSinceActive(ts);
  if (days == null) return -35;
  if (days <= 7) return 3;
  if (days <= 14) return -5;
  if (days <= 30) return -18;
  if (days <= 90) return -35;
  return -60;
};

const isRecentlyActiveCandidate = (player: Player): boolean => {
  const days = getDaysSinceActive(player.lastActiveAt);
  return days != null && days <= 14;
};

const activityPoints = (ts: any): number => {
  const level = getActivityLevel(ts);

  if (level === "online") return 5;
  if (level === "recent") return 2;
  return -1;
};

const getActivityAgoLabel = (ts: any): string => {
  if (!ts) return "Offline";

  const d: Date =
    typeof ts?.toDate === "function"
      ? ts.toDate()
      : ts instanceof Date
      ? ts
      : new Date(ts);

  const diffMs = Date.now() - d.getTime();
  if (!Number.isFinite(diffMs) || diffMs < 0) return "Offline";

  const mins = Math.floor(diffMs / 60000);
  const hrs = Math.floor(mins / 60);
  const days = Math.floor(hrs / 24);

  if (mins <= 5) return "ONLINE NOW";
  if (mins < 60) return `Active ${mins} mins ago`;
  if (hrs < 24) return `Active ${hrs} hours ago`;

  // ðŸ‘‡ THIS is where your code goes
  if (days === 1) return "Active yesterday";
  return `Active ${days} days ago`;
};

const getActivityBadge = (ts: any) => {
  const level = getActivityLevel(ts);
  const agoLabel = getActivityAgoLabel(ts);

  if (level === "online") {
    return {
      label: "ONLINE NOW",
      style: {
        background: "rgba(57,255,20,0.18)",
        border: "1.5px solid #39FF14",
        color: "#0B3D2E",
        boxShadow: "0 0 12px rgba(57,255,20,0.7)",
      } as React.CSSProperties,
    };
  }

  if (level === "recent") {
    return {
      label: agoLabel,
      style: {
        background: "rgba(255,200,0,0.15)",
        border: "1px solid rgba(255,200,0,0.6)",
        color: "#0B3D2E",
      } as React.CSSProperties,
    };
  }

  return {
    label: agoLabel,
    style: {
      background: "rgba(15,23,42,0.06)",
      border: "1px solid rgba(15,23,42,0.12)",
      color: "rgba(15,23,42,0.6)",
    } as React.CSSProperties,
  };
};

const formatAvailability = (slots: string[] | undefined | null) => {
  const a = Array.isArray(slots) ? slots : [];
  if (a.length === 0) return "Availability unknown";

  // show up to 2 slots like the screenshot
  const shown = a.slice(0, 2).join(" & ");
  const more = a.length > 2 ? ` +${a.length - 2}` : "";
  return `${shown}${more}`;
};

const formatAvailabilityDateLabel = (value?: string) => {
  if (!value) return "Date not set";
  const parsed = new Date(`${value}T12:00:00`);
  if (Number.isNaN(parsed.getTime())) return value;
  return new Intl.DateTimeFormat("en-AU", {
    weekday: "long",
    month: "short",
    day: "numeric",
  }).format(parsed);
};

const formatAvailabilityTimeLabel = (value?: string) => {
  if (value === "morning") return "Morning";
  if (value === "afternoon") return "Afternoon";
  return "Evening";
};

const formatAvailabilityMatchType = (value?: string) => {
  if (value === "casual_hit") return "Casual Hit";
  return "Singles";
};

const toDateSafe = (value: any): Date | null => {
  if (!value) return null;
  if (typeof value?.toDate === "function") {
    const d = value.toDate();
    return Number.isNaN(d.getTime()) ? null : d;
  }
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
};

const endOfAvailabilityDay = (dateValue: string) => {
  const d = new Date(`${dateValue}T23:59:59`);
  return Number.isNaN(d.getTime()) ? Timestamp.fromMillis(Date.now()) : Timestamp.fromDate(d);
};

const isAvailabilityExpired = (availability: { date?: string; expiresAt?: any } | null | undefined) => {
  if (!availability) return true;

  const expiresAt = toDateSafe(availability.expiresAt);
  if (expiresAt) return expiresAt.getTime() < Date.now();

  if (availability.date) {
    const fallback = new Date(`${availability.date}T23:59:59`);
    if (!Number.isNaN(fallback.getTime())) return fallback.getTime() < Date.now();
  }

  return false;
};

const hasText = (value: unknown) => typeof value === "string" && value.trim().length > 0;

const hasUsablePublicPlayerProfile = (data: any) => {
  if (!data || typeof data !== "object") return false;

  const hasSkill =
    hasText(data.skillLevel) ||
    hasText(data.skillBand) ||
    (typeof data.skillRating === "number" && Number.isFinite(data.skillRating)) ||
    (typeof data.utr === "number" && Number.isFinite(data.utr));

  return hasText(data.name) && hasText(data.postcode) && hasSkill;
};

const needsAvailabilityProfileEnrichment = (availability: AvailabilityRecord) =>
  !hasText(availability.name) ||
  availability.name.trim().toLowerCase() === "player" ||
  !hasText(availability.photoURL) ||
  !hasText(availability.photoThumbURL);

const availabilitySnapshotFromPlayer = (player: any) => ({
  name: hasText(player.name) ? player.name.trim() : "Player",
  photoURL: resolveProfilePhoto(player),
  photoThumbURL:
    hasText(player.photoThumbURL) ? player.photoThumbURL.trim() : resolveProfilePhoto(player),
  postcode: hasText(player.postcode) ? player.postcode.trim() : "",
  skillBand: (hasText(player.skillBand) ? player.skillBand.trim() : "") as SkillBand | "",
  skillBandLabel: hasText(player.skillBandLabel) ? player.skillBandLabel.trim() : null,
  skillLevel: hasText(player.skillLevel) ? player.skillLevel.trim() : null,
  skillRating:
    typeof player.skillRating === "number" && Number.isFinite(player.skillRating)
      ? player.skillRating
      : null,
  utr:
    typeof player.utr === "number" && Number.isFinite(player.utr)
      ? player.utr
      : null,
});

const enrichAvailabilityRecordsFromPlayers = async (records: AvailabilityRecord[]) => {
  if (records.length === 0) return records;

  const uniqueUserIds = Array.from(new Set(records.map((item) => item.userId)));
  const playerSnaps = await Promise.all(
    uniqueUserIds.map(async (uid) => ({
      uid,
      snap: await getDoc(doc(db, "players", uid)),
    }))
  );

  const publicProfiles = new Map<string, ReturnType<typeof availabilitySnapshotFromPlayer>>();
  playerSnaps.forEach(({ uid, snap }) => {
    if (!snap.exists()) return;
    const player = snap.data();
    if (!hasUsablePublicPlayerProfile(player)) return;
    publicProfiles.set(uid, availabilitySnapshotFromPlayer(player));
  });

  return records.flatMap((record) => {
    const profile = publicProfiles.get(record.userId);
    if (!profile) return [];

    return {
      ...record,
      name: needsAvailabilityProfileEnrichment(record) ? profile.name : record.name,
      photoURL: profile.photoURL,
      photoThumbURL: profile.photoThumbURL,
      postcode: profile.postcode || record.postcode,
      skillBand: profile.skillBand || record.skillBand,
      skillBandLabel: profile.skillBandLabel || record.skillBandLabel,
      skillLevel: profile.skillLevel || record.skillLevel,
      skillRating: profile.skillRating ?? record.skillRating,
      utr: profile.utr ?? record.utr,
    };
  });
};

const normalizeAvailabilityRecord = (id: string, data: any): AvailabilityRecord | null => {
  if (!data || typeof data !== "object") return null;

  const userId =
    typeof data.userId === "string" && data.userId.trim()
      ? data.userId.trim()
      : typeof data.uid === "string" && data.uid.trim()
      ? data.uid.trim()
      : id;

  const date = typeof data.date === "string" ? data.date : "";
  if (!date) return null;

  return {
    id,
    userId,
    instanceId:
      typeof data.instanceId === "string" && data.instanceId.trim()
        ? data.instanceId.trim()
        : id,
    status: typeof data.status === "string" ? data.status : "open",
    date,
    timeSlot: typeof data.timeSlot === "string" ? data.timeSlot : "evening",
    postcode: typeof data.postcode === "string" ? data.postcode : "",
    radiusKm:
      typeof data.radiusKm === "number"
        ? data.radiusKm
        : Number.parseInt(String(data.radiusKm ?? "10"), 10) || 10,
    matchType: typeof data.matchType === "string" ? data.matchType : "singles",
    note: typeof data.note === "string" ? data.note : "",
    name:
      typeof data.name === "string" && data.name.trim()
        ? data.name.trim()
        : "Player",
    photoURL:
      typeof data.photoURL === "string" && data.photoURL.trim()
        ? data.photoURL.trim()
        : null,
    photoThumbURL:
      typeof data.photoThumbURL === "string" && data.photoThumbURL.trim()
        ? data.photoThumbURL.trim()
        : null,
    skillBand:
      (typeof data.skillBand === "string" ? data.skillBand : "") as SkillBand | "",
    skillBandLabel:
      typeof data.skillBandLabel === "string" && data.skillBandLabel.trim()
        ? data.skillBandLabel.trim()
        : null,
    skillLevel:
      typeof data.skillLevel === "string" && data.skillLevel.trim()
        ? data.skillLevel.trim()
        : null,
    skillRating:
      typeof data.skillRating === "number" && Number.isFinite(data.skillRating)
        ? data.skillRating
        : null,
    utr:
      typeof data.utr === "number" && Number.isFinite(data.utr)
        ? data.utr
        : null,
    lat: typeof data.lat === "number" ? data.lat : null,
    lng: typeof data.lng === "number" ? data.lng : null,
    createdAt: data.createdAt ?? null,
    updatedAt: data.updatedAt ?? null,
    expiresAt: data.expiresAt ?? null,
  };
};


export default function MatchPage() {
  const {
    user,
    isCheckingBirthYear,
    needsBirthYear,
    saveBirthYear,
  } = useRequireBirthYear(true);
  const [myProfile, setMyProfile] = useState<Player | null>(null);
  const [rawMatches, setRawMatches] = useState<Player[]>([]);
  const [sentRequests, setSentRequests] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [blockedMatchUserIds, setBlockedMatchUserIds] = useState<Set<string>>(new Set());
  const [sortBy, setSortBy] = useState<string>("score");
  const PAGE_SIZE = 10;
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  const MAX_DISTANCE_KM = 50; // hard cutoff to prevent interstate matches
  const [matchMode, setMatchMode] = useState<"auto"|"skill"|"utr">("auto");
  const [myProfileHidden, setMyProfileHidden] = useState(false);
  const refreshingRef = useRef(false);
  const matchPageTrackedRef = useRef(false);
  const [profileOpenId, setProfileOpenId] = useState<string | null>(null);
  const [recommendedMatches, setRecommendedMatches] = useState<RecommendedMatchPlayer[]>([]);
  const [recommendedMatchLoading, setRecommendedMatchLoading] = useState(false);
  const isDesktop = useIsDesktop();
  const userCreatedAtMs = user?.metadata?.creationTime
    ? new Date(user.metadata.creationTime).getTime()
    : null;
  const isNewUserForOnboarding =
    userCreatedAtMs == null || Date.now() - userCreatedAtMs < 14 * 24 * 60 * 60 * 1000;
  const onboarding = useOnboardingProgress(user?.uid, {
    enabled: Boolean(user?.emailVerified && myProfile?.profileComplete === true && isNewUserForOnboarding),
  });
  const [firstRequestSuccessVisible, setFirstRequestSuccessVisible] = useState(false);
  const [matchRequestNotificationPromptOpen, setMatchRequestNotificationPromptOpen] = useState(false);
  const [matchSurface, setMatchSurface] = useState<"players" | "availability">("players");
  const [availabilityRequestOpen, setAvailabilityRequestOpen] = useState(false);
  const [availabilityDraftSaved, setAvailabilityDraftSaved] = useState(false);
  const [availabilitySaveError, setAvailabilitySaveError] = useState<string | null>(null);
  const [availabilitySaving, setAvailabilitySaving] = useState(false);
  const [availabilityActionsOpen, setAvailabilityActionsOpen] = useState(false);
  const [availabilityCancelling, setAvailabilityCancelling] = useState(false);
  const [pendingAvailabilityInterestKeys, setPendingAvailabilityInterestKeys] = useState<Set<string>>(new Set());
  const [postcodePrefixPlayerCount, setPostcodePrefixPlayerCount] = useState<number | null>(null);
  const [availabilityRequest, setAvailabilityRequest] = useState<AvailabilityFormState>({
    date: "",
    timeSlot: "evening",
    postcode: "",
    radiusKm: "10",
    matchType: "singles",
    note: "",
  });
  const [activeAvailabilityRecord, setActiveAvailabilityRecord] = useState<AvailabilityRecord | null>(null);
  const [browseAvailabilityRecords, setBrowseAvailabilityRecords] = useState<AvailabilityRecord[]>([]);
  


type GenderFilter = "" | "Male" | "Female" | "Non-binary" | "Other";
type ActivityFilter = "" | "online" | "recent" | "offline";

const [ageBand, setAgeBand] = useState<AgeBand>("");
const [genderFilter, setGenderFilter] = useState<GenderFilter>("");
const [activityFilter, setActivityFilter] = useState<ActivityFilter>("");

const router = useRouter();
const params = useSearchParams();

const setQuery = (key: string, value?: string) => {
  const p = new URLSearchParams(params.toString());
  if (value == null || value === "") p.delete(key);
  else p.set(key, value);
  router.replace(`?${p.toString()}`);
};

const clearRecommendedMatchQuery = () => {
  const p = new URLSearchParams(params.toString());
  p.delete("recommendedPlayerId");
  p.delete("candidateId");
  p.delete("notificationId");
  const qs = p.toString();
  router.replace(qs ? `?${qs}` : "/match", { scroll: false });
};

const [justVerified, setJustVerified] = useState(false);

const [hideContacted, setHideContacted] = useState(true);

const [refreshing, setRefreshing] = useState(false);
const [lastUpdated, setLastUpdated] = useState<number | null>(null);
const [dismissedPlayerIds, setDismissedPlayerIds] = useState<Set<string>>(new Set());
const [recommendationImpressions, setRecommendationImpressions] = useState<Record<string, MatchRecommendationImpression>>({});
const recommendationImpressionWriteRef = useRef<Set<string>>(new Set());
const recommendationRotationSeedRef = useRef(`${Date.now()}-${Math.random()}`);
const recommendationsViewedTrackedRef = useRef(false);


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
  activityFilter !== "" ||
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

useEffect(() => {
  if (!myProfile?.postcode) return;
  setAvailabilityRequest((prev) =>
    prev.postcode ? prev : { ...prev, postcode: myProfile.postcode }
  );
}, [myProfile?.postcode]);

useEffect(() => {
  if (!user?.uid || !myProfile?.postcode) {
    setPostcodePrefixPlayerCount(null);
    return;
  }

  const prefix = myProfile.postcode.trim().charAt(0);
  if (!/^\d$/.test(prefix)) {
    setPostcodePrefixPlayerCount(null);
    return;
  }

  let cancelled = false;
  const lower = prefix;
  const upper = prefix === "9" ? ":" : String(Number(prefix) + 1);

  const loadPostcodePrefixCount = async () => {
    const playersRef = collection(db, "players");

    try {
      const countQ = query(
        playersRef,
        where("postcode", ">=", lower),
        where("postcode", "<", upper),
        where("profileComplete", "==", true),
        where("isMatchable", "==", true)
      );

      const countSnap = await getCountFromServer(countQ);
      let nextCount = countSnap.data().count;

      if (
        hasUsablePublicPlayerProfile(myProfile) &&
        myProfile.profileComplete === true &&
        myProfile.isMatchable === true
      ) {
        nextCount = Math.max(0, nextCount - 1);
      }

      if (!cancelled) setPostcodePrefixPlayerCount(nextCount);
    } catch (error) {
      console.warn("[MatchPage] postcode-prefix count aggregate failed; falling back to client count", error);

      try {
        const fallbackQ = query(
          playersRef,
          where("postcode", ">=", lower),
          where("postcode", "<", upper)
        );
        const snap = await getDocs(fallbackQ);
        let nextCount = 0;

        snap.forEach((docSnap) => {
          if (docSnap.id === user.uid) return;
          const data = docSnap.data() as any;
          if (!hasUsablePublicPlayerProfile(data)) return;
          if (data.isMatchable === false) return;
          nextCount += 1;
        });

        if (!cancelled) setPostcodePrefixPlayerCount(nextCount);
      } catch (fallbackError) {
        console.warn("[MatchPage] postcode-prefix count fallback failed", fallbackError);
        if (!cancelled) setPostcodePrefixPlayerCount(null);
      }
    }
  };

  void loadPostcodePrefixCount();

  return () => {
    cancelled = true;
  };
}, [myProfile, user?.uid]);

useEffect(() => {
  if (!availabilityDraftSaved) return;
  const t = window.setTimeout(() => setAvailabilityDraftSaved(false), 3500);
  return () => window.clearTimeout(t);
}, [availabilityDraftSaved]);

useEffect(() => {
  if (!activeAvailabilityRecord) return;

  setAvailabilityRequest({
    date: activeAvailabilityRecord.date,
    timeSlot:
      activeAvailabilityRecord.timeSlot === "morning" ||
      activeAvailabilityRecord.timeSlot === "afternoon"
        ? activeAvailabilityRecord.timeSlot
        : "evening",
    postcode: activeAvailabilityRecord.postcode || myProfile?.postcode || "",
    radiusKm: String(activeAvailabilityRecord.radiusKm || 10),
    matchType: activeAvailabilityRecord.matchType === "casual_hit" ? "casual_hit" : "singles",
    note: activeAvailabilityRecord.note || "",
  });
}, [activeAvailabilityRecord, myProfile?.postcode]);

useEffect(() => {
  if (activeAvailabilityRecord) return;
  setAvailabilityActionsOpen(false);
}, [activeAvailabilityRecord]);

useEffect(() => {
  if (!user?.uid) {
    setActiveAvailabilityRecord(null);
    setBrowseAvailabilityRecords([]);
    setPendingAvailabilityInterestKeys(new Set());
    return;
  }

  const activeRef = doc(db, "availabilities", user.uid);
  const browseQ = query(
    collection(db, "availabilities"),
    where("status", "==", "open"),
    limit(30)
  );

  const unsubActive = onSnapshot(
    activeRef,
    (snap) => {
      if (!snap.exists()) {
        setActiveAvailabilityRecord(null);
        return;
      }

      const normalized = normalizeAvailabilityRecord(snap.id, snap.data());
      if (!normalized || normalized.status !== "open" || isAvailabilityExpired(normalized)) {
        setActiveAvailabilityRecord(null);
        return;
      }

      setActiveAvailabilityRecord(normalized);
    },
    (error) => {
      console.error("[MatchPage] failed to subscribe to active availability", error);
    }
  );

  const unsubBrowse = onSnapshot(
    browseQ,
    async (snap) => {
      const next = snap.docs
        .map((d) => normalizeAvailabilityRecord(d.id, d.data()))
        .filter((item): item is AvailabilityRecord => !!item)
        .filter((item) => item.userId !== user.uid)
        .filter((item) => !isAvailabilityExpired(item))
        .sort((a, b) => {
          const aTime =
            toDateSafe(a.updatedAt)?.getTime() ??
            toDateSafe(a.createdAt)?.getTime() ??
            0;
          const bTime =
            toDateSafe(b.updatedAt)?.getTime() ??
            toDateSafe(b.createdAt)?.getTime() ??
            0;
          return bTime - aTime;
        });

      try {
        setBrowseAvailabilityRecords(await enrichAvailabilityRecordsFromPlayers(next));
      } catch (error) {
        console.warn("[MatchPage] failed to enrich availability profiles", error);
        setBrowseAvailabilityRecords(next);
      }
    },
    (error) => {
      console.error("[MatchPage] failed to subscribe to browse availabilities", error);
      setAvailabilitySaveError("We couldn't load open availabilities just now.");
    }
  );

  return () => {
    unsubActive();
    unsubBrowse();
  };
}, [user?.uid]);

useEffect(() => {
  if (!user?.uid) {
    setDismissedPlayerIds(new Set());
    return;
  }

  const dismissedRef = collection(db, "users", user.uid, "dismissedPlayers");
  const unsubDismissed = onSnapshot(
    dismissedRef,
    (snap) => {
      const next = new Set<string>();
      snap.docs.forEach((docSnap) => {
        next.add(docSnap.id);
      });
      setDismissedPlayerIds(next);
    },
    (error) => {
      console.error("[MatchPage] failed to subscribe to dismissed players", error);
    }
  );

  return () => unsubDismissed();
}, [user?.uid]);

useEffect(() => {
  recommendationImpressionWriteRef.current.clear();

  if (!user?.uid) {
    setRecommendationImpressions({});
    return;
  }

  let cancelled = false;
  const impressionsRef = collection(
    db,
    "users",
    user.uid,
    MATCH_RECOMMENDATION_IMPRESSIONS_COLLECTION
  );
  getDocs(impressionsRef)
    .then((snap) => {
      if (cancelled) return;
      const next: Record<string, MatchRecommendationImpression> = {};
      snap.docs.forEach((docSnap) => {
        const data = docSnap.data() as MatchRecommendationImpression;
        next[docSnap.id] = {
          ...data,
          candidateId: data.candidateId || docSnap.id,
        };
      });
      setRecommendationImpressions(next);
    })
    .catch((error) => {
      if (cancelled) return;
      console.error("[MatchPage] failed to load recommendation impressions", error);
    });

  return () => {
    cancelled = true;
  };
}, [user?.uid]);

useEffect(() => {
  if (!user?.uid) {
    setPendingAvailabilityInterestKeys(new Set());
    return;
  }

  const sentAvailabilityQ = query(
    collection(db, "match_requests"),
    where("fromUserId", "==", user.uid),
    where("status", "==", "pending")
  );

  const unsub = onSnapshot(
    sentAvailabilityQ,
    (snap) => {
      const next = new Set<string>();

      snap.forEach((docSnap) => {
        const data = docSnap.data() as any;
        if (data?.requestContext !== "availability_interest") return;

        const toUserId =
          typeof data.toUserId === "string" && data.toUserId.trim()
            ? data.toUserId.trim()
            : null;
        const instanceId =
          typeof data.availabilityInstanceId === "string" && data.availabilityInstanceId.trim()
            ? data.availabilityInstanceId.trim()
            : null;

        if (toUserId && instanceId) next.add(`${toUserId}:${instanceId}`);
      });

      setPendingAvailabilityInterestKeys(next);
    },
    (error) => {
      console.error("[MatchPage] failed to subscribe to sent availability interests", error);
    }
  );

  return () => unsub();
}, [user?.uid]);

const handleAvailabilitySubmit = useCallback(
  async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();

    if (!user?.uid || !myProfile) {
      setAvailabilitySaveError("Please finish loading your profile before posting availability.");
      return;
    }

    setAvailabilitySaving(true);
    setAvailabilitySaveError(null);

    try {
      const cleanPostcode = availabilityRequest.postcode.replace(/\D/g, "").slice(0, 4);
      const photo = resolveProfilePhoto(myProfile);
      const availabilityRef = doc(db, "availabilities", user.uid);
      const instanceId =
        activeAvailabilityRecord?.instanceId ||
        globalThis.crypto?.randomUUID?.() ||
        `${user.uid}_${Date.now()}`;

      await setDoc(
        availabilityRef,
        {
          instanceId,
          userId: user.uid,
          status: "open",
          date: availabilityRequest.date,
          timeSlot: availabilityRequest.timeSlot,
          postcode: cleanPostcode || myProfile.postcode || "",
          radiusKm: Number.parseInt(availabilityRequest.radiusKm, 10) || 10,
          matchType: availabilityRequest.matchType,
          note: availabilityRequest.note.trim(),
          name: myProfile.name || user.displayName || "Player",
          photoURL: photo,
          photoThumbURL:
            typeof myProfile.photoThumbURL === "string" && myProfile.photoThumbURL.trim()
              ? myProfile.photoThumbURL.trim()
              : photo,
          skillBand: myProfile.skillBand || "",
          skillBandLabel: myProfile.skillBandLabel || null,
          skillLevel: myProfile.skillLevel || null,
          skillRating:
            typeof myProfile.skillRating === "number" && Number.isFinite(myProfile.skillRating)
              ? myProfile.skillRating
              : null,
          utr:
            typeof myProfile.utr === "number" && Number.isFinite(myProfile.utr)
              ? myProfile.utr
              : null,
          lat: typeof myProfile.lat === "number" ? myProfile.lat : null,
          lng: typeof myProfile.lng === "number" ? myProfile.lng : null,
          createdAt: activeAvailabilityRecord?.createdAt ?? serverTimestamp(),
          updatedAt: serverTimestamp(),
          expiresAt: endOfAvailabilityDay(availabilityRequest.date),
        },
        { merge: true }
      );

      setAvailabilityRequestOpen(false);
      setAvailabilityDraftSaved(true);
      setMatchSurface("availability");
    } catch (error) {
      console.error("[MatchPage] failed to save availability", error);
      setAvailabilitySaveError("We couldn't save that availability just now. Please try again.");
    } finally {
      setAvailabilitySaving(false);
    }
  },
  [activeAvailabilityRecord?.createdAt, availabilityRequest, myProfile, user]
);

const handleEditAvailability = useCallback(() => {
  setAvailabilityActionsOpen(false);
  setAvailabilitySaveError(null);
  setAvailabilityRequestOpen(true);
}, []);

const handleCancelAvailability = useCallback(async () => {
  if (!user?.uid || !activeAvailabilityRecord?.instanceId) return;

  setAvailabilityCancelling(true);
  setAvailabilitySaveError(null);

  try {
    const pendingAvailabilityQ = query(
      collection(db, "match_requests"),
      where("toUserId", "==", user.uid),
      where("status", "==", "pending")
    );

    const pendingAvailabilitySnap = await getDocs(pendingAvailabilityQ);
    const relatedRequests = pendingAvailabilitySnap.docs.filter((docSnap) => {
      const data = docSnap.data() as any;
      return (
        data?.requestContext === "availability_interest" &&
        data?.availabilityInstanceId === activeAvailabilityRecord.instanceId
      );
    });

    await Promise.all(
      relatedRequests.map(async (docSnap) => {
        const requestId = docSnap.id;
        await deleteDoc(doc(db, "match_requests", requestId));

        const notificationQ = query(
          collection(db, "notifications"),
          where("recipientId", "==", user.uid),
          where("matchId", "==", requestId)
        );
        const notificationSnap = await getDocs(notificationQ);
        await Promise.all(notificationSnap.docs.map((notificationDoc) => deleteDoc(notificationDoc.ref)));
      })
    );

    await setDoc(
      doc(db, "availabilities", user.uid),
      {
        status: "cancelled",
        updatedAt: serverTimestamp(),
      },
      { merge: true }
    );

    setAvailabilityActionsOpen(false);
    setAvailabilityDraftSaved(false);
  } catch (error) {
    console.error("[MatchPage] failed to cancel availability", error);
    setAvailabilitySaveError("We couldn't cancel that availability just now. Please try again.");
  } finally {
    setAvailabilityCancelling(false);
  }
}, [activeAvailabilityRecord?.instanceId, user?.uid]);




const loadNearbyPlayers = useCallback(
  async (radiusKm: number) => {
    const response = await getNearbyPlayers({
      radiusKm,
      activeWithinHours: null,
      limit: MAX_NEARBY_READS,
    });

    return response.players.map((data) => {
      const uid = data.uid;
      const photoURL =
        typeof data.photoThumbURL === "string" ? data.photoThumbURL :
        typeof data.photoURL === "string" ? data.photoURL :
        null;

      return {
        id: uid,
        userId: uid,
        docId: uid,
        dataId: null,
        name: data.name || "",
        postcode: data.postcode || "",
        skillLevel: data.skillLevel,
        skillBand: (data.skillBand as SkillBand | "" | undefined) ?? "",
        skillBandLabel: data.skillBandLabel ?? null,
        utr: typeof data.skillRating === "number" ? data.skillRating : null,
        skillRating: typeof data.skillRating === "number" ? data.skillRating : null,
        availability: Array.isArray(data.availability) ? (data.availability as string[]) : [],
        bio: data.bio || "",
        email: "",
        photoURL: photoURL ?? undefined,
        photoThumbURL: typeof data.photoThumbURL === "string" ? data.photoThumbURL : null,
        avatar: photoURL,
        birthYear: null,
        age: null,
        gender: null,
        isMatchable: typeof data.isMatchable === "boolean" ? data.isMatchable : true,
        timestamp: null,
        lastActiveAt: data.lastActiveAt ?? null,
        distance: data.distanceKm,
      } satisfies Player;
    });
  },
  []
);

const loadBlockedMatchUserIds = useCallback(async (currentUid: string) => {
  const blocked = new Set<string>();
  const statusesToBlock = ["pending", "confirmed", "accepted"];

  const snaps = await Promise.all(
    statusesToBlock.flatMap((status) => [
      getDocs(
        query(
          collection(db, "match_requests"),
          where("fromUserId", "==", currentUid),
          where("status", "==", status)
        )
      ),
      getDocs(
        query(
          collection(db, "match_requests"),
          where("toUserId", "==", currentUid),
          where("status", "==", status)
        )
      ),
    ])
  );

  snaps.forEach((snap) => {
    snap.forEach((d) => {
      const data = d.data() as any;

      const fromUid =
        typeof data.fromUserId === "string" ? data.fromUserId.trim() : null;
      const toUid =
        typeof data.toUserId === "string" ? data.toUserId.trim() : null;

      if (fromUid === currentUid && toUid) blocked.add(toUid);
      if (toUid === currentUid && fromUid) blocked.add(fromUid);
    });
  });

  blocked.delete(currentUid);
  return blocked;
}, []);

const refreshMatches = useCallback(async () => {
  if (!auth.currentUser) return;

  // âœ… throttle refresh frequency (do this BEFORE locking the ref)
  if (lastUpdated && Date.now() - lastUpdated < REFRESH_MIN_MS) {
    return;
  }

  // âœ… prevent duplicate refresh calls while one is already running
  if (refreshingRef.current) return;
  refreshingRef.current = true;

  setRefreshing(true);

  try {
    // 1) Load my profile
    const myRef = doc(db, "players", auth.currentUser.uid);
    const mySnap = await getDoc(myRef);
    if (!mySnap.exists()) return;

    const myData = mySnap.data() as any;
    if (!hasUsablePublicPlayerProfile(myData)) {
      setMyProfileHidden(false);
      setRawMatches([]);
      setLastUpdated(Date.now());
      return;
    }

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

        // 2b) Block users with an active relationship so they do not appear in Match Me
    const blockedIds = await loadBlockedMatchUserIds(auth.currentUser.uid);
    setBlockedMatchUserIds(blockedIds);

    // 3) Load nearby players via callable (caller location comes from players_private)
    const allPlayers = await loadNearbyPlayers(MAX_DISTANCE_KM);

    const meRating = (myData.skillRating ?? myData.utr) ?? null;

    // 4) Score + distance filter
    const scoredPlayers: ScoredPlayer[] = [];

    for (const p of allPlayers) {
      const candidateUid = uidOf(p);
      if (!candidateUid || candidateUid === auth.currentUser!.uid) continue;
      if (p.isMatchable === false) continue;
      if (blockedIds.has(candidateUid)) continue;

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

      const shared = A(p.availability).filter((a) =>
        A(myData.availability).includes(a)
      ).length;
      score += Math.min(shared, 4);

      score += activityPoints(p.lastActiveAt);

      if (typeof p.distance === "number" && Number.isFinite(p.distance)) {
        distance = p.distance;

        if (distance > MAX_DISTANCE_KM) continue;

        if (distance < 5) score += 3;
        else if (distance < 10) score += 2;
        else if (distance < 20) score += 1;
      } else {
        continue;
      }

      if ((score ?? 0) <= 0) continue;

      scoredPlayers.push({ ...p, score, distance, skillBand: theirBand });
    }

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
  } catch (error) {
    console.warn("[MATCH] refreshMatches failed:", error);
    setRawMatches([]);
  } finally {
    refreshingRef.current = false;
    setRefreshing(false);
  }
}, [matchMode, lastUpdated, loadNearbyPlayers, loadBlockedMatchUserIds]);




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
  return () => {
    document.body.style.overflow = overflow;
  };
}, [justVerified]);

useEffect(() => {
  if (isCheckingBirthYear) return;

  if (!user) {
    router.push("/login");
    return;
  }

  if (needsBirthYear) {
    setLoading(false);
    return;
  }

  let cancelled = false;

  const load = async () => {
    setLoading(true);

    const isVerifyAction = params.get("mode") === "verifyEmail" && !!params.get("oobCode");

    // redirect unverified-but-required users (skip if we're consuming a verify action)
    const userDoc = await getDoc(doc(db, "users", user.uid));
    if (cancelled) return;

    const requireFlag = userDoc.exists() && (userDoc.data() as any)?.requireVerification === true;
    if (requireFlag && !user.emailVerified && !isVerifyAction) {
      router.replace("/verify-email");
      return;
    }

    // ensure profile exists
    const myRef = doc(db, "players", user.uid);
    const mySnap = await getDoc(myRef);
    if (cancelled) return;

    const myData = mySnap.exists() ? (mySnap.data() as any) : null;

    if (!mySnap.exists() || !hasUsablePublicPlayerProfile(myData)) {
      console.log("[PROFILE REDIRECT DEBUG]", {
        source: "MatchPage",
        reason: mySnap.exists()
          ? "incomplete players/{uid} public profile"
          : "missing players/{uid} document",
        pathname: "/match",
        uid: user.uid,
        playerExists: mySnap.exists(),
        profileComplete: myData?.profileComplete ?? null,
        birthYear: myData?.birthYear ?? null,
      });
      console.trace("[PROFILE REDIRECT TRACE]", {
        source: "MatchPage",
        pathname: "/match",
        target: "/profile",
        uid: user.uid,
        profileGateReady: null,
        playerExists: mySnap.exists(),
        profileComplete: myData?.profileComplete ?? null,
        usableProfile: false,
        playerData: myData,
        authReady: true,
        loadingState: mySnap.exists() ? "incomplete-player-document" : "missing-player-document",
        timestamp: new Date().toISOString(),
      });
      alert("Please complete your profile first.");
      router.push("/profile");
      return;
    }

    try {
      await refreshMatches();
      if (cancelled) return;
      setLoading(false);
      window.dispatchEvent(new CustomEvent("tm:matchMeReady"));
    } catch (error) {
      if (cancelled) return;
      console.error("[MatchPage] failed to load match page", error);
      setLoading(false);
    }
  };

  void load();

  return () => {
    cancelled = true;
  };
}, [user, isCheckingBirthYear, needsBirthYear, router, params, refreshMatches]);

useEffect(() => {
  matchPageTrackedRef.current = false;
}, [user?.uid]);

useEffect(() => {
  if (!user?.uid) return;
  if (loading) return;

  const key = `tm_match_page_opened_${user.uid}`;
  const now = Date.now();
  const lastTracked = sessionStorage.getItem(key);

  // prevent noisy repeat fires when bouncing around quickly
  if (lastTracked && now - Number(lastTracked) < 5 * 60 * 1000) {
    return;
  }

  // extra guard for same mount/render cycle
  if (matchPageTrackedRef.current) return;
  matchPageTrackedRef.current = true;

  sessionStorage.setItem(key, String(now));

  trackEvent("match_page_opened", {
    userId: user.uid,
    platform: typeof window !== "undefined" && window.matchMedia("(min-width: 1024px)").matches
      ? "desktop"
      : "mobile",
    matchMode,
    hideContacted,
  });
}, [user?.uid, loading, matchMode, hideContacted]);

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

// âœ… Always use AUTH UID for match_requests (matches production)
const uidOf = (p: any): string | null => {
  if (!p) return null;

  // if already a uid string
  if (typeof p === "string") return p.trim() || null;

  // âœ… prefer explicit auth uid fields
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

const toMillisSafe = (value: unknown): number | null => {
  if (!value) return null;
  if (value instanceof Timestamp) return value.toMillis();
  if (value instanceof Date) return Number.isFinite(value.getTime()) ? value.getTime() : null;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string") {
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  if (typeof value === "object" && typeof (value as { toDate?: unknown }).toDate === "function") {
    const date = (value as { toDate: () => Date }).toDate();
    return Number.isFinite(date.getTime()) ? date.getTime() : null;
  }
  return null;
};

const getFreshnessAdjustment = (
  impression: MatchRecommendationImpression | undefined,
  nowMs: number
) => {
  if (!impression) return 8;

  const lastSeenMs = toMillisSafe(impression.lastSeenAt);
  const timesShown = typeof impression.timesShown === "number" ? impression.timesShown : 0;
  if (!lastSeenMs) return 8;

  const ageMs = nowMs - lastSeenMs;
  let adjustment = 0;

  if (ageMs <= DAY_MS) {
    adjustment -= 25;
  } else if (ageMs <= 7 * DAY_MS) {
    adjustment -= 10;
  }

  if (timesShown >= 3 && ageMs <= 14 * DAY_MS) {
    adjustment -= 15;
  }

  return adjustment;
};

const candidateUidFromPlayer = (player: Player): string => {
  const uid = (player as Player & { uid?: unknown }).uid;

  return (
    (typeof player.userId === "string" && player.userId.trim()) ||
    (typeof uid === "string" && uid.trim()) ||
    player.id
  );
};

const seededRotationValue = (seed: string, value: string): number => {
  let hash = 2166136261;
  const input = `${seed}:${value}`;

  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }

  return (hash >>> 0) / 4294967295;
};

const getRecommendationBandIndex = (score: number): number => {
  const bandIndex = RECOMMENDATION_BANDS.findIndex((band) => score >= band.min);
  return bandIndex === -1 ? RECOMMENDATION_BANDS.length : bandIndex;
};

const withFreshnessScore = (
  player: Player,
  impressions: Record<string, MatchRecommendationImpression>,
  nowMs: number
): ScoredPlayer => {
  const candidateUid = candidateUidFromPlayer(player);
  const baseScore = player.score ?? 0;
  const freshnessAdjustment = getFreshnessAdjustment(impressions[candidateUid], nowMs);
  const activityAdjustment = activityFreshnessPenalty(player.lastActiveAt);
  const normalizedBaseScore = baseScore * RECOMMENDATION_SCORE_SCALE;

  return {
    ...player,
    score: baseScore,
    baseScore,
    finalScore: normalizedBaseScore + freshnessAdjustment + activityAdjustment,
    freshnessAdjustment,
    activityAdjustment,
    distance: typeof player.distance === "number" ? player.distance : Infinity,
    skillBand: player.skillBand || "",
  };
};

const HIGH_PROBABILITY_BLOCKING_STATUSES = new Set([
  "unread",
  "requested",
  "pending",
  "accepted",
  "confirmed",
  "completed",
]);

const safeRecommendationReasons = (value: unknown): string[] => {
  const raw = Array.isArray(value) ? value : [];
  const labels = raw
    .map((reason) => {
      if (reason === "nearby") return "Nearby player";
      if (reason === "similar_skill") return "Similar skill level";
      if (reason === "availability_overlap") return "Availability match";
      if (reason === "recently_active") return "Recently active";
      return null;
    })
    .filter((reason) => typeof reason === "string");

  return Array.from(new Set(labels));
};

const hasExistingMatchBetweenUsers = async (currentUid: string, candidateUid: string) => {
  const [
    fromSnap,
    toSnap,
    historySnap,
    completedFromSnap,
    completedToSnap,
    scoresSnap,
  ] = await Promise.all([
    getDocs(
      query(
        collection(db, "match_requests"),
        where("fromUserId", "==", currentUid),
        where("toUserId", "==", candidateUid)
      )
    ),
    getDocs(
      query(
        collection(db, "match_requests"),
        where("fromUserId", "==", candidateUid),
        where("toUserId", "==", currentUid)
      )
    ),
    getDocs(
      query(
        collection(db, "match_history"),
        where("players", "array-contains", currentUid),
        limit(50)
      )
    ),
    getDocs(
      query(
        collection(db, "completed_matches"),
        where("fromUserId", "==", currentUid),
        where("toUserId", "==", candidateUid)
      )
    ),
    getDocs(
      query(
        collection(db, "completed_matches"),
        where("fromUserId", "==", candidateUid),
        where("toUserId", "==", currentUid)
      )
    ),
    getDocs(
      query(
        collection(db, "match_scores"),
        where("players", "array-contains", currentUid),
        limit(50)
      )
    ),
  ]);

  const blockingRequest = [...fromSnap.docs, ...toSnap.docs].some((docSnap) =>
    HIGH_PROBABILITY_BLOCKING_STATUSES.has(String(docSnap.data()?.status || ""))
  );
  if (blockingRequest) return true;

  if (!completedFromSnap.empty || !completedToSnap.empty) return true;

  const historyBlocks = historySnap.docs.some((docSnap) => {
    const players = Array.isArray(docSnap.data()?.players) ? docSnap.data().players : [];
    return players.includes(candidateUid);
  });
  if (historyBlocks) return true;

  return scoresSnap.docs.some((docSnap) => {
    const players = Array.isArray(docSnap.data()?.players) ? docSnap.data().players : [];
    return players.includes(candidateUid);
  });
};

useEffect(() => {
  if (!user?.uid || loading) return;

  let cancelled = false;

  const loadRecommendedMatches = async () => {
    const notificationId = params.get("notificationId");
    const queryCandidateId = params.get("recommendedPlayerId") || params.get("candidateId") || "";
    const descriptors = new Map<
      string,
      { candidateId: string; reasons: string[]; score: number | null }
    >();

    const addDescriptor = (
      candidateId: unknown,
      reasons: string[] = [],
      score: number | null = null
    ) => {
      if (typeof candidateId !== "string" || !candidateId || candidateId === user.uid) return;
      if (descriptors.has(candidateId)) return;
      descriptors.set(candidateId, { candidateId, reasons, score });
    };

    addDescriptor(queryCandidateId);

    setRecommendedMatchLoading(true);

    try {
      if (notificationId) {
        const notificationSnap = await getDoc(doc(db, "notifications", notificationId));
        if (!notificationSnap.exists()) {
          if (!cancelled) setRecommendedMatches([]);
          return;
        }

        const notification = notificationSnap.data() as any;
        if (notification.recipientId && notification.recipientId !== user.uid) {
          if (!cancelled) setRecommendedMatches([]);
          return;
        }

        const notificationType = String(notification.type || "");
        if (
          notificationType !== "high_probability_match" &&
          notificationType !== "high_probability_match_alert"
        ) {
          if (!cancelled) setRecommendedMatches([]);
          return;
        }

        const recommendationRows = Array.isArray(notification.recommendedCandidates)
          ? notification.recommendedCandidates
          : [];

        recommendationRows.forEach((item: any) => {
          addDescriptor(
            item?.candidateId || item?.recommendedPlayerId,
            safeRecommendationReasons(item?.scoreReasons),
            typeof item?.score === "number" ? item.score : null
          );
        });

        const candidateIds = Array.isArray(notification.candidateIds)
          ? notification.candidateIds
          : Array.isArray(notification.recommendedPlayerIds)
            ? notification.recommendedPlayerIds
            : [];

        candidateIds.forEach((id: unknown) => {
          addDescriptor(id, safeRecommendationReasons(notification.scoreReasons), null);
        });

        addDescriptor(
          notification.candidateId || notification.recommendedPlayerId,
          safeRecommendationReasons(notification.scoreReasons),
          typeof notification.score === "number" ? notification.score : null
        );

        if (notification.read !== true) {
          try {
            await updateDoc(doc(db, "notifications", notificationId), { read: true });
          } catch (error) {
            console.warn("[MatchPage] failed to mark high probability notification read on open", error);
          }
        }
      }

      const requestedCandidates = Array.from(descriptors.values()).slice(0, 3);
      if (!requestedCandidates.length) {
        if (!cancelled) setRecommendedMatches([]);
        return;
      }

      const loadedCandidates = await Promise.all(
        requestedCandidates.map(async (descriptor): Promise<RecommendedMatchPlayer | null> => {
          const candidateSnap = await getDoc(doc(db, "players", descriptor.candidateId));
          if (!candidateSnap.exists()) return null;

          const candidateData = candidateSnap.data() as any;
          if (candidateData.profileComplete !== true || candidateData.isMatchable === false) return null;

          const blocked = await hasExistingMatchBetweenUsers(user.uid, descriptor.candidateId);
          if (blocked) return null;

          return {
            id: descriptor.candidateId,
            userId: descriptor.candidateId,
            name: typeof candidateData.name === "string" ? candidateData.name : "TennisMate player",
            postcode: typeof candidateData.postcode === "string" ? candidateData.postcode : "",
            skillLevel: typeof candidateData.skillLevel === "string" ? candidateData.skillLevel : undefined,
            skillBand:
              typeof candidateData.skillBand === "string"
                ? (candidateData.skillBand as SkillBand)
                : "",
            skillBandLabel:
              typeof candidateData.skillBandLabel === "string" ? candidateData.skillBandLabel : null,
            utr: typeof candidateData.utr === "number" ? candidateData.utr : null,
            skillRating:
              typeof candidateData.skillRating === "number" ? candidateData.skillRating : null,
            availability: Array.isArray(candidateData.availability) ? candidateData.availability : [],
            bio: typeof candidateData.bio === "string" ? candidateData.bio : "",
            email: "",
            photoURL: typeof candidateData.photoURL === "string" ? candidateData.photoURL : undefined,
            photoThumbURL:
              typeof candidateData.photoThumbURL === "string" ? candidateData.photoThumbURL : null,
            avatar: typeof candidateData.avatar === "string" ? candidateData.avatar : null,
            profileComplete: true,
            isMatchable: candidateData.isMatchable !== false,
            lastActiveAt: candidateData.lastActiveAt ?? null,
            recommendationReasons: descriptor.reasons.length
              ? descriptor.reasons
              : ["Nearby player", "Similar skill level"],
            recommendationScore: descriptor.score,
            notificationId,
          };
        })
      );

      if (!cancelled) {
        const validCandidates = loadedCandidates.filter(
          (candidate): candidate is RecommendedMatchPlayer => candidate != null
        );
        setRecommendedMatches(validCandidates);
        if (validCandidates.length) setMatchSurface("players");
      }
    } catch (error) {
      console.warn("[MatchPage] recommended match overlay skipped", error);
      if (!cancelled) setRecommendedMatches([]);
    } finally {
      if (!cancelled) setRecommendedMatchLoading(false);
    }
  };

  void loadRecommendedMatches();

  return () => {
    cancelled = true;
  };
}, [user?.uid, loading, params]);

const maybeShowAfterMatchRequestNotificationPrompt = () => {
  if (matchRequestNotificationPromptOpen) return;
  if (onboarding.shouldShow) return;
  if (!shouldShowNotificationPrompt("after_match_request_sent")) return;

  setMatchRequestNotificationPromptOpen(true);
};

const closeMatchRequestNotificationPrompt = () => {
  setMatchRequestNotificationPromptOpen(false);
};

const handleEnableMatchRequestNotifications = async () => {
  try {
    await registerTennisMateNotifications();
  } catch (error) {
    console.warn("[MatchPage] notification registration failed", error);
  } finally {
    closeMatchRequestNotificationPrompt();
  }
};

const matchRequestNotificationPrompt = (
  <NotificationPrompt
    variant="after_match_request_sent"
    mode="toast"
    isOpen={matchRequestNotificationPromptOpen}
    onEnable={() => {
      void handleEnableMatchRequestNotifications();
    }}
    onDismiss={closeMatchRequestNotificationPrompt}
  />
);

  // don't double-submit the same card
const handleMatchRequest = async (target: Player | string) => {
  if (!myProfile || !user) return false;

  const toUid = resolveRecipientUid(target);
  if (!toUid) {
    console.error("[TM] Missing recipient UID", { target });
    alert("Could not send request (missing recipient id). Please refresh.");
    return false;
  }

  // Prevent self-send
  if (toUid === user.uid) return false;

  // Don't double-submit
  if (sendingIds.has(toUid)) return false;

  const candidateForAnalytics = typeof target === "string" ? null : target;
  const hasRecommendationReasons =
    Array.isArray((candidateForAnalytics as any)?.recommendationReasons) &&
    (candidateForAnalytics as any).recommendationReasons.length > 0;
  void trackAnalyticsEvent(ANALYTICS_EVENTS.MATCH_INVITE_STARTED, {
    source: hasRecommendationReasons ? "recommended_match" : "match_page",
    distance_band: analyticsDistanceBand(candidateForAnalytics?.distance),
    availability_overlap: Boolean(candidateForAnalytics?.availability?.length),
  });

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

    const isAvailabilityInterest =
      typeof target !== "string" &&
      typeof (target as any)?.dateLabel === "string" &&
      typeof (target as any)?.timeLabel === "string";

    const availabilityLabel = isAvailabilityInterest
      ? `${(target as any).dateLabel} | ${(target as any).timeLabel}`
      : null;
    const availabilityInstanceId =
      isAvailabilityInterest && typeof (target as any)?.availabilityInstanceId === "string"
        ? (target as any).availabilityInstanceId
        : null;

    // âœ… Create match request doc
// Stage 1 player_relationships: create the match request and link it to
// player_relationships/{pairId}. Other interaction collections migrate later.
console.debug("[MatchPage] before createMatchRequestWithRelationship", {
  fromUserId: user.uid,
  toUserId: toUid,
});

const ref = await createMatchRequestWithRelationship(db, user.uid, toUid, {
  fromUserId: user.uid,
  toUserId: toUid,
  status: "pending",
  bellNotified: true,

  // lifecycle timestamps
  createdAt: serverTimestamp(),
  acceptedAt: null,

  // temporary backwards compatibility for older code
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
  requestContext: isAvailabilityInterest ? "availability_interest" : "player_match",
  availabilityInstanceId,
}, {
  actorId: user.uid,
  playerSnapshots: {
    [user.uid]: {
      name: myProfile?.name ?? null,
      photoURL: myProfile?.photoURL || myProfile?.avatar || null,
      photoThumbURL: myProfile?.photoThumbURL ?? null,
    },
    [toUid]: matchPlayer
      ? {
          name: matchPlayer.name ?? null,
          photoURL: matchPlayer.photoURL || matchPlayer.avatar || null,
          photoThumbURL: matchPlayer.photoThumbURL ?? null,
        }
      : null,
  },
});

console.debug("[MatchPage] after createMatchRequestWithRelationship", {
  matchRequestId: ref.id,
  fromUserId: user.uid,
  toUserId: toUid,
});

void trackAnalyticsEvent(ANALYTICS_EVENTS.MATCH_INVITE_SENT, {
  source:
    Array.isArray((matchPlayer as any)?.recommendationReasons) &&
    (matchPlayer as any).recommendationReasons.length > 0
      ? "recommended_match"
      : "match_page",
  distance_band: analyticsDistanceBand(matchPlayer?.distance),
  availability_overlap: Boolean(matchPlayer?.availability?.length),
});

try {
  console.debug("[MatchPage] before notifications create", {
    matchRequestId: ref.id,
    recipientId: toUid,
    fromUserId: user.uid,
  });

  await addDoc(collection(db, "notifications"), {
    recipientId: toUid,
    toUserId: toUid,
    fromUserId: user.uid,
    type: "match_request",
    matchId: ref.id,
    title: isAvailabilityInterest ? "New availability interest" : "New match request",
    body: isAvailabilityInterest
      ? `${myProfile?.name ?? "A player"} is interested in your ${availabilityLabel} availability.`
      : `${myProfile?.name ?? "A player"} has challenged you to a match.`,
    message: isAvailabilityInterest
      ? `${myProfile?.name ?? "A player"} is interested in your ${availabilityLabel} availability.`
      : `${myProfile?.name ?? "A player"} has challenged you to a match.`,
    route: "/matches",
    url: "https://tennismate.vercel.app/matches",
    timestamp: serverTimestamp(),
    read: false,
    source: isAvailabilityInterest ? "client:availability_interest" : "client:match_request",
  });

  console.debug("[MatchPage] after notifications create", {
    matchRequestId: ref.id,
    recipientId: toUid,
  });
} catch (notificationError) {
  console.warn("[MatchPage] optional notification create failed after match request was created", {
    matchRequestId: ref.id,
    recipientId: toUid,
    error: notificationError,
  });
}

trackEvent("match_request_sent", {
  requestId: ref.id,
  fromUserId: user.uid,
  toUserId: toUid,
  matchMode,
  distanceKm: typeof matchPlayer?.distance === "number" ? matchPlayer.distance : null,
  targetPostcode: matchPlayer?.postcode ?? null,
  targetSkillBand: matchPlayer?.skillBand ?? null,
});

if (!onboarding.checklist.firstMatchRequestSent) {
  await onboarding.markFirstMatchRequestSent(ref.id);
  setFirstRequestSuccessVisible(true);
}

console.log("[TM] match_requests created:", ref.id, { toUid });

    // âœ… Update local state so UI immediately shows "sent"
setSentRequests((prev) => {
  const next = new Set(prev);
  next.add(toUid);

  if (auth.currentUser?.uid) {
    writeSentCache(auth.currentUser.uid, next);
  }

  return next;
});

setBlockedMatchUserIds((prev) => {
  const next = new Set(prev);
  next.add(toUid);
  return next;
});

    // âœ… Update localStorage cache so hideContacted works instantly
    if (auth.currentUser?.uid) {
      const merged = new Set(sentRequests);
      merged.add(toUid);
      writeSentCache(auth.currentUser.uid, merged);
    }

    maybeShowAfterMatchRequestNotificationPrompt();

    return true;
  } catch (err: any) {
    console.error("Failed to send match request:", err);
    alert(`âŒ Could not send request: ${err?.message ?? String(err)}`);
    return false;
  } finally {
    setSendingIds((s) => {
      const n = new Set(s);
      n.delete(toUid);
      return n;
    });
  }
};

const closeRecommendedMatchOverlay = () => {
  setRecommendedMatches([]);
  clearRecommendedMatchQuery();
};

const handleRecommendedMatchRequest = async (recommendedMatch: RecommendedMatchPlayer) => {
  const sent = await handleMatchRequest(recommendedMatch);
  if (!sent) return;

  if (recommendedMatch.notificationId) {
    try {
      await updateDoc(doc(db, "notifications", recommendedMatch.notificationId), { read: true });
    } catch (error) {
      console.warn("[MatchPage] failed to mark high probability notification read", error);
    }
  }
};

const handleDismissPlayer = useCallback(
  async (target: Player | string) => {
    if (!user?.uid) return;

    const dismissedPlayerId = resolveRecipientUid(target);
    if (!dismissedPlayerId || dismissedPlayerId === user.uid) return;

    setDismissedPlayerIds((prev) => {
      const next = new Set(prev);
      next.add(dismissedPlayerId);
      return next;
    });

    try {
      await setDoc(doc(db, "users", user.uid, "dismissedPlayers", dismissedPlayerId), {
        dismissedPlayerId,
        dismissedAt: serverTimestamp(),
        source: "match_page",
      });
    } catch (error) {
      console.error("[MatchPage] failed to dismiss player", error);
      setDismissedPlayerIds((prev) => {
        const next = new Set(prev);
        next.delete(dismissedPlayerId);
        return next;
      });
      alert("Could not hide this player right now. Please try again.");
    }
  },
  [user?.uid]
);

const recommendedMatchOverlay = !recommendedMatchLoading && recommendedMatches.length > 0 ? (
  <div
    role="dialog"
    aria-modal="true"
    aria-labelledby="recommended-match-title"
    className="fixed inset-0 z-[10020] flex items-center justify-center p-4"
  >
    <div
      className="absolute inset-0 bg-black/55"
      onMouseDown={closeRecommendedMatchOverlay}
    />

    <div
      className="relative z-[10021] flex max-h-[90vh] w-full max-w-2xl flex-col overflow-hidden rounded-3xl bg-white shadow-2xl ring-1 ring-black/10"
      onMouseDown={(e) => e.stopPropagation()}
    >
      <div className="flex items-start justify-between gap-4 border-b border-black/5 px-5 py-5">
        <div>
          <div
            className="text-[11px] font-extrabold uppercase tracking-[0.16em]"
            style={{ color: "rgba(11,61,46,0.58)" }}
          >
            Recommended match
          </div>
          <h2 id="recommended-match-title" className="mt-1 text-xl font-black" style={{ color: "#0B3D2E" }}>
            Recommended matches
          </h2>
          <p className="mt-1 text-sm font-medium text-gray-600">
            A smart suggestion based on public match signals, not a guaranteed match.
          </p>
        </div>

        <button
          type="button"
          onClick={closeRecommendedMatchOverlay}
          className="grid h-10 w-10 place-items-center rounded-full bg-black/5 text-gray-600 hover:bg-black/10"
          aria-label="Close recommended match"
        >
          <X className="h-5 w-5" />
        </button>
      </div>

      <div className="overflow-y-auto px-5 py-5">
        <div className="grid gap-4">
          {recommendedMatches.map((recommendedMatch) => (
            <div
              key={recommendedMatch.id}
              className="rounded-2xl border border-black/10 bg-white p-4"
            >
              <div className="flex items-start gap-4">
                <div className="relative h-16 w-16 shrink-0 overflow-hidden rounded-full bg-gray-100 ring-1 ring-black/10 sm:h-20 sm:w-20">
                  {resolveProfilePhoto(recommendedMatch) ? (
                    <Image
                      src={resolveProfilePhoto(recommendedMatch)!}
                      alt={recommendedMatch.name ? `${recommendedMatch.name} profile photo` : "Profile photo"}
                      fill
                      sizes="80px"
                      className="object-cover"
                    />
                  ) : (
                    <div className="grid h-full w-full place-items-center text-xl font-black text-gray-500">
                      {(recommendedMatch.name || "?").trim().charAt(0).toUpperCase()}
                    </div>
                  )}
                </div>

                <div className="min-w-0 flex-1">
                  <div className="truncate text-lg font-black" style={{ color: "#0B3D2E" }}>
                    {recommendedMatch.name}
                  </div>

                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    <span
                      className="inline-flex rounded-full px-2.5 py-1 text-[11px] font-extrabold"
                      style={{
                        background: "rgba(57,255,20,0.14)",
                        border: "1px solid rgba(57,255,20,0.35)",
                        color: "#0B3D2E",
                      }}
                    >
                      {(() => {
                        const numeric =
                          typeof (recommendedMatch.skillRating ?? recommendedMatch.utr) === "number"
                            ? (recommendedMatch.skillRating ?? recommendedMatch.utr)!
                            : null;
                        const label = labelForBand(
                          recommendedMatch.skillBand ||
                            skillFromUTR((recommendedMatch.skillRating ?? recommendedMatch.utr) ?? null) ||
                            legacyToBand(recommendedMatch.skillLevel),
                          recommendedMatch.skillBandLabel
                        );
                        return numeric != null ? `LEVEL ${numeric.toFixed(1)}` : label.toUpperCase();
                      })()}
                    </span>

                    {recommendedMatch.postcode && (
                      <span className="text-[12px] font-semibold text-gray-600">
                        {recommendedMatch.postcode}
                      </span>
                    )}
                  </div>

                  {recommendedMatch.availability?.length > 0 && (
                    <div className="mt-2 text-sm text-gray-600">
                      Availability: {formatAvailability(recommendedMatch.availability)}
                    </div>
                  )}
                </div>
              </div>

              {recommendedMatch.recommendationReasons.length > 0 && (
                <div className="mt-4 flex flex-wrap gap-2">
                  {recommendedMatch.recommendationReasons.map((reason) => (
                    <span
                      key={`${recommendedMatch.id}-${reason}`}
                      className="rounded-full bg-gray-100 px-3 py-1.5 text-xs font-bold text-gray-700 ring-1 ring-black/5"
                    >
                      {reason}
                    </span>
                  ))}
                </div>
              )}

              <div className="mt-4 grid gap-2 sm:grid-cols-2">
                <button
                  type="button"
                  onClick={() => {
                    setProfileOpenId(recommendedMatch.id);
                    closeRecommendedMatchOverlay();
                  }}
                  className="w-full rounded-full py-3 text-sm font-extrabold"
                  style={{
                    background: "#EEF0F2",
                    color: "#0F172A",
                    border: "1px solid rgba(15,23,42,0.10)",
                  }}
                >
                  View profile
                </button>

                <button
                  type="button"
                  onClick={() => void handleRecommendedMatchRequest(recommendedMatch)}
                  disabled={sendingIds.has(recommendedMatch.id) || sentRequests.has(recommendedMatch.id)}
                  className="w-full rounded-full py-3 text-sm font-extrabold disabled:opacity-60"
                  style={{
                    background: "#39FF14",
                    color: "#0B3D2E",
                    boxShadow: "0 10px 30px rgba(57,255,20,0.18)",
                  }}
                >
                  {sentRequests.has(recommendedMatch.id)
                    ? "Request sent"
                    : sendingIds.has(recommendedMatch.id)
                      ? "Sending..."
                      : "Send match request"}
                </button>
              </div>
            </div>
          ))}
        </div>

        <button
          type="button"
          onClick={closeRecommendedMatchOverlay}
          className="mt-4 w-full rounded-full py-3 text-sm font-extrabold text-gray-600 hover:bg-gray-50"
        >
          Not now
        </button>
      </div>
    </div>
  </div>
) : null;

  // Sort matches based on user choice
const filteredMatches = useMemo(() => {
  if (!myProfile || !user) return rawMatches;

  return rawMatches.filter((m) => {
    const toUid = uidOf(m);
    if (!toUid) return false;

    // Never show myself
    if (toUid === user.uid) return false;

    // Never show players where there is already a pending / confirmed / accepted match relationship
    if (blockedMatchUserIds.has(toUid)) return false;

    // Hide players dismissed from Match page
    if (dismissedPlayerIds.has(toUid)) return false;

    // Hide already contacted?
    if (hideContacted && sentRequests.has(toUid)) return false;

    // Gender filter
    if (genderFilter !== "" && m.gender !== genderFilter) return false;

    // Age filter
    if (ageBand !== "" && m.age != null && !inAgeBand(m.age, ageBand)) return false;

    // Activity filter
    const level = getActivityLevel(m.lastActiveAt);
    if (activityFilter === "online" && level !== "online") return false;
    if (activityFilter === "recent" && level !== "recent") return false;
    if (activityFilter === "offline" && level !== "inactive") return false;

    return true;
  });
}, [
  rawMatches,
  hideContacted,
  myProfile,
  user,
  sentRequests,
  blockedMatchUserIds,
  dismissedPlayerIds,
  ageBand,
  genderFilter,
  activityFilter,
]);




const sortedMatches = useMemo(() => {
  if (!myProfile) return filteredMatches;

  const byDistanceAsc = (a: Player, b: Player) => {
    const da = typeof a.distance === "number" ? a.distance! : Infinity;
    const db = typeof b.distance === "number" ? b.distance! : Infinity;
    return da - db;
  };

  const byBaseScore = (a: Player, b: Player) => {
    const diff = (b.score ?? 0) - (a.score ?? 0);
    if (diff !== 0) return diff;
    return byDistanceAsc(a, b);
  };

  if (sortBy === "score") {
    const nowMs = Date.now();
    const byRelevance = [...filteredMatches].sort(byBaseScore);
    const recentByRelevance = byRelevance.filter(isRecentlyActiveCandidate);
    const protectedSource = recentByRelevance.length > 0 ? recentByRelevance : byRelevance;
    const protectedMatches = byRelevance
      .filter((match) =>
        protectedSource
          .slice(0, PROTECTED_RELEVANCE_COUNT)
          .some((protectedMatch) => candidateUidFromPlayer(protectedMatch) === candidateUidFromPlayer(match))
      )
      .map((match) => withFreshnessScore(match, recommendationImpressions, nowMs));
    const protectedIds = new Set(protectedMatches.map(candidateUidFromPlayer));
    const scoredRotatingMatches = byRelevance
      .filter((match) => !protectedIds.has(candidateUidFromPlayer(match)))
      .map((match) => withFreshnessScore(match, recommendationImpressions, nowMs));
    const bandedMatches: ScoredPlayer[][] = Array.from(
      { length: RECOMMENDATION_BANDS.length + 1 },
      () => []
    );

    scoredRotatingMatches.forEach((match) => {
      bandedMatches[getRecommendationBandIndex(match.finalScore ?? 0)].push(match);
    });

    const rotatingMatches = bandedMatches.flatMap((band) =>
      band.sort((a, b) => {
        const finalDiff = (b.finalScore ?? 0) - (a.finalScore ?? 0);
        if (Math.abs(finalDiff) > CLOSE_SCORE_ROTATION_THRESHOLD) return finalDiff;

        const aRotation = seededRotationValue(
          recommendationRotationSeedRef.current,
          candidateUidFromPlayer(a)
        );
        const bRotation = seededRotationValue(
          recommendationRotationSeedRef.current,
          candidateUidFromPlayer(b)
        );
        if (aRotation !== bRotation) return aRotation - bRotation;

        return byBaseScore(a, b);
      })
    );
    const recentRotatingMatches = rotatingMatches.filter(isRecentlyActiveCandidate);
    const inactiveRotatingMatches = rotatingMatches.filter((match) => !isRecentlyActiveCandidate(match));
    const recentPriorityMatches = [...protectedMatches, ...recentRotatingMatches];
    const guardedRecentMatches = recentPriorityMatches.slice(0, TOP_RECENT_ACTIVITY_GUARD_COUNT);
    const remainingRecentMatches = recentPriorityMatches.slice(TOP_RECENT_ACTIVITY_GUARD_COUNT);

    return [...guardedRecentMatches, ...remainingRecentMatches, ...inactiveRotatingMatches];
  }

  return [...filteredMatches].sort((a, b) => {
    if (sortBy === "distance_desc") {
  const da = typeof a.distance === "number" ? a.distance! : -Infinity;
  const db = typeof b.distance === "number" ? b.distance! : -Infinity;
  return db - da; // farthest first
}
  if (sortBy === "distance") {
    return byDistanceAsc(a, b); // closest first
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
    return byBaseScore(a, b);
  });
}, [filteredMatches, sortBy, myProfile, recommendationImpressions]);
const visibleMatches = useMemo(
  () => sortedMatches.slice(0, visibleCount),
  [sortedMatches, visibleCount]
);

useEffect(() => {
  if (loading) return;
  if (recommendationsViewedTrackedRef.current) return;
  if (visibleMatches.length === 0) return;

  recommendationsViewedTrackedRef.current = true;
  void trackAnalyticsEvent(ANALYTICS_EVENTS.MATCH_RECOMMENDATIONS_VIEWED, {
    recommendation_count: visibleMatches.length,
    source: recommendedMatches.length > 0 ? "notification_recommendation" : "match_page",
  });
}, [loading, recommendedMatches.length, visibleMatches.length]);

useEffect(() => {
  if (!profileOpenId) return;
  void trackAnalyticsEvent(ANALYTICS_EVENTS.PLAYER_PROFILE_VIEWED, {
    profile_source: "match_page",
    distance_band: "unknown",
    skill_difference_band: "unknown",
    availability_overlap: false,
  });
}, [profileOpenId]);

const shouldHighlightFirstMatchRequest =
  onboarding.shouldShow &&
  onboarding.activationTour.currentStep === "bestMatchInvite" &&
  matchSurface === "players";

useEffect(() => {
  if (!user?.uid || matchSurface !== "players" || visibleMatches.length === 0) return;
  void onboarding.markViewedRecommendedPlayers();
}, [matchSurface, onboarding.markViewedRecommendedPlayers, user?.uid, visibleMatches.length]);

useEffect(() => {
  if (!shouldHighlightFirstMatchRequest) return;
  void onboarding.markFirstMatchRequestPromptShown();
}, [onboarding.markFirstMatchRequestPromptShown, shouldHighlightFirstMatchRequest]);

useEffect(() => {
  if (!user?.uid || visibleMatches.length === 0) return;

  const visibleImpressions = visibleMatches
    .map((match) => {
      const candidateId = candidateUidFromPlayer(match);
      return {
        candidateId,
        baseScore: match.baseScore ?? match.score ?? 0,
        finalScore: match.finalScore ?? match.score ?? 0,
      };
    })
    .filter(({ candidateId }) => {
      if (!candidateId || candidateId === user.uid) return false;
      if (recommendationImpressionWriteRef.current.has(candidateId)) return false;
      return true;
    });

  if (visibleImpressions.length === 0) return;

  visibleImpressions.forEach(({ candidateId }) => {
    recommendationImpressionWriteRef.current.add(candidateId);
  });

  const batch = writeBatch(db);
  visibleImpressions.forEach(({ candidateId, baseScore, finalScore }) => {
    const impressionRef = doc(
      db,
      "users",
      user.uid,
      MATCH_RECOMMENDATION_IMPRESSIONS_COLLECTION,
      candidateId
    );
    const existing = recommendationImpressions[candidateId];
    const payload: Record<string, unknown> = {
      candidateId,
      lastSeenAt: serverTimestamp(),
      timesShown: increment(1),
      lastBaseScore: baseScore,
      lastFinalScore: finalScore,
    };

    if (!existing?.firstSeenAt) {
      payload.firstSeenAt = serverTimestamp();
    }

    batch.set(impressionRef, payload, { merge: true });
  });

  batch.commit().catch((error) => {
    visibleImpressions.forEach(({ candidateId }) => {
      recommendationImpressionWriteRef.current.delete(candidateId);
    });
    console.error("[MatchPage] failed to write recommendation impressions", error);
  });
}, [user?.uid, visibleMatches, recommendationImpressions]);

const activeAvailability = useMemo(() => {
  if (!activeAvailabilityRecord) return null;

  return {
    dateLabel: formatAvailabilityDateLabel(activeAvailabilityRecord.date),
    timeLabel: formatAvailabilityTimeLabel(activeAvailabilityRecord.timeSlot),
    postcode: activeAvailabilityRecord.postcode || myProfile?.postcode || "Postcode TBC",
    radiusLabel: `Within ${activeAvailabilityRecord.radiusKm}km`,
    matchTypeLabel: formatAvailabilityMatchType(activeAvailabilityRecord.matchType),
    note: activeAvailabilityRecord.note.trim(),
  };
}, [activeAvailabilityRecord, myProfile?.postcode]);

const browseAvailabilityCards = useMemo(() => {
  return browseAvailabilityRecords.map((availability) => {
    const numeric =
      typeof (availability.skillRating ?? availability.utr) === "number"
        ? (availability.skillRating ?? availability.utr)!.toFixed(1)
        : null;

    const skillLabel = numeric
      ? `Level ${numeric}`
      : `Level ${labelForBand(
          availability.skillBand ||
            skillFromUTR((availability.skillRating ?? availability.utr) ?? null) ||
            legacyToBand(availability.skillLevel ?? undefined),
          availability.skillBandLabel
        )}`;

    const distanceKm =
      typeof myProfile?.lat === "number" &&
      typeof myProfile?.lng === "number" &&
      typeof availability.lat === "number" &&
      typeof availability.lng === "number"
        ? getDistanceFromLatLonInKm(myProfile.lat, myProfile.lng, availability.lat, availability.lng)
        : null;

    return {
      id: availability.id,
      userId: availability.userId,
      availabilityInstanceId: availability.instanceId,
      name: availability.name || "Player",
      photoURL: availability.photoThumbURL || availability.photoURL || null,
      postcode: availability.postcode || null,
      skillLabel,
      distanceLabel: distanceKm != null ? `${distanceKm} km away` : "Distance unknown",
      dateLabel: formatAvailabilityDateLabel(availability.date),
      timeLabel: formatAvailabilityTimeLabel(availability.timeSlot),
      matchTypeLabel: formatAvailabilityMatchType(availability.matchType),
      note: availability.note,
    };
  });
}, [browseAvailabilityRecords, myProfile?.lat, myProfile?.lng]);

useEffect(() => {
  setVisibleCount(PAGE_SIZE);
}, [sortBy, hideContacted, matchMode, ageBand, genderFilter, activityFilter]);

useEffect(() => {
  const qSort = params.get("sort");
  const qHide = params.get("hide");
  const qMode = params.get("mode");
  const qActivity = params.get("activity");
  const qSurface = params.get("surface");

  if (qSort) setSortBy(qSort);
  if (qHide === "0" || qHide === "1") setHideContacted(qHide === "1");
  if (qMode === "auto" || qMode === "skill" || qMode === "utr") setMatchMode(qMode);
  if (qActivity === "online" || qActivity === "recent" || qActivity === "offline") {
    setActivityFilter(qActivity);
  }
  if (qSurface === "availability" || qSurface === "players") {
    setMatchSurface(qSurface);
  }
  // eslint-disable-next-line react-hooks/exhaustive-deps
}, []);

const TM = {
  forest: "#0B3D2E",
  neon: "#39FF14",
  ink: "#EAF7F0",
  sub: "rgba(234,247,240,0.75)",
};

const TILE_STYLE = {
  background: "#F1F3F5",                  // âœ… light grey card
  border: "1px solid rgba(15,23,42,0.10)", // subtle border
  boxShadow: "0 6px 18px rgba(15,23,42,0.08)",
};

const selectStyle: React.CSSProperties = {
  backgroundColor: "rgba(0,0,0,0.62)", // âœ… darker = clearer
  border: "1px solid rgba(255,255,255,0.18)",
  color: "rgba(234,247,240,0.95)",
  outline: "none",
};


const optionStyle: React.CSSProperties = {
  backgroundColor: "#071B15",   // deep green-black
  color: "#EAF7F0",            // TM.ink
};


const showBirthYearGate = !!user && !isCheckingBirthYear && needsBirthYear;

if (loading || isCheckingBirthYear || showBirthYearGate) {
  return (
    <>
      <AgeGateModal
        isOpen={showBirthYearGate}
        onSave={async (birthYear) => {
          setLoading(true);
          await saveBirthYear(birthYear);
          await refreshMatches();
          setLoading(false);
        }}
        onSignOut={async () => {
          await signOut(auth);
          router.push("/login");
        }}
      />

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
    </>
  );
}

if (myProfileHidden) {
  return (
    <div className="w-full min-h-screen px-4 pb-28 pt-4 bg-white">
      <div className="rounded-2xl border bg-white p-5 shadow-sm">
        <h1 className="text-xl font-semibold">Match Me is turned off</h1>
        <p className="mt-2 text-sm text-gray-700">
          Your profile is hidden â€” turn it back on to use Match Me.
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
        {availabilityDraftSaved && (
          <div
            className="mb-4 rounded-2xl px-4 py-3 text-sm font-semibold"
            style={{
              background: "rgba(57,255,20,0.12)",
              color: TM.forest,
              border: "1px solid rgba(57,255,20,0.28)",
            }}
          >
            Availability posted. You can now browse other open requests below.
          </div>
        )}

        {availabilitySaveError && (
          <div
            className="mb-4 rounded-2xl px-4 py-3 text-sm font-semibold"
            style={{
              background: "rgba(239,68,68,0.08)",
              color: "#991B1B",
              border: "1px solid rgba(239,68,68,0.20)",
            }}
          >
            {availabilitySaveError}
          </div>
        )}

        <div className="flex items-start gap-6">
          <TMDesktopSidebar player={myProfile} />
          <div className="flex-1 min-w-0">
            {firstRequestSuccessVisible && (
              <div className="mb-4 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-bold text-emerald-950">
                Great start — you’ve sent your first match request. We’ll notify you when someone responds.
              </div>
            )}

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
  sortBy={sortBy}
  setSortBy={setSortBy}
  matchMode={matchMode}
  setMatchMode={setMatchMode}
  ageBand={ageBand}
  setAgeBand={setAgeBand}
  genderFilter={genderFilter}
  setGenderFilter={setGenderFilter}
  activityFilter={activityFilter}
  setActivityFilter={setActivityFilter}
  hideContacted={hideContacted}
  setHideContacted={setHideContacted}
  onLoadMore={() => setVisibleCount((c) => c + PAGE_SIZE)}
  onInvite={(match) => handleMatchRequest(match)}
  onDismiss={(match) => void handleDismissPlayer(match)}
  onViewProfile={(id) => setProfileOpenId(id)}
  onOpenAvailabilityRequest={() => setAvailabilityRequestOpen(true)}
  onOpenAvailabilityActions={() => setAvailabilityActionsOpen(true)}
  matchSurface={matchSurface}
  setMatchSurface={setMatchSurface}
  activeAvailability={activeAvailability}
  browseAvailabilityCards={browseAvailabilityCards}
  sentRequestUserIds={sentRequests}
  sendingRequestUserIds={sendingIds}
  pendingAvailabilityInterestKeys={pendingAvailabilityInterestKeys}
  postcodePrefixPlayerCount={postcodePrefixPlayerCount}
  highlightFirstMatchRequest={shouldHighlightFirstMatchRequest}
  profileOpenId={profileOpenId}
  setProfileOpenId={setProfileOpenId}
/>
          </div>
        </div>
      </div>

      {recommendedMatchOverlay}
      {matchRequestNotificationPrompt}

      {availabilityRequestOpen && (
        <div className="fixed inset-0 z-[10000]">
          <div
            className="absolute inset-0 bg-black/50"
            onMouseDown={() => setAvailabilityRequestOpen(false)}
          />

          <div className="absolute inset-0 overflow-y-auto p-4 sm:p-6">
            <div className="flex min-h-full items-center justify-center">
            <div
              className="w-full max-w-lg overflow-hidden rounded-[28px] bg-white shadow-2xl ring-1 ring-black/5"
              onMouseDown={(e) => e.stopPropagation()}
            >
              <div className="flex items-start justify-between gap-4 border-b border-black/5 px-4 py-4 sm:px-5 sm:py-5">
                <div>
                  <div
                    className="text-[11px] font-extrabold uppercase tracking-[0.16em]"
                    style={{ color: "rgba(11,61,46,0.58)" }}
                  >
                    Find Me a Match
                  </div>
                  <div className="mt-1 text-xl font-black tracking-tight" style={{ color: TM.forest }}>
                    When do you want to play?
                  </div>
                  <div className="mt-1 text-sm" style={{ color: "rgba(11,61,46,0.70)" }}>
                    Post your availability and we&apos;ll show it in the live open requests feed.
                  </div>
                </div>

                <button
                  type="button"
                  onClick={() => setAvailabilityRequestOpen(false)}
                  className="grid h-10 w-10 place-items-center rounded-full bg-black/5 text-gray-600 hover:bg-black/10"
                  aria-label="Close"
                >
                  <X className="h-5 w-5" />
                </button>
              </div>

              <form onSubmit={handleAvailabilitySubmit} className="px-4 py-4 sm:px-5 sm:py-5">
                <div className="space-y-3">
                <div>
                  <label className="block text-sm font-extrabold" style={{ color: TM.forest }}>
                    Day
                  </label>
                  <input
                    type="date"
                    min={new Date().toISOString().split("T")[0]}
                    value={availabilityRequest.date}
                    onChange={(e) =>
                      setAvailabilityRequest((prev) => ({ ...prev, date: e.target.value }))
                    }
                    className="mt-1.5 w-full rounded-2xl border px-4 py-2.5 text-[16px] outline-none"
                    style={{ borderColor: "rgba(11,61,46,0.16)" }}
                    required
                  />
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-sm font-extrabold" style={{ color: TM.forest }}>
                      Time
                    </label>
                    <select
                      value={availabilityRequest.timeSlot}
                      onChange={(e) =>
                        setAvailabilityRequest((prev) => ({
                          ...prev,
                          timeSlot: e.target.value as AvailabilityFormState["timeSlot"],
                        }))
                      }
                      className="mt-1.5 w-full rounded-2xl border px-4 py-2.5 text-[16px] outline-none bg-white"
                      style={{ borderColor: "rgba(11,61,46,0.16)" }}
                    >
                      <option value="morning">Morning</option>
                      <option value="afternoon">Afternoon</option>
                      <option value="evening">Evening</option>
                    </select>
                  </div>

                  <div>
                    <label className="block text-sm font-extrabold" style={{ color: TM.forest }}>
                      Match Type
                    </label>
                    <select
                      value={availabilityRequest.matchType}
                      onChange={(e) =>
                        setAvailabilityRequest((prev) => ({
                          ...prev,
                          matchType: e.target.value as AvailabilityFormState["matchType"],
                        }))
                      }
                      className="mt-1.5 w-full rounded-2xl border px-4 py-2.5 text-[16px] outline-none bg-white"
                      style={{ borderColor: "rgba(11,61,46,0.16)" }}
                    >
                      <option value="singles">Singles</option>
                      <option value="casual_hit">Casual Hit</option>
                    </select>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-sm font-extrabold" style={{ color: TM.forest }}>
                      Postcode
                    </label>
                    <input
                      type="text"
                      inputMode="numeric"
                      maxLength={4}
                      value={availabilityRequest.postcode}
                      onChange={(e) =>
                        setAvailabilityRequest((prev) => ({ ...prev, postcode: e.target.value }))
                      }
                      className="mt-1.5 w-full rounded-2xl border px-4 py-2.5 text-[16px] outline-none"
                      style={{ borderColor: "rgba(11,61,46,0.16)" }}
                      placeholder="3000"
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-extrabold" style={{ color: TM.forest }}>
                      Radius
                    </label>
                    <select
                      value={availabilityRequest.radiusKm}
                      onChange={(e) =>
                        setAvailabilityRequest((prev) => ({ ...prev, radiusKm: e.target.value }))
                      }
                      className="mt-1.5 w-full rounded-2xl border px-4 py-2.5 text-[16px] outline-none bg-white"
                      style={{ borderColor: "rgba(11,61,46,0.16)" }}
                    >
                      <option value="5">Within 5km</option>
                      <option value="10">Within 10km</option>
                      <option value="20">Within 20km</option>
                    </select>
                  </div>
                </div>

                <div>
                  <label className="block text-sm font-extrabold" style={{ color: TM.forest }}>
                    Note
                  </label>
            <textarea
              rows={2}
              value={availabilityRequest.note}
              onChange={(e) =>
                setAvailabilityRequest((prev) => ({ ...prev, note: e.target.value }))
              }
              className="mt-1.5 w-full rounded-2xl border px-4 py-2.5 text-[16px] outline-none"
              style={{ borderColor: "rgba(11,61,46,0.16)" }}
              placeholder="Happy to travel, casual hit, after work..."
            />
          </div>

                <div className="flex justify-end gap-2 pt-1">
                  <button
                    type="button"
                    onClick={() => setAvailabilityRequestOpen(false)}
                    className="rounded-full bg-gray-100 px-4 py-2.5 text-sm font-extrabold text-gray-700 hover:bg-gray-200"
                  >
                    Cancel
                  </button>

                  <button
                    type="submit"
                    disabled={availabilitySaving}
                    className="rounded-full px-4 py-2.5 text-sm font-extrabold"
                    style={{
                      background: TM.neon,
                      color: TM.forest,
                      opacity: availabilitySaving ? 0.7 : 1,
                    }}
                  >
                    {availabilitySaving ? "Saving..." : "Save Availability"}
                  </button>
                </div>
                </div>
              </form>
            </div>
          </div>
          </div>
        </div>
      )}
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
  className="-mx-4 sm:-mx-6 px-4 sm:px-6 pt-3 pb-4 sticky top-[var(--safe-top)] z-20"
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
        {(postcodePrefixPlayerCount ?? sortedMatches.length)} players nearby
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

{availabilityDraftSaved && (
  <div
    className="mb-4 rounded-2xl px-4 py-3 text-sm font-semibold"
    style={{
      background: "rgba(57,255,20,0.12)",
      color: TM.forest,
      border: "1px solid rgba(57,255,20,0.28)",
    }}
  >
    Availability posted. You can now browse other open requests below.
  </div>
)}

{availabilitySaveError && (
  <div
    className="mb-4 rounded-2xl px-4 py-3 text-sm font-semibold"
    style={{
      background: "rgba(239,68,68,0.08)",
      color: "#991B1B",
      border: "1px solid rgba(239,68,68,0.20)",
    }}
  >
    {availabilitySaveError}
  </div>
)}

<div
  className="mb-4 rounded-3xl p-4"
  style={{
    background: "#F7FAF8",
    border: "1px solid rgba(11,61,46,0.10)",
    boxShadow: "0 12px 30px rgba(15,23,42,0.06)",
  }}
>
  <div className="flex items-start justify-between gap-4">
    <div className="min-w-0">
      <div
        className="text-[11px] font-extrabold uppercase tracking-[0.16em]"
        style={{ color: "rgba(11,61,46,0.58)" }}
      >
        New
      </div>
      <div className="mt-1 text-[18px] font-black tracking-tight" style={{ color: TM.forest }}>
        Need a game this week?
      </div>
      <div className="mt-1 text-[13px] font-medium" style={{ color: "rgba(11,61,46,0.70)" }}>
        Post your availability and we&apos;ll use it for future instant matching.
      </div>
    </div>

    <button
      type="button"
      onClick={() => setAvailabilityRequestOpen(true)}
      className="shrink-0 rounded-full px-4 py-3 text-[14px] font-extrabold"
      style={{
        background: TM.forest,
        color: "white",
        boxShadow: "0 10px 24px rgba(11,61,46,0.18)",
      }}
    >
      Post Availability
    </button>
  </div>
</div>

<div className="mb-4 inline-flex rounded-full bg-[#F3F5F7] p-1 ring-1 ring-black/5">
  <button
    type="button"
    onClick={() => setMatchSurface("players")}
    className="rounded-full px-4 py-2 text-sm font-extrabold transition"
    style={
      matchSurface === "players"
        ? { background: TM.neon, color: TM.forest }
        : { background: "transparent", color: "rgba(11,61,46,0.62)" }
    }
  >
    Players
  </button>
  <button
    type="button"
    onClick={() => setMatchSurface("availability")}
    className="rounded-full px-4 py-2 text-sm font-extrabold transition"
    style={
      matchSurface === "availability"
        ? { background: TM.neon, color: TM.forest }
        : { background: "transparent", color: "rgba(11,61,46,0.62)" }
    }
  >
    Availabilities
  </button>
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
          // âœ… darker â€œcardâ€ so controls pop (fixes washed-out white)
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
                <option value="18-24" style={optionStyle}>18â€“24</option>
                <option value="25-34" style={optionStyle}>25â€“34</option>
                <option value="35-44" style={optionStyle}>35â€“44</option>
                <option value="45-54" style={optionStyle}>45â€“54</option>
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

          <div className="grid grid-cols-1 gap-3">
  <div className="min-w-0">
    <label className="block text-xs font-medium text-white/80 mb-1">Activity</label>
    <select
      value={activityFilter}
      onChange={(e) => {
        const val = e.target.value as ActivityFilter;
        setActivityFilter(val);
        setQuery("activity", val);
      }}
      className="w-full text-sm rounded-lg px-2 py-2 text-white appearance-none"
      style={selectStyle}
    >
      <option value="" style={optionStyle}>Any</option>
      <option value="online" style={optionStyle}>Online now</option>
      <option value="recent" style={optionStyle}>Active recently</option>
      <option value="offline" style={optionStyle}>Offline</option>
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




{recommendedMatchOverlay}
{matchRequestNotificationPrompt}

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
        {/* âœ… Taller than before, but capped so it doesn't feel full screen */}
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

{availabilityRequestOpen && (
  <div className="fixed inset-0 z-[10000]">
    <div
      className="absolute inset-0 bg-black/50"
      onMouseDown={() => setAvailabilityRequestOpen(false)}
    />

    <div className="absolute inset-0 overflow-y-auto p-3 sm:p-6">
      <div className="flex min-h-full items-center justify-center">
      <div
        className="w-full max-w-lg overflow-hidden rounded-[28px] bg-white shadow-2xl ring-1 ring-black/5"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-4 border-b border-black/5 px-4 py-4 sm:px-5 sm:py-5">
          <div>
            <div
              className="text-[11px] font-extrabold uppercase tracking-[0.16em]"
              style={{ color: "rgba(11,61,46,0.58)" }}
            >
              Find Me a Match
            </div>
            <div className="mt-1 text-xl font-black tracking-tight" style={{ color: TM.forest }}>
              When do you want to play?
            </div>
            <div className="mt-1 text-sm" style={{ color: "rgba(11,61,46,0.70)" }}>
              Post your availability and we&apos;ll show it in the live open requests feed.
            </div>
          </div>

          <button
            type="button"
            onClick={() => setAvailabilityRequestOpen(false)}
            className="grid h-10 w-10 place-items-center rounded-full bg-black/5 text-gray-600 hover:bg-black/10"
            aria-label="Close"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <form onSubmit={handleAvailabilitySubmit} className="px-4 py-4 sm:px-5 sm:py-5">
          <div className="space-y-3">
          <div>
            <label className="block text-sm font-extrabold" style={{ color: TM.forest }}>
              Day
            </label>
            <input
              type="date"
              min={new Date().toISOString().split("T")[0]}
              value={availabilityRequest.date}
              onChange={(e) =>
                setAvailabilityRequest((prev) => ({ ...prev, date: e.target.value }))
              }
              className="mt-1.5 w-full rounded-2xl border px-4 py-2.5 text-[16px] outline-none"
              style={{ borderColor: "rgba(11,61,46,0.16)" }}
              required
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-extrabold" style={{ color: TM.forest }}>
                Time
              </label>
              <select
                value={availabilityRequest.timeSlot}
                onChange={(e) =>
                  setAvailabilityRequest((prev) => ({
                    ...prev,
                    timeSlot: e.target.value as AvailabilityFormState["timeSlot"],
                  }))
                }
                className="mt-1.5 w-full rounded-2xl border px-4 py-2.5 text-[16px] outline-none bg-white"
                style={{ borderColor: "rgba(11,61,46,0.16)" }}
              >
                <option value="morning">Morning</option>
                <option value="afternoon">Afternoon</option>
                <option value="evening">Evening</option>
              </select>
            </div>

            <div>
              <label className="block text-sm font-extrabold" style={{ color: TM.forest }}>
                Match Type
              </label>
              <select
                value={availabilityRequest.matchType}
                onChange={(e) =>
                  setAvailabilityRequest((prev) => ({
                    ...prev,
                    matchType: e.target.value as AvailabilityFormState["matchType"],
                  }))
                }
                className="mt-1.5 w-full rounded-2xl border px-4 py-2.5 text-[16px] outline-none bg-white"
                style={{ borderColor: "rgba(11,61,46,0.16)" }}
              >
                <option value="singles">Singles</option>
                <option value="casual_hit">Casual Hit</option>
              </select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-extrabold" style={{ color: TM.forest }}>
                Postcode
              </label>
              <input
                type="text"
                inputMode="numeric"
                maxLength={4}
                value={availabilityRequest.postcode}
                onChange={(e) =>
                  setAvailabilityRequest((prev) => ({ ...prev, postcode: e.target.value }))
                }
                className="mt-1.5 w-full rounded-2xl border px-4 py-2.5 text-[16px] outline-none"
                style={{ borderColor: "rgba(11,61,46,0.16)" }}
                placeholder="3000"
              />
            </div>

            <div>
              <label className="block text-sm font-extrabold" style={{ color: TM.forest }}>
                Radius
              </label>
              <select
                value={availabilityRequest.radiusKm}
                onChange={(e) =>
                  setAvailabilityRequest((prev) => ({ ...prev, radiusKm: e.target.value }))
                }
                className="mt-1.5 w-full rounded-2xl border px-4 py-2.5 text-[16px] outline-none bg-white"
                style={{ borderColor: "rgba(11,61,46,0.16)" }}
              >
                <option value="5">Within 5km</option>
                <option value="10">Within 10km</option>
                <option value="20">Within 20km</option>
              </select>
            </div>
          </div>

          <div>
            <label className="block text-sm font-extrabold" style={{ color: TM.forest }}>
              Note
            </label>
            <textarea
              rows={2}
              value={availabilityRequest.note}
              onChange={(e) =>
                setAvailabilityRequest((prev) => ({ ...prev, note: e.target.value }))
              }
              className="mt-1.5 w-full rounded-2xl border px-4 py-2.5 text-[16px] outline-none"
              style={{ borderColor: "rgba(11,61,46,0.16)" }}
              placeholder="Happy to travel, casual hit, after work..."
            />
          </div>

          <div className="flex gap-2 pt-1">
            <button
              type="button"
              onClick={() => setAvailabilityRequestOpen(false)}
              className="flex-1 rounded-full bg-gray-100 px-4 py-2.5 text-sm font-extrabold text-gray-700 hover:bg-gray-200"
            >
              Cancel
            </button>

            <button
              type="submit"
              disabled={availabilitySaving}
              className="flex-1 rounded-full px-4 py-2.5 text-sm font-extrabold"
              style={{
                background: TM.neon,
                color: TM.forest,
                opacity: availabilitySaving ? 0.7 : 1,
              }}
            >
              {availabilitySaving ? "Saving..." : "Save Availability"}
            </button>
          </div>
          </div>
        </form>
      </div>
    </div>
    </div>
  </div>
)}

{availabilityActionsOpen && activeAvailability && (
  <div className="fixed inset-0 z-[10001]">
    <div
      className="absolute inset-0 bg-black/50"
      onMouseDown={() => !availabilityCancelling && setAvailabilityActionsOpen(false)}
    />

    <div className="absolute inset-0 flex items-end justify-center p-3 sm:items-center sm:p-6">
      <div
        className="w-full max-w-sm rounded-[28px] bg-white p-5 shadow-2xl ring-1 ring-black/5"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="text-[11px] font-extrabold uppercase tracking-[0.16em]" style={{ color: "rgba(11,61,46,0.58)" }}>
          My Availability
        </div>
        <div className="mt-2 text-xl font-black tracking-tight" style={{ color: TM.forest }}>
          {activeAvailability.dateLabel}
        </div>
        <div className="mt-1 text-sm font-semibold" style={{ color: "rgba(11,61,46,0.70)" }}>
          {activeAvailability.timeLabel} | {activeAvailability.matchTypeLabel}
        </div>

        <div className="mt-5 space-y-3">
          <button
            type="button"
            onClick={handleEditAvailability}
            className="w-full rounded-full px-4 py-3 text-sm font-extrabold"
            style={{ background: TM.forest, color: "#FFFFFF" }}
          >
            Edit Availability
          </button>

          <button
            type="button"
            onClick={handleCancelAvailability}
            disabled={availabilityCancelling}
            className="w-full rounded-full border px-4 py-3 text-sm font-extrabold"
            style={{
              borderColor: "rgba(239,68,68,0.24)",
              color: "#B42318",
              background: "rgba(239,68,68,0.06)",
              opacity: availabilityCancelling ? 0.7 : 1,
            }}
          >
            {availabilityCancelling ? "Cancelling..." : "Cancel Availability"}
          </button>

          <button
            type="button"
            onClick={() => setAvailabilityActionsOpen(false)}
            disabled={availabilityCancelling}
            className="w-full rounded-full bg-gray-100 px-4 py-3 text-sm font-extrabold text-gray-700"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  </div>
)}

 {matchSurface === "availability" ? (
  <div className="space-y-4">
    {activeAvailability ? (
      <button
        type="button"
        onClick={() => setAvailabilityActionsOpen(true)}
        className="w-full rounded-3xl p-5 text-left shadow-sm"
        style={{
          background: "#FFFFFF",
          border: "1px solid rgba(15,23,42,0.10)",
          boxShadow: "0 10px 30px rgba(15,23,42,0.08)",
        }}
      >
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="text-[11px] font-extrabold uppercase tracking-[0.16em]" style={{ color: "rgba(11,61,46,0.55)" }}>
              My Availability
            </div>
            <div className="mt-2 text-[18px] font-black tracking-tight" style={{ color: TM.forest }}>
              {activeAvailability.dateLabel}
            </div>
            <div className="mt-1 text-[13px] font-semibold" style={{ color: "rgba(11,61,46,0.70)" }}>
              {activeAvailability.timeLabel} | {activeAvailability.matchTypeLabel}
            </div>
          </div>

          <span
            className="rounded-full px-3 py-1 text-[11px] font-extrabold"
            style={{ background: "rgba(57,255,20,0.14)", color: TM.forest }}
          >
            Looking
          </span>
        </div>

        <div className="mt-4 space-y-2 text-[13px] font-medium" style={{ color: "rgba(15,23,42,0.68)" }}>
          <div>{activeAvailability.postcode} | {activeAvailability.radiusLabel}</div>
          <div>{activeAvailability.note || "No note added yet."}</div>
        </div>
        <div className="mt-4 text-left text-[11px] font-extrabold uppercase tracking-[0.16em]" style={{ color: "rgba(11,61,46,0.50)" }}>
          Tap to edit or cancel
        </div>
      </button>
    ) : (
      <div
        className="rounded-3xl p-5 shadow-sm"
        style={{
          background: "#FFFFFF",
          border: "1px solid rgba(15,23,42,0.10)",
          boxShadow: "0 10px 30px rgba(15,23,42,0.08)",
        }}
      >
        <div className="text-[18px] font-black tracking-tight" style={{ color: TM.forest }}>
          No live availability yet
        </div>
        <div className="mt-2 text-[14px]" style={{ color: "rgba(15,23,42,0.65)" }}>
          Post when you want to play, then browse other open requests here.
        </div>
        <button
          type="button"
          onClick={() => setAvailabilityRequestOpen(true)}
          className="mt-4 rounded-full px-4 py-3 text-[14px] font-extrabold"
          style={{
            background: TM.forest,
            color: "#FFFFFF",
            boxShadow: "0 10px 24px rgba(11,61,46,0.18)",
          }}
        >
          Post Availability
        </button>
      </div>
    )}

    <div className="px-1 text-[11px] font-extrabold uppercase tracking-[0.16em]" style={{ color: "rgba(11,61,46,0.55)" }}>
      Browse Open Requests
    </div>
    <div className="px-1 text-[13px]" style={{ color: "rgba(15,23,42,0.60)" }}>
      Explore players who are already looking to play and raise your hand when someone fits.
    </div>

    {browseAvailabilityCards.length === 0 ? (
      <div className="rounded-3xl bg-white ring-1 ring-black/5 p-6 text-sm text-gray-600">
        No open availability requests are live right now.
      </div>
    ) : (
      <ul className="space-y-3">
                        {browseAvailabilityCards.map((card) => (
                          <li
                            key={card.id}
                            className="rounded-3xl p-5 shadow-sm"
                            style={{
                              background: "#FFFFFF",
                              border: "1px solid rgba(15,23,42,0.10)",
                              boxShadow: "0 10px 30px rgba(15,23,42,0.08)",
                            }}
                          >
                            {(() => {
                              const recipientUid = card.userId;
                              const interestKey = `${recipientUid}:${card.availabilityInstanceId}`;
                              const alreadySent = pendingAvailabilityInterestKeys.has(interestKey);
                              const sending = sendingIds.has(recipientUid);

                              return (
                                <>
            <div className="flex items-start gap-3">
              <div
                className="relative h-14 w-14 shrink-0 overflow-hidden rounded-full"
                style={{ background: "rgba(15,23,42,0.06)", border: "1px solid rgba(15,23,42,0.10)" }}
              >
                {card.photoURL ? (
                  <Image src={card.photoURL} alt={card.name} fill sizes="56px" className="object-cover" />
                ) : (
                  <div className="grid h-full w-full place-items-center text-sm font-extrabold text-gray-500">
                    {(card.name || "?").charAt(0).toUpperCase()}
                  </div>
                )}
              </div>

              <div className="min-w-0 flex-1">
                <div className="text-[16px] font-extrabold text-[#0B3D2E]">{card.name}</div>
                <div className="mt-1 text-[12px] font-semibold text-black/60">
                  {card.dateLabel} | {card.timeLabel}
                </div>

                <div className="mt-2 flex flex-wrap gap-2">
                  <span
                    className="rounded-full px-2.5 py-1 text-[11px] font-extrabold"
                    style={{ background: "rgba(57,255,20,0.14)", color: TM.forest }}
                  >
                    {card.matchTypeLabel}
                  </span>
                  <span
                    className="rounded-full px-2.5 py-1 text-[11px] font-extrabold"
                    style={{ background: "#EEF0F2", color: "#0F172A" }}
                  >
                    {card.skillLabel}
                  </span>
                </div>

                <div className="mt-3 text-[13px] font-medium text-black/65">
                  {card.distanceLabel}{card.postcode ? ` | ${card.postcode}` : ""}
                </div>
                <div className="mt-1 text-[13px] text-black/60">
                  {card.note || "Open to a casual hit."}
                </div>
              </div>
            </div>

            <button
              type="button"
              onClick={() => handleMatchRequest(card as any)}
              disabled={alreadySent || sending}
              className="mt-4 w-full rounded-full py-3.5 text-[14px] font-extrabold transition"
              style={{
                background: alreadySent ? "rgba(11,61,46,0.10)" : TM.neon,
                color: alreadySent ? "rgba(11,61,46,0.60)" : TM.forest,
                boxShadow:
                  shouldHighlightFirstMatchRequest && !alreadySent
                    ? "0 0 0 4px rgba(57,255,20,0.22), 0 14px 34px rgba(57,255,20,0.26)"
                    : "0 10px 30px rgba(57,255,20,0.18)",
                opacity: sending ? 0.75 : 1,
              }}
            >
              {sending
                ? "Sending..."
                : alreadySent
                ? "Request Sent"
                : shouldHighlightFirstMatchRequest
                ? "Send Match Request"
                : "I'm Interested"}
            </button>
                                </>
                              );
                            })()}
          </li>
        ))}
      </ul>
    )}
  </div>
) : sortedMatches.length === 0 ? (
<p>No matches found yet. Try adjusting your availability or skill level.</p>
) : (
  <>

{activityFilter && (
  <div
    className="text-sm font-semibold mb-3 px-2"
    style={{ color: "rgba(11,61,46,0.70)" }}
  >
    Showing {activityFilter === "online" ? "players online now" :
             activityFilter === "recent" ? "players active recently" :
             "offline players"}
  </div>
)}

{firstRequestSuccessVisible && (
  <div className="mb-3 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-bold text-emerald-950">
    Great start — you’ve sent your first match request. We’ll notify you when someone responds.
  </div>
)}

    <ul className="space-y-3" data-onboarding-target="recommended-matches">
{visibleMatches.map((match, index) => {
  const avatarSrc = match.photoThumbURL || match.photoURL || null;
  const initials = (match.name || "?").trim().charAt(0).toUpperCase();
  const toUid = uidOf(match);
  const activityBadge = getActivityBadge(match.lastActiveAt);

  if (!toUid) return null;
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

  <button
    type="button"
    onClick={() => {
      void handleDismissPlayer(match);
    }}
    className="absolute right-4 top-4 z-[1] rounded-full p-2"
    style={{
      background: "rgba(15,23,42,0.06)",
      border: "1px solid rgba(15,23,42,0.10)",
      color: "rgba(15,23,42,0.65)",
    }}
    aria-label={`Hide ${match.name} from recommendations`}
    title="Hide this Player"
  >
    <X size={14} />
  </button>

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

{/* Content area */}
<div className="pl-24">
  <div className="mb-2">
    <div
      className="inline-flex rounded-full px-2 py-[3px] text-[10px] font-bold uppercase tracking-[0.03em] whitespace-nowrap"
      style={activityBadge.style}
    >
      {activityBadge.label}
    </div>
  </div>

  {/* Name */}
  <div
    className="text-[16px] font-extrabold truncate"
    style={{ color: TM.forest }}
  >
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
          {distText && pcText ? " â€¢ " : ""}
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
    âœ… Request Sent
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
    data-onboarding-target={index === 0 ? "best-match-invite" : undefined}
    data-distance-km={index === 0 && typeof match.distance === "number" ? String(match.distance) : undefined}
    data-availability-text={index === 0 ? formatAvailability(match.availability) : undefined}
    className="w-full rounded-full py-3.5 text-[14px] font-extrabold disabled:opacity-60"
    style={{
      background: TM.neon,
      color: TM.forest,
      boxShadow: "0 10px 30px rgba(57,255,20,0.18)",
    }}
  >
    {sendingIds.has(toUid) ? "Sendingâ€¦" : "Invite to Play"}
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
      {refreshing ? "Loadingâ€¦" : "Load more"}
    </button>
  </div>
)}

  </>
)}

    </div>
  </div>
);
}
