"use client";
import { useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import { auth, db } from "@/lib/firebaseConfig";
import { collection, onSnapshot, orderBy, query, where } from "firebase/firestore";
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

}
