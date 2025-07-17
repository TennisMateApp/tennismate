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

const tennisPoints = ["0", "15", "30", "40", "Adv"];

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

  const updateFirestoreState = async (updatedFields: any) => {
    const matchRef = doc(db, "match_scores", matchId as string);
    await setDoc(
      matchRef,
      {
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
    <div className="p-6 max-w-3xl mx-auto">
      <h1 className="text-2xl font-bold mb-4">Match Scoreboard</h1>
      {tieBreaker && <p className="text-red-600 font-semibold mb-2">🏆 Tie-breaker in progress</p>}

      <div className="overflow-x-auto">
        <table className="min-w-[640px] table-auto border-collapse border border-gray-400 text-center">
          <thead>
            <tr>
              <th rowSpan={2} className="border border-gray-400 px-2 py-2 w-40">Player</th>
              <th colSpan={6} className="border border-gray-400 px-4 py-2">Sets</th>
              <th rowSpan={2} className="border border-gray-400 px-4 py-2">Points</th>
            </tr>
            <tr>
              {[1, 2, 3, 4, 5, 6].map((num) => (
                <th key={num} className="border border-gray-400 px-2 py-1 text-sm">{num}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {["A", "B"].map((player) => {
              const p = player === "A" ? playerA : playerB;
              const playerSets = sets.map((s) => player === "A" ? s.A : s.B);
              const tieScores = sets.map((s) => player === "A" ? s.tieBreakA : s.tieBreakB);
              return (
                <tr key={player}>
<td className="border border-gray-400 px-2 py-2 text-left min-w-[140px] max-w-[160px]">
  <div className="flex items-center gap-2 overflow-hidden">
    <Image
      src={p.photoURL || "/default-avatar.png"}
      width={30}
      height={30}
      className="rounded-full shrink-0"
      alt={`Player ${player}`}
    />
    <span className="truncate text-sm block w-full">{p.name || `Player ${player}`}</span>
  </div>
</td>
                  {[0, 1, 2, 3, 4, 5].map((i) => (
                    <td key={i} className="border border-gray-400 px-2 py-1 text-sm">
                      {playerSets[i] ?? "-"}
                      {tieScores[i] !== undefined && (
                        <sup className="text-[10px] ml-1 text-gray-600">{tieScores[i]}</sup>
                      )}
                    </td>
                  ))}
                  <td className="border border-gray-400 px-4 py-2">
                    {tieBreaker ? tieBreakerPoints[player as "A" | "B"] : tennisPoints[points[player as "A" | "B"]]}
                    <div className="flex justify-center gap-1 mt-1">
                      <button
                        onClick={() => incrementPoint(player as "A" | "B")}
                        className="px-2 py-1 bg-green-500 text-white rounded text-xs"
                      >
                        +
                      </button>
                      <button
                        onClick={() => decrementPoint(player as "A" | "B")}
                        className="px-2 py-1 bg-red-500 text-white rounded text-xs"
                      >
                        −
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="flex justify-end mt-6">
        <button onClick={handleSubmit} className="px-4 py-2 bg-green-600 text-white rounded">
          Game, Set & Match
        </button>
      </div>
    </div>
  );
}

// ✅ Correct export to fix build type error
const AuthenticatedComponent: ComponentType = withAuth(MatchDetailsForm);
export default AuthenticatedComponent;
