"use client";

import { useCallback, useEffect, useState } from "react";
import {
  onSnapshot,
  query,
  where,
  collection,
  doc,
  getDoc,
  getDocs,
  updateDoc,
  deleteDoc,
  addDoc,
  serverTimestamp,
  DocumentData,
  QuerySnapshot,
  arrayUnion,
  setDoc,
} from "firebase/firestore";
import { auth, db } from "@/lib/firebase";
import { onAuthStateChanged } from "firebase/auth";
import { useRouter } from "next/navigation";
import { Trash2 } from "lucide-react";
import withAuth from "@/components/withAuth";

type Match = {
  id: string;
  playerId: string;
  opponentId: string;
  court?: string;
  time?: string;
  status: string;
  message?: string;
  fromName?: string;
  toName?: string;
  suggestedCourtName?: string;
  suggestedCourtLat?: number;
  suggestedCourtLng?: number;
  createdAt?: any;
};

function MatchesPage() {
  const [matches, setMatches] = useState<Match[]>([]);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [tab, setTab] = useState<"pending" | "accepted">("pending");
  const router = useRouter();

  // Track auth state
  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (user) => {
      if (user) setCurrentUserId(user.uid);
    });
    return () => unsub();
  }, []);

  // Listen for match requests
  useEffect(() => {
    if (!currentUserId) return;

    const fromQ = query(
      collection(db, "match_requests"),
      where("fromUserId", "==", currentUserId)
    );
    const toQ = query(
      collection(db, "match_requests"),
      where("toUserId", "==", currentUserId)
    );

    const all: Record<string, Match> = {};
    const proc = (snap: QuerySnapshot<DocumentData>) => {
      let updated = false;
      snap.docs.forEach((d) => {
        const data = d.data();
        const m: Match = {
          id: d.id,
          playerId: data.fromUserId,
          opponentId: data.toUserId,
          court: data.court,
          time: data.time,
          status: data.status,
          message: data.message,
          fromName: data.fromName,
          toName: data.toName,
          suggestedCourtName: data.suggestedCourtName,
          suggestedCourtLat: data.suggestedCourtLat,
          suggestedCourtLng: data.suggestedCourtLng,
          createdAt: data.createdAt,
        };
        if (!all[d.id] || all[d.id].status !== m.status) {
          all[d.id] = m;
          updated = true;
        }
      });
      if (updated) setMatches(Object.values(all));
    };

    const unsubFrom = onSnapshot(fromQ, proc);
    const unsubTo = onSnapshot(toQ, proc);
    return () => { unsubFrom(); unsubTo(); };
  }, [currentUserId]);

  // Accept a match and award badge
  const acceptMatch = async (matchId: string, currentUserId: string) => {
    try {
      const matchRef = doc(db, "match_requests", matchId);
      const snap = await getDoc(matchRef);
      if (!snap.exists()) return;

      const { fromUserId, toUserId } = snap.data();
      if (currentUserId !== toUserId) return;

      // Mark accepted
      await updateDoc(matchRef, {
        status: "accepted",
        players: [fromUserId, toUserId],
      });

      // Notify requester
      const playerDoc = await getDoc(doc(db, "players", toUserId));
      const name = playerDoc.data()?.name || "A player";
      await addDoc(collection(db, "notifications"), {
        recipientId: fromUserId,
        matchId,
        message: `${name} accepted your match request!`,
        timestamp: serverTimestamp(),
        read: false,
      });

      // Award first match badge
      await setDoc(
        doc(db, "players", toUserId),
        { badges: arrayUnion("firstMatch") },
        { merge: true }
      );
      await setDoc(
  doc(db, "players", fromUserId),
  { badges: arrayUnion("firstMatch") },
  { merge: true }
);
    } catch (err) {
      console.error("❌ Error accepting match:", err);
    }
  };

  // Start match logic
  const handleStartMatch = async (match: Match) => {
    if (!currentUserId) return;
    const refMatch = doc(db, "match_requests", match.id);
    await updateDoc(refMatch, { started: true, startedAt: serverTimestamp() });
    const other = match.playerId === currentUserId ? match.opponentId : match.playerId;
    await addDoc(collection(db, "notifications"), {
      recipientId: other,
      matchId: match.id,
      message: "Your match has started!",
      timestamp: serverTimestamp(),
      read: false,
    });
    router.push(`/matches/${match.id}/complete`);
  };

  // Delete match
  const deleteMatch = async (id: string) => {
    if (!confirm("Delete this match?")) return;
    await deleteDoc(doc(db, "match_requests", id));
    setMatches((prev) => prev.filter((m) => m.id !== id));
  };

  // Chat logic omitted for brevity

  const renderMatch = useCallback((match: Match) => {
    const isRec = match.opponentId === currentUserId && match.status !== "accepted";
    const isMine = match.playerId === currentUserId;
    const other = isMine ? match.opponentId : match.playerId;
    const initiator = isMine ? "You" : match.fromName;
    const recipient = isMine ? match.toName : "You";

    return (
      <li key={match.id} className="border p-4 rounded-xl shadow-md relative">
        <div className="flex justify-between items-start">
          <p className="font-semibold">{initiator} → {recipient}</p>
          <button onClick={() => deleteMatch(match.id)} title="Delete match" className="text-red-500 hover:text-red-700">
            <Trash2 size={18} />
          </button>
        </div>
        <p className="text-sm text-gray-700 mt-1">Message: {match.message || "No message"}</p>
        <p className="text-sm text-gray-700">Status: {match.status}</p>
        <p className="text-sm text-gray-500 italic">🏗️ Court suggestion coming soon</p>
        {match.time && <p className="text-sm text-gray-700">Time: {match.time}</p>}
        <div className="flex gap-2 mt-3">
          {isRec && match.status !== "accepted" && (
            <button onClick={() => currentUserId && acceptMatch(match.id, currentUserId)} className="px-4 py-1 bg-green-600 text-white rounded">
              Accept Match
            </button>
          )}
          {match.status === "accepted" && (
            <>
              <button onClick={() => handleStartMatch(match)} className="px-4 py-1 bg-purple-600 text-white rounded">
                Start Game
              </button>
              {/* Chat button logic here */}
 <button
  onClick={() => {
    const sortedIDs = [currentUserId, other].sort().join("_");
    router.push(`/messages/${sortedIDs}`);
  }}
  className="px-4 py-1 bg-blue-600 text-white rounded"
>
  Chat
</button>
  </>
)}
        </div>
      </li>
    );
  }, [currentUserId]);

  const filtered = tab === "accepted"
    ? matches.filter((m) => m.status === "accepted")
    : matches.filter((m) => m.status !== "accepted");

  return (
    <div className="p-4 max-w-2xl mx-auto">
      <h1 className="text-2xl font-bold mb-4">Match Requests</h1>
      <div className="flex gap-4 mb-4">
        <button onClick={() => setTab("accepted")} className={`px-4 py-1 rounded ${tab === "accepted" ? "bg-blue-600 text-white" : "bg-gray-200 text-gray-800"}`}>Accepted</button>
        <button onClick={() => setTab("pending")} className={`px-4 py-1 rounded ${tab === "pending" ? "bg-blue-600 text-white" : "bg-gray-200 text-gray-800"}`}>Pending</button>
      </div>
      {filtered.length === 0 ? <p>No matches in this tab.</p> : <ul className="space-y-4">{filtered.map(renderMatch)}</ul>}
    </div>
  );
}

export default withAuth(MatchesPage);
