"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { db } from "@/lib/firebase";
import { doc, getDoc, collection, query, where, getDocs, getCountFromServer } from "firebase/firestore";
import Image from "next/image";
import withAuth from "@/components/withAuth";
import { onAuthStateChanged } from "firebase/auth";
import { auth } from "@/lib/firebase";
import { CalendarDays, CheckCircle2, Trophy, ArrowLeft } from "lucide-react";
import type { SkillBand } from "@/lib/skills";
import { SKILL_OPTIONS, skillFromUTR } from "@/lib/skills";

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

  // 1) If you’ve already stored a label, use it
  if (typeof skillBandLabel === "string" && skillBandLabel.trim()) {
    return skillBandLabel.trim();
  }

  // 2) Use the band value + SKILL_OPTIONS
  if (typeof skillBand === "string" && skillBand.trim()) {
    const band = skillBand.trim() as SkillBand;

    const fromOptions = SKILL_OPTIONS_SAFE.find((o) => o.value === band)?.label;
    if (fromOptions) return fromOptions;

    // fallback: lower_beginner -> Lower Beginner
    if (band.includes("_")) {
      return band
        .split("_")
        .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
        .join(" ");
    }
    return band.charAt(0).toUpperCase() + band.slice(1);
  }

  // 3) Try deriving from rating if present
  if (typeof rating === "number") {
    const fromRating = skillFromUTR(rating);
    if (fromRating) return fromRating;
  }

  // 4) Last resort: legacy skillLevel string
  if (typeof skillLevel === "string" && skillLevel.trim()) {
    return skillLevel.trim();
  }

  return "";
};

type Player = {
  name: string;
  postcode: string;
  skillLevel: string;        // human-readable label we’ll show
  availability: string[];
  bio: string;
  photoURL?: string;
  // New canonical + legacy support
  skillRating?: number | null;
  utr?: number | null;
  skillBand?: string | null;
  skillBandLabel?: string | null;
  userId?: string | null;
};


const RATING_LABEL = "TennisMate Rating (TMR)";

function PublicProfilePage() {
  const { id } = useParams();
  const router = useRouter();
  const [player, setPlayer] = useState<Player | null>(null);
  const [loading, setLoading] = useState(true);
const [matchStats, setMatchStats] = useState({
  matches: 0,          // accepted requests (sent or received)
  completed: 0,        // completed games (from match_history)
  wins: 0,
});

  const [showFullBio, setShowFullBio] = useState(false);

  useEffect(() => {
   const fetchPlayerAndStats = async () => {
  if (!id) return;

  // ✅ declare once, before any usage
  let playerUserId: string = id as string;

  try {


        const playerRef = doc(db, "players", id as string);
        const playerSnap = await getDoc(playerRef);

   if (playerSnap.exists()) {
  const d = playerSnap.data() as any;

  // ✅ Use Auth UID if stored on the player doc
  if (typeof d.userId === "string" && d.userId.trim()) {
    playerUserId = d.userId.trim();
  }

          // Prefer new field, fall back to legacy "utr"
          const ratingNumber: number | null =
            typeof d.skillRating === "number" ? d.skillRating :
            typeof d.utr === "number" ? d.utr :
            null;

         const computedSkillLabel = toSkillLabel({
  skillBand: d.skillBand ?? null,
  skillBandLabel: d.skillBandLabel ?? null,
  skillLevel: d.skillLevel ?? null, // legacy fallback
  rating: ratingNumber,             // fallback if band/label missing
  
});

setPlayer({
  userId: playerUserId,
  name: d.name,
  postcode: d.postcode,
  skillLevel: computedSkillLabel, // ✅ always a “best available” label
  availability: d.availability || [],
  bio: d.bio || "",
  photoURL: d.photoURL,
  skillRating: ratingNumber,
  utr: d.utr ?? null,
  skillBand: d.skillBand ?? null,
  skillBandLabel: d.skillBandLabel ?? null,
});

        } else {
          console.warn("Player not found in Firestore.");
        }

      // ✅ MATCHES (accepted requests) — same definition as Matches page
const acceptedFromQ = query(
  collection(db, "match_requests"),
  where("fromUserId", "==", playerUserId),
  where("status", "==", "accepted")
);

const acceptedToQ = query(
  collection(db, "match_requests"),
  where("toUserId", "==", playerUserId),
  where("status", "==", "accepted")
);

const [acceptedFromCount, acceptedToCount] = await Promise.all([
  getCountFromServer(acceptedFromQ),
  getCountFromServer(acceptedToQ),
]);

const acceptedMatchesCount =
  (acceptedFromCount.data().count ?? 0) + (acceptedToCount.data().count ?? 0);


// ✅ COMPLETED + WINS (from match_history)
const historyQ = query(
  collection(db, "match_history"),
  where("players", "array-contains", playerUserId)
);

const historySnap = await getDocs(historyQ);

let completed = 0;
let wins = 0;

historySnap.forEach((docSnap) => {
  const match = docSnap.data() as any;
  if (match.completed === true || match.status === "completed") completed++;
  if (match.winnerId === playerUserId) wins++;
});

setMatchStats({
  matches: acceptedMatchesCount,
  completed,
  wins,
});

      } catch (error) {
        console.error("Error loading player profile:", error);
      } finally {
        setLoading(false);
      }
    };

    const unsubscribe = onAuthStateChanged(auth, (user) => {
      if (user) {
        fetchPlayerAndStats();
      } else {
        console.warn("User not signed in");
        setLoading(false);
      }
    });

    return () => unsubscribe();
  }, [id]);

  if (loading) {
    return (
      <div className="flex justify-center items-center p-6">
        <div className="animate-spin border-t-4 border-blue-600 rounded-full w-12 h-12"></div>
        <span className="ml-3 text-sm text-gray-600">Loading profile...</span>
      </div>
    );
  }

  if (!player) {
    return (
      <div className="p-6 text-center text-red-600">
        <h2 className="text-xl font-bold">Player not found.</h2>
        <p>Please check the URL or try searching for another player.</p>
      </div>
    );
  }

  // Decide what to display for rating (prefer new field)
  const displayRating =
    typeof player.skillRating === "number" ? player.skillRating :
    typeof player.utr === "number" ? player.utr :
    null;

  return (
    <div className="mx-auto max-w-3xl p-4 sm:p-6 pb-28 text-gray-800 space-y-6">
      {/* Back button */}
<button
  type="button"
  onClick={() => {
    if (window.history.length > 1) {
      router.back();
    } else {
      router.push("/match"); // fallback to Match Me tab
    }
  }}
  className="inline-flex items-center gap-2 rounded-full border border-gray-200 bg-white px-3 py-2 text-sm font-medium text-gray-800 shadow-sm hover:bg-gray-50 active:scale-[0.98] transition"
>
  <ArrowLeft className="h-4 w-4" />
  Back
</button>

      {/* HERO HEADER */}
      <section className="relative overflow-hidden rounded-2xl border border-gray-200 bg-gradient-to-b from-white to-emerald-50 p-5 sm:p-6 shadow-sm">
        {/* decorative blobs */}
        <span className="pointer-events-none absolute -top-10 -right-10 h-28 w-28 rounded-full bg-emerald-200/40 blur-2xl" />
        <span className="pointer-events-none absolute -bottom-8 -left-8 h-24 w-24 rounded-full bg-emerald-100/60 blur-2xl" />

        <div className="flex flex-col sm:flex-row sm:items-center gap-4 sm:gap-6">
          {/* Avatar (keep it round) */}
          <div className="relative h-24 w-24 shrink-0 rounded-full overflow-hidden ring-4 ring-white bg-gray-100 aspect-square">
            {player.photoURL ? (
              <Image
                src={player.photoURL}
                alt={`${player.name} avatar`}
                fill
                className="object-cover"
                sizes="96px"
              />
            ) : (
              <div className="flex h-full w-full items-center justify-center text-xl text-gray-500">
                {player.name?.slice(0, 2)?.toUpperCase() || "TM"}
              </div>
            )}
          </div>

          {/* Name + meta */}
          <div className="min-w-0">
            <h1 className="text-2xl sm:text-3xl font-bold tracking-tight break-words">
              {player.name}
            </h1>

            {/* Chips */}
            <div className="mt-2 flex flex-wrap items-center gap-2 text-sm">
              <span className="rounded-full border border-emerald-200 bg-emerald-50 text-emerald-700 px-2.5 py-0.5">
                Skill: {player.skillLevel || "—"}
              </span>

              {typeof displayRating === "number" && (
                <span className="rounded-full border border-emerald-200 bg-emerald-50 text-emerald-700 px-2.5 py-0.5">
                  TMR {displayRating.toFixed(2)}
                </span>
              )}

              {player.postcode ? (
                <span className="rounded-full border border-emerald-200 bg-emerald-50 text-emerald-700 px-2.5 py-0.5">
                  Postcode {player.postcode}
                </span>
              ) : null}
            </div>

            {/* Optional note under chips */}
            {typeof displayRating === "number" && (
              <p className="mt-1 text-xs text-gray-500">
                TMR is a simple numeric skill indicator (comparable to UTR®; TennisMate isn’t affiliated with Universal Tennis).
              </p>
            )}

            {/* Bio */}
            {player.bio && (
              <div className="mt-3">
                <p
                  className={`text-[15px] leading-relaxed text-gray-700 ${
                    showFullBio ? "" : "line-clamp-3"
                  }`}
                >
                  {player.bio}
                </p>
                {player.bio.length > 160 && (
                  <button
                    type="button"
                    onClick={() => setShowFullBio((v) => !v)}
                    className="mt-1 text-sm text-gray-600 underline"
                  >
                    {showFullBio ? "Show less" : "Read more"}
                  </button>
                )}
              </div>
            )}
          </div>
        </div>
      </section>

      {/* AVAILABILITY */}
      <section className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
        <h2 className="text-lg font-semibold">Availability</h2>
        {player.availability?.length ? (
          <div className="mt-2 flex flex-wrap gap-2">
            {player.availability.map((slot, i) => (
              <span
                key={`${slot}-${i}`}
                className="rounded-full border border-emerald-200 bg-emerald-50 text-emerald-800 px-3 py-1 text-sm"
              >
                {slot}
              </span>
            ))}
          </div>
        ) : (
          <p className="mt-2 text-sm text-gray-600">No availability provided.</p>
        )}
      </section>

      {/* MATCH STATS */}
      <section className="grid grid-cols-1 sm:grid-cols-3 gap-3" aria-labelledby="stats-heading">
        <h2 id="stats-heading" className="sr-only">Match stats</h2>

        <div className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm text-center">
          <div className="mx-auto mb-2 flex h-8 w-8 items-center justify-center rounded-full bg-emerald-100 text-emerald-700">
            <CalendarDays className="h-4 w-4" />
          </div>
          <div className="text-2xl font-bold tabular-nums">{matchStats.matches}</div>
          <div className="mt-1 text-sm text-gray-700">Accepted Matches</div>
        </div>

        <div className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm text-center">
          <div className="mx-auto mb-2 flex h-8 w-8 items-center justify-center rounded-full bg-emerald-100 text-emerald-700">
            <CheckCircle2 className="h-4 w-4" />
          </div>
          <div className="text-2xl font-bold tabular-nums">{matchStats.completed}</div>
          <div className="mt-1 text-sm text-gray-700">Completed Matches</div>
        </div>

        <div className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm text-center">
          <div className="mx-auto mb-2 flex h-8 w-8 items-center justify-center rounded-full bg-emerald-100 text-emerald-700">
            <Trophy className="h-4 w-4" />
          </div>
          <div className="text-2xl font-bold tabular-nums">{matchStats.wins}</div>
          <div className="mt-1 text-sm text-gray-700">Wins</div>
        </div>
      </section>
    </div>
  );
}

export default withAuth(PublicProfilePage);
