"use client";

import { useParams, useSearchParams, useRouter } from "next/navigation";
import { useEffect, useState, useRef } from "react";
import { db } from "@/lib/firebase";
import {
  doc,
  getDoc,
  updateDoc,
  onSnapshot,
  setDoc,
  serverTimestamp,
  arrayUnion,
} from "firebase/firestore";
import Image from "next/image";
import withAuth from "@/components/withAuth";
import { ComponentType } from "react"; // ✅ Add this for typing
import { GiTennisBall } from "react-icons/gi";

const tennisPoints = ["0", "15", "30", "40", "Adv"];
const pointText = (isTB: boolean, pts: number, tbPts: number) =>
  isTB ? String(tbPts) : tennisPoints[pts] ?? "0";

function MatchDetailsForm() {
  const { id: matchId } = useParams();
  const type = useSearchParams().get("type");
  const router = useRouter();

  const [playerA, setPlayerA] = useState<any>(null);
  const [playerB, setPlayerB] = useState<any>(null);
  const [sets, setSets] = useState<any[]>([]);
  const [points, setPoints] = useState<{ A: number; B: number }>({ A: 0, B: 0 });
  const [tieBreaker, setTieBreaker] = useState(false);
  const [tieBreakerPoints, setTieBreakerPoints] = useState<{ A: number; B: number }>({ A: 0, B: 0 });
  const [currentSetIndex, setCurrentSetIndex] = useState(0);

  const gameWinLock = useRef(false);

  useEffect(() => {
    const matchRef = doc(db, "match_scores", matchId as string);
    const unsub = onSnapshot(matchRef, (docSnap) => {
      if (docSnap.exists()) {
        const data = docSnap.data();
        setSets(data.sets || Array(6).fill({ A: 0, B: 0 }));
        setPoints(data.points || { A: 0, B: 0 });
        setTieBreakerPoints(data.tieBreakerPoints || { A: 0, B: 0 });
        setTieBreaker(data.tieBreaker || false);
        setCurrentSetIndex(data.currentSetIndex || 0);
      }
    });
    return () => unsub();
  }, [matchId]);

// 1. Fetch match and set players
useEffect(() => {
  const fetchMatch = async () => {
    const matchRef = doc(db, "match_requests", matchId as string);
    const matchSnap = await getDoc(matchRef);
    if (matchSnap.exists()) {
      const match = matchSnap.data();
      const playerARef = doc(db, "players", match.fromUserId);
      const playerBRef = doc(db, "players", match.toUserId);
      const [aSnap, bSnap] = await Promise.all([getDoc(playerARef), getDoc(playerBRef)]);
      setPlayerA({ id: match.fromUserId, ...aSnap.data() });
      setPlayerB({ id: match.toUserId, ...bSnap.data() });
    }
  };
  fetchMatch();
}, [matchId]);

// 2. Initialize match_scores if it doesn't exist
useEffect(() => {
  if (playerA && playerB) {
    const initMatchScore = async () => {
      const matchScoreRef = doc(db, "match_scores", matchId as string);
      const scoreSnap = await getDoc(matchScoreRef);
      if (!scoreSnap.exists()) {
        await setDoc(matchScoreRef, {
          players: [playerA.id, playerB.id],
          sets: Array(6).fill({ A: 0, B: 0 }),
          points: { A: 0, B: 0 },
          tieBreakerPoints: { A: 0, B: 0 },
          currentSetIndex: 0,
          tieBreaker: false,
          createdAt: serverTimestamp(),
        });
      }
    };
    initMatchScore();
  }
}, [playerA, playerB, matchId]);

const updateFirestoreState = async (updatedFields: any) => {
  if (!playerA || !playerB) return;

  const matchRef = doc(db, "match_scores", matchId as string);
  await setDoc(
    matchRef,
    {
      players: [playerA.id, playerB.id], // ✅ Include players for security rule
      ...updatedFields,
      updatedAt: serverTimestamp(),
    },
    { merge: true }
  );
};

  const handleWinGame = async (winner: "A" | "B") => {
    const updatedSets = [...sets];
    const currentSet = { ...updatedSets[currentSetIndex] };
    const opponent = winner === "A" ? "B" : "A";

    currentSet[winner] += 1;
    updatedSets[currentSetIndex] = currentSet;

    if (currentSet[winner] === 6 && currentSet[opponent] === 6) {
      await updateFirestoreState({ sets: updatedSets, tieBreaker: true });
    } else if (currentSet[winner] >= 6 && currentSet[winner] - currentSet[opponent] >= 2) {
      const nextSetIndex = currentSetIndex < 5 ? currentSetIndex + 1 : currentSetIndex;
      await updateFirestoreState({ sets: updatedSets, currentSetIndex: nextSetIndex });
    } else {
      await updateFirestoreState({ sets: updatedSets });
    }
  };

  const incrementPoint = (player: "A" | "B") => {
    if (tieBreaker) {
      const updated = { ...tieBreakerPoints, [player]: tieBreakerPoints[player] + 1 };
      const opponent = player === "A" ? "B" : "A";

      if (updated[player] >= 7 && updated[player] - updated[opponent] >= 2) {
        const updatedSets = [...sets];
        updatedSets[currentSetIndex] = {
          ...updatedSets[currentSetIndex],
          A: player === "A" ? 7 : 6,
          B: player === "B" ? 7 : 6,
          tieBreakA: updated.A,
          tieBreakB: updated.B,
        };
        const nextSetIndex = currentSetIndex < 5 ? currentSetIndex + 1 : currentSetIndex;
        updateFirestoreState({
          tieBreaker: false,
          tieBreakerPoints: { A: 0, B: 0 },
          sets: updatedSets,
          currentSetIndex: nextSetIndex,
        });
        return;
      }

      updateFirestoreState({ tieBreakerPoints: updated });
      return;
    }

    const current = points[player];
    const opponent = player === "A" ? "B" : "A";
    const opponentPoints = points[opponent];

    if (tennisPoints[current] === "Adv") {
      if (!gameWinLock.current) {
        gameWinLock.current = true;
        handleWinGame(player);
        setTimeout(() => (gameWinLock.current = false), 100);
      }
      updateFirestoreState({ points: { A: 0, B: 0 } });
      return;
    }

    if (tennisPoints[current] === "40" && tennisPoints[opponentPoints] === "40") {
      updateFirestoreState({ points: { ...points, [player]: 4 } });
      return;
    }

    if (tennisPoints[current] === "40" && tennisPoints[opponentPoints] !== "40") {
      if (!gameWinLock.current) {
        gameWinLock.current = true;
        handleWinGame(player);
        setTimeout(() => (gameWinLock.current = false), 100);
      }
      updateFirestoreState({ points: { A: 0, B: 0 } });
      return;
    }

    updateFirestoreState({ points: { ...points, [player]: Math.min(current + 1, 4) } });
  };

  const decrementPoint = (player: "A" | "B") => {
    if (tieBreaker) {
      updateFirestoreState({
        tieBreakerPoints: {
          ...tieBreakerPoints,
          [player]: Math.max(0, tieBreakerPoints[player] - 1),
        },
      });
    } else {
      updateFirestoreState({
        points: {
          ...points,
          [player]: Math.max(0, points[player] - 1),
        },
      });
    }
  };

  const handleSubmit = async () => {
    try {
      // 1) Fetch original match request data for badge logic
      const matchReqRef = doc(db, "match_requests", matchId as string);
      const matchReqSnap = await getDoc(matchReqRef);
      if (!matchReqSnap.exists()) return;
      const matchData = matchReqSnap.data();

      // 2) Compute setsWon and winnerId
      let setsWonA = 0, setsWonB = 0;
      sets.forEach((s) => {
        if (s.A > s.B) setsWonA++;
        else if (s.B > s.A) setsWonB++;
      });
      const winnerId = setsWonA > setsWonB ? playerA?.id : setsWonB > setsWonA ? playerB?.id : null;

      // 3) Prepare update data
      const updateData: any = {
        matchType: type,
        score: sets.map((s) => `${s.A}-${s.B}`).join(", "),
        completed: true,
        winnerId,
      };
      if (playerA?.id && playerB?.id) updateData.players = [playerA.id, playerB.id];

      // 4) Update match request doc
      await updateDoc(matchReqRef, updateData);

      // 5) Award Love Hold badge if any set was 40-0
      if (updateData.score) {
        const setStrs = updateData.score.split(",").map((s: string) => s.trim());
        for (const str of setStrs) {
          if (str === "40-0") {
            await setDoc(
              doc(db, "players", winnerId!),
              { badges: arrayUnion("loveHold") },
              { merge: true }
            );
            break;
          }
        }
      }

// 3) Finally navigate on to the summary page
router.push(`/matches/${matchId}/summary`);
    } catch (error) {
      console.error("Error submitting match results:", error);
    }
  };

  if (!playerA || !playerB) return <div className="p-6 text-center">Loading...</div>;

return (
  <div className="mx-auto max-w-3xl p-4 pb-40 sm:pb-8">
  {/* Page title */}
<div className="mb-3">
  <div className="flex items-center gap-3">
    <GiTennisBall className="h-6 w-6 text-green-600" aria-hidden="true" />
    <h1 className="text-2xl sm:text-3xl font-bold tracking-tight">Match Scoreboard</h1>
  </div>

  {/* subtitle aligned under the title */}
  <p className="mt-1 ml-9 text-sm text-gray-600">
    Live scoring — the highlighted column is the current set.
  </p>

  {/* optional: keep tie-break notice here (otherwise move it to the sticky toolbar) */}
  {tieBreaker && (
    <p
      className="mt-1 ml-9 inline-block rounded-full bg-amber-50 px-2 py-1 text-xs text-amber-700 ring-1 ring-amber-200"
      aria-live="polite"
    >
      🏆 Tie-break in progress
    </p>
  )}
</div>
{/* Sticky toolbar */}
<div className="sticky top-[56px] z-10 mb-3 rounded-xl bg-white/90 backdrop-blur ring-1 ring-black/5 p-3">
  <div className="flex flex-wrap items-center gap-3">
    <span className="inline-flex items-center gap-2 rounded-lg bg-gray-100 px-2.5 py-1 text-sm">
      Current set
      <span className="rounded-md bg-white px-1.5 py-0.5 ring-1 ring-black/5 font-medium">
        {currentSetIndex + 1}
      </span>
    </span>

    {tieBreaker && (
      <span className="text-xs px-2 py-1 rounded-full bg-amber-50 text-amber-700 ring-1 ring-amber-200">
        Tie-break
      </span>
    )}

    <button
      onClick={() =>
        updateFirestoreState({
          points: { A: 0, B: 0 },
          tieBreakerPoints: { A: 0, B: 0 },
        })
      }
      className="ml-auto rounded-lg border px-3 py-1.5 text-sm hover:bg-gray-50"
    >
      Reset points
    </button>
  </div>
</div>

    {/* ---------- Mobile: card layout (sm:hidden) ---------- */}
    <div className="sm:hidden space-y-3">
      {(["A", "B"] as const).map((playerKey) => {
        const p = playerKey === "A" ? playerA : playerB;
        const pSets = sets.map((s) => (playerKey === "A" ? s.A : s.B));
        const pTBs  = sets.map((s) => (playerKey === "A" ? s.tieBreakA : s.tieBreakB));
        const pt    = pointText(tieBreaker, points[playerKey], tieBreakerPoints[playerKey]);

        return (
          <div key={playerKey} className="rounded-xl border bg-white p-3 shadow-sm">
            {/* Header: avatar + name */}
            <div className="flex items-center gap-3">
              <Image
                src={p.photoURL || "/images/default-avatar.jpg"}
                alt={p.name || `Player ${playerKey}`}
                width={40}
                height={40}
                className="rounded-full"
              />
              <div className="min-w-0">
                <div className="font-medium truncate">{p.name || `Player ${playerKey}`}</div>
                {/* Set chips */}
                <div className="mt-1 flex flex-wrap gap-1">
                  {pSets.map((val, i) => (
                    <span
                      key={i}
                      className="inline-flex items-center rounded-md border px-2 py-0.5 text-xs text-gray-700"
                      title={pTBs[i] != null ? `Tiebreak: ${pTBs[i]}` : undefined}
                    >
                      Set {i + 1}: {val ?? "-"}
                      {pTBs[i] != null && (
                        <sup className="ml-1 text-[10px] text-gray-500">{pTBs[i]}</sup>
                      )}
                    </span>
                  ))}
                </div>
              </div>
            </div>

            {/* Points row */}
            <div className="mt-3 rounded-lg bg-gray-50 px-3 py-2 flex items-center justify-between">
              <div className="text-sm text-gray-600">Points</div>
              <div className="text-lg font-semibold tabular-nums">{pt}</div>
            </div>

            {/* Controls */}
            <div className="mt-2 grid grid-cols-2 gap-2">
              <button
                onClick={() => incrementPoint(playerKey)}
                className="h-10 rounded-lg bg-green-600 text-white font-medium active:scale-[.98]"
                aria-label={`Add point for ${p.name || `Player ${playerKey}`}`}
              >
                + Point
              </button>
              <button
                onClick={() => decrementPoint(playerKey)}
                className="h-10 rounded-lg bg-red-50 text-red-700 font-medium active:scale-[.98]"
                aria-label={`Remove point for ${p.name || `Player ${playerKey}`}`}
              >
                − Point
              </button>
            </div>
          </div>
        );
      })}
    </div>

{/* Table card (tablet & desktop only) */}
<div className="hidden md:block overflow-x-auto rounded-xl border bg-white shadow-sm">
  <table className="min-w-full table-auto text-center" role="grid">
    <caption className="sr-only">Live tennis scoring table</caption>
    <thead className="bg-gray-50">
      <tr>
        <th scope="col" rowSpan={2} className="px-3 py-3 w-48 text-left">Player</th>
        <th scope="col" colSpan={6} className="px-3 py-3">Sets</th>
        <th scope="col" rowSpan={2} className="px-2 sm:px-3 py-3 w-[56px] sm:w-auto">
  Points
</th>
      </tr>
      <tr>
        {[1, 2, 3, 4, 5, 6].map((num, i) => {
          const isActive = i === currentSetIndex;
          return (
            <th
              key={num}
              className={
                "px-2 py-2 text-sm font-medium " +
                (isActive ? "bg-green-50 text-green-800 ring-1 ring-green-200" : "")
              }
            >
              {num}
            </th>
          );
        })}
      </tr>
    </thead>

    <tbody>
      {(["A", "B"] as const).map((playerKey) => {
        const p = playerKey === "A" ? playerA : playerB;
        const pSets = sets.map((s) => (playerKey === "A" ? s.A : s.B));
        const pTBs  = sets.map((s) => (playerKey === "A" ? s.tieBreakA : s.tieBreakB));
        const pt    = pointText(tieBreaker, points[playerKey], tieBreakerPoints[playerKey]);

        return (
          <tr key={playerKey} className="border-t">
            {/* Player cell */}
            <th scope="row" className="px-3 py-3 text-left font-normal">
              <div className="flex items-center gap-2">
                <Image
                  src={p.photoURL || "/images/default-avatar.jpg"}
                  width={32}
                  height={32}
                  alt={`Player ${playerKey}`}
                  className="rounded-full"
                />
                <span className="truncate">{p.name || `Player ${playerKey}`}</span>
              </div>
            </th>

            {/* Set cells with active column highlight */}
            {[0, 1, 2, 3, 4, 5].map((i) => {
              const isActive = i === currentSetIndex;
              return (
                <td
                  key={i}
                  className={
                    "px-2 py-2 text-sm tabular-nums " +
                    (isActive ? "bg-green-50 ring-1 ring-green-200" : "")
                  }
                  title={pTBs[i] != null ? `Tie-break: ${pTBs[i]}` : undefined}
                >
                  {pSets[i] ?? "-"}
                  {pTBs[i] != null && (
                    <sup className="ml-1 text-[10px] text-gray-500">{pTBs[i]}</sup>
                  )}
                </td>
              );
            })}

            {/* Points + compact controls */}
            <td className="px-2 sm:px-3 py-3">
  <div className="inline-flex items-center gap-2">
    <span className="font-semibold tabular-nums">{pt}</span>

    {/* Hide table controls on mobile; keep them on desktop */}
    <div className="hidden sm:flex items-center gap-1">
      <button
        onClick={() => incrementPoint(playerKey)}
        className="px-2 py-1 rounded bg-green-600 text-white text-xs hover:bg-green-700"
        aria-label={`Add point for ${p.name || `Player ${playerKey}`}`}
      >
        +
      </button>
      <button
        onClick={() =>
          decrementPoint(playerKey)
        }
        disabled={!(tieBreaker ? tieBreakerPoints[playerKey] > 0 : points[playerKey] > 0)}
        className="px-2 py-1 rounded bg-red-50 text-red-700 text-xs disabled:opacity-40 disabled:cursor-not-allowed"
        aria-label={`Remove point for ${p.name || `Player ${playerKey}`}`}
      >
        −
      </button>
    </div>
  </div>
</td>

          </tr>
        );
      })}
    </tbody>
  </table>
</div>

{/* Primary action: fixed on mobile (above bottom nav/FAB), inline on desktop */}
<div className="sm:mt-6">
  <div
    className="fixed left-0 right-0 px-4 sm:static sm:px-0 z-50 pointer-events-none sm:pointer-events-auto"
    // keep the button safely above bottom bars + safe area
    style={{ bottom: 'max(6rem, env(safe-area-inset-bottom))' }} // ~96px on phones; adjust if needed
  >
    <div className="max-w-3xl mx-auto">
      <button
        onClick={handleSubmit}
        className="pointer-events-auto w-full sm:w-auto rounded-lg bg-green-600 px-4 py-3 text-white font-semibold shadow-lg hover:bg-green-700"
      >
        Game, Set &amp; Match
      </button>
    </div>
  </div>
</div>

<style jsx global>{`
  /* Hide the floating “Give Feedback” FAB on this page */
  button.fixed.bottom-6.right-6 {
    display: none !important;
  }
`}</style>

  </div>
);

}

// ✅ Correct export to fix build type error
const AuthenticatedComponent: ComponentType = withAuth(MatchDetailsForm);
export default AuthenticatedComponent;
