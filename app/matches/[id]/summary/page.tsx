"use client";

import { useEffect, useState, useMemo } from "react";
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
import { Trophy } from "lucide-react";
import { GiTennisBall } from "react-icons/gi";

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

  // ---- auth ----
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (user) => {
      if (user) setCurrentUserId(user.uid);
    });
    return () => unsubscribe();
  }, []);

  // ---- data ----
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

  // ---- helpers for UI ----
  const parsedSets = useMemo(
    () =>
      scoreArray.map((s) => {
        const [a, b] = s.split("-").map((n) => Number(n || 0));
        return { A: a, B: b };
      }),
    [scoreArray]
  );

  // ---- actions ----
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
  const cleanId =
    Array.isArray(matchId) ? matchId[0] : (matchId as string | undefined);

  if (!cleanId) return; // no route without an id

  try {
    // If we don't have auth or winner yet, just go to feedback anyway.
    if (!currentUserId || !match?.winnerId) {
      router.push(`/matches/${cleanId}/feedback`);
      return;
    }

    const matchRef = doc(db, "match_requests", cleanId);
    const matchSnap = await getDoc(matchRef);
    if (!matchSnap.exists()) {
      // If somehow missing, just go to feedback to avoid dead-ends
      router.push(`/matches/${cleanId}/feedback`);
      return;
    }

    const matchData = matchSnap.data();
    const alreadyCompletedBy: string[] = matchData.completedBy || [];
    const iAlreadyCompleted = alreadyCompletedBy.includes(currentUserId);

    // Only do updates if I haven't completed yet
    if (!iAlreadyCompleted) {
      // Step 1: mark as completed by user
      await updateDoc(matchRef, {
        status: "completed",
        completedBy: arrayUnion(currentUserId),
      });

      // Step 2: mark completed & timestamp
      await updateDoc(matchRef, {
        completed: true,
        completedAt: serverTimestamp(),
      });

      // Step 3: if both have completed → archive + function trigger
      if ((alreadyCompletedBy.length + 1) === 2) {
        const historyRef = doc(collection(db, "match_history"));
        await setDoc(historyRef, {
          ...matchData,
          completed: true,
          status: "completed",
          movedAt: serverTimestamp(),
        });

        await deleteDoc(matchRef);

        await setDoc(doc(db, "completed_matches", cleanId), {
          matchId: cleanId,
          winnerId: matchData.winnerId,
          fromUserId: matchData.fromUserId,
          toUserId: matchData.toUserId,
          timestamp: serverTimestamp(),
        });
      }
    }

    // Step 4: ensure feedback doc exists for this user (idempotent)
    if (currentUserId) {
      const feedbackDocId = `${cleanId}_${currentUserId}`;
      await setDoc(
        doc(db, "match_feedback", feedbackDocId),
        {
          matchId: cleanId,
          userId: currentUserId,
          createdAt: serverTimestamp(),
          feedback: {},
        },
        { merge: true }
      );
    }

    // Always navigate to feedback
    router.push(`/matches/${cleanId}/feedback`);
  } catch (error) {
    console.error("Failed to complete match:", error);
    // Even if something fails, still navigate so the user can leave feedback.
    router.push(`/matches/${cleanId}/feedback`);
  }
};

  if (loading) return <div className="p-6">Loading summary...</div>;

  return (
   <div className="mx-auto max-w-3xl p-4 pb-28 sm:pb-8 text-center">
      {/* Page title */}
      <div className="mb-3 text-left">
        <div className="flex items-center gap-3">
          <GiTennisBall className="h-6 w-6 text-green-600" aria-hidden="true" />
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight">Match Summary</h1>
        </div>
        <p className="mt-1 ml-9 text-sm text-gray-600">Nice work! Here’s how the sets finished up.</p>
      </div>

      {winner && loser ? (
        <>
          {/* Winner highlight */}
          <div className="mb-6 flex items-center justify-center gap-6">
            {/* Winner */}
            <div className="text-center scale-105">
              <div className="mx-auto h-16 w-16 rounded-full ring-2 ring-yellow-400 ring-offset-2">
                <img
                  src={winner.photoURL || "/default-avatar.png"}
                  alt={winner.name}
                  className="h-16 w-16 rounded-full object-cover"
                />
              </div>
              <div className="mt-2 text-sm font-medium flex items-center justify-center gap-1 text-green-700">
                <Trophy className="h-4 w-4 text-yellow-500" />
                <span>{winner.name}</span>
              </div>
            </div>

            <span className="text-gray-500">vs</span>

            {/* Loser */}
            <div className="text-center">
              <div className="mx-auto h-16 w-16 rounded-full ring-2 ring-gray-200 ring-offset-2">
                <img
                  src={loser.photoURL || "/default-avatar.png"}
                  alt={loser.name}
                  className="h-16 w-16 rounded-full object-cover"
                />
              </div>
              <div className="mt-2 text-sm font-medium text-gray-700">{loser.name}</div>
            </div>
          </div>

          {/* Mobile summary cards */}
          <div className="sm:hidden space-y-2 mb-4 text-left">
            {parsedSets.map((s, i) => (
              <div key={i} className="flex items-center justify-between rounded-lg border bg-white px-3 py-2">
                <span className="text-sm text-gray-600">Set {i + 1}</span>
                <span className="font-semibold tabular-nums">{s.A}–{s.B}</span>
              </div>
            ))}
          </div>

          {/* Desktop/tablet table */}
          <div className="hidden sm:block overflow-x-auto">
            <table className="min-w-[540px] mx-auto border-separate border-spacing-0 text-center bg-white rounded-xl overflow-hidden shadow-sm">
              <thead className="bg-gray-50 text-sm">
                <tr>
                  <th className="py-3 px-4 text-left rounded-tl-xl">Set</th>
                  <th className="py-3 px-4">{winner.name}</th>
                  <th className="py-3 px-4 rounded-tr-xl">{loser.name}</th>
                </tr>
              </thead>
              <tbody>
                {parsedSets.map((s, i) => (
                  <tr key={i} className="border-t">
                    <th className="py-2.5 px-4 text-left font-medium text-gray-700">Set {i + 1}</th>
                    <td className="py-2.5 px-4 tabular-nums">{s.A}</td>
                    <td className="py-2.5 px-4 tabular-nums">{s.B}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      ) : (
        <p className="text-lg text-gray-600">This match ended without a declared winner.</p>
      )}

     {/* Sticky actions */}
<div className="sm:mt-6">
  <div className="fixed bottom-20 left-0 right-0 px-4 z-50 sm:static sm:px-0">
    <div className="mx-auto max-w-3xl flex flex-col sm:flex-row gap-3 sm:justify-center">
      <button
        onClick={handleRematch}
        disabled={rematchRequested}
        className="w-full sm:w-auto rounded-xl bg-blue-600 px-4 py-3 text-white text-sm font-semibold shadow hover:bg-blue-700 disabled:opacity-50"
      >
        {rematchRequested ? "Rematch Requested" : "Request Rematch"}
      </button>

      <button
        onClick={handleComplete}
        className="w-full sm:w-auto rounded-xl bg-green-600 px-4 py-3 text-white text-sm font-semibold shadow hover:bg-green-700"
      >
        Done
          </button>
          </div>
        </div>
      </div>
    </div>
  );
}
