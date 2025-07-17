"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { db, auth } from "@/lib/firebase";
import {
  doc,
  getDoc,
  addDoc,
  collection,
  serverTimestamp,
  deleteDoc,
  updateDoc,
  setDoc,
  arrayUnion,
} from "firebase/firestore";
import { onAuthStateChanged } from "firebase/auth";

export default function MatchSummaryPage() {
  const { id: matchId } = useParams();
  const router = useRouter();
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [match, setMatch] = useState<any>(null);
  const [winner, setWinner] = useState<any>(null);
  const [loser, setLoser] = useState<any>(null);
  const [scoreArray, setScoreArray] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [rematchRequested, setRematchRequested] = useState(false);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (user) => {
      if (user) setCurrentUserId(user.uid);
    });
    return () => unsubscribe();
  }, []);

  useEffect(() => {
    async function fetchMatchData() {
      if (!matchId) return;

      const matchRef = doc(db, "match_requests", matchId as string);
      const matchSnap = await getDoc(matchRef);
      if (!matchSnap.exists()) {
        setLoading(false);
        return;
      }

      const matchData = matchSnap.data();
      setMatch(matchData);

      const { winnerId, fromUserId, toUserId, fromName, toName, score } = matchData;
      const fromSnap = await getDoc(doc(db, "players", fromUserId));
      const toSnap = await getDoc(doc(db, "players", toUserId));
      const fromPlayer = fromSnap.exists() ? fromSnap.data() : {};
      const toPlayer = toSnap.exists() ? toSnap.data() : {};

      if (winnerId === fromUserId) {
        setWinner({ ...fromPlayer, id: fromUserId, name: fromName });
        setLoser({ ...toPlayer, id: toUserId, name: toName });
      } else {
        setWinner({ ...toPlayer, id: toUserId, name: toName });
        setLoser({ ...fromPlayer, id: fromUserId, name: fromName });
      }

      if (score) {
        setScoreArray(score.split(",").map((s: string) => s.trim()));
      }

      setLoading(false);
    }

    fetchMatchData();
  }, [matchId]);

  const handleRematch = async () => {
    if (!currentUserId || !match) return;
    const { fromUserId, toUserId, fromName, toName } = match;
    const opponentId = currentUserId === fromUserId ? toUserId : fromUserId;
    const myName = currentUserId === fromUserId ? fromName : toName;
    const opponentName = currentUserId === fromUserId ? toName : fromName;

    const newMatchRef = await addDoc(collection(db, "match_requests"), {
      fromUserId: currentUserId,
      toUserId: opponentId,
      fromName: myName,
      toName: opponentName,
      status: "pending",
      score: "",
      winnerId: "",
      completed: false,
      createdAt: serverTimestamp(),
    });

    await addDoc(collection(db, "notifications"), {
      recipientId: opponentId,
      message: `${myName} wants a rematch!`,
      matchId: newMatchRef.id,
      timestamp: serverTimestamp(),
      read: false,
      type: "rematch_request",
    });

    setRematchRequested(true);
  };

  const handleComplete = async () => {
    if (!matchId || !currentUserId || !match?.winnerId) return;

    try {
      const matchRef = doc(db, "match_requests", matchId as string);
      const matchSnap = await getDoc(matchRef);
      if (!matchSnap.exists()) return;
      const matchData = matchSnap.data();

      // Move to history
      const historyRef = doc(collection(db, "match_history"));
      await setDoc(historyRef, {
        ...matchData,
        completed: true,
        status: "completed",
        movedAt: serverTimestamp(),
      });

      // Remove original request
      await deleteDoc(matchRef);

      // Update player stats
      const winnerRef = doc(db, "players", matchData.winnerId);
      const loserId = matchData.winnerId === matchData.fromUserId ? matchData.toUserId : matchData.fromUserId;
      const loserRef = doc(db, "players", loserId);
      const [winnerSnap, loserSnap] = await Promise.all([
        getDoc(winnerRef),
        getDoc(loserRef),
      ]);
      const winnerData = winnerSnap.data() || {};
      const loserData = loserSnap.data() || {};

      await Promise.all([
        updateDoc(winnerRef, {
          matchesPlayed: (winnerData.matchesPlayed || 0) + 1,
          matchesWon: (winnerData.matchesWon || 0) + 1,
        }),
        updateDoc(loserRef, {
          matchesPlayed: (loserData.matchesPlayed || 0) + 1,
        }),
      ]);

      // Award "First Match Complete" badge to both players
      const users = [matchData.fromUserId, matchData.toUserId];
      for (const uid of users) {
        await setDoc(
          doc(db, "players", uid),
          { badges: arrayUnion("firstMatchComplete") },
          { merge: true }
        );
        // Award First Win to the match winner
await setDoc(
  doc(db, "players", matchData.winnerId),
  { badges: arrayUnion("firstWin") },
  { merge: true }
);
      }

      router.push(`/matches/${matchId}/feedback`);
    } catch (error) {
      console.error("Failed to complete match:", error);
    }
  };

  if (loading) return <div className="p-6">Loading summary...</div>;

  return (
    <div className="p-6 max-w-2xl mx-auto text-center">
      <h1 className="text-3xl font-bold mb-6">🎾 Match Summary</h1>

      {winner && loser ? (
        <div className="flex flex-col items-center gap-6">
          <div className="flex items-center justify-center gap-8">
            {/* Winner */}
            <div className="flex flex-col items-center">
              <img
                src={winner.photoURL || "/default-avatar.png"}
                className="w-24 h-24 rounded-full border-4 border-green-500 object-cover"
                alt={winner.name}
              />
              <p className="text-green-700 font-semibold mt-2">🏆 {winner.name}</p>
            </div>
            <div className="text-xl font-bold text-gray-500">vs</div>
            {/* Loser */}
            <div className="flex flex-col items-center">
              <img
                src={loser.photoURL || "/default-avatar.png"}
                className="w-24 h-24 rounded-full border object-cover"
                alt={loser.name}
              />
              <p className="text-gray-600 font-semibold mt-2">{loser.name}</p>
            </div>
          </div>

          {/* Scoreboard */}
          <div className="w-full max-w-md mt-4 bg-white rounded-lg shadow-sm border">
            <div className="flex justify-center gap-8 font-bold text-gray-800 border-b p-2">
              <span className="w-20 text-right">Set</span>
              <span className="w-20 text-center">{winner.name}</span>
              <span className="w-20 text-center">{loser.name}</span>
            </div>
            {scoreArray.map((set, i) => {
              const [a, b] = set.split("-").map(Number);
              return (
                <div key={i} className="flex justify-center gap-8 border-b py-2">
                  <span className="w-20 text-right">Set {i + 1}</span>
                  <span className="w-20 text-center">{a}</span>
                  <span className="w-20 text-center">{b}</span>
                </div>
              );
            })}
          </div>

          {/* Actions */}
          <div className="flex gap-4 mt-6">
            <button
              onClick={handleRematch}
              disabled={rematchRequested}
              className="px-6 py-2 rounded bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50"
            >
              {rematchRequested ? "Rematch Requested" : "Request Rematch"}
            </button>

            <button
              onClick={handleComplete}
              className="px-6 py-2 rounded bg-green-600 text-white hover:bg-green-700"
            >
              Complete
            </button>
          </div>
        </div>
      ) : (
        <p className="text-lg text-gray-600">This match ended without a declared winner.</p>
      )}
    </div>
  );
}
