"use client";

import { useEffect, useMemo, useState } from "react";
import { auth, db } from "@/lib/firebaseConfig";
import { onAuthStateChanged } from "firebase/auth";
import { collection, onSnapshot, query, where } from "firebase/firestore";

import FullCalendar from "@fullcalendar/react";
import dayGridPlugin from "@fullcalendar/daygrid";
import timeGridPlugin from "@fullcalendar/timegrid";
import interactionPlugin from "@fullcalendar/interaction";
import listPlugin from "@fullcalendar/list";

type Status = "proposed" | "accepted" | "declined" | "cancelled";
type CalEvent = {
  id: string;
  title: string;
  start: Date;
  end: Date;
  status: Status;
  location?: string;
};

function useIsMobile() {
  const [isMobile, setIsMobile] = useState(false);
  useEffect(() => {
    const check = () => setIsMobile(window.innerWidth < 768);
    check();
    window.addEventListener("resize", check);
    return () => window.removeEventListener("resize", check);
  }, []);
  return isMobile;
}

function formatRange(start: Date, end: Date) {
  const d = new Intl.DateTimeFormat(undefined, { weekday: "short", day: "numeric", month: "short" });
  const t = new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" });
  const sameDay = start.toDateString() === end.toDateString();
  return sameDay
    ? `${d.format(start)} · ${t.format(start)}–${t.format(end)}`
    : `${d.format(start)} ${t.format(start)} → ${d.format(end)} ${t.format(end)}`;
}

function statusChip(s: Status) {
  const map: Record<Status, { label: string; cls: string }> = {
    proposed: { label: "Proposed",  cls: "bg-amber-300/80 text-gray-800" },
    accepted: { label: "Accepted",  cls: "bg-emerald-300/80 text-emerald-900" },
    declined: { label: "Declined",  cls: "bg-gray-300/80 text-gray-700 line-through" },
    cancelled:{ label: "Cancelled", cls: "bg-red-200/80 text-red-900 line-through" },
  };
  const { label, cls } = map[s];
  return <span className={`text-xs px-2 py-0.5 rounded-full ${cls}`}>{label}</span>;
}

function MobileAgenda({ events }: { events: CalEvent[] }) {
  // group by YYYY-MM-DD
  const groups = useMemo(() => {
    const g: Record<string, CalEvent[]> = {};
    for (const e of events) {
      const key = e.start.toISOString().slice(0, 10);
      g[key] ??= [];
      g[key].push(e);
    }
    Object.values(g).forEach(arr => arr.sort((a,b)=>+a.start - +b.start));
    return Object.entries(g).sort(([a],[b]) => a.localeCompare(b));
  }, [events]);

  if (events.length === 0) {
    return (
      <div className="mt-6 rounded-2xl border bg-white p-6 text-center text-sm text-zinc-500">
        No events yet. Propose a time from a chat to get started.
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {groups.map(([dateIso, items]) => (
        <section key={dateIso}>
          <h3 className="mb-2 text-sm font-semibold text-zinc-600">
            {new Date(dateIso).toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long" })}
          </h3>
          <ul className="space-y-3">
            {items.map((e) => (
              <li key={e.id} className="rounded-2xl border bg-white p-4 shadow-sm">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="text-base font-semibold">{e.title}</div>
                    <div className="text-sm text-zinc-600">{formatRange(e.start, e.end)}</div>
                    {e.location && (
                      <div className="mt-1 text-sm text-zinc-600">📍 {e.location}</div>
                    )}
                  </div>
                  {statusChip(e.status)}
                </div>
                {/* Buttons you can wire to your callables later */}
                {e.status === "proposed" && (
                  <div className="mt-3 flex gap-2">
                    <button
                      className="rounded-xl bg-emerald-600 px-3 py-2 text-sm text-white"
                      onClick={() => alert("Accept from mobile agenda — wire to cfUpdateEvent")}
                    >
                      Accept
                    </button>
                    <button
                      className="rounded-xl bg-zinc-700 px-3 py-2 text-sm text-white"
                      onClick={() => alert("Decline from mobile agenda — wire to cfUpdateEvent")}
                    >
                      Decline
                    </button>
                  </div>
                )}
                {e.status === "accepted" && (
                  <div className="mt-3">
                    <button
                      className="rounded-xl bg-red-600 px-3 py-2 text-sm text-white"
                      onClick={() => alert("Cancel from mobile agenda — wire to cfUpdateEvent")}
                    >
                      Cancel
                    </button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

export default function CalendarPage() {
  const [uid, setUid] = useState<string | null>(null);
  const [rawEvents, setRawEvents] = useState<CalEvent[]>([]);
  const [filter, setFilter] = useState<"all" | "proposed" | "accepted">("all");
  const [loading, setLoading] = useState(true);
  const isMobile = useIsMobile();

  useEffect(() => {
    const off = onAuthStateChanged(auth, (user) => {
      if (!user) {
        setUid(null);
        setRawEvents([]);
        setLoading(false);
        return;
      }
      setUid(user.uid);

      const qy = query(
        collection(db, "calendar_events"),
        where("participants", "array-contains", user.uid)
      );

      const unsub = onSnapshot(qy, (snap) => {
        const rows: CalEvent[] = [];
        snap.forEach((doc) => {
          const d: any = doc.data();
          rows.push({
            id: doc.id,
            title: d.title || "Match",
            start: d.start?.toDate?.() || new Date(d.start),
            end: d.end?.toDate?.() || new Date(d.end),
            status: d.status,
            location: d.location,
          });
        });
        setRawEvents(rows);
        setLoading(false);
      });

      return () => unsub();
    });

    return () => off();
  }, []);

  const filtered = useMemo(
    () => rawEvents.filter((e) => (filter === "all" ? true : e.status === filter)),
    [rawEvents, filter]
  );

  // Desktop events mapped for FullCalendar
  const fcEvents = useMemo(
    () =>
      filtered.map((e) => ({
        id: e.id,
        title: e.title,
        start: e.start.toISOString(),
        end: e.end.toISOString(),
        className: e.status, // colored via CSS
        extendedProps: { status: e.status, location: e.location },
      })),
    [filtered]
  );

  if (!uid) {
    return (
      <div className="p-6">
        <h1 className="text-xl font-semibold">My Calendar</h1>
        <p className="text-sm mt-2">Please sign in to view your calendar.</p>
      </div>
    );
  }

  return (
    <div className="p-4 space-y-3">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">My Calendar</h1>
        <div className="flex items-center gap-2">
          <label className="text-sm">Filter:</label>
          <select
            className="border rounded px-2 py-1 text-sm bg-transparent"
            value={filter}
            onChange={(e) => setFilter(e.target.value as any)}
          >
            <option value="all">All</option>
            <option value="proposed">Proposed</option>
            <option value="accepted">Accepted</option>
          </select>
        </div>
      </div>

      {loading ? (
        <div className="text-sm text-zinc-500">Loading…</div>
      ) : isMobile ? (
        // ===== MOBILE: card agenda =====
        <MobileAgenda events={filtered} />
      ) : (
        // ===== DESKTOP: full calendar =====
        <FullCalendar
          plugins={[dayGridPlugin, timeGridPlugin, interactionPlugin, listPlugin]}
          initialView="timeGridWeek"
          headerToolbar={{ left: "prev,next today", center: "title", right: "dayGridMonth,timeGridWeek,timeGridDay,listWeek" }}
          views={{
            timeGridWeek: { buttonText: "Week" },
            timeGridDay: { buttonText: "Day" },
            dayGridMonth: { buttonText: "Month" },
            listWeek: { buttonText: "List" },
          }}
          height="auto"
          nowIndicator
          slotMinTime="06:00:00"
          slotMaxTime="22:00:00"
          slotDuration="00:30:00"
          scrollTime="18:00:00"
          events={fcEvents}
          eventClick={(info) => {
            const { status, location } = info.event.extendedProps as any;
            const when = formatRange(info.event.start!, info.event.end!);
            alert(`${info.event.title}\n${when}\nStatus: ${status}${location ? `\nLocation: ${location}` : ""}`);
          }}
        />
      )}

      <div className="text-xs text-zinc-500">
        Legend: <span className="inline-block rounded px-1 bg-amber-300/70">Proposed</span>{" "}
        • <span className="inline-block rounded px-1 bg-emerald-300/70">Accepted</span>
      </div>
    </div>
  );
}
