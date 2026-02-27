"use client";

import Link from "next/link";
import TMDesktopSidebar from "@/components/desktop_layout/TMDesktopSidebar";
import { Plus, CalendarDays, MapPin, Heart } from "lucide-react";

export type Player = {
  name?: string;
  photoURL?: string | null;
  photoThumbURL?: string | null;
  avatar?: string | null;
  skillLevel?: number | null;
};

export type DesktopEventItem = {
  id: string;
  title?: string;
  type?: string;
  location?: string;
  start?: string;
  end?: string;
  spotsTotal?: number;
  spotsFilled?: number;
  participantThumbs?: Player[];
};

const pickPlayerImg = (p?: Player) =>
  p?.photoThumbURL || p?.photoURL || p?.avatar || "/default-avatar.png";

function formatLine(startISO?: string, endISO?: string) {
  if (!startISO) return "TBA";
  const start = new Date(startISO);
  const end = endISO ? new Date(endISO) : null;

  const datePart = start.toLocaleDateString([], {
    weekday: "long",
    month: "short",
    day: "numeric",
  });

  const startTime = start.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  const endTime = end ? end.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }) : "";

  return `${datePart} • ${startTime}${endTime ? ` - ${endTime}` : ""}`;
}

function typeTag(type?: string) {
  const t = (type || "").toLowerCase();
  if (t.includes("practice") || t.includes("drill")) return "PRACTICE";
  if (t.includes("competitive")) return "COMPETITIVE";
  if (t.includes("social")) return "SOCIAL";
  if (t.includes("double")) return "DOUBLES";
  if (t.includes("single")) return "SINGLES";
  return "EVENT";
}

function DesktopEventCard({ ev }: { ev: DesktopEventItem }) {
  const filled = ev.spotsFilled ?? 0;
  const total = ev.spotsTotal ?? 0;

  return (
    <div className="overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm">
      <div className="relative h-36 w-full">
        <img
          src="/images/eventspagetile.jpg"
          alt=""
          className="h-full w-full object-cover"
          loading="lazy"
        />

        {/* Tag */}
        <div className="absolute left-3 top-3">
          <span className="rounded-full bg-lime-300 px-2.5 py-1 text-[11px] font-extrabold text-green-950">
            {typeTag(ev.type)}
          </span>
        </div>

        {/* Save */}
        <button
          type="button"
          className="absolute right-3 top-3 grid h-9 w-9 place-items-center rounded-full bg-white/90 shadow-sm hover:bg-white"
          aria-label="Save event"
        >
          <Heart className="h-4 w-4 text-gray-800" />
        </button>

        {/* Participants */}
        {ev.participantThumbs && ev.participantThumbs.length > 0 && (
          <div className="absolute right-3 bottom-3 flex -space-x-2">
            {ev.participantThumbs.slice(0, 3).map((p, i) => (
              <img
                key={i}
                src={pickPlayerImg(p)}
                className="h-7 w-7 rounded-full border-2 border-white object-cover"
                alt={p.name || "Player"}
              />
            ))}
          </div>
        )}
      </div>

      <div className="p-4">
        <h3 className="text-sm font-extrabold text-gray-900 line-clamp-1">
          {ev.title || "Tennis Event"}
        </h3>

        <div className="mt-2 space-y-1 text-xs text-gray-600">
          <div className="flex items-center gap-2">
            <CalendarDays className="h-4 w-4 text-lime-600" />
            <span className="line-clamp-1">{formatLine(ev.start, ev.end)}</span>
          </div>

          {ev.location && (
            <div className="flex items-center gap-2">
              <MapPin className="h-4 w-4 text-lime-600" />
              <span className="line-clamp-1">{ev.location}</span>
            </div>
          )}
        </div>

        <div className="mt-4">
          <Link
            href={`/events/${ev.id}`}
            className="block w-full rounded-xl bg-lime-400 px-4 py-2 text-center text-xs font-extrabold text-green-950 hover:bg-lime-300"
          >
            View Event Details
          </Link>

          {total > 0 && (
            <p className="mt-2 text-[11px] text-gray-500 text-center">
              {filled}/{total} spots filled
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

function DesktopEventsPage({
  events,
  loading,
}: {
  events: DesktopEventItem[];
  loading: boolean;
}) {
return (
  <div className="min-h-screen bg-[#F7FAF8]">
    <div className="w-full px-8 2xl:px-12 py-8">
      <div className="grid gap-8 2xl:gap-10 xl:grid-cols-[300px_1fr]">
        {/* Sidebar (match home) */}
        <TMDesktopSidebar active="Calendar" player={null} />

        {/* Main (match home spacing) */}
        <main className="min-w-0">
          <div className="mt-2 grid gap-8 2xl:gap-10">
            <section className="min-w-0">
              {/* Header */}
              <div className="rounded-3xl border border-black/10 bg-white p-7 2xl:p-8">
                <div className="flex items-center justify-between gap-4">
                  <div className="min-w-0">
                    <h1 className="text-xl font-extrabold text-gray-900">
                      Trending Events
                    </h1>
                    <p className="mt-1 text-sm text-gray-600">
                      Discover popular games and sessions in your area
                    </p>
                  </div>

                  <Link
                    href="/events/new"
                    className="inline-flex shrink-0 items-center gap-2 rounded-2xl px-4 py-2 text-sm font-extrabold"
                    style={{ background: "#39FF14", color: "#0B3D2E" }}
                  >
                    <Plus className="h-4 w-4" />
                    Create Event
                  </Link>
                </div>
              </div>

              {/* Content */}
              <div className="mt-6">
                {loading ? (
                  <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-5">
                    {Array.from({ length: 6 }).map((_, i) => (
                      <div
                        key={i}
                        className="rounded-3xl border border-black/10 bg-white p-5 shadow-sm"
                      >
                        <div className="h-32 w-full animate-pulse rounded-2xl bg-black/5" />
                        <div className="mt-4 h-4 w-40 animate-pulse rounded bg-black/5" />
                        <div className="mt-2 h-3 w-56 animate-pulse rounded bg-black/5" />
                        <div className="mt-4 h-10 w-full animate-pulse rounded-2xl bg-black/5" />
                      </div>
                    ))}
                  </div>
                ) : events.length === 0 ? (
                  <div className="rounded-3xl border border-black/10 bg-white p-10 text-center">
                    <p className="text-sm text-gray-600">No events found.</p>
                  </div>
                ) : (
                  <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-5">
                    {events.map((ev) => (
                      <DesktopEventCard key={ev.id} ev={ev} />
                    ))}
                  </div>
                )}
              </div>
            </section>
          </div>
        </main>
      </div>
    </div>
  </div>
);
}

/**
 * ✅ IMPORTANT: export BOTH ways so you can’t accidentally import it wrong.
 * - default import:  import DesktopEventsPage from "..."
 * - named import:    import { DesktopEventsPage } from "..."
 */
export default DesktopEventsPage;
export { DesktopEventsPage };
