"use client";

import { useEffect, useState } from "react";
import { db } from "@/lib/firebaseConfig";
import {
  doc,
  getDoc,
  collection,
  query,
  where,
  getDocs,
  serverTimestamp,
  updateDoc,
} from "firebase/firestore";
import Image from "next/image";
import { onAuthStateChanged } from "firebase/auth";
import { auth } from "@/lib/firebaseConfig";
import { CalendarDays, CheckCircle2, Trophy } from "lucide-react";
import type { SkillBand } from "@/lib/skills";
import { SKILL_OPTIONS, skillFromUTR } from "@/lib/skills";
import { resolveLargeProfilePhoto, resolveSmallProfilePhoto } from "@/lib/profilePhoto";
import { createMatchRequestWithRelationship } from "@/lib/playerRelationships";

const TM = {
  forest: "#0B3D2E",
  forestDark: "#071B15",
  neon: "#39FF14",
  ink: "#EAF7F0",
  sub: "rgba(234,247,240,0.75)",
};

const CTA_CLEARANCE_PX = 120; // tuned: clears sticky CTA without big dead space

const SKILL_OPTIONS_SAFE =
  Array.isArray(SKILL_OPTIONS) && SKILL_OPTIONS.length > 0
    ? SKILL_OPTIONS
    : ([
        { value: "beginner", label: "Beginner" },
        { value: "intermediate", label: "Intermediate" },
        { value: "advanced", label: "Advanced" },
      ] as Array<{ value: SkillBand; label: string }>);

const toSkillLabel = (opts: {
  skillBand?: string | null;
  skillBandLabel?: string | null;
  skillLevel?: string | null;
  rating?: number | null;
}): string => {
  const { skillBandLabel, skillBand, skillLevel, rating } = opts;

  if (typeof skillBandLabel === "string" && skillBandLabel.trim()) {
    return skillBandLabel.trim();
  }

  if (typeof skillBand === "string" && skillBand.trim()) {
    const band = skillBand.trim() as SkillBand;

    const fromOptions = SKILL_OPTIONS_SAFE.find((o) => o.value === band)?.label;
    if (fromOptions) return fromOptions;

    if (band.includes("_")) {
      return band
        .split("_")
        .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
        .join(" ");
    }
    return band.charAt(0).toUpperCase() + band.slice(1);
  }

  if (typeof rating === "number") {
    const fromRating = skillFromUTR(rating);
    if (fromRating) return fromRating;
  }

  if (typeof skillLevel === "string" && skillLevel.trim()) {
    return skillLevel.trim();
  }

  return "";
};

type Player = {
  userId?: string | null;
  name: string;
  postcode: string;
  skillLevel: string;
  availability: string[];
  bio: string;
  photoURL?: string;
  photoThumbURL?: string;
  avatar?: string;
  birthYear?: number | null;
  gender?: string | null;
  skillRating?: number | null;
  utr?: number | null;
  skillBand?: string | null;
  skillBandLabel?: string | null;
};

export default function PlayerProfileView({
  playerId,
  onClose,
}: {
  playerId: string;
  onClose?: () => void;
}) {
  const [player, setPlayer] = useState<Player | null>(null);
  const [loading, setLoading] = useState(true);
  const [matchStats, setMatchStats] = useState({
    matches: 0,
    completed: 0,
    wins: 0,
  });
const [showFullBio, setShowFullBio] = useState(false);
const [matchRequestStatus, setMatchRequestStatus] = useState<"none" | "pending" | "accepted">("none");
const [pendingRequestDirection, setPendingRequestDirection] = useState<"sent" | "received" | null>(null);
const [pendingRequestId, setPendingRequestId] = useState<string | null>(null);
const [sendingInvite, setSendingInvite] = useState(false);
const [inviteError, setInviteError] = useState<string | null>(null);
const [inviteSent, setInviteSent] = useState(false);
const [currentUid, setCurrentUid] = useState<string | null>(null);

  useEffect(() => {
    if (!playerId) return;

      const fetchPlayerAndStats = async (currentUid: string) => {
      let playerUserId: string = playerId;
      let playerLoaded = false;

      try {
        const playerRef = doc(db, "players", playerId);
        const playerSnap = await getDoc(playerRef);

        if (playerSnap.exists()) {
          const d = playerSnap.data() as any;

          if (typeof d.userId === "string" && d.userId.trim()) {
            playerUserId = d.userId.trim();
          }

          const ratingNumber: number | null =
            typeof d.skillRating === "number"
              ? d.skillRating
              : typeof d.utr === "number"
              ? d.utr
              : null;

          const computedSkillLabel = toSkillLabel({
            skillBand: d.skillBand ?? null,
            skillBandLabel: d.skillBandLabel ?? null,
            skillLevel: d.skillLevel ?? null,
            rating: ratingNumber,
          });

          setPlayer({
            userId: playerUserId,
            name: d.name,
            postcode: d.postcode,
            skillLevel: computedSkillLabel,
            availability: d.availability || [],
            bio: d.bio || "",
            photoURL: typeof d.photoURL === "string" ? d.photoURL : undefined,
            photoThumbURL: typeof d.photoThumbURL === "string" ? d.photoThumbURL : undefined,
            avatar: typeof d.avatar === "string" ? d.avatar : undefined,
            gender: typeof d.gender === "string" ? d.gender : null,
            skillRating: ratingNumber,
            utr: d.utr ?? null,
            skillBand: d.skillBand ?? null,
            skillBandLabel: d.skillBandLabel ?? null,
          });
          playerLoaded = true;
        } else {
          setPlayer(null);
          return;
        }

        try {
          const publicStatsSnap = await getDoc(doc(db, "player_public_stats", playerUserId));
          const publicStats = publicStatsSnap.exists() ? (publicStatsSnap.data() as any) : null;

          setMatchStats({
            matches:
              typeof publicStats?.acceptedMatches === "number" ? publicStats.acceptedMatches : 0,
            completed:
              typeof publicStats?.completedMatches === "number" ? publicStats.completedMatches : 0,
            wins: typeof publicStats?.wins === "number" ? publicStats.wins : 0,
          });
        } catch (statsError) {
          console.warn("Public player stats unavailable for profile view:", statsError);
          setMatchStats({
            matches: 0,
            completed: 0,
            wins: 0,
          });
        }

                // ✅ Determine whether this player is pending or already accepted
        try {
          if (currentUid === playerUserId) {
            setMatchRequestStatus("accepted");
            setPendingRequestDirection(null);
            setPendingRequestId(null);
          } else {
            const q1 = query(
              collection(db, "match_requests"),
              where("fromUserId", "==", currentUid),
              where("toUserId", "==", playerUserId)
            );

            const q2 = query(
              collection(db, "match_requests"),
              where("fromUserId", "==", playerUserId),
              where("toUserId", "==", currentUid)
            );

            const [s1, s2] = await Promise.all([getDocs(q1), getDocs(q2)]);

            const sentDocs = s1.docs.map((docSnap) => ({
              id: docSnap.id,
              direction: "sent" as const,
              ...(docSnap.data() as any),
            }));

            const receivedDocs = s2.docs.map((docSnap) => ({
              id: docSnap.id,
              direction: "received" as const,
              ...(docSnap.data() as any),
            }));

            const allDocs = [...sentDocs, ...receivedDocs];

            const acceptedDoc = allDocs.find((req) =>
              ["accepted", "confirmed", "completed"].includes(req.status)
            );

            if (acceptedDoc) {
              setMatchRequestStatus("accepted");
              setPendingRequestDirection(null);
              setPendingRequestId(acceptedDoc.id);
            } else {
              const pendingDoc = allDocs.find((req) =>
                ["pending", "unread", "requested"].includes(req.status)
              );

              if (pendingDoc) {
                setMatchRequestStatus("pending");
                setPendingRequestDirection(pendingDoc.direction);
                setPendingRequestId(pendingDoc.id);
              } else {
                setMatchRequestStatus("none");
                setPendingRequestDirection(null);
                setPendingRequestId(null);
              }
            }
          }
        } catch (e) {
          console.warn("Match existence check failed:", e);
          setMatchRequestStatus("none");
          setPendingRequestDirection(null);
          setPendingRequestId(null);
        }
      } catch (error) {
        console.error("Error loading player profile:", error);
        if (!playerLoaded) {
          setPlayer(null);
        }
      } finally {
        setLoading(false);
      }
    };

   const unsubscribe = onAuthStateChanged(auth, (user) => {
  if (user) {
    setCurrentUid(user.uid);
    fetchPlayerAndStats(user.uid);
  } else {
    console.warn("User not signed in");
    setCurrentUid(null);
    setLoading(false);
  }
});

    return () => unsubscribe();
  }, [playerId]);

  const resolveRecipientUid = (): string | null => {
  if (!player) return null;

  const uid =
    typeof player.userId === "string" && player.userId.trim()
      ? player.userId.trim()
      : typeof playerId === "string" && playerId.trim()
      ? playerId.trim()
      : null;

  console.log("[PlayerProfileView] Derived recipient UID:", {
    playerId,
    playerUserId: player.userId,
    finalUid: uid,
  });

  return uid;
};

const handleInviteToPlay = async () => {
  if (!player || !currentUid) return;
  if (sendingInvite) return;

  const toUid = resolveRecipientUid();

  if (!toUid) {
    console.error("[PlayerProfileView] Missing recipient UID", { player, playerId });
    setInviteError("Could not send request. Please refresh and try again.");
    return;
  }

  if (toUid === currentUid) {
    setInviteError("You cannot send a match request to yourself.");
    return;
  }

  try {
    setSendingInvite(true);
    setInviteError(null);

    // same defensive check style as Match page
    const q1 = query(
      collection(db, "match_requests"),
      where("fromUserId", "==", currentUid),
      where("toUserId", "==", toUid)
    );

    const q2 = query(
      collection(db, "match_requests"),
      where("fromUserId", "==", toUid),
      where("toUserId", "==", currentUid)
    );

    const [existingSent, existingReceived] = await Promise.all([
      getDocs(q1),
      getDocs(q2),
    ]);

    const sentDocs = existingSent.docs.map((docSnap) => ({
      id: docSnap.id,
      direction: "sent" as const,
      ...(docSnap.data() as any),
    }));

    const receivedDocs = existingReceived.docs.map((docSnap) => ({
      id: docSnap.id,
      direction: "received" as const,
      ...(docSnap.data() as any),
    }));

    const allDocs = [...sentDocs, ...receivedDocs];

    const acceptedDoc = allDocs.find((req) =>
      ["accepted", "confirmed", "completed"].includes(req.status)
    );

    if (acceptedDoc) {
      setMatchRequestStatus("accepted");
      setPendingRequestDirection(null);
      setPendingRequestId(acceptedDoc.id);
      setInviteSent(true);
      return;
    }

    const pendingDoc = allDocs.find((req) =>
      ["pending", "unread", "requested"].includes(req.status)
    );

    if (pendingDoc) {
      setMatchRequestStatus("pending");
      setPendingRequestDirection(pendingDoc.direction);
      setPendingRequestId(pendingDoc.id);
      setInviteSent(true);
      return;
    }

    // load my profile so this matches the Match page payload
    const myProfileSnap = await getDoc(doc(db, "players", currentUid));
    const myProfileData = myProfileSnap.exists() ? (myProfileSnap.data() as any) : null;

    const fromName =
      typeof myProfileData?.name === "string" ? myProfileData.name : null;

    const fromPostcode =
      typeof myProfileData?.postcode === "string" ? myProfileData.postcode : null;

    const fromPhotoURL = resolveSmallProfilePhoto(myProfileData);

    // Stage 1 player_relationships: link new match_requests to
    // player_relationships/{pairId}. Other collections migrate later.
    const ref = await createMatchRequestWithRelationship(db, currentUid, toUid, {
      fromUserId: currentUid,
      toUserId: toUid,
      status: "pending",
      timestamp: serverTimestamp(),

      fromName,
      fromPostcode,
      fromPhotoURL,

      toName: player.name ?? null,
      toPostcode: player.postcode ?? null,
      toPhotoURL: resolveLargeProfilePhoto(player) ?? null,
    }, {
      actorId: currentUid,
      playerSnapshots: {
        [currentUid]: {
          name: fromName,
          photoURL: fromPhotoURL,
          photoThumbURL:
            typeof myProfileData?.photoThumbURL === "string" ? myProfileData.photoThumbURL : null,
        },
        [toUid]: {
          name: player.name ?? null,
          photoURL: resolveLargeProfilePhoto(player) ?? null,
          photoThumbURL: resolveSmallProfilePhoto(player) ?? null,
        },
      },
    });

    console.log("[PlayerProfileView] ✅ match_requests created:", ref.id, {
      from: currentUid,
      to: toUid,
    });

setInviteSent(true);
setMatchRequestStatus("pending");
setPendingRequestDirection("sent");
setPendingRequestId(ref.id);
  } catch (err: any) {
    console.error("Failed to send match request from profile view:", err);
    setInviteError(err?.message ?? "Could not send request.");
  } finally {
    setSendingInvite(false);
  }
};

const handleAcceptMatchRequest = async () => {
  if (!pendingRequestId || !currentUid) return;
  if (sendingInvite) return;

  try {
    setSendingInvite(true);
    setInviteError(null);

    await updateDoc(doc(db, "match_requests", pendingRequestId), {
      status: "accepted",
      acceptedAt: serverTimestamp(),
      respondedBy: currentUid,
    });

    setMatchRequestStatus("accepted");
    setPendingRequestDirection(null);
    setInviteSent(false);
  } catch (err: any) {
    console.error("Failed to accept match request from profile view:", err);
    setInviteError(err?.message ?? "Could not accept request.");
  } finally {
    setSendingInvite(false);
  }
};

  if (loading) {
    return (
      <div className="flex justify-center items-center p-6">
        <div className="animate-spin border-t-4 border-blue-600 rounded-full w-12 h-12" />
        <span className="ml-3 text-sm text-gray-600">Loading profile...</span>
      </div>
    );
  }

  if (!player) {
    return (
      <div className="p-6 text-center text-red-600">
        <h2 className="text-xl font-bold">Player not found.</h2>
        <p>Please check the player ID.</p>
      </div>
    );
  }

  const displayRating =
    typeof player.skillRating === "number"
      ? player.skillRating
      : typeof player.utr === "number"
      ? player.utr
      : null;

const recipientUid = resolveRecipientUid();
const showInviteCTA = !!player && !!currentUid && !!recipientUid && currentUid !== recipientUid;
const currentCTAState =
  matchRequestStatus === "accepted"
    ? "accepted"
    : matchRequestStatus === "pending" || inviteSent
    ? "pending"
    : "none";
const canAcceptPendingRequest =
  currentCTAState === "pending" && pendingRequestDirection === "received";
const clearancePx = showInviteCTA ? CTA_CLEARANCE_PX : 24;

 return (
<div
  className="w-full h-full min-h-0 text-white flex flex-col"
  style={{ background: TM.forestDark }}
>

    {/* Optional close button */}
    {onClose && (
      <div className="flex justify-end px-4 pt-4 relative z-10">
        <button
          type="button"
          onClick={onClose}
          className="h-10 w-10 rounded-full grid place-items-center"
          style={{
            background: "rgba(255,255,255,0.06)",
            border: "1px solid rgba(255,255,255,0.12)",
            color: TM.ink,
          }}
          aria-label="Close"
        >
          ✕
        </button>
      </div>
    )}

    {/* ✅ ONLY scroll container */}
  <div
  className="flex-1 min-h-0 overflow-y-auto tm-scrollbar-hide"
  style={{
    WebkitOverflowScrolling: "touch",
    overscrollBehavior: "contain",
    background: TM.forestDark,

    // ✅ hide scrollbar visuals (keep scroll working)
    scrollbarWidth: "none",        // Firefox
    msOverflowStyle: "none",       // IE/Edge legacy
  }}
>


      {/* HERO */}
<div className="px-4 pb-2 pt-2">
  <div
    className="relative rounded-3xl overflow-hidden"
    style={{
      background:
        "linear-gradient(180deg, rgba(11,61,46,0.95), rgba(7,27,21,0.95))",
      boxShadow: "0 20px 60px rgba(0,0,0,0.35)",
      border: "1px solid rgba(255,255,255,0.08)",
    }}
  >
    {/* Image / avatar */}
    <div
      className="relative w-full"
      style={{
        height: "240px",
        background: "rgba(0,0,0,0.25)",
      }}
    >
      {resolveLargeProfilePhoto(player) ? (
        <Image
          src={resolveLargeProfilePhoto(player)!}
          alt={`${player.name} avatar`}
          fill
          sizes="560px"
          className="object-cover object-center"
          priority
        />
      ) : (
        <div
          className="h-full w-full grid place-items-center text-5xl font-black"
          style={{ color: TM.ink }}
        >
          {player.name?.slice(0, 1)?.toUpperCase() || "T"}
        </div>
      )}

      {/* Neon Level pill (top-right) */}
      <div
        className="absolute top-4 right-4 px-3 py-1 rounded-full text-sm font-extrabold"
        style={{ background: TM.neon, color: TM.forest }}
      >
        {typeof displayRating === "number"
          ? `Level ${displayRating.toFixed(1)}`
          : `Level ${player.skillLevel || "—"}`}
      </div>
    </div>

    {/* Title / subtitle */}
    <div className="p-3">
      <div className="text-2xl font-black tracking-tight">{player.name}</div>

      <div className="mt-1 text-sm font-semibold" style={{ color: TM.neon }}>
        TennisMate Player
      </div>

      {/* Chips */}
      <div className="mt-3 flex flex-wrap gap-2">
        {!!player.skillLevel && (
          <span
            className="px-3 py-1 rounded-full text-xs font-bold"
            style={{
              background: "rgba(255,255,255,0.06)",
              border: "1px solid rgba(255,255,255,0.10)",
              color: TM.ink,
            }}
          >
            Skill: {player.skillLevel}
          </span>
        )}

        {!!player.postcode && (
          <span
            className="px-3 py-1 rounded-full text-xs font-bold"
            style={{
              background: "rgba(255,255,255,0.06)",
              border: "1px solid rgba(255,255,255,0.10)",
              color: TM.ink,
            }}
          >
            Postcode {player.postcode}
          </span>
        )}

        {!!player.gender && (
          <span
            className="px-3 py-1 rounded-full text-xs font-bold"
            style={{
              background: "rgba(255,255,255,0.06)",
              border: "1px solid rgba(255,255,255,0.10)",
              color: TM.ink,
            }}
          >
            {player.gender}
          </span>
        )}
      </div>
    </div>
  </div>
</div>


      {/* STATS */}
      <div className="px-4 grid grid-cols-3 gap-3 mt-3">
        <StatCard label="ACCEPTED" value={matchStats.matches} />
        <StatCard label="COMPLETED" value={matchStats.completed} />
        <StatCard label="WINS" value={matchStats.wins} />
      </div>

      {/* AVAILABILITY */}
      <div className="px-4 mt-4">
        <h3 className="text-sm font-bold uppercase mb-2" style={{ color: TM.ink }}>
          Availability
        </h3>

        {player.availability?.length ? (
          <div className="flex flex-wrap gap-2">
            {player.availability.map((slot, i) => (
              <span
                key={`${slot}-${i}`}
                className="px-3 py-1 rounded-full text-xs font-bold"
                style={{
                  background: "rgba(255,255,255,0.06)",
                  border: "1px solid rgba(57,255,20,0.22)",
                  color: TM.ink,
                }}
              >
                {slot}
              </span>
            ))}
          </div>
        ) : (
          <p className="text-sm" style={{ color: TM.sub }}>
            No availability provided.
          </p>
        )}
      </div>

      {/* BIO */}
      {!!player.bio && (
        <div className="px-4 mt-4">
          <h3 className="text-sm font-bold uppercase mb-2" style={{ color: TM.ink }}>
            Bio
          </h3>

          <p
            className={`text-sm leading-relaxed ${showFullBio ? "" : "line-clamp-4"}`}
            style={{ color: TM.sub }}
          >
            {player.bio}
          </p>

          {player.bio.length > 160 && (
            <button
              type="button"
              onClick={() => setShowFullBio((v) => !v)}
              className="mt-2 text-sm font-semibold"
              style={{ color: TM.neon }}
            >
              {showFullBio ? "Show less" : "Read more"}
            </button>
          )}
        </div>
      )}

      {/* DETAILS (✅ smaller bottom padding; still clears CTA) */}
<div
  className="px-4 mt-4 space-y-3"
  style={{
    paddingBottom: `calc(env(safe-area-inset-bottom, 0px) + ${clearancePx}px)`,
  }}
>

  <DetailRow label="Postcode" value={player.postcode || "—"} />
  <DetailRow label="Skill" value={player.skillLevel || "—"} />
  {player.gender ? <DetailRow label="Gender" value={player.gender} /> : null}
</div>

    </div>

    {/* ✅ CTA is OUTSIDE scroll container */}
{showInviteCTA && (
  <div
    className="sticky bottom-0 p-4"
    style={{
      background:
        "linear-gradient(180deg, rgba(7,27,21,0) 0%, rgba(7,27,21,0.92) 40%, rgba(7,27,21,0.98) 100%)",
      paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + 16px)",
      borderTop: "1px solid rgba(255,255,255,0.08)",
      backdropFilter: "blur(10px)",
      WebkitBackdropFilter: "blur(10px)",
    }}
  >
<button
  type="button"
  onClick={canAcceptPendingRequest ? handleAcceptMatchRequest : handleInviteToPlay}
  disabled={
    sendingInvite ||
    (currentCTAState === "accepted") ||
    (currentCTAState === "pending" && !canAcceptPendingRequest)
  }
  className="w-full h-16 rounded-full flex items-center justify-center gap-4 font-extrabold tracking-wide transition active:scale-[0.98] disabled:cursor-not-allowed"
  style={{
    background:
      currentCTAState === "none" || canAcceptPendingRequest
        ? TM.neon
        : "rgba(255,255,255,0.08)",
    color:
      currentCTAState === "none" || canAcceptPendingRequest
        ? TM.forest
        : TM.ink,
    boxShadow:
      currentCTAState === "none" || canAcceptPendingRequest
        ? "0 14px 36px rgba(57,255,20,0.45)"
        : "none",
    border:
      currentCTAState === "none" || canAcceptPendingRequest
        ? "none"
        : "1px solid rgba(255,255,255,0.14)",
    opacity: sendingInvite ? 0.7 : 1,
  }}
>
  {(currentCTAState === "none" || canAcceptPendingRequest) && !sendingInvite && (
    <span
      aria-hidden
      style={{
        width: 0,
        height: 0,
        borderTop: "9px solid transparent",
        borderBottom: "9px solid transparent",
        borderLeft: "16px solid #000000",
      }}
    />
  )}

  <span className="text-base">
    {sendingInvite
      ? canAcceptPendingRequest
        ? "Accepting…"
        : "Sending…"
      : currentCTAState === "accepted"
      ? "✓ Match Accepted"
      : canAcceptPendingRequest
      ? "Accept Match Request"
      : currentCTAState === "pending"
      ? "✓ Request Pending"
      : "Invite to Play"}
  </span>
</button>

    {inviteError && (
      <p className="mt-3 text-sm text-center text-red-300">{inviteError}</p>
    )}
  </div>
)}
  </div>
);


}

function StatCard({ label, value }: { label: string; value: number }) {
  return (
    <div
      className="rounded-2xl p-3 text-center"
      style={{
        background: "rgba(255,255,255,0.04)",
        border: "1px solid rgba(255,255,255,0.08)",
      }}
    >
      <div className="text-xl font-black" style={{ color: TM.neon }}>
        {value}
      </div>
      <div className="text-[11px] font-semibold opacity-70 mt-1">{label}</div>
    </div>
  );
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div
      className="flex items-center justify-between rounded-xl px-4 py-3"
      style={{
        background: "rgba(255,255,255,0.04)",
        border: "1px solid rgba(255,255,255,0.08)",
      }}
    >
      <div className="text-sm opacity-70" style={{ color: TM.sub }}>
        {label}
      </div>
      <div className="text-sm font-bold" style={{ color: TM.ink }}>
        {value}
      </div>
    </div>
  );
}
