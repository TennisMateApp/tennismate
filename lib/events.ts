// lib/events.ts
import {
  addDoc,
  collection,
  serverTimestamp,
  Timestamp,
  updateDoc,
  doc,
} from "firebase/firestore";
import { db } from "@/lib/firebaseConfig";

export type EventState = "proposed" | "accepted" | "declined" | "cancelled";

export async function createProposal(params: {
  matchId: string;
  participants: string[];
  proposerId: string;
  startISO: string;
  durationMins: number;
  courtId?: string;
  courtName?: string;
  note?: string;
}) {
  const start = Timestamp.fromDate(new Date(params.startISO));
  const end = Timestamp.fromMillis(start.toMillis() + params.durationMins * 60 * 1000);

  // ✅ write ONLY the event document
  return await addDoc(collection(db, "match_events"), {
    matchId: params.matchId,
    participants: params.participants,
    proposerId: params.proposerId,
    state: "proposed" as EventState,
    start,
    end,
    durationMins: params.durationMins,
    courtId: params.courtId || null,
    courtName: params.courtName || null,
    note: "", // no notes
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
}

export async function respondToProposal(eventId: string, state: EventState) {
  await updateDoc(doc(db, "match_events", eventId), {
    state,
    updatedAt: serverTimestamp(),
  });
}

export async function cancelEvent(eventId: string) {
  await respondToProposal(eventId, "cancelled");
}
