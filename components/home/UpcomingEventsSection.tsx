"use client";

import Link from "next/link";
import { CalendarDays, MapPin, Users } from "lucide-react";
import { getEventFilledSpots } from "@/lib/eventCapacity";

export type HomeDiscoveryEvent = {
  id: string;
  hostId?: string | null;
  title?: string | null;
  type?: string | null;
  start?: string | null;
  location?: string | null;
  court?: {
    suburb?: string | null;
    postcode?: string | null;
  } | null;
  spotsTotal?: number | null;
  spotsFilled?: number | null;
  participants?: string[] | null;
};

type UpcomingEventsSectionProps = {
  events: HomeDiscoveryEvent[];
  loading: boolean;
  compact?: boolean;
};

function formatEventStart(value?: string | null) {
  if (!value) return "Time TBA";
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "Time TBA";

  return date.toLocaleString(undefined, {
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "numeric",
    minute: "2-digit",
  });
}

function formatEventType(value?: string | null) {
  const text = String(value || "Event").replace(/[_-]+/g, " ").trim();
  return text ? text.replace(/\b\w/g, (letter) => letter.toUpperCase()) : "Event";
}

function spotsLabel(event: HomeDiscoveryEvent) {
  const total = typeof event.spotsTotal === "number" ? event.spotsTotal : 0;
  const filled = getEventFilledSpots(event);

  if (total <= 0) return "Spaces available";
  const remaining = Math.max(0, total - filled);
  return remaining === 1 ? "1 spot left" : `${remaining} spots left`;
}

export default function UpcomingEventsSection({
  events,
  loading,
  compact = false,
}: UpcomingEventsSectionProps) {
  return (
    <section className={compact ? "mt-6" : "mt-8"} aria-labelledby="upcoming-events-heading">
      <div className="mb-3 flex items-center justify-between gap-4">
        <div>
          <h2 id="upcoming-events-heading" className="text-sm font-extrabold text-black/85">
            Events near you
          </h2>
          <p className="mt-0.5 text-xs font-medium text-black/50">Nearby and upcoming events you can join</p>
        </div>
        <Link
          href="/events"
          className="shrink-0 text-xs font-extrabold tracking-wide text-green-700 hover:text-green-800"
        >
          SEE ALL
        </Link>
      </div>

      {loading ? (
        <div className="flex gap-3 overflow-hidden">
          {[0, 1, 2].map((item) => (
            <div
              key={item}
              className="h-40 min-w-[82%] animate-pulse rounded-3xl bg-black/5 sm:min-w-[260px]"
            />
          ))}
        </div>
      ) : events.length ? (
        <div className="flex snap-x snap-mandatory gap-3 overflow-x-auto pb-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {events.map((event) => {
            const place = event.court?.suburb || event.location || "Location TBA";

            return (
              <Link
                key={event.id}
                href={`/events/${event.id}`}
                className="group min-w-[82%] snap-start rounded-3xl border border-emerald-950/10 bg-[#F3F8F4] p-4 transition hover:-translate-y-0.5 hover:shadow-md sm:min-w-[260px] sm:max-w-[300px]"
              >
                <div className="flex items-center justify-between gap-3">
                  <span className="rounded-full bg-emerald-100 px-2 py-1 text-[10px] font-extrabold tracking-wider text-emerald-800">
                    {formatEventType(event.type)}
                  </span>
                  <span className="text-[11px] font-bold text-emerald-700">{spotsLabel(event)}</span>
                </div>

                <h3 className="mt-3 line-clamp-1 text-base font-extrabold text-slate-900 group-hover:text-emerald-800">
                  {event.title || "Tennis Event"}
                </h3>

                <div className="mt-3 space-y-2 text-xs font-semibold text-slate-600">
                  <div className="flex items-center gap-2">
                    <CalendarDays className="h-4 w-4 shrink-0 text-emerald-700" />
                    <span className="truncate">{formatEventStart(event.start)}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <MapPin className="h-4 w-4 shrink-0 text-emerald-700" />
                    <span className="truncate">{place}</span>
                  </div>
                </div>

                <div className="mt-4 flex items-center justify-between border-t border-emerald-950/10 pt-3">
                  <span className="inline-flex items-center gap-1.5 text-xs font-bold text-slate-600">
                    <Users className="h-4 w-4" /> Join players
                  </span>
                  <span className="text-xs font-extrabold text-emerald-700">View event ›</span>
                </div>
              </Link>
            );
          })}
        </div>
      ) : (
        <div className="rounded-3xl border border-black/10 bg-white p-4">
          <div className="text-sm font-extrabold text-black/80">No upcoming open events</div>
          <p className="mt-1 text-sm text-black/55">Be the first to organise a hit in your area.</p>
          <Link
            href="/events/new"
            className="mt-3 inline-flex rounded-2xl bg-[#39FF14] px-4 py-2 text-xs font-extrabold text-[#0B3D2E]"
          >
            Create an event
          </Link>
        </div>
      )}
    </section>
  );
}
