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

  useEffect(() => {
    const unsubscribeAuth = onAuthStateChanged(auth, (user) => {
      if (user) setCurrentUserId(user.uid);
    });
    return () => unsubscribeAuth();
  }, []);

  useEffect(() => {
    if (!currentUserId) return;

    const fromQuery = query(
      collection(db, "match_requests"),
      where("fromUserId", "==", currentUserId)
    );

    const toQuery = query(
      collection(db, "match_requests"),
      where("toUserId", "==", currentUserId)
    );

    const allMatches: Record<string, Match> = {};

    const processSnapshot = (snapshot: QuerySnapshot<DocumentData>) => {
      let updated = false;

      snapshot.docs.forEach((doc) => {
        const data = doc.data();
        const match: Match = {
          id: doc.id,
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

        if (!allMatches[doc.id] || allMatches[doc.id].status !== match.status) {
          allMatches[doc.id] = match;
          updated = true;
        }
      });

      if (updated) {
        setMatches(Object.values(allMatches));
      }
    };

    const unsubFrom = onSnapshot(fromQuery, processSnapshot);
    const unsubTo = onSnapshot(toQuery, processSnapshot);

    return () => {
      unsubFrom();
      unsubTo();
    };
  }, [currentUserId]);

  const acceptMatch = async (matchId: string, currentUserId: string) => {
    try {
      const matchRef = doc(db, "match_requests", matchId);
      const matchSnap = await getDoc(matchRef);

      if (!matchSnap.exists()) return;

      const matchData = matchSnap.data();
      const fromUserId = matchData.fromUserId;
      const toUserId = matchData.toUserId;

      if (currentUserId !== toUserId) return;

      const playerSnap = await getDoc(doc(db, "players", toUserId));
      const acceptingUserName = playerSnap.exists() ? playerSnap.data().name : "A player";

      await updateDoc(matchRef, {
        status: "accepted",
        players: [fromUserId, toUserId],
      });

      await addDoc(collection(db, "notifications"), {
        recipientId: fromUserId,
        matchId,
        message: `${acceptingUserName} accepted your match request!`,
        timestamp: serverTimestamp(),
        read: false,
      });
    } catch (error) {
      console.error("❌ Error accepting match:", error);
    }
  };

  const handleStartMatch = async (match: Match) => {
    if (!currentUserId) return;

    try {
      const matchRef = doc(db, "match_requests", match.id);

      await updateDoc(matchRef, {
        started: true,
        startedAt: serverTimestamp(),
      });

      const otherUserId = match.playerId === currentUserId ? match.opponentId : match.playerId;

      await addDoc(collection(db, "notifications"), {
        recipientId: otherUserId,
        matchId: match.id,
        message: "Your match has started!",
        timestamp: serverTimestamp(),
        read: false,
      });

      router.push(`/matches/${match.id}/complete`);
    } catch (error) {
      console.error("❌ Error starting match:", error);
    }
  };

  const deleteMatch = async (matchId: string) => {
    const confirmDelete = window.confirm("Are you sure you want to delete this match?");
    if (!confirmDelete) return;

    try {
      await deleteDoc(doc(db, "match_requests", matchId));
      setMatches((prev) => prev.filter((m) => m.id !== matchId));
    } catch (error) {
      console.error("❌ Error deleting match:", error);
    }
  };

  const handleChatClick = async (otherUserId: string) => {
    if (!currentUserId) return;

    const participants = [currentUserId, otherUserId].sort();

    const convoQuery = query(
      collection(db, "conversations"),
      where("participants", "==", participants)
    );

    const convoSnap = await getDocs(convoQuery);

    if (!convoSnap.empty) {
      const existingConvoId = convoSnap.docs[0].id;
      router.push(`/messages/${existingConvoId}`);
    } else {
      const newConvoRef = await addDoc(collection(db, "conversations"), {
        participants,
        createdAt: serverTimestamp(),
        lastRead: {
          [currentUserId]: serverTimestamp(),
          [otherUserId]: null,
        },
      });

      router.push(`/messages/${newConvoRef.id}`);
    }
  };

  const renderMatch = useCallback(
    (match: Match) => {
      const isRecipient = match.opponentId === currentUserId && match.status !== "accepted";
      const isSentByCurrentUser = match.playerId === currentUserId;
      const otherUserId = isSentByCurrentUser ? match.opponentId : match.playerId;

      const initiator = isSentByCurrentUser ? "You" : match.fromName;
      const recipient = isSentByCurrentUser ? match.toName : "You";

      return (
        <li key={match.id} className="border p-4 rounded-xl shadow-md relative">
          <div className="flex justify-between items-start">
            <p className="font-semibold">
              {initiator} → {recipient}
            </p>
            <button
              onClick={() => deleteMatch(match.id)}
              className="text-red-500 hover:text-red-700"
              title="Delete match"
            >
              <Trash2 size={18} />
            </button>
          </div>

          <p className="text-sm text-gray-700 mt-1">
            Message: {match.message || "No message"}
          </p>
          <p className="text-sm text-gray-700">Status: {match.status}</p>

{/* Court suggestion logic preserved but hidden for now */}
{/* 
{match.suggestedCourtName && match.suggestedCourtLat && match.suggestedCourtLng ? (
  <p className="text-sm text-gray-700">
    Suggested Court:{" "}
    <a
      href={`https://www.google.com/maps/search/?api=1&query=${match.suggestedCourtLat},${match.suggestedCourtLng}`}
      target="_blank"
      rel="noopener noreferrer"
      className="text-blue-600 underline"
    >
      {match.suggestedCourtName}
    </a>
  </p>
) : (
  <p className="text-sm text-gray-500 italic">🏗️ Court suggestion coming soon</p>
)} 
*/}

{/* Temporary placeholder until court suggestion rollout */}
<p className="text-sm text-gray-500 italic">🏗️ Court suggestion coming soon</p>

          {match.time && <p className="text-sm text-gray-700">Time: {match.time}</p>}

          <div className="flex gap-2 mt-3">
            {isRecipient && match.status !== "accepted" && (
              <button
                onClick={() => currentUserId && acceptMatch(match.id, currentUserId)}
                className="px-4 py-1 bg-green-600 text-white rounded"
              >
                Accept Match
              </button>
            )}
            {match.status === "accepted" && (
              <>
                <button
                  onClick={() => handleStartMatch(match)}
                  className="px-4 py-1 bg-purple-600 text-white rounded"
                >
                  Start Game
                </button>
                <button
                  onClick={() => handleChatClick(otherUserId)}
                  className="px-4 py-1 bg-blue-600 text-white rounded"
                >
                  Chat
                </button>
              </>
            )}
          </div>
        </li>
      );
    },
    [currentUserId]
  );

  const filteredMatches =
    tab === "accepted"
      ? matches
          .filter((m) => m.status === "accepted")
          .sort((a, b) => (b.createdAt?.toMillis?.() || 0) - (a.createdAt?.toMillis?.() || 0))
      : matches
          .filter((m) => m.status !== "accepted")
          .sort((a, b) => (b.createdAt?.toMillis?.() || 0) - (a.createdAt?.toMillis?.() || 0));

  return (
    <div className="p-4 max-w-2xl mx-auto">
      <h1 className="text-2xl font-bold mb-4">Match Requests</h1>

      <div className="flex gap-4 mb-4">
        <button
          onClick={() => setTab("accepted")}
          className={`px-4 py-1 rounded ${
            tab === "accepted" ? "bg-blue-600 text-white" : "bg-gray-200 text-gray-800"
          }`}
        >
          Accepted
        </button>
        <button
          onClick={() => setTab("pending")}
          className={`px-4 py-1 rounded ${
            tab === "pending" ? "bg-blue-600 text-white" : "bg-gray-200 text-gray-800"
          }`}
        >
          Pending
        </button>
      </div>

      {filteredMatches.length === 0 ? (
        <p>No matches in this tab.</p>
      ) : (
        <ul className="space-y-4">{filteredMatches.map(renderMatch)}</ul>
      )}
    </div>
  );
}

export default withAuth(MatchesPage);
