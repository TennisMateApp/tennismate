"use client";

import { useParams, useSearchParams, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { db } from "@/lib/firebase";
import { doc, getDoc, updateDoc, setDoc, serverTimestamp } from "firebase/firestore";
import Image from "next/image";
import withAuth from "@/components/withAuth";
import { ComponentType } from "react";
import { GiTennisBall } from "react-icons/gi";

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
  (s.A === 7 && s.B === 6) || (s.A === 6 && s.B === 7);

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
  return (
    <div className="grid grid-cols-[auto,1fr,1fr,auto] items-center gap-2 py-2 border-t first:border-t-0">
      <div className="text-sm text-gray-700 w-16">{label}</div>

      {/* Player A games */}
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => onChange({ ...value, A: clampGame((value.A ?? 0) - 1) })}
          className="h-10 w-8 rounded-md border"
          aria-label={`Decrease ${aName} games in ${label}`}
        >−</button>
        <input
          type="number"
          inputMode="numeric"
          min={0}
          max={7}
          className="h-10 w-full rounded-md border px-3 text-sm"
          placeholder={`${aName} games`}
          value={value.A ?? ""}
          onChange={(e) => onChange({ ...value, A: clampGame(Number(e.target.value)) })}
          aria-label={`${label} — ${aName} games`}
        />
        <button
          type="button"
          onClick={() => onChange({ ...value, A: clampGame((value.A ?? 0) + 1) })}
          className="h-10 w-8 rounded-md border"
          aria-label={`Increase ${aName} games in ${label}`}
        >+</button>
      </div>

      {/* Player B games */}
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => onChange({ ...value, B: clampGame((value.B ?? 0) - 1) })}
          className="h-10 w-8 rounded-md border"
          aria-label={`Decrease ${bName} games in ${label}`}
        >−</button>
        <input
          type="number"
          inputMode="numeric"
          min={0}
          max={7}
          className="h-10 w-full rounded-md border px-3 text-sm"
          placeholder={`${bName} games`}
          value={value.B ?? ""}
          onChange={(e) => onChange({ ...value, B: clampGame(Number(e.target.value)) })}
          aria-label={`${label} — ${bName} games`}
        />
        <button
          type="button"
          onClick={() => onChange({ ...value, B: clampGame((value.B ?? 0) + 1) })}
          className="h-10 w-8 rounded-md border"
          aria-label={`Increase ${bName} games in ${label}`}
        >+</button>
      </div>

      {/* Tiebreak (only when needed) */}
      <div className="flex items-center gap-1">
        {showTB && (
          <>
            <input
              type="number"
              inputMode="numeric"
              min={0}
              className="h-9 w-14 rounded-md border px-2 text-xs"
              placeholder={`TB ${aName.split(" ")[0] || "A"}`}
              value={value.tieBreakA ?? ""}
              onChange={(e) =>
                onChange({ ...value, tieBreakA: Math.max(0, Number(e.target.value) || 0) })
              }
              aria-label={`${label} — tiebreak points for ${aName}`}
            />
            <span className="text-gray-400">/</span>
            <input
              type="number"
              inputMode="numeric"
              min={0}
              className="h-9 w-14 rounded-md border px-2 text-xs"
              placeholder={`TB ${bName.split(" ")[0] || "B"}`}
              value={value.tieBreakB ?? ""}
              onChange={(e) =>
                onChange({ ...value, tieBreakB: Math.max(0, Number(e.target.value) || 0) })
              }
              aria-label={`${label} — tiebreak points for ${bName}`}
            />
          </>
        )}
      </div>
    </div>
  );
}


function MatchDetailsForm() {
  const { id: matchId } = useParams();
  const type = useSearchParams().get("type");
  const router = useRouter();

  const [playerA, setPlayerA] = useState<Player | null>(null);
  const [playerB, setPlayerB] = useState<Player | null>(null);
  const [sets, setSets] = useState<SetScore[]>([{ ...EMPTY_SET }, { ...EMPTY_SET }, { ...EMPTY_SET }]);
  const [loading, setLoading] = useState(true);

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

    await setDoc(
      doc(db, "match_scores", matchId as string),
      {
        players: [playerA.id, playerB.id],
        sets: clean.map(s => ({
          A: s.A, B: s.B,
          ...(s.tieBreakA != null ? { tieBreakA: s.tieBreakA } : {}),
          ...(s.tieBreakB != null ? { tieBreakB: s.tieBreakB } : {}),
        })),
        updatedAt: serverTimestamp(),
      },
      { merge: true }
    );

    await updateDoc(doc(db, "match_requests", matchId as string), {
      matchType: type,
      score: scoreText,
      completed: true,
      winnerId,
    });

    // Love-hold badge if any 6–0
    if (clean.some(s => (s.A === 6 && s.B === 0) || (s.B === 6 && s.A === 0))) {
      if (winnerId) {
        await setDoc(doc(db, "players", winnerId), { badges: { loveHold: true } }, { merge: true });
      }
    }

    router.push(`/matches/${matchId}/summary`);
  };

  if (loading || !playerA || !playerB) return <div className="p-6 text-center">Loading…</div>;

  return (
    <div className="mx-auto max-w-3xl p-4 pb-40 sm:pb-8">
      <div className="mb-3">
        <div className="flex items-center gap-3">
          <GiTennisBall className="h-6 w-6 text-green-600" aria-hidden="true" />
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight">Enter Set Scores</h1>
        </div>
        <p className="mt-1 ml-9 text-sm text-gray-600">Best of 3 sets. Tiebreak appears automatically for 7–6 sets.</p>
      </div>

      {/* Players */}
      <div className="mb-4 grid grid-cols-1 sm:grid-cols-2 gap-3">
        {[playerA, playerB].map((p, i) => (
          <div key={p.id} className="flex items-center gap-3 rounded-xl border bg-white p-3 shadow-sm">
            <Image src={p.photoURL || "/images/default-avatar.jpg"} alt={p.name || `Player ${i ? "B" : "A"}`} width={40} height={40} className="rounded-full" />
            <div className="min-w-0">
              <div className="font-medium truncate">{p.name || `Player ${i ? "B" : "A"}`}</div>
              <div className="text-xs text-gray-500">{i ? "Player B" : "Player A"}</div>
            </div>
          </div>
        ))}
      </div>

      {/* Sets */}
      <div className="rounded-xl border bg-white shadow-sm p-4">
      <div className="mb-2 grid grid-cols-[auto,1fr,1fr,auto] items-center gap-2">
  <div className="text-xs font-medium text-gray-500">Set</div>

  {/* Player A header */}
  <div className="text-xs font-medium text-gray-700 flex items-center gap-2 min-w-0">
    {playerA?.photoURL ? (
      // eslint-disable-next-line @next/next/no-img-element
      <img src={playerA.photoURL} alt="" className="h-4 w-4 rounded-full" />
    ) : (
      <span className="h-4 w-4 rounded-full bg-gray-200 inline-block" />
    )}
    <span className="truncate">{playerA?.name || "Player A"}</span>
  </div>

  {/* Player B header */}
  <div className="text-xs font-medium text-gray-700 flex items-center gap-2 min-w-0">
    {playerB?.photoURL ? (
      // eslint-disable-next-line @next/next/no-img-element
      <img src={playerB.photoURL} alt="" className="h-4 w-4 rounded-full" />
    ) : (
      <span className="h-4 w-4 rounded-full bg-gray-200 inline-block" />
    )}
    <span className="truncate">{playerB?.name || "Player B"}</span>
  </div>

  <div className="text-xs font-medium text-gray-500">Tiebreak</div>
</div>


       {[0,1,2].map((i) => (
  <SetRow
    key={i}
    idx={i}
    label={`Set ${i + 1}`}
    value={sets[i]}
    aName={playerA?.name || "Player A"}
    bName={playerB?.name || "Player B"}
    onChange={(v) => setSets((prev) => { const next = [...prev]; next[i] = v; return next; })}
  />
))}

      </div>

      {/* Submit */}
      <div className="sm:mt-6">
        <div className="fixed left-0 right-0 px-4 sm:static sm:px-0 z-50 pointer-events-none sm:pointer-events-auto" style={{ bottom: 'max(6rem, env(safe-area-inset-bottom))' }}>
          <div className="max-w-3xl mx-auto">
            <button onClick={handleSubmit} className="pointer-events-auto w-full sm:w-auto rounded-lg bg-green-600 px-4 py-3 text-white font-semibold shadow-lg hover:bg-green-700">
              Save Match Result
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
