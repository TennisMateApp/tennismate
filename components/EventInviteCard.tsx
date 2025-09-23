"use client";

import { useState } from "react";
import { cfUpdateEvent } from "@/lib/callables";

export default function EventInviteCard({ event }: { event: {
  id: string; title: string; start: Date; end: Date; location?: string; status: string;
} }) {
  const [loading, setLoading] = useState(false);

  const accept = async () => {
    setLoading(true);
    await cfUpdateEvent({ eventId: event.id, action: "ACCEPT" });
    setLoading(false);
  };
  const decline = async () => {
    setLoading(true);
    await cfUpdateEvent({ eventId: event.id, action: "DECLINE" });
    setLoading(false);
  };
  const cancelEvt = async () => {
    setLoading(true);
    await cfUpdateEvent({ eventId: event.id, action: "CANCEL" });
    setLoading(false);
  };

  return (
    <div className="rounded-xl border p-3 w-full max-w-md">
      <div className="text-sm text-zinc-500">{event.start.toLocaleString()} → {event.end.toLocaleTimeString()}</div>
      <div className="font-semibold">{event.title}</div>
      {event.location && <div className="text-sm">{event.location}</div>}
      <div className="mt-2 text-xs uppercase tracking-wide">Status: {event.status}</div>
      <div className="mt-3 flex gap-2">
        {event.status === "proposed" && (
          <>
            <button disabled={loading} onClick={accept} className="px-3 py-1 rounded bg-green-600 text-white">Accept</button>
            <button disabled={loading} onClick={decline} className="px-3 py-1 rounded bg-zinc-600 text-white">Decline</button>
          </>
        )}
        {event.status === "accepted" && (
          <button disabled={loading} onClick={cancelEvt} className="px-3 py-1 rounded bg-red-600 text-white">Cancel</button>
        )}
      </div>
    </div>
  );
}
