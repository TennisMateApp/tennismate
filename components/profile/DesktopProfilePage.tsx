"use client";

import React, { useEffect, useMemo, useState } from "react";
import Image from "next/image";
import { useRouter, useSearchParams } from "next/navigation";
import { onAuthStateChanged } from "firebase/auth";
import {
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  where,
  setDoc,
} from "firebase/firestore";
import { auth, db, storage } from "@/lib/firebaseConfig";
import { Edit2, CheckCircle2, CalendarDays, Trophy } from "lucide-react";

// ✅ Adjust this import path to match your project
import TMDesktopSidebar from "@/components/desktop_layout/TMDesktopSidebar";

// ✅ Reuse your existing skill helpers
import type { SkillBand } from "@/lib/skills";
import { SKILL_OPTIONS, skillFromUTR } from "@/lib/skills";

import { BADGE_CATALOG } from "@/lib/badges";

import { httpsCallable } from "firebase/functions";
import { getFunctionsClient } from "@/lib/getFunctionsClient";
import { ref, deleteObject } from "firebase/storage";
import {
  PROFILE_FULL_PATH,
  PROFILE_THUMB_PATH,
  cleanupLegacyProfilePhotos,
} from "@/lib/profilePhoto";

const TM = {
  forest: "#0B3D2E",
  forestDark: "#071B15",
  neon: "#39FF14",
  ink: "#0B3D2E",
  cream: "#F5F5F0",
  tile: "#FFFFFF",
  softRing: "rgba(57,255,20,0.35)",
  border: "rgba(11,61,46,0.12)",
  sub: "rgba(11,61,46,0.72)",
};

const SKILL_OPTIONS_SAFE =
  Array.isArray(SKILL_OPTIONS) && SKILL_OPTIONS.length > 0
    ? SKILL_OPTIONS
    : ([
        { value: "beginner", label: "Beginner" },
        { value: "intermediate", label: "Intermediate" },
        { value: "advanced", label: "Advanced" },
      ] as Array<{ value: SkillBand; label: string }>);

const toSkillLabel = (band: SkillBand | "" | undefined): string => {
  if (!band) return "—";
  return SKILL_OPTIONS_SAFE.find((o) => o.value === band)?.label ?? "—";
};

const legacyToBand = (level?: string): SkillBand | "" => {
  if (!level) return "";
  const norm = level.toLowerCase();
  if (norm.includes("beginner")) return "beginner";
  if (norm.includes("intermediate")) return "intermediate";
  if (norm.includes("advanced") || norm.includes("advance")) return "advanced";
  return "";
};

const normalizeBadges = (raw: any): string[] => {
  if (Array.isArray(raw)) {
    return raw.filter((b): b is string => typeof b === "string" && b.trim().length > 0);
  }

  // support old object format like { firstWin: true, loveHold: true }
  if (raw && typeof raw === "object") {
    return Object.entries(raw)
      .filter(([_, value]) => value === true)
      .map(([key]) => key);
  }

  return [];
};

const arraysEqualUnordered = (a: string[], b: string[]) => {
  if (a.length !== b.length) return false;
  const as = [...a].sort();
  const bs = [...b].sort();
  return as.every((v, i) => v === bs[i]);
};

async function logFirestoreCall<T>(label: string, operation: () => Promise<T>): Promise<T> {
  console.info(`[DesktopProfilePage][Firestore] START ${label}`);
  try {
    const result = await operation();
    console.info(`[DesktopProfilePage][Firestore] OK ${label}`);
    return result;
  } catch (error) {
    console.error(`[DesktopProfilePage][Firestore] FAIL ${label}`, error);
    throw error;
  }
}

type MatchStats = { matches: number; completed: number; wins: number };

type ProfileData = {
  name: string;
  postcode: string;
  skillBand: SkillBand | "";
  rating: number | ""; // TMR
  bio: string;
  photoURL: string;
  badges: string[];
  birthYear: number | "";
  gender: string;
  availability: string[];
  memberSince?: string; // optional
};

const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as const;
type DayKey = (typeof DAYS)[number];

const AVAILABILITY_OPTIONS = [
  "Weekdays AM",
  "Weekdays PM",
  "Weekends AM",
  "Weekends PM",
] as const;

type AvailabilityKey = (typeof AVAILABILITY_OPTIONS)[number];

function normalizeAvailability(raw: any): AvailabilityKey[] {
  const arr = Array.isArray(raw) ? raw : [];
  const set = new Set(arr.map((s) => String(s).trim()));
  return AVAILABILITY_OPTIONS.filter((k) => set.has(k));
}


function buildWeeklyMatrix(availability: string[]) {
  // Your stored availability is like: ["Weekdays AM", "Weekdays PM", "Weekends AM", "Weekends PM"]
  // We'll map that into a simple 3-row grid to match the desktop layout vibe.
  const has = (s: string) => availability?.includes(s);

  const weekdaysAM = has("Weekdays AM");
  const weekdaysPM = has("Weekdays PM");
  const weekendsAM = has("Weekends AM");
  const weekendsPM = has("Weekends PM");

  const isWeekend = (d: DayKey) => d === "Sat" || d === "Sun";
  const isWeekday = (d: DayKey) => !isWeekend(d);

  // Rows: AM / PM / Evening (we’ll treat “PM” as evening-ish for now)
  const rows = [
    { key: "AM", label: "AM" },
    { key: "PM", label: "PM" },
    { key: "EVE", label: "EVE" },
  ] as const;

  const cell = (day: DayKey, rowKey: (typeof rows)[number]["key"]) => {
    if (rowKey === "AM") return isWeekday(day) ? weekdaysAM : weekendsAM;
    if (rowKey === "PM") return isWeekday(day) ? weekdaysPM : weekendsPM;
    // “EVE” duplicates PM to give the 3-row layout from the mock.
    return isWeekday(day) ? weekdaysPM : weekendsPM;
  };

  return { rows, cell };
}

function StatCard(props: {
  title: string;
  value: number;
  icon?: React.ReactNode;
}) {
  return (
    <div
      className="rounded-2xl border p-5"
      style={{ background: TM.tile, borderColor: TM.border }}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <div
            className="h-10 w-10 rounded-xl grid place-items-center"
            style={{ background: "rgba(57,255,20,0.16)", color: TM.forest }}
          >
            {props.icon}
          </div>

          <div className="min-w-0">
            <div className="text-xs font-extrabold" style={{ color: TM.sub }}>
              {props.title}
            </div>
          </div>
        </div>
      </div>

      <div className="mt-4">
        <div className="text-4xl font-black tabular-nums" style={{ color: TM.forest }}>
          {props.value}
        </div>
      </div>
    </div>
  );
}


function BadgePill(props: { title: string; subtitle: string; locked?: boolean; icon: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center">
      <div
        className="h-12 w-12 rounded-full grid place-items-center border"
        style={{
          background: props.locked ? "rgba(0,0,0,0.03)" : "rgba(57,255,20,0.14)",
          borderColor: props.locked ? "rgba(0,0,0,0.08)" : "rgba(57,255,20,0.35)",
          color: props.locked ? "rgba(11,61,46,0.25)" : TM.forest,
        }}
      >
        {props.icon}
      </div>
      <div className="mt-2 text-xs font-extrabold" style={{ color: TM.forest }}>
        {props.title}
      </div>
      <div className="text-[11px] font-semibold" style={{ color: "rgba(11,61,46,0.55)" }}>
        {props.subtitle}
      </div>
    </div>
  );
}

export default function DesktopProfilePage() {
  const router = useRouter();

    const searchParams = useSearchParams();
  const isEditing = searchParams.get("edit") === "true";

const [deletingAccount, setDeletingAccount] = useState(false);
const [deleteError, setDeleteError] = useState<string | null>(null);


  const [loading, setLoading] = useState(true);
  const [profile, setProfile] = useState<ProfileData>({
    name: "",
    postcode: "",
    skillBand: "",
    rating: "",
    bio: "",
    photoURL: "",
    badges: [],
    birthYear: "",
    gender: "",
    availability: [],
  });

  const [matchStats, setMatchStats] = useState<MatchStats>({
    matches: 0,
    completed: 0,
    wins: 0,
  });

  const derivedAge = useMemo(() => {
    if (typeof profile.birthYear !== "number") return null;
    const age = new Date().getFullYear() - profile.birthYear;
    if (!Number.isFinite(age) || age < 0 || age > 120) return null;
    return age;
  }, [profile.birthYear]);

  const safeBadges = Array.isArray(profile.badges) ? profile.badges : [];

  const weekly = useMemo(() => buildWeeklyMatrix(profile.availability || []), [profile.availability]);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (u) => {
      if (!u) return;

      // players/{uid} + players_private/{uid}
      const [playerSnap, privateSnap] = await Promise.all([
        logFirestoreCall(`getDoc players/${u.uid}`, () => getDoc(doc(db, "players", u.uid))),
        logFirestoreCall(`getDoc players_private/${u.uid}`, () =>
          getDoc(doc(db, "players_private", u.uid))
        ),
      ]);
      const data = playerSnap.exists() ? (playerSnap.data() as any) : {};
      const privateData = privateSnap.exists() ? (privateSnap.data() as any) : {};

      const ratingNumber =
        typeof data.skillRating === "number"
          ? data.skillRating
          : typeof data.utr === "number"
          ? data.utr
          : null;

      const derivedBand: SkillBand | "" =
        (data.skillBand as SkillBand) ||
        (typeof ratingNumber === "number" ? (skillFromUTR(ratingNumber) ?? "") : "") ||
        legacyToBand(data.skillLevel) ||
        "";

      setProfile({
        name: data.name || "",
        postcode: data.postcode || "",
        skillBand: derivedBand || "",
        rating: typeof ratingNumber === "number" ? ratingNumber : "",
        bio: data.bio || "",
        photoURL: data.photoURL || "",
        badges: normalizeBadges(data.badges),
        birthYear: typeof privateData.birthYear === "number" ? privateData.birthYear : "",
        gender: typeof data.gender === "string" ? data.gender : "",
        availability: normalizeAvailability(data.availability),
        memberSince: data.memberSince || "", // optional if you store it
      });

      // ✅ Matches = accepted OR confirmed OR completed match requests
      const requestStatusesToCount = ["accepted", "confirmed", "completed"];

      const requestSnaps = await Promise.all(
        requestStatusesToCount.flatMap((status) => [
          logFirestoreCall(`getDocs match_requests fromUserId=${u.uid} status=${status}`, () =>
            getDocs(
              query(
                collection(db, "match_requests"),
                where("fromUserId", "==", u.uid),
                where("status", "==", status)
              )
            )
          ),
          logFirestoreCall(`getDocs match_requests toUserId=${u.uid} status=${status}`, () =>
            getDocs(
              query(
                collection(db, "match_requests"),
                where("toUserId", "==", u.uid),
                where("status", "==", status)
              )
            )
          ),
        ])
      );

      const acceptedRequestIds = new Set<string>();
      requestSnaps.forEach((snap) => {
        snap.forEach((docSnap) => acceptedRequestIds.add(docSnap.id));
      });

      const acceptedMatches = acceptedRequestIds.size;

      // ✅ Completed + Wins + badge derivation from match_history
      const historyQ = query(
        collection(db, "match_history"),
        where("players", "array-contains", u.uid)
      );
      const historySnap = await logFirestoreCall(
        `getDocs match_history players array-contains ${u.uid}`,
        () => getDocs(historyQ)
      );

      let completed = 0;
      let wins = 0;
      let hasLoveHold = false;

      historySnap.forEach((d) => {
        const m = d.data() as any;

        const isCompleted =
          m.completed === true ||
          m.status === "completed";

        if (isCompleted) {
          completed++;
        }

        const isWin =
          m.winnerId === u.uid ||
          (Array.isArray(m.winnerIds) && m.winnerIds.includes(u.uid)) ||
          (Array.isArray(m.completedByWinner) && m.completedByWinner.includes(u.uid));

        if (isWin) {
          wins++;
        }

        if (isWin && Array.isArray(m.sets)) {
          const wonWithBagel = m.sets.some((s: any) => {
            const a = typeof s?.A === "number" ? s.A : null;
            const b = typeof s?.B === "number" ? s.B : null;
            if (a == null || b == null) return false;
            return (a === 6 && b === 0) || (a === 0 && b === 6);
          });

          if (wonWithBagel) {
            hasLoveHold = true;
          }
        }
      });

      setMatchStats({
        matches: acceptedMatches,
        completed,
        wins,
      });

      // ✅ Derive + normalize badges
      const existingBadges = normalizeBadges(data.badges);
      const earnedBadges: string[] = [];

      if (acceptedMatches >= 1) earnedBadges.push("firstMatch");
      if (completed >= 1) earnedBadges.push("firstMatchComplete");
      if (wins >= 1) earnedBadges.push("firstWin");
      if (hasLoveHold) earnedBadges.push("loveHold");

      const mergedBadges = Array.from(new Set([...existingBadges, ...earnedBadges]));

      if (!arraysEqualUnordered(existingBadges, mergedBadges)) {
        await logFirestoreCall(`setDoc players/${u.uid} badges merge`, () =>
          setDoc(doc(db, "players", u.uid), { badges: mergedBadges }, { merge: true })
        );
      }

      setProfile((prev) => ({
        ...prev,
        badges: mergedBadges,
      }));

      setLoading(false);
    });

    return () => unsub();
  }, []);

    const handleDeleteAccount = async () => {
  setDeleteError(null);

  const ok1 = window.confirm(
    "Delete your TennisMate account?\n\nThis will permanently remove your profile and data. This cannot be undone."
  );
  if (!ok1) return;

  const uid = auth.currentUser?.uid;
  if (!uid) {
    setDeleteError("You must be signed in to delete your account.");
    return;
  }

  try {
    setDeletingAccount(true);

    // best-effort storage cleanup (same as ProfileContent)
    await deleteObject(ref(storage, PROFILE_FULL_PATH(uid))).catch(() => {});
    await deleteObject(ref(storage, PROFILE_THUMB_PATH(uid))).catch(() => {});
    await cleanupLegacyProfilePhotos(storage, uid);

    // ✅ IMPORTANT: use the existing callable
    const fn = httpsCallable(getFunctionsClient(), "deleteMyAccount");
    await fn();

    await auth.signOut();
    router.replace("/");
  } catch (err: any) {
    console.error("[DesktopProfilePage] delete FAILED", err);

    const details = err?.details;
    setDeleteError(
      `❌ Delete failed${details?.runId ? ` (ref ${details.runId})` : ""}`
    );
  } finally {
    setDeletingAccount(false);
  }
};


  if (loading) {
    return (
    <div className="min-h-screen w-full" style={{ background: TM.cream }}>
  {/* Full width page padding */}
  <div className="w-full px-8 py-6 2xl:px-12">
    {/* 3-column desktop layout */}
   <div className="grid grid-cols-[300px_minmax(0,1fr)_340px] gap-6 items-start">
      
  {/* LEFT: Sidebar pinned left */}
<aside className="sticky top-6 h-[calc(100vh-48px)]">
<TMDesktopSidebar active="Profile" />

</aside>


      {/* MIDDLE: fills remaining space */}
      <main className="min-w-0">
        {/* ... keep your existing middle content exactly the same ... */}
      </main>

      {/* RIGHT: Profile card pinned right */}
      <aside className="sticky top-6 h-[calc(100vh-48px)]">
        {/* ... keep your existing right card exactly the same ... */}
      </aside>

    </div>
  </div>
</div>

    );
  }

return (
  <div className="min-h-screen w-full" style={{ background: TM.cream }}>
    {/* Full width page padding */}
    <div className="w-full px-8 py-6 2xl:px-12">
      {/* 3-column desktop layout */}
     <div className="grid grid-cols-[300px_minmax(0,1fr)_340px] gap-6 items-start">

        {/* LEFT: Desktop Sidebar pinned left */}
<aside className="sticky top-6 self-start">
  <TMDesktopSidebar active="Profile" />
</aside>


        {/* MIDDLE: Main content */}
        <main className="min-w-0">
          {/* ✅ MOVE ALL YOUR EXISTING MIDDLE CONTENT HERE */}
    {/* Header row */}
<div>
  <div className="text-2xl font-black" style={{ color: TM.forest }}>
    My Profile
  </div>
  <div className="text-sm font-semibold" style={{ color: "rgba(11,61,46,0.55)" }}>
    Keep your details up to date for better matches.
  </div>
</div>


            {/* Personal intro (maps to Bio) */}
            <section
              className="mt-5 rounded-2xl border p-5"
              style={{ background: TM.tile, borderColor: TM.border }}
            >
              <div className="flex items-center gap-2">
                <div
                  className="h-8 w-8 rounded-xl grid place-items-center"
                  style={{ background: "rgba(57,255,20,0.16)", color: TM.forest }}
                >
                  <CheckCircle2 size={18} />
                </div>
                <div className="text-sm font-black" style={{ color: TM.forest }}>
                  Personal Introduction
                </div>
              </div>

              <div className="mt-3 rounded-xl p-4" style={{ background: "rgba(11,61,46,0.04)" }}>
                <p className="text-sm leading-relaxed" style={{ color: "rgba(11,61,46,0.75)" }}>
                  {profile.bio || "Add a short bio so other players know your style and what you're looking for."}
                </p>
              </div>
            </section>

            {/* Performance stats */}
            <section className="mt-6">
              <div className="flex items-center justify-between">
                <div className="text-base font-black" style={{ color: TM.forest }}>
                  Performance Stats
                </div>
              </div>

              <div className="mt-3 grid grid-cols-1 md:grid-cols-3 gap-4">
        <StatCard title="Matches Accepted" value={matchStats.matches ?? 0} icon={<CheckCircle2 size={18} />} />
<StatCard title="Completed" value={matchStats.completed ?? 0} icon={<CalendarDays size={18} />} />
<StatCard title="Wins" value={matchStats.wins ?? 0} icon={<Trophy size={18} />} />

              </div>
            </section>

            {/* Availability */}
<section
  className="mt-6 rounded-2xl border p-5"
  style={{ background: TM.tile, borderColor: TM.border }}
>
  <div className="flex items-center justify-between">
    <div className="flex items-center gap-2">
      <div
        className="h-8 w-8 rounded-xl grid place-items-center"
        style={{ background: "rgba(57,255,20,0.16)", color: TM.forest }}
      >
        <CalendarDays size={18} />
      </div>
      <div className="text-sm font-black" style={{ color: TM.forest }}>
        Availability
      </div>
    </div>

    <button
      type="button"
      onClick={() => router.push("/profile?edit=true")}
      className="text-xs font-extrabold"
      style={{ color: TM.neon }}
    >
      MANAGE SLOTS
    </button>
  </div>

  <div className="mt-4 flex flex-wrap gap-3">
    {AVAILABILITY_OPTIONS.map((slot) => {
      const on = profile.availability.includes(slot);

      return (
        <span
          key={slot}
          className="rounded-full px-4 py-2 text-sm font-extrabold border"
          style={{
            background: on ? TM.neon : "rgba(11,61,46,0.04)",
            color: on ? TM.forest : "rgba(11,61,46,0.55)",
            borderColor: on ? "rgba(57,255,20,0.55)" : "rgba(11,61,46,0.10)",
          }}
          title={on ? "Available" : "Not selected"}
        >
          {slot}
        </span>
      );
    })}

    {profile.availability.length === 0 && (
      <div className="text-sm font-semibold" style={{ color: "rgba(11,61,46,0.55)" }}>
        No availability selected yet.
      </div>
    )}
  </div>
</section>


           {/* Achievements */}
<section
  className="mt-6 rounded-2xl border p-5"
  style={{ background: TM.tile, borderColor: TM.border }}
>
  <div className="flex items-center justify-between">
    <div className="text-base font-black" style={{ color: TM.forest }}>
      My Achievements
    </div>

    <button
      type="button"
      onClick={() => router.push("/badges")}
      className="text-xs font-extrabold"
      style={{ color: TM.neon }}
    >
      View All
    </button>
  </div>

  <div className="mt-5 grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-4">
    {BADGE_CATALOG.map((badge) => {
      const unlocked = safeBadges.includes(badge.id);

      return (
        <div key={badge.id} className="flex flex-col items-center justify-center">
          <div
            className="h-12 w-12 rounded-full grid place-items-center border overflow-hidden"
            style={{
              background: unlocked
                ? "rgba(57,255,20,0.14)"
                : "rgba(0,0,0,0.03)",
              borderColor: unlocked
                ? "rgba(57,255,20,0.35)"
                : "rgba(0,0,0,0.08)",
            }}
            title={unlocked ? "Unlocked" : "Locked"}
          >
            <Image
              src={unlocked ? badge.icon : badge.iconLocked}
              alt={badge.title}
              width={28}
              height={28}
              className={unlocked ? "" : "opacity-40"}
            />
          </div>

          <div className="mt-2 text-xs font-extrabold" style={{ color: TM.forest }}>
            {badge.title}
          </div>
          <div className="text-[11px] font-semibold" style={{ color: "rgba(11,61,46,0.55)" }}>
  {unlocked ? "Unlocked" : "Locked"}
</div>
        </div>
      );
    })}
  </div>
</section>

          </main>

          {/* RIGHT: Profile card (image section on the right) */}
          <aside className="w-[340px] shrink-0">
            <div
              className="rounded-3xl border p-6"
              style={{ background: TM.tile, borderColor: TM.border }}
            >
              {/* Avatar */}
              <div className="relative mx-auto h-[220px] w-full overflow-hidden rounded-2xl border"
                style={{ borderColor: TM.border, background: "rgba(11,61,46,0.03)" }}
              >
                <Image
                  src={profile.photoURL || "/default-avatar.png"}
                  alt={`${profile.name || "Player"} avatar`}
                  fill
                  className="object-cover"
                  sizes="340px"
                />

                <button
                  type="button"
                  onClick={() => router.push("/profile?edit=true")}
                  className="absolute bottom-3 right-3 h-10 w-10 rounded-xl grid place-items-center shadow"
                  style={{ background: TM.neon, color: TM.forest }}
                  aria-label="Edit photo"
                  title="Edit photo"
                >
                  <Edit2 size={18} />
                </button>
              </div>

              {/* Name */}
              <div className="mt-5">
                <div className="text-2xl font-black leading-tight" style={{ color: TM.forest }}>
                  {profile.name || "Your Name"}
                </div>
                <div className="mt-1 text-xs font-semibold" style={{ color: "rgba(11,61,46,0.55)" }}>
                  {profile.memberSince ? `Member since ${profile.memberSince}` : "Member"}
                </div>
              </div>

              {/* Key info list */}
              <div className="mt-5 space-y-3">
                <div className="flex items-center justify-between text-sm">
                  <span className="font-semibold" style={{ color: "rgba(11,61,46,0.60)" }}>
                    Skill Level
                  </span>
                  <span
                    className="rounded-full px-3 py-1 text-xs font-extrabold"
                    style={{ background: "rgba(57,255,20,0.16)", color: TM.forest }}
                  >
                    {toSkillLabel(profile.skillBand)}
                  </span>
                </div>

                <div className="flex items-center justify-between text-sm">
                  <span className="font-semibold" style={{ color: "rgba(11,61,46,0.60)" }}>
                    TMR Rating
                  </span>
                  <span className="font-black" style={{ color: TM.forest }}>
                    {typeof profile.rating === "number" ? profile.rating.toFixed(1) : "—"}
                  </span>
                </div>

                <div className="flex items-center justify-between text-sm">
                  <span className="font-semibold" style={{ color: "rgba(11,61,46,0.60)" }}>
                    Postcode
                  </span>
                  <span className="font-black" style={{ color: TM.forest }}>
                    {profile.postcode || "—"}
                  </span>
                </div>

                <div className="flex items-center justify-between text-sm">
                  <span className="font-semibold" style={{ color: "rgba(11,61,46,0.60)" }}>
                    Age
                  </span>
                  <span className="font-black" style={{ color: TM.forest }}>
                    {typeof derivedAge === "number" ? derivedAge : "—"}
                  </span>
                </div>

                <div className="flex items-center justify-between text-sm">
                  <span className="font-semibold" style={{ color: "rgba(11,61,46,0.60)" }}>
                    Gender
                  </span>
                  <span className="font-black" style={{ color: TM.forest }}>
                    {profile.gender || "—"}
                  </span>
                </div>
              </div>

              {/* Verified profile box (visual only) */}
              <div
                className="mt-6 rounded-2xl border p-4"
                style={{
                  background: "rgba(57,255,20,0.10)",
                  borderColor: "rgba(57,255,20,0.30)",
                }}
              >
                <div className="flex items-center gap-2">
                  <div
                    className="h-8 w-8 rounded-xl grid place-items-center"
                    style={{ background: TM.forest, color: TM.neon }}
                  >
                    ✓
                  </div>
                  <div className="min-w-0">
                    <div className="text-sm font-black" style={{ color: TM.forest }}>
                      Verified Profile
                    </div>
                    <div className="mt-1 text-[11px] font-semibold" style={{ color: "rgba(11,61,46,0.65)" }}>
                      Your account is set up and ready for matching.
                    </div>
                  </div>
                </div>
              </div>

              {/* Quick CTA */}
              <button
                type="button"
                onClick={() => router.push("/profile?edit=true")}
                className="mt-6 w-full rounded-2xl py-3 font-extrabold shadow"
                style={{ background: TM.neon, color: TM.forest }}
              >
                Update Profile
              </button>

              {isEditing && (
  <div className="mt-4">
    <button
      type="button"
      onClick={handleDeleteAccount}
      disabled={deletingAccount}
      className="w-full rounded-2xl py-3 font-extrabold border"
      style={{
        background: "rgba(239, 68, 68, 0.10)", // soft red
        borderColor: "rgba(239, 68, 68, 0.35)",
        color: "rgb(185, 28, 28)",
        opacity: deletingAccount ? 0.7 : 1,
        cursor: deletingAccount ? "not-allowed" : "pointer",
      }}
    >
      {deletingAccount ? "Deleting…" : "Delete account"}
    </button>

    {deleteError && (
      <div
        className="mt-3 rounded-xl border px-3 py-2 text-sm font-semibold"
        style={{
          background: "rgba(239, 68, 68, 0.08)",
          borderColor: "rgba(239, 68, 68, 0.25)",
          color: "rgb(185, 28, 28)",
        }}
      >
        {deleteError}
      </div>
    )}

    <div className="mt-2 text-[11px] font-semibold" style={{ color: "rgba(11,61,46,0.55)" }}>
      This permanently removes your account and data. This can’t be undone.
    </div>
  </div>
)}

            </div>
          </aside>
        </div>
      </div>
    </div>
  );
}
