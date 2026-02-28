"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { ChevronLeft, ChevronRight, MapPin } from "lucide-react";
import InviteOverlayCard from "@/components/invites/InviteOverlayCard";

type MiniProfile = { name?: string; photoURL?: string };

export default function DesktopCalendarView(props: {
  // data
  loading: boolean;
  selectedISO: string;
  rightDateLabel: string;
  todaysList: any[];
  profiles: Record<string, MiniProfile>;

  // calendar
  year: number;
  month: number;
  monthLabel: string;
  calendarCells: Array<{ day: number | null; iso?: string }>;
  isTodayISO: (iso?: string) => boolean;
  hasEventsISO: (iso?: string) => boolean;

  // handlers
  onPrevMonth: () => void;
  onNextMonth: () => void;
  onSelectISO: (iso: string) => void;
  onOpenEvent: (eventId?: string) => void;
}) {
  const {
    loading,
    selectedISO,
    rightDateLabel,
    todaysList,
    profiles,

    monthLabel,
    calendarCells,
    isTodayISO,
    hasEventsISO,

    onPrevMonth,
    onNextMonth,
    onSelectISO,
    onOpenEvent,
  } = props;

  const [inviteOverlayId, setInviteOverlayId] = useState<string | null>(null);

useEffect(() => {
  if (!inviteOverlayId) return;

  const onKey = (e: KeyboardEvent) => {
    if (e.key === "Escape") setInviteOverlayId(null);
  };

  window.addEventListener("keydown", onKey);
  return () => window.removeEventListener("keydown", onKey);
}, [inviteOverlayId]);

  return (
    <div className="w-full">
      {/* Header */}
      <div className="flex items-start justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Calendar</h1>
          <p className="text-sm text-slate-500">
            Manage your matches and training sessions
          </p>
        </div>

        {/* Month selector pill */}
        <div className="flex items-center gap-2 rounded-xl bg-white border border-slate-200 px-3 py-2 shadow-sm">
          <button
            type="button"
            onClick={onPrevMonth}
            className="h-8 w-8 rounded-lg flex items-center justify-center hover:bg-slate-100"
            aria-label="Previous month"
          >
            <ChevronLeft size={18} />
          </button>

          <div className="text-sm font-semibold text-slate-900 min-w-[140px] text-center">
            {monthLabel}
          </div>

          <button
            type="button"
            onClick={onNextMonth}
            className="h-8 w-8 rounded-lg flex items-center justify-center hover:bg-slate-100"
            aria-label="Next month"
          >
            <ChevronRight size={18} />
          </button>
        </div>
      </div>

      {/* Main grid: Calendar + Right panel */}
      <div className="grid grid-cols-12 gap-6">
        {/* Calendar card */}
        <div className="col-span-8 rounded-2xl bg-white border border-slate-200 shadow-sm p-6">
          {/* Weekdays */}
          <div className="grid grid-cols-7 gap-2 text-xs font-semibold text-slate-500 mb-3 px-1">
            {[
              { k: "sun", l: "SUN" },
              { k: "mon", l: "MON" },
              { k: "tue", l: "TUE" },
              { k: "wed", l: "WED" },
              { k: "thu", l: "THU" },
              { k: "fri", l: "FRI" },
              { k: "sat", l: "SAT" },
            ].map((d) => (
              <div key={d.k} className="text-center">
                {d.l}
              </div>
            ))}
          </div>

          {/* Month grid */}
          <div className="grid grid-cols-7 gap-2">
            {calendarCells.map((c, idx) => {
              const isSelected = c.iso === selectedISO;
              const isToday = isTodayISO(c.iso);
              const hasEvents = hasEventsISO(c.iso);

              return (
                <button
                  key={idx}
                  type="button"
                  disabled={!c.day || !c.iso}
                  onClick={() => c.iso && onSelectISO(c.iso)}
                  className={`h-16 rounded-xl border text-left px-3 py-2 transition ${
                    !c.day
                      ? "border-transparent bg-transparent cursor-default"
                      : isSelected
                      ? "border-transparent bg-[#39FF14]/30"
                      : "border-slate-200 hover:bg-slate-50"
                  }`}
                >
                  {c.day ? (
                    <div className="flex items-start justify-between">
                      <div className="flex flex-col">
                        <div
                          className={`text-sm font-bold ${
                            isSelected ? "text-slate-900" : "text-slate-900"
                          }`}
                        >
                          {c.day}
                        </div>

                        {/* dot */}
                        {hasEvents && (
                          <div className="mt-2 h-1.5 w-1.5 rounded-full bg-[#39FF14]" />
                        )}
                      </div>

                      {/* Today marker ring (optional) */}
                      {isToday && !isSelected && (
                        <div className="h-7 w-7 rounded-full border-2 border-[#0B3D2E]/20" />
                      )}
                    </div>
                  ) : (
                    <div />
                  )}
                </button>
              );
            })}
          </div>
        </div>

        {/* Right panel */}
        <div className="col-span-4 rounded-2xl bg-white border border-slate-200 shadow-sm p-6">
          <div className="flex items-start justify-between mb-4">
            <div>
              <div className="text-lg font-bold text-slate-900">Today’s Schedule</div>
              <div className="text-xs font-semibold text-[#0B3D2E] mt-1">
                {rightDateLabel}
              </div>
            </div>
          </div>

          {loading ? (
            <div className="text-sm text-slate-500">Loading your events…</div>
          ) : todaysList.length === 0 ? (
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-600">
              No events on this day.
              <div className="mt-2">
                <Link href="/events" className="font-semibold text-[#0B3D2E]">
                  Browse Events →
                </Link>
              </div>
            </div>
          ) : (
            <div className="space-y-3">
              {todaysList.map((e: any) => {
                const start = e?.start ? new Date(e.start) : null;
                const time = start
                  ? start.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
                  : "—";
                const ampm = start
                  ? start.toLocaleTimeString([], { hour: "2-digit" }).includes("AM")
                    ? "AM"
                    : "PM"
                  : "";

                const avatarIds: string[] = (e.participants ?? []).filter(Boolean).slice(0, 2);

const inviteId = e?.inviteId || e?.matchInviteId || null;

const isMatchInvite =
  (String(e?.type || "").toLowerCase().includes("invite")) ||
  (String(e?.source || "").toLowerCase().includes("invite")) ||
  (String(e?.title || "").toLowerCase().includes("invite")) ||
  (String(e?.title || "").toLowerCase().includes("match invite")) ||
  !!e?.inviteId ||
  !!e?.matchInviteId;


// ✅ Build a Google Maps embed query from location text
const locText = String(e?.courtName || e?.location || "").trim();
const mapsQ = encodeURIComponent(locText);
const mapsEmbedSrc = locText
  ? `https://www.google.com/maps?q=${mapsQ}&output=embed`
  : "";

                return (
   <button
  key={e.id}
  type="button"
  onClick={() => {
    // ✅ If this is a match invite: open overlay instead of navigating
    if (isMatchInvite && inviteId) {
      setInviteOverlayId(inviteId);
      return;
    }

    // ✅ Otherwise open normal event
    onOpenEvent(e?.eventId);
  }}
  className="w-full text-left rounded-2xl border border-slate-200 bg-white p-4 hover:bg-slate-50 transition"
>
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <div className="text-lg font-bold text-slate-900 leading-none">
                          {time}
                        </div>
                        <div className="text-[10px] font-semibold text-slate-500 mt-1">
                          {ampm}
                        </div>
                      </div>

                      <div className="flex -space-x-2">
                        {avatarIds.map((uid) => {
                          const p = profiles[uid] || {};
                          const src = p.photoURL || "/default-avatar.png";
                          return (
                            <div
                              key={uid}
                              className="h-9 w-9 rounded-full ring-2 ring-white overflow-hidden bg-slate-100"
                              title={p.name || "Player"}
                            >
                              <img
                                src={src}
                                alt={p.name || "Player"}
                                className="h-full w-full object-cover"
                                loading="lazy"
                              />
                            </div>
                          );
                        })}
                      </div>
                    </div>

                    <div className="mt-3 font-semibold text-slate-900">
                      {e.title || "Tennis Event"}
                    </div>

                    <div className="mt-1 flex items-center gap-1 text-xs text-slate-500">
                      <MapPin size={14} />
                      <span className="truncate">
                        {e.courtName || e.location || "Court TBA"}
                      </span>
                    </div>
                    {/* ✅ Match invite: show embedded map preview */}
{isMatchInvite && mapsEmbedSrc && (
  <div className="mt-3 overflow-hidden rounded-xl border border-slate-200 bg-slate-50">
    <div className="relative w-full h-[160px]">
      <iframe
        title="Map preview"
        src={mapsEmbedSrc}
        className="absolute inset-0 w-full h-full"
        loading="lazy"
        referrerPolicy="no-referrer-when-downgrade"
      />
    </div>
  </div>
)}
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </div>
      {/* ✅ Invite overlay */}
{inviteOverlayId && (
  <div className="fixed inset-0 z-[9999]">
    {/* Backdrop */}
    <div
      className="absolute inset-0 bg-black/40"
      onMouseDown={() => setInviteOverlayId(null)}
    />

    {/* Modal */}
    <div className="absolute inset-0 flex items-center justify-center p-4">
      <div
        className="w-[900px] max-w-[95vw] h-[85vh] rounded-2xl overflow-hidden shadow-2xl bg-white border border-slate-200"
        onMouseDown={(e) => e.stopPropagation()}
      >
 <div className="flex items-center justify-between px-4 py-3 border-b border-slate-200 bg-slate-50">
  <div className="text-sm font-bold text-slate-900">Match Invite</div>

  <button
    type="button"
    onClick={() => setInviteOverlayId(null)}
    className="rounded-lg px-3 py-1.5 text-xs font-semibold border border-slate-200 bg-white hover:bg-slate-100"
  >
    Close
  </button>
</div>

   <InviteOverlayCard inviteId={inviteOverlayId} />
      </div>
    </div>
  </div>
)}
    </div>
  );
}
