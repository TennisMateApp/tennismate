"use client";

import { useState } from "react";
import { cfProposeEvent } from "@/lib/callables";
import { auth } from "@/lib/firebase";

export default function ProposeTimeModal({ open, onClose, otherUid, conversationId }: {
  open: boolean; onClose: () => void; otherUid: string; conversationId: string;
}) {
  const [title, setTitle] = useState("Tennis Match");
  const [date, setDate] = useState("");      // "2025-09-10"
  const [time, setTime] = useState("");      // "18:30"
  const [durationMin, setDurationMin] = useState(90);
  const [location, setLocation] = useState("");

  async function submit() {
    const me = auth.currentUser;
    if (!me) return;
    const startIso = new Date(`${date}T${time}:00`).toISOString();
    const endIso = new Date(new Date(startIso).getTime() + durationMin * 60000).toISOString();

    await cfProposeEvent({
      title,
      start: startIso,
      end: endIso,
      timeZone: "Australia/Melbourne",
      participants: [me.uid, otherUid],
      conversationId,
      location,
      notes: ""
    });

    onClose();
  }

  if (!open) return null;
  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center">
      <div className="bg-white dark:bg-zinc-900 p-4 rounded-2xl w-full max-w-md space-y-3">
        <h3 className="text-lg font-semibold">Propose a time</h3>
        <input className="w-full p-2 rounded border" placeholder="Title" value={title} onChange={e=>setTitle(e.target.value)} />
        <input className="w-full p-2 rounded border" type="date" value={date} onChange={e=>setDate(e.target.value)} />
        <input className="w-full p-2 rounded border" type="time" value={time} onChange={e=>setTime(e.target.value)} />
        <input className="w-full p-2 rounded border" type="number" min={15} step={15} value={durationMin} onChange={e=>setDurationMin(+e.target.value)} />
        <input className="w-full p-2 rounded border" placeholder="Location (optional)" value={location} onChange={e=>setLocation(e.target.value)} />
        <div className="flex gap-2 justify-end">
          <button className="px-3 py-2 rounded bg-zinc-700 text-white" onClick={onClose}>Cancel</button>
          <button className="px-3 py-2 rounded bg-blue-600 text-white" onClick={submit}>Send</button>
        </div>
      </div>
    </div>
  );
}
