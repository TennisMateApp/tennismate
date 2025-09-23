"use client";
import { useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import { auth, db } from "@/lib/firebaseConfig";
import { collection, onSnapshot, orderBy, query, where } from "firebase/firestore";
import ProposeTimeButton from "@/components/events/ProposeTimeButton";
import ProposalCard from "@/components/events/ProposalCard";
import { onAuthStateChanged } from "firebase/auth";

export default function MatchPage() {
  const params = useParams();
  const matchId = params?.id as string;

  const [uid, setUid] = useState<string>("");
  const [participants, setParticipants] = useState<string[]>([]);   // TODO: load from your match doc
  const [events, setEvents] = useState<any[]>([]);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (u) => setUid(u?.uid || ""));
    return () => unsub();
  }, []);

  // TODO: fetch participants from your match document (quick hack: infer from messages/conversation if available)
  useEffect(() => {
    // Replace with real participant load
    // setParticipants([uid, otherPlayerId]);
  }, [uid]);

  useEffect(() => {
    if (!matchId) return;
    const q = query(
      collection(db, "match_events"),
      where("matchId", "==", matchId),
      orderBy("start", "asc")
    );
    const unsub = onSnapshot(q, (snap) => {
      setEvents(snap.docs.map(d => ({ id: d.id, ...d.data() })));
    });
    return () => unsub();
  }, [matchId]);

  if (!uid) return null;

  return (
    <div className="max-w-2xl mx-auto space-y-4 p-4">
      {/* Place this near your chat or match details */}
      <div className="flex justify-end">
        {!!participants.length && (
          <ProposeTimeButton
            matchId={matchId}
            participants={participants}
            currentUserId={uid}
          />
        )}
      </div>

      <div className="space-y-3">
        {events.map((ev) => (
          <ProposalCard
            key={ev.id}
            eventId={ev.id}
            start={ev.start}
            end={ev.end}
            durationMins={ev.durationMins}
            courtName={ev.courtName}
            note={ev.note}
            state={ev.state}
            currentUserId={uid}
            participants={ev.participants}
          />
        ))}
      </div>
    </div>
  );
}
