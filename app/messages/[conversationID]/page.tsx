"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import debounce from "lodash.debounce";
import { ArrowLeft, CalendarPlus, Info, Send } from "lucide-react";
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


function ChatPage() {
  const { conversationID } = useParams();
  const router = useRouter();

  // ===== STATE (keep all useState together) =====
  const [user, setUser] = useState<any>(null);
  const [messages, setMessages] = useState<any[]>([]);
  const [input, setInput] = useState("");
  const [userAvatar, setUserAvatar] = useState<string | null>(null);

  const [participants, setParticipants] = useState<string[]>([]);
  const [profiles, setProfiles] = useState<
    Record<string, { name?: string; photoURL?: string; photoThumbURL?: string; avatar?: string }>
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
const [inputBarH, setInputBarH] = useState(56); // measured later

const headerTopOffset = Math.max(vvTopInset, 20);

  const [otherUserId, setOtherUserId] = useState<string | null>(null);
const [isOtherOnline, setIsOtherOnline] = useState(false);

const [profileOpenId, setProfileOpenId] = useState<string | null>(null);
const [inviteOverlayId, setInviteOverlayId] = useState<string | null>(null);

const [showMatchPrompt, setShowMatchPrompt] = useState(false);
const [rematchPromptInvite, setRematchPromptInvite] = useState<RematchPrefill | null>(null);
const [rematchPromptBusy, setRematchPromptBusy] = useState(false);
const rematchViewedRef = useRef<Set<string>>(new Set());

const profileTargetId = useMemo(() => {
  if (isEventChat) return null;
  return otherUserId || participants.find((p) => p !== user?.uid) || null;
}, [isEventChat, otherUserId, participants, user?.uid]);

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
const firstLoadRef = useRef(true);

const isNearBottom = () => {
  const el = listRef.current;
  if (!el) return true;
  return el.scrollHeight - el.scrollTop - el.clientHeight < 350;
};

const scrollToBottom = (smooth = false) => {
  bottomRef.current?.scrollIntoView({ behavior: smooth ? "smooth" : "auto" });
};



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

    const setH = () => setInputBarH(el.clientHeight || 56);
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

  // ===== VISUAL VIEWPORT (mobile keyboards) =====
  useEffect(() => {
  const vv = window.visualViewport;
  if (!vv) return;

  const computeInset = () => {
    const topInset = Math.max(0, vv.offsetTop);
    const bottomInset = Math.max(
      0,
      window.innerHeight - (vv.height + vv.offsetTop)
    );

    setVvTopInset(topInset);
    setVvBottomInset(bottomInset);
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
}, [vvBottomInset, inputBarH]);


  // ===== LOAD PARTICIPANT PROFILES (TOP-LEVEL EFFECT) =====
  useEffect(() => {
    if (!participants.length) return;

    let cancelled = false;
    (async () => {
      const out: Record<
        string,
        { name?: string; photoURL?: string; photoThumbURL?: string; avatar?: string }
      > = {};
      for (const uid of participants) {
        try {
          const pSnap = await getDoc(doc(db, "players", uid));
          if (pSnap.exists()) {
            const d = pSnap.data() as any;
            out[uid] = {
              name: d.name,
              photoURL: d.photoURL,
              photoThumbURL: d.photoThumbURL,
              avatar: d.avatar,
            };
          } else {
            out[uid] = {};
          }
        } catch {
          out[uid] = {};
        }
      }
      if (!cancelled) setProfiles(out);
    })();

    return () => { cancelled = true; };
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


  // ===== MESSAGES SUBSCRIPTION =====
  useEffect(() => {
    if (!conversationID) return;
    const msgRef = collection(db, "conversations", String(conversationID), "messages");
    const q = query(msgRef, orderBy("timestamp"));

const unsub = onSnapshot(q, async (snap) => {
  const msgs = snap.docs.map((d) => ({ id: d.id, ...d.data() }));

  const shouldStick = firstLoadRef.current || isNearBottom();
  setMessages(msgs);

  requestAnimationFrame(() => {
    if (firstLoadRef.current) {
      scrollToBottom(false);
      firstLoadRef.current = false;
    } else if (shouldStick) {
      scrollToBottom(true);
    }
  });

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
  el.style.height = Math.min(el.scrollHeight, 160) + "px";
}, [input]);

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

  // ===== RENDER =====
  return (
   <div className="flex h-[100svh] flex-col bg-white overflow-hidden">
    {/* Header */}
<div
  className="relative z-20 border-b bg-white px-3"
  style={{
    paddingTop: `${headerTopOffset}px`,
  }}
>
  <div className="min-h-[68px] flex items-center gap-3 py-2">
    {/* Back */}
    <button
      onClick={() => router.push("/messages")}
      aria-label="Back"
      className="h-10 w-10 rounded-full grid place-items-center hover:bg-black/5"
    >
      <ArrowLeft className="w-5 h-5 text-gray-800" />
    </button>

    <button
  type="button"
  onClick={() => {
    if (profileTargetId) setProfileOpenId(profileTargetId);
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

    {!isEventChat && (
      <div className="mt-1">
        <span
          className="inline-flex items-center rounded-full px-3 py-1 text-[12px] font-extrabold"
          style={{ background: "rgba(57,255,20,0.18)", color: TM.ink }}
        >
          View profile
        </span>
      </div>
    )}

    {typingUsers.length > 0 && (
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

    {/* Right actions: Calendar+ and Info (instead of Phone icon) */}
    <div className="flex items-center gap-2">
      <button
  type="button"
  className="relative h-11 w-11 rounded-full grid place-items-center hover:bg-black/5"
  aria-label="Create invite"
  title="Create invite"
onClick={async () => {
  if (isEventChat) return;

  // set defaults first so modal has date/time immediately
  openInviteModal();

  // then fetch suggestion + prefill location/note
  await fetchSuggestedCourt();
}}
>
  {/* Pulsing ring */}
  {!isEventChat && (
    <span
      className="absolute inset-0 rounded-full animate-ping"
      style={{ background: "rgba(57,255,20,0.35)" }}
    />
  )}

  {/* Solid ring so it still looks “active” even between pings */}
  {!isEventChat && (
    <span
      className="absolute inset-0 rounded-full"
      style={{ boxShadow: "0 0 0 3px rgba(57,255,20,0.35)" }}
    />
  )}

  {/* Icon on top */}
  <span className="relative z-10">
    <CalendarPlus className="w-5 h-5 text-gray-800" />
  </span>
</button>

<button
  type="button"
  className="h-11 w-11 rounded-full grid place-items-center hover:bg-black/5 disabled:opacity-40"
  aria-label="View profile"
  title="View profile"
  disabled={!profileTargetId}
  onClick={() => {
    if (profileTargetId) setProfileOpenId(profileTargetId);
  }}
>
  <Info className="w-5 h-5 text-gray-800" />
</button>
    </div>
  </div>
</div>

{showMatchPrompt && !isEventChat && (
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

{rematchPromptInvite && !isEventChat && (
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
                  {otherUserId && profiles[otherUserId]?.name
                    ? `Lock in your next game with ${profiles[otherUserId]?.name}?`
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
                {formatInviteWhenSafe(rematchPromptInvite.startISO)}{" "}
                {rematchPromptInvite.courtName || rematchPromptInvite.location
                  ? `• ${rematchPromptInvite.courtName || rematchPromptInvite.location}`
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

{/* Messages */}
<div
  ref={listRef}

  onScroll={() => {
    const el = listRef.current;
    if (!el) return;
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 350;
    setShowScrollDown(!nearBottom);
  }}
  className="flex-1 overflow-y-auto overscroll-contain px-3 pt-3 pb-2 bg-gradient-to-b from-emerald-50/40 to-white"
  style={{
    // Reserve room for input bar + keyboard inset so the last message never hides
    scrollPaddingBottom: `${inputBarH + vvBottomInset + 24}px`,
    paddingBottom: `${inputBarH + vvBottomInset + 24}px`,
  }}
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

    {/* Bottom spacer so scrollToBottom() lands correctly */}
    <div
      ref={bottomRef}
      style={{
        height: 1,
        scrollMarginBottom: inputBarH + vvBottomInset + 24,
      }}
    />
  </div>
</div>


      {/* Scroll-to-bottom FAB */}
{showScrollDown && (
  <button
    onClick={() => scrollToBottom(true)}
    className="fixed right-4 rounded-full bg-white border shadow px-3 py-1.5 text-xs text-gray-700"
    style={{ bottom: 'calc(96px + env(safe-area-inset-bottom, 0px))' }} // 96px ≈ bottom nav + input bar
  >
    Jump to latest
  </button>
)}


      {/* Input */}
      <div
  ref={inputBarRef}
  className="fixed left-0 right-0 z-10 border-t bg-white px-3"
  style={{
    bottom: vvBottomInset,
    paddingBottom: "calc(env(safe-area-inset-bottom) + 10px)",
    paddingTop: 10,
  }}
>
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
        onBlur={() => updateTypingStatus(false)}
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

    {showInvite && (
  <div
    className="fixed inset-0 z-[60] flex items-center justify-center px-4"
    style={{ background: "rgba(0,0,0,0.35)" }}
    onMouseDown={(e) => {
      if (e.target === e.currentTarget) closeInviteModal();
    }}
  >
    <div
  className="w-full max-w-md rounded-2xl bg-white shadow-xl overflow-hidden flex flex-col"
  style={{
    maxHeight: "calc(100svh - 120px)",
  }}
>
  
 
      {/* Header */}
      <div className="flex items-center justify-between px-5 py-4 border-b">
        <button
          className="h-9 w-9 rounded-full grid place-items-center hover:bg-black/5"
          onClick={closeInviteModal}
          aria-label="Close"
          title="Close"
        >
          ✕
        </button>
        <div className="font-extrabold text-[16px] text-gray-900">
          {inviteFlow === "rematch" ? "Send Rematch Invite" : "Invite to Play"}
        </div>
        <div className="h-9 w-9" />
      </div>

      {/* Body */}
<div
  className="px-5 py-4 overflow-y-auto overscroll-contain"
  style={{
    WebkitOverflowScrolling: "touch",
    paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + 16px)",
  }}
>
        <div className="text-[12px] font-bold text-gray-700 mb-2">
          {inviteFlow === "rematch" ? "Rematch Details" : "Match Details"}
        </div>

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

        {/* Date */}
        <div className="mb-3">
          <div className="text-[12px] font-semibold text-gray-700 mb-1">Match Date</div>
          <input
            type="date"
            value={inviteDate}
            onChange={(e) => setInviteDate(e.target.value)}
            className="w-full rounded-xl border px-3 py-2 text-[14px] outline-none"
          />
        </div>

        {/* Time + Duration */}
        <div className="mb-3 grid grid-cols-2 gap-3">
          <div>
            <div className="text-[12px] font-semibold text-gray-700 mb-1">Start Time</div>
            <input
              type="time"
              value={inviteTime}
              onChange={(e) => setInviteTime(e.target.value)}
              className="w-full rounded-xl border px-3 py-2 text-[14px] outline-none"
            />
          </div>

          <div>
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
          {inviteFlow === "rematch" ? "Send Rematch Invite →" : "Send Invite →"}
        </button>

        <button
          type="button"
          onClick={closeInviteModal}
          className="w-full py-3 text-[13px] font-semibold text-gray-600"
        >
          Cancel
        </button>
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
export default ChatPage;
