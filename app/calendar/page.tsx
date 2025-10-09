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
  CalendarDays,
  MapPin,
  Clock,
  ChevronRight,
  Ellipsis,
} from "lucide-react";
import { useRouter } from "next/navigation";

/* ---------------------------- Helper Functions ---------------------------- */
function groupByDate(items: any[]) {
  const by: Record<string, any[]> = {};
  items.forEach((e) => {
    const d = e.start ? new Date(e.start) : null;
    const key = d
      ? `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`
      : "unknown";
    (by[key] ??= []).push(e);
  });
  return Object.entries(by).sort(([a], [b]) => a.localeCompare(b));
}


function dateLabel(isoDay: string) {
  const d = new Date(isoDay);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const that = new Date(d);
  that.setHours(0, 0, 0, 0);
  const diff = (that.getTime() - today.getTime()) / 86400000;
  if (diff === 0) return "Today";
  if (diff === 1) return "Tomorrow";
  return d.toLocaleDateString(undefined, {
    weekday: "short",
    day: "2-digit",
    month: "short",
  });
}

function StatusStripe({ status }: { status?: string }) {
  const map: Record<string, string> = {
    accepted: "bg-emerald-500",
    pending: "bg-amber-500",
    cancelled: "bg-red-500",
    completed: "bg-gray-400",
  };
  return (
    <div
      className={`absolute left-0 top-0 h-full w-1.5 rounded-l-2xl ${
        map[status ?? "accepted"] || "bg-emerald-500"
      }`}
    />
  );
}

function StatusPill({ status }: { status?: string }) {
  const base = "px-2 py-0.5 text-[11px] rounded-full border";
  const s = status ?? "accepted";
  const map: Record<string, string> = {
    accepted: "bg-emerald-50 text-emerald-700 border-emerald-200",
    pending: "bg-amber-50 text-amber-700 border-amber-200",
    cancelled: "bg-red-50 text-red-700 border-red-200",
    completed: "bg-gray-50 text-gray-600 border-gray-200",
  };
  return <span className={`${base} ${map[s] || map.accepted}`}>{s[0].toUpperCase() + s.slice(1)}</span>;
}

/* --------------------------- Types for mini-profs -------------------------- */
type MiniProfile = { name?: string; photoURL?: string };

/* -------------------------------- Component ------------------------------- */
export default function CalendarPage() {
  const [events, setEvents] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const router = useRouter();


  // cache of userId -> mini profile
  const [profiles, setProfiles] = useState<Record<string, MiniProfile>>({});

  useEffect(() => {
    const offAuth = auth.onAuthStateChanged((u) => {
      let offSnap: undefined | (() => void);

      if (!u) {
        setEvents([]);
        setLoading(false);
        return;
      }

      const qRef = query(collection(db, "calendar_events"), where("ownerId", "==", u.uid));

      offSnap = onSnapshot(qRef, (snap) => {
        const all = snap.docs.map((d) => ({ id: d.id, ...d.data() } as any));
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
    events.forEach((e) => (e.participants ?? []).forEach((uid: string) => uid && set.add(uid)));
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

  /* ------------------------------ Empty State ------------------------------ */
  if (!loading && events.length === 0) {
    return (
      <main className="mx-auto w-full max-w-3xl px-4 py-8 text-center">
        <CalendarDays className="mx-auto mb-3 h-8 w-8 text-emerald-600" />
        <h1 className="text-2xl font-bold">My Calendar</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          When you join or host events, they’ll appear here.
        </p>
        <Link
          href="/events"
          className="mt-4 inline-flex items-center rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700"
        >
          Browse Events
        </Link>
      </main>
    );
  }

  /* ----------------------------- Grouped Layout ---------------------------- */
  return (
    <main className="mx-auto w-full max-w-4xl px-4 py-6">
  {/* 🎾 Hero Header */}
<section className="relative mb-6 overflow-hidden rounded-2xl border shadow-md">
  {/* Background image */}
  <img
    src="/images/calendar.jpg"
    alt="Calendar background"
    className="absolute inset-0 h-full w-full object-cover"
    loading="lazy"
    fetchPriority="low"
  />
  {/* Overlay for readability */}
  <div className="absolute inset-0 bg-black/40" />

  {/* Content */}
  <div className="relative z-10 p-6 text-white">
    <div className="flex items-center justify-between">
      <div>
        <h1 className="text-3xl font-bold tracking-tight drop-shadow-md">
          Your Match Calendar
        </h1>
        <p className="mt-1 text-sm text-gray-200 drop-shadow">
          View your upcoming games, practices, and social hits — all in one place.
        </p>
      </div>

      {/* TennisMate logo (optional) */}
      <img
        src="/logo.png"
        alt="TennisMate logo"
        className="h-10 w-10 opacity-90 drop-shadow-lg"
      />
    </div>
  </div>
</section>


      {loading ? (
        <p className="text-sm text-muted-foreground">Loading your events…</p>
      ) : (
        <div className="space-y-6">
          {groupByDate(events).map(([isoDay, list]) => (
            <section key={isoDay}>
              <div className="sticky top-0 -mx-4 mb-2 bg-gray-50/80 px-4 py-2 text-xs font-semibold uppercase tracking-wide text-gray-600 backdrop-blur">
                {dateLabel(isoDay)}
              </div>

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                {list.map((e) => {
                  const start = e.start ? new Date(e.start) : null;
                  const end = e.end ? new Date(e.end) : null;
                  const cancelled =
                    (e.status ?? "") === "cancelled" ||
                    (e.status ?? "") === "completed";
                  const href = e?.eventId ? `/events/${e.eventId}` : "#";

                  // pick up to 4 avatars from participants list
                  const avatarIds: string[] = (e.participants ?? []).filter(Boolean).slice(0, 4);

                  const CardContent = (
                    <div
                      className={`relative rounded-2xl border bg-white p-4 shadow-sm transition ${
                        cancelled ? "opacity-70 grayscale" : "hover:shadow-md hover:-translate-y-0.5"
                      }`}
                    >
                      <StatusStripe status={e.status} />

                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            <h3 className="truncate font-semibold leading-6">
                              {e.title || "Tennis Event"}
                            </h3>
                            {e.type && (
                              <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] text-emerald-700 border border-emerald-200">
                                {e.type}
                              </span>
                            )}
                          </div>

                          <div className="mt-1 flex flex-wrap items-center gap-3 text-sm text-gray-700">
                            <span className="inline-flex items-center gap-1">
                              <Clock className="h-4 w-4" />
                              {start
                                ? `${start.toLocaleDateString([], { weekday: "short" })} • ${start.toLocaleTimeString([], {
                                    hour: "2-digit",
                                    minute: "2-digit",
                                  })}${end ? `–${end.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}` : ""}`
                                : "—"}
                            </span>
                            {e.courtName && (
                              <span className="inline-flex items-center gap-1">
                                <MapPin className="h-4 w-4" />
                                {e.courtName}
                              </span>
                            )}
                            <StatusPill status={e.status ?? "accepted"} />
                          </div>
                        </div>

                        {/* Avatar stack */}
                        {avatarIds.length > 0 && (
                          <div className="shrink-0">
                            <div className="flex -space-x-2">
                              {avatarIds.map((uid) => {
                                const p = profiles[uid] || {};
                                const src = p.photoURL || "/default-avatar.png";
                                return (
                                  <Link
                                    key={uid}
                                    href={`/players/${uid}`}
                                    className="inline-block rounded-full ring-2 ring-white hover:z-10"
                                    title={p.name || "Player"}
                                  >
                                    <img
                                      src={src}
                                      alt={p.name || "Player"}
                                      className="h-8 w-8 rounded-full object-cover"
                                      loading="lazy"
                                      fetchPriority="low"
                                    />
                                  </Link>
                                );
                              })}
                            </div>
                          </div>
                        )}

                        <button
                          type="button"
                          className="rounded-md p-1 text-gray-500 hover:bg-gray-100"
                          aria-label="More actions"
                          onClick={(ev) => {
                            ev.preventDefault();
                            // Future: open actions menu
                          }}
                        >
                          <Ellipsis className="h-5 w-5" />
                        </button>
                      </div>

                      {!cancelled && (
                        <div className="mt-3 inline-flex items-center gap-1 text-sm font-medium text-emerald-700">
                          View details <ChevronRight className="h-4 w-4" />
                        </div>
                      )}
                    </div>
                  );

return (
<div
  key={e.id}
  role="link"
  tabIndex={e?.eventId ? 0 : -1}
  aria-label={e.title ? `Open event ${e.title}` : "Open event"}
  aria-disabled={!e?.eventId}
  className="block cursor-pointer focus:outline-none focus:ring-2 focus:ring-emerald-300 rounded-2xl"
  onClick={(ev) => {
    if ((ev.target as HTMLElement)?.closest("a,button")) return;
    if (!e?.eventId) return;
    router.push(`/events/${e.eventId}`);
  }}
  onKeyDown={(ev) => {
    if ((ev.key === "Enter" || ev.key === " ")) {
      if ((ev.target as HTMLElement)?.closest("a,button")) return;
      ev.preventDefault();
      if (!e?.eventId) return;
      router.push(`/events/${e.eventId}`);
    }
  }}
>
  {CardContent}
</div>

);

                })}
              </div>
            </section>
          ))}
        </div>
      )}
    </main>
  );
}
