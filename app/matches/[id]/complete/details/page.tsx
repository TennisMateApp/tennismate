"use client";

import { useParams, useSearchParams, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { db } from "@/lib/firebase";
import { doc, getDoc, updateDoc, setDoc, serverTimestamp } from "firebase/firestore";
import Image from "next/image";
import withAuth from "@/components/withAuth";
import { ComponentType } from "react";
import { GiTennisBall } from "react-icons/gi";
import ClientLayoutWrapper from "@/components/ClientLayoutWrapper";

type Player = { id: string; name?: string; photoURL?: string };

type SetScore = {
  A: number | null;
  B: number | null;
  tieBreakA?: number | null;
  tieBreakB?: number | null;
};

const EMPTY_SET: SetScore = { A: null, B: null, tieBreakA: null, tieBreakB: null };

const clampGame = (n: number | null) =>
  n == null || Number.isNaN(n) ? null : Math.max(0, Math.min(7, Math.round(n)));

const isTBNeeded = (s: SetScore) =>
  (s.A === 6 && s.B === 6) ||
  (s.A === 7 && s.B === 6) ||
  (s.A === 6 && s.B === 7);

function formatScoreline(sets: SetScore[]): string {
  return sets
    .filter(s => s.A != null && s.B != null)
    .map(s => {
      const base = `${s.A}-${s.B}`;
      const a = s.tieBreakA ?? null;
      const b = s.tieBreakB ?? null;
      if ((s.A === 7 && s.B === 6 && a != null) || (s.A === 6 && s.B === 7 && b != null)) {
        const tb = s.A === 7 ? a : b;
        return `${base}(${tb})`;
      }
      return base;
    })
    .join(", ");
}

function computeWinner(sets: SetScore[], A?: Player | null, B?: Player | null): string | null {
  let wa = 0, wb = 0;
  sets.forEach(s => {
    if (s.A == null || s.B == null) return;
    if (s.A > s.B) wa++; else if (s.B > s.A) wb++;
  });
  if (wa === wb) return null;
  return wa > wb ? (A?.id ?? null) : (B?.id ?? null);
}

// --- Small row component (no quick picks) ---
function SetRow({
  idx,
  label,
  value,
  aName,
  bName,
  onChange,
}: {
  idx: number;
  label: string;
  value: SetScore;
  aName: string;
  bName: string;
  onChange: (v: SetScore) => void;
}) {
  const showTB = isTBNeeded(value);

const scoreBtn =
  "h-9 w-9 rounded-lg border border-gray-200 bg-white text-sm font-bold text-gray-700 shadow-sm active:scale-[0.98]";
const scoreInput =
  "h-9 w-11 rounded-lg border border-gray-200 bg-[#F7F8FA] text-center text-sm font-bold text-[#0B3D2E] outline-none";

  return (
   <div className="border-t border-gray-100 first:border-t-0 py-4">
      <div className="grid grid-cols-[44px_1fr_1fr] gap-3 items-start">
        <div className="pt-2 text-xs font-extrabold uppercase tracking-wide text-gray-400">
          S{idx + 1}
        </div>

        {/* Player A */}
        <div className="min-w-0">
          <div className="flex items-center justify-center gap-1">
            <button
              type="button"
              onClick={() => onChange({ ...value, A: clampGame((value.A ?? 0) - 1) })}
              className={scoreBtn}
              aria-label={`Decrease ${aName} games in ${label}`}
            >
              −
            </button>

            <input
              type="number"
              inputMode="numeric"
              min={0}
              max={7}
              className={scoreInput}
              value={value.A ?? ""}
              onChange={(e) => onChange({ ...value, A: clampGame(Number(e.target.value)) })}
              aria-label={`${label} — ${aName} games`}
            />

            <button
              type="button"
              onClick={() => onChange({ ...value, A: clampGame((value.A ?? 0) + 1) })}
              className={scoreBtn}
              aria-label={`Increase ${aName} games in ${label}`}
            >
              +
            </button>
          </div>

          {showTB && (
            <div className="mt-2 flex justify-center">
              <input
                type="number"
                inputMode="numeric"
                min={0}
                className="h-8 w-14 rounded-md border border-gray-200 bg-white px-2 text-center text-xs font-semibold text-gray-700 outline-none"
                placeholder="TB"
                value={value.tieBreakA ?? ""}
                onChange={(e) =>
                  onChange({
                    ...value,
                    tieBreakA: Math.max(0, Number(e.target.value) || 0),
                  })
                }
                aria-label={`${label} — tiebreak points for ${aName}`}
              />
            </div>
          )}
        </div>

        {/* Player B */}
        <div className="min-w-0">
          <div className="flex items-center justify-center gap-1">
            <button
              type="button"
              onClick={() => onChange({ ...value, B: clampGame((value.B ?? 0) - 1) })}
              className={scoreBtn}
              aria-label={`Decrease ${bName} games in ${label}`}
            >
              −
            </button>

            <input
              type="number"
              inputMode="numeric"
              min={0}
              max={7}
              className={scoreInput}
              value={value.B ?? ""}
              onChange={(e) => onChange({ ...value, B: clampGame(Number(e.target.value)) })}
              aria-label={`${label} — ${bName} games`}
            />

            <button
              type="button"
              onClick={() => onChange({ ...value, B: clampGame((value.B ?? 0) + 1) })}
              className={scoreBtn}
              aria-label={`Increase ${bName} games in ${label}`}
            >
              +
            </button>
          </div>

          {showTB && (
            <div className="mt-2 flex justify-center">
              <input
                type="number"
                inputMode="numeric"
                min={0}
                className="h-8 w-14 rounded-md border border-gray-200 bg-white px-2 text-center text-xs font-semibold text-gray-700 outline-none"
                placeholder="TB"
                value={value.tieBreakB ?? ""}
                onChange={(e) =>
                  onChange({
                    ...value,
                    tieBreakB: Math.max(0, Number(e.target.value) || 0),
                  })
                }
                aria-label={`${label} — tiebreak points for ${bName}`}
              />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}


function MatchDetailsForm() {
  const { id: matchId } = useParams();
  const searchParams = useSearchParams();
const type = searchParams.get("type");
const fromInvite = searchParams.get("fromInvite");
  const router = useRouter();

const [playerA, setPlayerA] = useState<Player | null>(null);
const [playerB, setPlayerB] = useState<Player | null>(null);
const [sets, setSets] = useState<SetScore[]>([{ ...EMPTY_SET }, { ...EMPTY_SET }, { ...EMPTY_SET }]);
const [loading, setLoading] = useState(true);

const [livePoints, setLivePoints] = useState("");
const [tiebreakMode, setTiebreakMode] = useState(false);
const [matchComments, setMatchComments] = useState("");

  // If opened from an invite overlay/page, we keep the same match save flow
// and only store invite metadata for traceability.

  // Prefill players and any existing compact set scores
  useEffect(() => {
    (async () => {
      try {
        const matchRef = doc(db, "match_requests", matchId as string);
        const matchSnap = await getDoc(matchRef);
        if (!matchSnap.exists()) return;

        const match = matchSnap.data() as any;
        const [aSnap, bSnap] = await Promise.all([
          getDoc(doc(db, "players", match.fromUserId)),
          getDoc(doc(db, "players", match.toUserId)),
        ]);

        setPlayerA({ id: match.fromUserId, ...(aSnap.data() as any) });
        setPlayerB({ id: match.toUserId, ...(bSnap.data() as any) });

        const scoreSnap = await getDoc(doc(db, "match_scores", matchId as string));
      if (scoreSnap.exists()) {
  const d = scoreSnap.data() as any;

  const existing: SetScore[] = (d.sets || []).slice(0, 3).map((s: any) => ({
    A: typeof s?.A === "number" ? s.A : null,
    B: typeof s?.B === "number" ? s.B : null,
    tieBreakA: typeof s?.tieBreakA === "number" ? s.tieBreakA : null,
    tieBreakB: typeof s?.tieBreakB === "number" ? s.tieBreakB : null,
  }));

  while (existing.length < 3) existing.push({ ...EMPTY_SET });
  setSets(existing);

  setLivePoints(typeof d.livePoints === "string" ? d.livePoints : "");
  setTiebreakMode(d.tiebreakMode === true);
  setMatchComments(typeof d.matchComments === "string" ? d.matchComments : "");
}
      } finally {
        setLoading(false);
      }
    })();
  }, [matchId]);

  const handleSubmit = async () => {
    if (!playerA || !playerB) return;

    const clean = sets.filter(s => s.A != null && s.B != null) as Required<SetScore>[];
    if (clean.length === 0) {
      alert("Please enter at least one set score.");
      return;
    }

    for (const [i, s] of clean.entries()) {
      const a = s.A!, b = s.B!;
      const max = Math.max(a, b), min = Math.min(a, b);
      const isTB = (max === 7 && min === 6);
      const twoClearIf6 = (max >= 6 && max - min >= 2 && max <= 7); // 6-0..6-4 or 7-5
      if (!(isTB || twoClearIf6)) {
        alert(`Set ${i + 1} looks off. Typical scores are 6-0..6-4, 7-5, or 7-6 with a tiebreak value.`);
        return;
      }
    }

    const scoreText = formatScoreline(clean);
    const winnerId = computeWinner(clean, playerA, playerB);

const cleanedSets = clean.map(s => ({
  A: s.A,
  B: s.B,
  ...(s.tieBreakA != null ? { tieBreakA: s.tieBreakA } : {}),
  ...(s.tieBreakB != null ? { tieBreakB: s.tieBreakB } : {}),
}));

await setDoc(
  doc(db, "match_scores", matchId as string),
  {
    players: [playerA.id, playerB.id],
    ...(fromInvite ? { inviteId: fromInvite } : {}),
    livePoints,
    tiebreakMode,
    matchComments,
    sets: cleanedSets,
    updatedAt: serverTimestamp(),
  },
  { merge: true }
);

await updateDoc(doc(db, "match_requests", matchId as string), {
  matchType: type,
  score: scoreText,
  completed: true,
  status: "completed",
  winnerId,
  ...(fromInvite ? { inviteId: fromInvite, completedFrom: "invite" } : {}),
});

// ✅ CREATE / UPDATE MATCH HISTORY
await setDoc(
  doc(db, "match_history", matchId as string),
  {
    matchRequestId: matchId,
    players: [playerA.id, playerB.id],
    fromUserId: playerA.id,
    toUserId: playerB.id,
    fromName: playerA.name ?? null,
    toName: playerB.name ?? null,
    fromPhotoURL: playerA.photoURL ?? null,
    toPhotoURL: playerB.photoURL ?? null,
    matchType: type ?? null,
    score: scoreText,
    sets: cleanedSets,
    livePoints,
    tiebreakMode,
    matchComments,
    completed: true,
    status: "completed",
    winnerId: winnerId ?? null,
    completedAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
    ...(fromInvite ? { inviteId: fromInvite, completedFrom: "invite" } : {}),
  },
  { merge: true }
);

    // Love-hold badge if any 6–0
    if (clean.some(s => (s.A === 6 && s.B === 0) || (s.B === 6 && s.A === 0))) {
      if (winnerId) {
        await setDoc(doc(db, "players", winnerId), { badges: { loveHold: true } }, { merge: true });
      }
    }

    router.push(
  fromInvite
    ? `/matches/${matchId}/summary?fromInvite=${fromInvite}`
    : `/matches/${matchId}/summary`
);
  };

if (loading || !playerA || !playerB) {
  return <div className="p-6 text-center">Loading…</div>;
}

return (
  <div className="min-h-screen bg-[#F3F4F6]">
    <div className="mx-auto max-w-md px-3 pt-3 pb-36">
      {/* Top bar */}
      <div className="mb-3 flex items-center justify-between">
        <button
          type="button"
          onClick={() => router.back()}
          className="h-9 w-9 rounded-full bg-white shadow-sm border border-gray-200 grid place-items-center"
          aria-label="Back"
        >
          ←
        </button>

        <div className="text-sm font-extrabold text-[#0B3D2E]">
          Score Tracker
        </div>

        <button
          type="button"
          className="h-9 w-9 rounded-full bg-white shadow-sm border border-gray-200 grid place-items-center"
          aria-label="Settings"
        >
          ⚙
        </button>
      </div>

      {/* Hero players card */}
      <div className="rounded-3xl bg-[#EFEFE8] px-4 py-5 shadow-sm border border-black/5">
        <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-3">
          {/* Player A */}
          <div className="flex flex-col items-center text-center">
            <div className="relative h-14 w-14 overflow-hidden rounded-full border-2 border-white shadow">
              <Image
                src={playerA.photoURL || "/images/default-avatar.jpg"}
                alt={playerA.name || "Player A"}
                fill
                sizes="56px"
                className="object-cover"
              />
            </div>
            <div className="mt-2 text-[12px] font-extrabold text-[#0B3D2E]">
              {playerA.name || "Player A"}
            </div>
            <div className="text-[10px] font-bold uppercase tracking-wide text-gray-400">
              Player 1
            </div>
          </div>

          {/* VS */}
          <div className="text-center">
            <div className="text-sm font-black uppercase tracking-widest text-[#4CD600]">
              VS
            </div>
          </div>

          {/* Player B */}
          <div className="flex flex-col items-center text-center">
            <div className="relative h-14 w-14 overflow-hidden rounded-full border-2 border-white shadow">
              <Image
                src={playerB.photoURL || "/images/default-avatar.jpg"}
                alt={playerB.name || "Player B"}
                fill
                sizes="56px"
                className="object-cover"
              />
            </div>
            <div className="mt-2 text-[12px] font-extrabold text-[#0B3D2E]">
              {playerB.name || "Player B"}
            </div>
            <div className="text-[10px] font-bold uppercase tracking-wide text-gray-400">
              Player 2
            </div>
          </div>
        </div>

        {/* Live game points + set */}
        <div className="mt-4 rounded-2xl bg-white/70 p-3 border border-black/5">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-[10px] font-extrabold uppercase tracking-wide text-gray-400">
                Live Game Points
              </div>
              <input
                type="text"
                value={livePoints}
                onChange={(e) => setLivePoints(e.target.value)}
                placeholder="e.g. 15-30"
                className="mt-1 w-28 border-0 bg-transparent p-0 text-sm font-bold text-[#0B3D2E] outline-none"
              />
            </div>

            <div className="rounded-full bg-[#E9F9D8] px-3 py-1 text-[10px] font-extrabold uppercase text-[#0B3D2E]">
              Best 3
            </div>
          </div>

          <div className="mt-3 flex items-center justify-between">
            <div>
              <div className="text-[10px] font-extrabold uppercase tracking-wide text-gray-400">
                Tiebreak Mode
              </div>
              <div className="text-[10px] text-gray-500">
                Great for 10-point finals
              </div>
            </div>

            <button
              type="button"
              onClick={() => setTiebreakMode((prev) => !prev)}
              className={[
                "relative h-7 w-12 rounded-full transition",
                tiebreakMode ? "bg-[#4CD600]" : "bg-gray-200",
              ].join(" ")}
              aria-pressed={tiebreakMode}
            >
              <span
                className={[
                  "absolute top-1 h-5 w-5 rounded-full bg-white transition",
                  tiebreakMode ? "left-6" : "left-1",
                ].join(" ")}
              />
            </button>
          </div>
        </div>
      </div>

{/* Set summary card */}
<div className="mt-4 rounded-3xl bg-white p-4 shadow-sm border border-black/5">
  <div className="mb-3 text-[11px] font-extrabold uppercase tracking-wide text-gray-400">
    Set Summary
  </div>

  {/* Header row */}
  <div className="grid grid-cols-[52px_1fr_1fr] gap-3 items-center pb-2 border-b border-gray-100">
    <div className="text-[10px] font-extrabold uppercase tracking-wide text-gray-400">
      Set
    </div>

    <div className="flex items-center justify-center gap-2 min-w-0">
      {playerA?.photoURL ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={playerA.photoURL} alt="" className="h-5 w-5 rounded-full" />
      ) : (
        <span className="h-5 w-5 rounded-full bg-gray-200 inline-block" />
      )}
      <span className="truncate text-[11px] font-bold text-[#0B3D2E]">
        {playerA?.name || "Player A"}
      </span>
    </div>

    <div className="flex items-center justify-center gap-2 min-w-0">
      {playerB?.photoURL ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={playerB.photoURL} alt="" className="h-5 w-5 rounded-full" />
      ) : (
        <span className="h-5 w-5 rounded-full bg-gray-200 inline-block" />
      )}
      <span className="truncate text-[11px] font-bold text-[#0B3D2E]">
        {playerB?.name || "Player B"}
      </span>
    </div>
  </div>

  {/* Per-set controls */}
  <div className="mt-1">
    {[0, 1, 2].map((i) => (
      <SetRow
        key={i}
        idx={i}
        label={`Set ${i + 1}`}
        value={sets[i]}
        aName={playerA?.name || "Player A"}
        bName={playerB?.name || "Player B"}
        onChange={(v) =>
          setSets((prev) => {
            const next = [...prev];
            next[i] = v;
            return next;
          })
        }
      />
    ))}
  </div>
</div>

      {/* Match comments */}
      <div className="mt-4 rounded-3xl bg-white p-4 shadow-sm border border-black/5">
        <div className="mb-2 text-[11px] font-extrabold uppercase tracking-wide text-gray-400">
          Match Comments
        </div>
        <textarea
          rows={4}
          value={matchComments}
          onChange={(e) => setMatchComments(e.target.value)}
          placeholder="Enter game notes, strategies or highlights..."
          className="w-full rounded-2xl border border-gray-200 bg-[#F7F8FA] px-3 py-3 text-sm outline-none resize-none"
        />
      </div>

      {/* Bottom actions */}
      <div
        className="fixed inset-x-0 z-50 mx-auto max-w-md px-3"
        style={{ bottom: "max(16px, env(safe-area-inset-bottom))" }}
      >
        <div className="space-y-2 rounded-3xl bg-white/85 p-3 backdrop-blur-md">
          <button
            onClick={handleSubmit}
            className="w-full rounded-2xl bg-[#4CD600] px-4 py-3 text-sm font-extrabold text-[#0B3D2E] shadow"
          >
            🏆 Match Complete
          </button>

          <button
            type="button"
            className="w-full rounded-2xl bg-[#E5E7EB] px-4 py-3 text-sm font-bold text-[#475569]"
          >
            ↻ Undo Last Point
          </button>
        </div>
      </div>
    </div>
  </div>
);
}

// keep HOC
const AuthenticatedComponent: ComponentType = withAuth(MatchDetailsForm);
export default AuthenticatedComponent;
