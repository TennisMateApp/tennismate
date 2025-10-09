// app/events/page.tsx
"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import {
  collection,
  doc,
  getDoc,
  onSnapshot,
  orderBy,
  query,
  where,
} from "firebase/firestore";
import { auth, db } from "@/lib/firebaseConfig";
import { CalendarDays, MapPin, Users, Plus, CircleCheck } from "lucide-react";

type EventItem = {
  id: string;
  title?: string;
  type?: "singles" | "doubles" | "social" | string;
  location?: string;
  start?: string;
  end?: string;
  status?: "open" | "full" | "cancelled" | "completed" | string;
  spotsTotal?: number;
  spotsFilled?: number;
  minSkill?: number;
  hostId?: string;
  participants?: string[];
};

type Player = {
  name?: string;
  photoURL?: string;
  skillLevel?: number | null;
};

type EnrichedEvent = EventItem & {
  host?: Player;
  participantThumbs?: Player[];
};

const playerCache = new Map<string, Player>();
async function fetchPlayer(uid: string): Promise<Player | undefined> {
  if (!uid) return undefined;
  if (playerCache.has(uid)) return playerCache.get(uid);
  const snap = await getDoc(doc(db, "players", uid));
  if (!snap.exists()) return undefined;
  const data = snap.data() as Player;
  playerCache.set(uid, data);
  return data;
}

type Filter = "all" | "singles" | "doubles" | "social" | "mine";

export default function EventsPage() {
  const [events, setEvents] = useState<EnrichedEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<Filter>("all");
  const [uid, setUid] = useState<string | null>(null);

  useEffect(() => {
    const off = auth.onAuthStateChanged((u) => setUid(u?.uid ?? null));
    return () => off();
  }, []);

  useEffect(() => {
    const qRef = query(
      collection(db, "events"),
      where("status", "==", "open"),
      orderBy("start", "asc")
    );
    const off = onSnapshot(qRef, async (snap) => {
      const items: EnrichedEvent[] = await Promise.all(
        snap.docs.map(async (d) => {
          const data = d.data() as EventItem;
const ev: EnrichedEvent = { ...data, id: d.id };
          const host = ev.hostId ? await fetchPlayer(ev.hostId) : undefined;
          const ids =
            (ev.participants ?? []).filter((id) => id && id !== ev.hostId).slice(0, 3);
          const participantThumbs = (
            await Promise.all(ids.map((id) => fetchPlayer(id)))
          ).filter(Boolean) as Player[];
          return { ...ev, host, participantThumbs };
        })
      );
      setEvents(items);
      setLoading(false);
    });
    return () => off();
  }, []);

  const filtered = useMemo(() => {
    if (filter === "all") return events;
    if (filter === "mine") {
      if (!uid) return [];
      return events.filter(
        (e) => e.hostId === uid || (e.participants ?? []).includes(uid)
      );
    }
    return events.filter((e) => (e.type || "").toLowerCase() === filter);
  }, [events, filter, uid]);

  return (
    <main className="mx-auto w-full max-w-3xl px-4 py-6">
    {/* HERO HEADER (match events/[id]) */}
<section className="mb-6 relative overflow-hidden rounded-2xl border p-5 shadow-sm">
  {/* background image */}
  <div className="absolute inset-0 z-0">
    <img
      src="/images/events.jpg"
      alt=""
      className="h-full w-full object-cover"
      loading="lazy"
      fetchPriority="low"
    />
    <div className="absolute inset-0 bg-black/30" />
    <div className="absolute inset-x-0 bottom-0 h-24 bg-gradient-to-t from-black/35 to-transparent" />
  </div>

  {/* content */}
  <div className="relative z-10 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between text-white drop-shadow-[0_1px_1px_rgba(0,0,0,0.35)]">
    <div>
      <h1 className="text-2xl font-bold leading-tight">Events</h1>
      <span className="mt-2 inline-flex items-center rounded-full border border-amber-200 bg-amber-100/90 px-2 py-0.5 text-xs font-semibold text-amber-900">
        Premium
      </span>
    </div>

    <Link
      href="/events/new"
      className="inline-flex items-center gap-2 rounded-xl bg-green-600 px-3 py-2 text-sm font-medium text-white hover:bg-green-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70 focus-visible:ring-offset-2 focus-visible:ring-offset-black/20"
    >
      <Plus className="h-4 w-4" />
      Create Event
    </Link>
  </div>
</section>


      {/* Filters */}
      <div className="mb-6 flex flex-wrap items-center gap-2">
        {(["all", "singles", "doubles", "social", "mine"] as Filter[]).map((f) => {
          const isActive = filter === f;
          return (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={[
                "rounded-full px-3 py-1.5 text-sm font-medium transition",
                isActive
                  ? "bg-green-600 text-white"
                  : "bg-gray-100 text-gray-700 hover:bg-gray-200",
              ].join(" ")}
            >
              {f === "all"
                ? "All"
                : f === "mine"
                ? "Mine"
                : f[0].toUpperCase() + f.slice(1)}
            </button>
          );
        })}
      </div>

      {/* Loading */}
      {loading && (
        <ul className="space-y-4">
          {Array.from({ length: 3 }).map((_, i) => (
            <li key={i} className="rounded-2xl border border-gray-200 p-4 shadow-sm">
              <div className="h-5 w-40 animate-pulse rounded bg-gray-200" />
              <div className="mt-2 h-4 w-56 animate-pulse rounded bg-gray-100" />
              <div className="mt-4 h-2 w-full animate-pulse rounded bg-gray-100" />
            </li>
          ))}
        </ul>
      )}

      {/* Empty */}
      {!loading && filtered.length === 0 && (
        <div className="rounded-2xl border border-gray-200 p-8 text-center">
          <p className="text-sm text-gray-600">No events match your filter.</p>
        </div>
      )}

      {/* List */}
      {!loading && filtered.length > 0 && (
        <ul className="space-y-4">
          {filtered.map((ev) => (
            <li key={ev.id}>
              <EventCard ev={ev} />
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}

/* ------------------------- Event Card ------------------------- */

function EventCard({ ev }: { ev: EnrichedEvent }) {
  const start = ev.start ? new Date(ev.start) : null;
  const niceDate = start ? formatDateTime(start) : "TBA";
  const total = ev.spotsTotal ?? 0;
  const filled = ev.spotsFilled ?? 0;
  const percent = total > 0 ? Math.min(100, Math.round((filled / total) * 100)) : 0;

  return (
    <Link
      href={`/events/${ev.id}`}
      className="block rounded-2xl border border-gray-200 p-4 shadow-sm transition hover:-translate-y-0.5 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-600/70 focus-visible:ring-offset-2"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          {/* Title + Status */}
          <div className="flex items-center gap-2">
            <h2 className="truncate text-base font-semibold text-gray-900">
              {ev.title || "Tennis Event"}
            </h2>
            {ev.status === "open" && (
              <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2 py-0.5 text-[11px] font-medium text-emerald-800">
                <CircleCheck className="h-3.5 w-3.5" />
                Open
              </span>
            )}
          </div>

          {/* Host + participant avatars */}
          <div className="mt-2 flex items-center gap-3">
            {ev.host && (
              <>
                <img
                  src={ev.host.photoURL || "/default-avatar.png"}
                  alt={ev.host.name || "Host"}
                  className="h-8 w-8 rounded-full object-cover"
                />
                <p className="text-sm text-gray-800">
                  Hosted by{" "}
                  <span className="font-medium">{ev.host.name || "Unknown"}</span>
                </p>
              </>
            )}

            {ev.participantThumbs && ev.participantThumbs.length > 0 && (
              <div className="ml-2 flex -space-x-2">
                {ev.participantThumbs.map((p, i) => (
                  <img
                    key={i}
                    src={p.photoURL || "/default-avatar.png"}
                    alt={p.name || "Player"}
                    title={p.name || "Player"}
                    className="h-7 w-7 rounded-full border-2 border-white object-cover"
                  />
                ))}
              </div>
            )}
          </div>

          {/* Meta */}
          <div className="mt-2 flex flex-wrap items-center gap-3 text-sm">
            {ev.location && (
              <span className="inline-flex items-center gap-1 text-gray-800">
                <MapPin className="h-4 w-4" />
                {ev.location}
              </span>
            )}
            {start && (
              <span className="inline-flex items-center gap-1 text-gray-800">
                <CalendarDays className="h-4 w-4" />
                {niceDate}
              </span>
            )}
            {typeof ev.minSkill === "number" && (
              <span className="rounded-full bg-indigo-100 px-2 py-0.5 text-xs font-medium text-indigo-700">
                Min Skill {ev.minSkill}
              </span>
            )}
            {ev.type && (
              <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-800">
                {(ev.type[0] || "").toUpperCase() + ev.type.slice(1)}
              </span>
            )}
          </div>

          {/* Spots */}
          {typeof ev.spotsTotal === "number" && (
            <div className="mt-3">
              <div className="flex items-center justify-between text-xs">
                <span className="inline-flex items-center gap-1 text-gray-800">
                  <Users className="h-3.5 w-3.5" />
                  Spots
                </span>
                <span className="font-semibold text-gray-900">
                  {filled}/{total}
                </span>
              </div>
              <div className="mt-1 h-2 w-full overflow-hidden rounded-full bg-gray-200">
                <div
                  className="h-2 rounded-full bg-green-600 transition-[width]"
                  style={{ width: `${percent}%` }}
                />
              </div>
            </div>
          )}
        </div>

        {/* CTA */}
        <div className="shrink-0 self-center">
          <span className="rounded-xl border border-green-600 px-3 py-1 text-xs font-semibold text-green-700 hover:bg-green-50">
            View Details
          </span>
        </div>
      </div>
    </Link>
  );
}

/* ------------------------- Helpers ------------------------- */
function formatDateTime(d: Date) {
  return new Intl.DateTimeFormat(undefined, {
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "numeric",
    minute: "2-digit",
  }).format(d);
}
