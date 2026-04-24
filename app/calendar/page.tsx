// app/calendar/page.tsx
"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { auth, db } from "@/lib/firebaseConfig";
import {
  collection,
  onSnapshot,
  query,
  where,
  getDoc,
  doc,
} from "firebase/firestore";
import {
  ArrowLeft,
  ChevronLeft,
  ChevronRight,
  MapPin,
  CalendarDays,
} from "lucide-react";


import { useRouter } from "next/navigation";

import TMDesktopSidebar from "@/components/desktop_layout/TMDesktopSidebar";
import DesktopCalendarView from "@/components/calendar/DesktopCalendarView";
import { useIsDesktop } from "@/lib/useIsDesktop";
import ClientLayoutWrapper from "@/components/ClientLayoutWrapper";
import { resolveSmallProfilePhoto } from "@/lib/profilePhoto";

/* ---------------------------- Helper Functions ---------------------------- */
function toISODate(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
    d.getDate()
  ).padStart(2, "0")}`;
}

function parseISODate(iso: string) {
  // iso = YYYY-MM-DD (local date)
  const [y, m, day] = iso.split("-").map(Number);
  return new Date(y, (m || 1) - 1, day || 1);
}

function monthLabel(d: Date) {
  return d.toLocaleDateString(undefined, { month: "long", year: "numeric" });
}

function daysInMonth(year: number, monthIndex0: number) {
  return new Date(year, monthIndex0 + 1, 0).getDate();
}

function startWeekday(year: number, monthIndex0: number) {
  // 0=Sun
  return new Date(year, monthIndex0, 1).getDay();
}

function formatTimeParts(iso?: string) {
  if (!iso) return { time: "—", ampm: "" };
  const d = new Date(iso);
  const time = d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  // Some locales return "10:00 AM" in one string. We'll derive AM/PM if present.
  const parts = time.split(" ");
  if (parts.length >= 2) return { time: parts[0], ampm: parts[1] };
  // Fallback: show time only, ampm blank
  return { time, ampm: "" };
}

/* --------------------------- Types for mini-profs -------------------------- */
type MiniProfile = {
  name?: string;
  photoURL?: string;
  photoThumbURL?: string;
  avatar?: string;
};

/* -------------------------------- Component ------------------------------- */
export default function CalendarPage() {
  const [events, setEvents] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const router = useRouter();

  const isDesktop = useIsDesktop();

  // cache of userId -> mini profile
  const [profiles, setProfiles] = useState<Record<string, MiniProfile>>({});

  // Month view + selected day (for the calendar card UI)
  const today = useMemo(() => {
    const t = new Date();
    t.setHours(0, 0, 0, 0);
    return t;
  }, []);

  const [viewDate, setViewDate] = useState<Date>(() => new Date());
  const [selectedISO, setSelectedISO] = useState<string>(() => toISODate(new Date()));

  useEffect(() => {
    const offAuth = auth.onAuthStateChanged((u) => {
      let offSnap: undefined | (() => void);

      if (!u) {
        setEvents([]);
        setLoading(false);
        return;
      }

   const qRef = query(
  collection(db, "calendar_events"),
  where("ownerId", "==", u.uid)
);

      offSnap = onSnapshot(qRef, (snap) => {
        const all = snap.docs
  .map((d) => ({ id: d.id, ...d.data() } as any))
  .filter((e) => (e.status ?? "") !== "cancelled");
        const now = Date.now();

        const upcoming = all
          .filter((e) => {
            const t = e?.start ? new Date(e.start).getTime() : 0;
            return t >= now;
          })
          .sort((a, b) => {
            const ta = a?.start ? new Date(a.start).getTime() : 0;
            const tb = b?.start ? new Date(b.start).getTime() : 0;
            return ta - tb;
          });

        setEvents(upcoming);
        setLoading(false);
      });

      return () => {
        if (offSnap) offSnap();
      };
    });

    return () => offAuth();
  }, []);

  /* --------- load mini profiles for *all* unique participant ids ---------- */
  const neededIds = useMemo(() => {
    const set = new Set<string>();
    events.forEach((e) =>
      (e.participants ?? []).forEach((uid: string) => uid && set.add(uid))
    );
    return Array.from(set);
  }, [events]);


  useEffect(() => {
    if (!neededIds.length) return;

    let cancelled = false;
    (async () => {
      const updates: Record<string, MiniProfile> = {};
      await Promise.all(
        neededIds
          .filter((uid) => !profiles[uid])
          .map(async (uid) => {
            try {
              const s = await getDoc(doc(db, "players", uid));
              if (s.exists()) updates[uid] = (s.data() as MiniProfile) || {};
              else updates[uid] = {};
            } catch {
              updates[uid] = {};
            }
          })
      );
      if (!cancelled && Object.keys(updates).length) {
        setProfiles((prev) => ({ ...prev, ...updates }));
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [neededIds, profiles]);

  /* ----------------------------- Events for Day ---------------------------- */
  const eventsByISO = useMemo(() => {
    const map: Record<string, any[]> = {};
    events.forEach((e) => {
      const d = e.start ? new Date(e.start) : null;
      const key = d ? toISODate(d) : "unknown";
      (map[key] ??= []).push(e);
    });
    // Sort within each day by start time
    Object.keys(map).forEach((k) => {
      map[k].sort((a, b) => {
        const ta = a?.start ? new Date(a.start).getTime() : 0;
        const tb = b?.start ? new Date(b.start).getTime() : 0;
        return ta - tb;
      });
    });
    return map;
  }, [events]);

  const isTodayISO = (iso?: string) => !!iso && iso === toISODate(today);
const hasEventsISO = (iso?: string) => !!(iso && eventsByISO[iso]?.length);

  const todaysList = useMemo(() => eventsByISO[selectedISO] ?? [], [eventsByISO, selectedISO]);

  /* ------------------------------ Calendar Grid ---------------------------- */
  const year = viewDate.getFullYear();
  const month = viewDate.getMonth(); // 0-based

  const calendarCells = useMemo(() => {
    const total = daysInMonth(year, month);
    const start = startWeekday(year, month);

    // 6-week grid (42 cells)
    const cells: Array<{ day: number | null; iso?: string }> = [];
    for (let i = 0; i < 42; i++) {
      const dayNum = i - start + 1;
      if (dayNum >= 1 && dayNum <= total) {
        const iso = toISODate(new Date(year, month, dayNum));
        cells.push({ day: dayNum, iso });
      } else {
        cells.push({ day: null });
      }
    }
    return cells;
  }, [year, month]);

  const rightDateLabel = useMemo(() => {
    const d = parseISODate(selectedISO);
    return d.toLocaleDateString(undefined, { weekday: "long", month: "short", day: "numeric" });
  }, [selectedISO]);

  const goPrevMonth = () => {
    const d = new Date(year, month - 1, 1);
    setViewDate(d);

    // keep same day number if possible
    const cur = parseISODate(selectedISO);
    const nextDay = Math.min(cur.getDate(), daysInMonth(d.getFullYear(), d.getMonth()));
    setSelectedISO(toISODate(new Date(d.getFullYear(), d.getMonth(), nextDay)));
  };

  const goNextMonth = () => {
    const d = new Date(year, month + 1, 1);
    setViewDate(d);

    const cur = parseISODate(selectedISO);
    const nextDay = Math.min(cur.getDate(), daysInMonth(d.getFullYear(), d.getMonth()));
    setSelectedISO(toISODate(new Date(d.getFullYear(), d.getMonth(), nextDay)));
  };


/* ----------------------------- Desktop UI Layout -------------------------- */
if (isDesktop) {
  return (
    <div className="min-h-screen bg-[#F6FAF7]">
      {/* Full-width layout */}
      <div className="w-full px-6 py-6">
        {/* Sidebar + content */}
        <div className="grid grid-cols-[320px_1fr] gap-8 items-start">
          {/* Sidebar pinned to far left */}
          <div className="sticky top-6 self-start">
            <TMDesktopSidebar active="Home" />
          </div>

          {/* Main content spans the rest */}
          <DesktopCalendarView
            loading={loading}
            selectedISO={selectedISO}
            rightDateLabel={rightDateLabel}
            todaysList={todaysList}
            profiles={profiles}
            year={year}
            month={month}
            monthLabel={monthLabel(new Date(year, month, 1))}
            calendarCells={calendarCells}
            isTodayISO={isTodayISO}
            hasEventsISO={hasEventsISO}
            onPrevMonth={goPrevMonth}
            onNextMonth={goNextMonth}
            onSelectISO={(iso) => setSelectedISO(iso)}
           onOpenEvent={(calendarDocId) => {
  if (!calendarDocId) return;

  const e = events.find((x) => x.id === calendarDocId);
  if (!e) return;

  // Invite-based calendar event
  if (e?.source === "cf:syncCalendarOnInviteAccepted" && e?.messageId) {
    router.push(`/invites/${e.messageId}`);
    return;
  }

 // Normal event fallback
if (!e?.eventId) return;
router.push(`/events/${e.eventId}`);
}}
          />
        </div>
      </div>
    </div>
  );
}


  /* ----------------------------- Mobile UI Layout -------------------------- */
/* ----------------------------- Mobile UI Layout -------------------------- */
return (
  <ClientLayoutWrapper>
    <div className="w-full bg-[#F6FAF7]">
      {/* ✅ wrapper handles bottom nav, so we do normal page padding */}
      <div className="w-full px-4 pb-8">
        {/* Top App Bar */}
        <div className="flex items-center justify-between pt-4 bg-transparent">
          <button
            type="button"
            onClick={() => {
              if (typeof window !== "undefined" && window.history.length > 1) router.back();
              else router.push("/");
            }}
            className="h-10 w-10 rounded-full flex items-center justify-center"
            style={{ background: "transparent" }}
            aria-label="Back"
          >
            <ArrowLeft size={20} className="text-[#0B3D2E]" />
          </button>

          <div className="text-[16px] font-semibold text-slate-900">Calendar</div>

          {/* Spacer to keep title centered */}
          <div className="h-10 w-10" />
        </div>

        {/* Calendar Card */}
        <div className="mt-4 rounded-3xl bg-white border border-slate-200/50 shadow-sm p-5">
          {/* Month header */}
          <div className="flex items-center justify-between mb-3">
            <button
              onClick={goPrevMonth}
              className="h-9 w-9 rounded-full flex items-center justify-center bg-slate-900/5"
              aria-label="Previous month"
            >
              <ChevronLeft size={18} className="text-slate-900" />
            </button>

            <div className="text-[13px] font-semibold text-slate-900">
              {monthLabel(new Date(year, month, 1))}
            </div>

            <button
              onClick={goNextMonth}
              className="h-9 w-9 rounded-full flex items-center justify-center bg-slate-900/5"
              aria-label="Next month"
            >
              <ChevronRight size={18} className="text-slate-900" />
            </button>
          </div>

          {/* Weekday labels */}
          <div className="grid grid-cols-7 gap-1 text-[11px] mb-2">
            {["S", "M", "T", "W", "T", "F", "S"].map((w, i) => (
              <div key={`${w}-${i}`} className="text-center font-semibold text-slate-900/45">
                {w}
              </div>
            ))}
          </div>

          {/* Date grid */}
          <div className="grid grid-cols-7 gap-2">
            {calendarCells.map((c, idx) => {
              const isSelected = c.iso === selectedISO;
              const isToday = c.iso === toISODate(today);
              const hasEvents = !!(c.iso && eventsByISO[c.iso]?.length);

              return (
                <button
                  key={idx}
                  disabled={c.day === null}
                  onClick={() => {
                    if (!c.iso) return;
                    setSelectedISO(c.iso);
                    setViewDate(new Date(year, month, 1));
                  }}
                  className="h-12 rounded-full flex flex-col items-center justify-center text-[14px] font-semibold leading-none"
                  style={{
                    color: c.day ? "#0F172A" : "transparent",
                    background: isSelected ? "#39FF14" : "transparent",
                    opacity: c.day ? 1 : 0,
                    outline: isToday && !isSelected ? "2px solid rgba(11,61,46,0.20)" : "none",
                  }}
                  aria-label={c.day ? `Select day ${c.day}` : "Empty"}
                >
                  <span>{c.day ?? "0"}</span>

                  {hasEvents && (
                    <span
                      className="mt-0.5 h-1.5 w-1.5 rounded-full"
                      style={{ background: isSelected ? "#0B3D2E" : "#39FF14" }}
                    />
                  )}
                </button>
              );
            })}
          </div>
        </div>

        {/* Today’s Schedule header */}
        <div className="mt-5 flex items-end justify-between">
          <div>
            <div className="text-[16px] font-semibold text-slate-900">Today’s Schedule</div>
            <div className="text-[12px] mt-1 text-slate-900/55">
              {selectedISO === toISODate(today) ? "Today" : "Selected day"}
            </div>
          </div>

          <div className="text-[12px] font-semibold text-[#0B3D2E]">{rightDateLabel}</div>
        </div>

        {/* Schedule list */}
        <div className="mt-3 space-y-3">
          {loading ? (
            <div className="text-sm text-slate-900/55">Loading your events…</div>
          ) : todaysList.length === 0 ? (
            <div className="rounded-2xl border border-slate-200/60 bg-white p-4 text-sm text-slate-900/60">
              No events on this day.
              <div className="mt-2">
                <Link href="/events" className="text-[#0B3D2E] font-semibold">
                  Browse Events →
                </Link>
              </div>
            </div>
          ) : (
            todaysList.map((e: any) => {
              const { time, ampm } = formatTimeParts(e.start);
              const avatarIds: string[] = (e.participants ?? []).filter(Boolean).slice(0, 2);

              const isInvite = e?.source === "cf:syncCalendarOnInviteAccepted" && !!e?.messageId;
              const canOpen = isInvite || !!e?.eventId;

              return (
                <div
                  key={e.id}
                  role="link"
                  tabIndex={canOpen ? 0 : -1}
                  aria-disabled={!canOpen}
                  className="rounded-2xl px-3 py-3 flex items-center gap-3 shadow-sm border border-slate-200/60 bg-white cursor-pointer focus:outline-none focus:ring-2 focus:ring-emerald-300"
                  onClick={(ev) => {
                    if ((ev.target as HTMLElement)?.closest("a,button")) return;

                    if (isInvite && e?.messageId) {
                      router.push(`/invites/${e.messageId}`);
                      return;
                    }

                    if (!canOpen) return;
                    router.push(`/events/${e.eventId}`);
                  }}
                  onKeyDown={(ev) => {
                    if (ev.key !== "Enter" && ev.key !== " ") return;
                    if ((ev.target as HTMLElement)?.closest("a,button")) return;
                    ev.preventDefault();

                    if (isInvite && e?.messageId) {
                      router.push(`/invites/${e.messageId}`);
                      return;
                    }

                    if (!canOpen) return;
                    router.push(`/events/${e.eventId}`);
                  }}
                >
                  <div className="w-[62px] text-center">
                    <div className="text-[14px] font-bold text-slate-900">{time}</div>
                    <div className="text-[10px] font-semibold text-slate-900/55">{ampm}</div>
                  </div>

                  <div className="flex-1 min-w-0">
                    <div className="text-[14px] font-semibold truncate text-slate-900">
                      {e.title || "Tennis Event"}
                    </div>

                    <div className="mt-1 flex items-center gap-1 text-[12px] text-slate-900/55">
                      <MapPin size={14} />
                      <span className="truncate">{e.courtName || e.location || "Court TBA"}</span>
                    </div>
                  </div>

                  <div className="flex items-center -space-x-2">
                    {avatarIds.map((uid) => {
                      const p = profiles[uid] || {};
                      const src = resolveSmallProfilePhoto(p) || "/default-avatar.png";
                      return (
                        <Link
                          key={uid}
                          href={`/players/${uid}`}
                          className="inline-block rounded-full ring-2 ring-white hover:z-10"
                          title={p.name || "Player"}
                          onClick={(ev) => ev.stopPropagation()}
                        >
                          <img
                            src={src}
                            alt={p.name || "Player"}
                            className="h-9 w-9 rounded-full object-cover"
                            loading="lazy"
                          />
                        </Link>
                      );
                    })}
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  </ClientLayoutWrapper>
);
}
