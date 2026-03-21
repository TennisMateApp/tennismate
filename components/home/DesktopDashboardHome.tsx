"use client";

import React, { useState } from "react";
import Image from "next/image";
import { Swords, CalendarDays, MapPin, GraduationCap, MapPin as Pin } from "lucide-react";
import { GiTennisBall } from "react-icons/gi";
import TMDesktopSidebar from "@/components/desktop_layout/TMDesktopSidebar";
import InviteOverlayCard from "@/components/invites/InviteOverlayCard";
import PlayerProfileView from "@/components/players/PlayerProfileView";

type ActivePlayer = {
  id: string;
  name?: string;
  photoURL?: string | null;
  photoThumbURL?: string | null;
  avatar?: string | null;
  lastActiveAt?: any;
};

type CalendarEvent = {
  id: string;
  title?: string | null;
  start?: string | null;
  end?: string | null;
  location?: string | null;
  courtName?: string | null;
  status?: string | null;

  eventId?: string | null;
  source?: string | null;
  messageId?: string | null;
  inviteId?: string | null;
  type?: string | null;

  participants?: string[] | null;
};

type DesktopDashboardHomeProps = {
  userName: string;
  levelLabel: string;
  avatarUrl: string | null;

  myMatches: any[];
  myMatchesLoading: boolean;

  oppByUid: Record<
    string,
    {
      name?: string;
      photoThumbURL?: string | null;
      photoURL?: string | null;
      avatar?: string | null;
    }
  >;

  uid: string | null;
  router: { push: (path: string) => void };

  nearbyActive: ActivePlayer[];
  nearbyActiveLoading: boolean;

  myCalendarEvents: CalendarEvent[];
  myCalendarEventsLoading: boolean;

  homeBootstrapping?: boolean;
};

export default function DesktopDashboardHome(props: DesktopDashboardHomeProps) {
   const {
    userName,
    levelLabel,
    avatarUrl,
    myMatches,
    myMatchesLoading,
    oppByUid,
    uid,
    router,
    nearbyActive,
    nearbyActiveLoading,
    myCalendarEvents,
    myCalendarEventsLoading,
    homeBootstrapping = false,
  } = props;

    const [openInviteId, setOpenInviteId] = useState<string | null>(null);
    const [openPlayerId, setOpenPlayerId] = useState<string | null>(null);
const [openPlayerCanMessage, setOpenPlayerCanMessage] = useState(false);

  const TM = {
    forest: "#0B3D2E",
    neon: "#39FF14",
    bg: "#F7FAF8",
    ink: "#0F172A",
  };

  const matchAccent = "#16A34A"; // clean green

  // Helper
  const getOtherUserId = (m: any, myUid: string) => {
    if (m.fromUserId === myUid) return m.toUserId;
    if (m.toUserId === myUid) return m.fromUserId;
    return null;
  };

    const getOpponentName = (m: any, myUid: string) => {
    if (m.fromUserId === myUid) {
      return m.toName || m.toUserName || m.toDisplayName || null;
    }

    if (m.toUserId === myUid) {
      return m.fromName || m.fromUserName || m.fromDisplayName || null;
    }

    return null;
  };

  const getOpponentUidFromParticipants = (e: any, myUid: string | null): string | null => {
    const parts: string[] = Array.isArray(e?.participants) ? e.participants : [];
    if (!parts.length) return null;
    if (!myUid) return parts[0] || null;
    return parts.find((pid) => pid && pid !== myUid) || null;
  };

  const formatStartLikeCard = (iso?: string | null) => {
    if (!iso) return "Time TBD";
    const d = new Date(iso);
    const time = d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });

    const today = new Date();
    const isToday =
      d.getFullYear() === today.getFullYear() &&
      d.getMonth() === today.getMonth() &&
      d.getDate() === today.getDate();

    if (isToday) return `Today, ${time}`;
    const day = d.toLocaleDateString(undefined, { weekday: "short" });
    return `${day}, ${time}`;
  };

  const getNextMatchHref = (e: any): string => {
    if (!e) return "/calendar";

    if (e?.source === "cf:syncCalendarOnInviteAccepted" && e?.messageId) {
      return `/invites/${e.messageId}`;
    }

    if ((e?.type === "invite" || String(e?.source ?? "").includes("invite")) && e?.inviteId) {
      return `/invites/${e.inviteId}`;
    }

    if (e?.eventId) return `/events/${e.eventId}`;

    return "/calendar";
  };

    const getInviteIdFromCalendarEvent = (e: any): string | null => {
    if (!e) return null;

    if (typeof e?.inviteId === "string" && e.inviteId) {
      return e.inviteId;
    }

    if (e?.source === "cf:syncCalendarOnInviteAccepted" && typeof e?.messageId === "string" && e.messageId) {
      return e.messageId;
    }

    if (
      (e?.type === "invite" || String(e?.source ?? "").includes("invite")) &&
      typeof e?.messageId === "string" &&
      e.messageId
    ) {
      return e.messageId;
    }

    return null;
  };

  const openConversationWithPlayer = (otherUid: string) => {
  if (!uid || !otherUid) return;

  const conversationId = [uid, otherUid].sort().join("_");
  router.push(`/messages/${conversationId}`);
};

  // ✅ Match status helpers
  const getMatchStatus = (m: any) => {
    const s = (m?.status ?? "").toString().toLowerCase();
    if (s === "accepted") return "accepted";
    if (s === "declined" || s === "rejected") return "declined";
    if (s === "completed" || s === "finished") return "completed";
    return "pending";
  };

  const statusToPill = (status: string) => {
    switch (status) {
      case "accepted":
        return {
          label: "ACCEPTED",
          accent: "#16A34A",
          bg: "rgba(22,163,74,0.12)",
          border: "rgba(22,163,74,0.25)",
        };
      case "declined":
        return {
          label: "DECLINED",
          accent: "#DC2626",
          bg: "rgba(220,38,38,0.10)",
          border: "rgba(220,38,38,0.22)",
        };
      case "completed":
        return {
          label: "COMPLETED",
          accent: "#2563EB",
          bg: "rgba(37,99,235,0.10)",
          border: "rgba(37,99,235,0.22)",
        };
      default:
        return {
          label: "PENDING",
          accent: "#64748B",
          bg: "rgba(100,116,139,0.10)",
          border: "rgba(100,116,139,0.22)",
        };
    }
  };

  // ✅ Match tiles: light neutral
  const MatchTileBG = () => (
    <>
      <div
        className="absolute inset-0"
        style={{
          background:
            "linear-gradient(180deg, rgba(245,247,249,1) 0%, rgba(236,239,243,1) 100%)",
        }}
      />
      <div className="pointer-events-none absolute inset-0 bg-black/[0.02]" />
      <div className="pointer-events-none absolute -right-24 -top-16 h-64 w-64 rounded-full bg-black/[0.03] blur-3xl" />
    </>
  );

  // ✅ EXACT match to mobile ActionTile background
  const MobileTileBG = () => (
    <>
      <div className="absolute inset-0 bg-emerald-950" />
      <div className="pointer-events-none absolute inset-0 bg-gradient-to-b from-white/8 to-transparent" />
      <div className="pointer-events-none absolute -right-10 -top-10 h-40 w-40 rounded-full bg-white/5" />
      <div className="pointer-events-none absolute -right-16 top-10 h-48 w-48 rounded-full bg-[#39FF14]/10" />
    </>
  );

  const NeonBottomBar = () => (
    <div
      className="absolute bottom-0 left-0 h-[6px] w-full"
      style={{ background: TM.neon, opacity: 0.8 }}
    />
  );

  const StatusPill = ({
    label,
    accent,
    bg,
    border,
  }: {
    label: string;
    accent: string;
    bg: string;
    border: string;
  }) => {
    return (
      <div
        className="absolute left-4 top-5 rounded-full px-3 py-1 text-[11px] font-extrabold tracking-widest"
        style={{
          background: bg,
          color: accent,
          border: `1px solid ${border}`,
        }}
      >
        {label}
      </div>
    );
  };

  const IconBubble = ({ children }: { children: React.ReactNode }) => (
    <div
      className="grid h-11 w-11 place-items-center rounded-2xl"
      style={{
        background: "rgba(255,255,255,0.08)",
        border: "1px solid rgba(255,255,255,0.10)",
      }}
    >
      {children}
    </div>
  );

  const nextEvent = myCalendarEvents?.[0] ?? null;

  return (
    <div className="min-h-screen" style={{ background: TM.bg }}>
      <div className="w-full px-8 2xl:px-12 py-8">
        <div className="grid gap-8 2xl:gap-10 xl:grid-cols-[300px_1fr]">
          {/* Sidebar */}
          <TMDesktopSidebar
            active="Home"
            player={{
              name: userName,
              skillLevel: levelLabel,
              photoURL: avatarUrl ?? null,
              photoThumbURL: avatarUrl ?? null,
              avatar: avatarUrl ?? null,
            }}
          />

          {/* Main */}
          <main className="min-w-0 xl:pr-[460px] 2xl:pr-[520px]">
            <div className="mt-2 grid gap-8 2xl:gap-10">
              {/* Left column */}
              <section className="min-w-0">
                {/* ✅ Active near you (SLIMMER) */}
                <div className="rounded-3xl border border-black/10 bg-white p-5 2xl:p-6">
                  <div className="flex items-center justify-between">
                    <div className="text-sm font-extrabold text-black/85">Active near you</div>

                    {!nearbyActiveLoading && nearbyActive?.length ? (
                      <div className="text-xs font-semibold text-black/45">
                        {nearbyActive.length} within 10km
                      </div>
                    ) : (
                      <div />
                    )}
                  </div>

                    {homeBootstrapping || nearbyActiveLoading ? (
                    <div className="mt-3 flex items-center gap-3">
                      <div className="h-4 w-40 rounded bg-black/5 animate-pulse" />
                      <div className="h-9 flex-1 rounded bg-black/5 animate-pulse" />
                    </div>
                                      ) : nearbyActive.length > 0 ? (
                    <div className="mt-3">
                      <div className="flex items-center -space-x-2">
                        {nearbyActive.slice(0, 12).map((p) => {
                          const src = p.photoThumbURL || p.photoURL || p.avatar || null;
                          const initial = (p.name || "?").trim().charAt(0).toUpperCase();

                          return (
                            <div
                              key={p.id}
                              className="relative h-9 w-9 overflow-hidden rounded-full ring-2 ring-white bg-gray-100"
                              title={p.name || "Player"}
                            >
                              {src ? (
                                <Image
                                  src={src}
                                  alt={p.name || "Player"}
                                  fill
                                  sizes="36px"
                                  className="object-cover"
                                />
                              ) : (
                                <div className="grid h-full w-full place-items-center text-[11px] font-bold text-gray-600">
                                  {initial}
                                </div>
                              )}
                            </div>
                          );
                        })}

                        {nearbyActive.length > 12 && (
                          <div className="relative h-9 w-9 rounded-full ring-2 ring-white bg-black/5 grid place-items-center text-[11px] font-extrabold text-black/60">
                            +{nearbyActive.length - 12}
                          </div>
                        )}
                      </div>
                    </div>
                  ) : (
                    <div className="mt-3 text-sm text-black/55">
                      No active players nearby right now.
                    </div>
                  )}
                </div>

                {/* ✅ Next Match (desktop, like mobile) */}
                <div className="mt-6 rounded-3xl border border-black/10 bg-white p-5 2xl:p-6">
                  <div className="flex items-center justify-between">
                    <div className="text-sm font-extrabold text-black/85">Next Game</div>
                    <button
                      onClick={() => router.push("/calendar")}
                      className="text-xs font-extrabold tracking-wide"
                      style={{ color: matchAccent }}
                    >
                      VIEW ALL
                    </button>
                  </div>

                  {homeBootstrapping || myCalendarEventsLoading ? (
                    <div className="mt-4 h-[96px] w-full rounded-2xl bg-black/5 animate-pulse" />
                  ) : nextEvent ? (
                    (() => {
                      const otherUid = getOpponentUidFromParticipants(nextEvent, uid);
                      const opp = otherUid ? oppByUid?.[otherUid] : null;

                      const opponentName = opp?.name || "Opponent";
                      const opponentPhoto = opp?.photoThumbURL || opp?.photoURL || opp?.avatar || null;

                     const whenLabel = formatStartLikeCard(nextEvent.start);
const whereLabel = nextEvent.courtName || nextEvent.location || "Court TBA";
const href = getNextMatchHref(nextEvent);
const inviteId = getInviteIdFromCalendarEvent(nextEvent);
const isInvite = !!inviteId;

                      return (
                        <div
                          className="mt-4 rounded-2xl p-4 overflow-hidden"
                          style={{ background: "rgba(22,163,74,0.06)", border: "1px solid rgba(22,163,74,0.15)" }}
                        >
                          <div className="flex items-start justify-between gap-4">
                            <div className="min-w-0">
                              <div
                                className="inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-extrabold tracking-widest"
                                style={{
                                  background: "rgba(22,163,74,0.12)",
                                  color: matchAccent,
                                  border: "1px solid rgba(22,163,74,0.25)",
                                }}
                              >
                                UPCOMING
                              </div>

                              <div className="mt-2 text-[18px] font-extrabold text-black/90 truncate">
                                {opponentName}
                              </div>

                              <div className="mt-1 flex items-center gap-2 text-sm text-black/60 truncate">
                                <Pin size={14} />
                                <span className="truncate">{whereLabel}</span>
                                <span className="text-black/30">·</span>
                                <span className="truncate">{whenLabel}</span>
                              </div>
                            </div>

                            <div className="relative h-14 w-14 shrink-0 overflow-hidden rounded-full ring-2 ring-white/70 bg-white">
                              {opponentPhoto ? (
                                <Image
                                  src={opponentPhoto}
                                  alt={opponentName}
                                  fill
                                  sizes="56px"
                                  className="object-cover"
                                />
                              ) : (
                                <div className="grid h-full w-full place-items-center text-[16px] font-extrabold text-black/60">
                                  {(opponentName || "O").trim().charAt(0).toUpperCase()}
                                </div>
                              )}
                            </div>
                          </div>

                          <button
  type="button"
  onClick={() => {
    if (isInvite && inviteId) {
      setOpenInviteId(inviteId);
      return;
    }

    router.push(href);
  }}
  className="mt-4 w-full rounded-2xl px-4 py-3 text-sm font-extrabold"
  style={{ background: matchAccent, color: "white" }}
>
  View Details ›
</button>
                        </div>
                      );
                    })()
                  ) : (
                    <div className="mt-4 rounded-2xl border border-black/10 bg-white p-4">
                      <div className="text-sm font-extrabold text-black/85">No upcoming matches</div>
                      <div className="mt-1 text-sm text-black/60">
                        Join or host an event and it’ll appear here.
                      </div>

                      <button
                        onClick={() => router.push("/events")}
                        className="mt-3 inline-flex items-center gap-2 rounded-2xl px-4 py-2 text-xs font-extrabold"
                        style={{ background: TM.neon, color: TM.forest }}
                      >
                        Browse events
                      </button>
                    </div>
                  )}
                </div>

                {/* Quick Actions */}
                <div className="mt-8 rounded-3xl border border-black/10 bg-white p-7 2xl:p-8">
                  <div className="text-sm font-extrabold text-black/85">Quick Actions</div>

                  <div className="mt-5 grid grid-cols-2 gap-6">
                    {[
                      {
                        label: "Match Me",
                        sub: "Find a partner now",
                        cta: "Start Match",
                        href: "/match",
                        icon: <Swords className="h-5 w-5" style={{ color: TM.neon }} />,
                      },
                      {
                        label: "Events",
                        sub: "Games & social hits",
                        cta: "Join or Host",
                        href: "/events",
                        icon: <CalendarDays className="h-5 w-5" style={{ color: TM.neon }} />,
                      },
                      {
                        label: "Courts",
                        sub: "Find courts near you",
                        cta: "Browse",
                        href: "/courts",
                        icon: <MapPin className="h-5 w-5" style={{ color: TM.neon }} />,
                      },
                      {
                        label: "Coaches",
                        sub: "Level up your game",
                        cta: "Find a Coach",
                        href: "/coaches",
                        icon: <GraduationCap className="h-5 w-5" style={{ color: TM.neon }} />,
                      },
                    ].map((x) => (
                      <button
                        key={x.label}
                        onClick={() => router.push(x.href)}
                        className="relative min-h-[140px] overflow-hidden rounded-3xl p-6 text-left shadow-sm transition-transform hover:-translate-y-[1px]"
                        style={{
                          border: "1px solid rgba(0,0,0,0.10)",
                          background: TM.forest,
                        }}
                      >
                        <MobileTileBG />

                        <div className="relative z-10 flex items-start justify-between gap-3">
                          <div className="flex items-start gap-4">
                            <IconBubble>{x.icon}</IconBubble>

                            <div className="min-w-0">
                              <div className="text-lg font-extrabold text-white">{x.label}</div>
                              <div className="mt-1 text-sm text-white/70">{x.sub}</div>
                            </div>
                          </div>
                        </div>

                        <div className="relative z-10 mt-6 text-sm font-semibold text-white/80">
                          {x.cta}
                        </div>

                        <NeonBottomBar />
                      </button>
                    ))}
                  </div>
                </div>
              </section>

              {/* Right rail */}
              <aside
                className="
                  min-w-0
                  xl:fixed xl:top-8 xl:right-8 2xl:right-12
                  xl:w-[420px] 2xl:w-[480px]
                  xl:max-h-[calc(100vh-4rem)]
                  xl:overflow-auto
                "
              >
                <div className="rounded-3xl border border-black/10 bg-white p-7 2xl:p-8">
                  <div className="flex items-center justify-between">
                    <div className="text-sm font-extrabold text-black/85">My TennisMates</div>
                    <button
                      onClick={() => router.push("/matches")}
                      className="text-xs font-extrabold tracking-wide"
                      style={{ color: TM.forest }}
                    >
                      SEE ALL
                    </button>
                  </div>

                  <div className="mt-4 space-y-3">
                    {homeBootstrapping || myMatchesLoading ? (
                      <>
                        <div className="h-14 rounded-2xl bg-black/5 animate-pulse" />
                        <div className="h-14 rounded-2xl bg-black/5 animate-pulse" />
                        <div className="h-14 rounded-2xl bg-black/5 animate-pulse" />
                      </>
                    ) : myMatches.length === 0 ? (
                      <div className="text-sm text-black/55">No matches yet.</div>
                    ) : (
                      myMatches.slice(0, 6).map((m) => {
                        const myUid = uid;
                        const otherUid = myUid ? getOtherUserId(m, myUid) : null;
                        if (!otherUid) return null;

                                               const directName = myUid ? getOpponentName(m, myUid) : null;
                        const cached = oppByUid?.[otherUid] ?? null;

                        const name = directName || cached?.name || "Player";
                        const photo =
                          cached?.photoThumbURL || cached?.photoURL || cached?.avatar || null;

                        const status = getMatchStatus(m);
                        const pill = statusToPill(status);

                        return (
                          <button
                            key={m.id}
                            onClick={() => {
  setOpenPlayerId(otherUid);
  setOpenPlayerCanMessage(
    ["accepted", "confirmed"].includes(String(m.status || "").toLowerCase())
  );
}}
                            className="relative w-full min-h-[120px] overflow-hidden rounded-3xl p-5 text-left shadow-sm transition-transform hover:-translate-y-[1px]"
                            style={{
                              border: "1px solid rgba(0,0,0,0.08)",
                              background: "#F5F7F9",
                            }}
                          >
                            <MatchTileBG />

                            <div
                              className="pointer-events-none absolute left-0 top-0 h-full w-1 rounded-l-3xl"
                              style={{ background: matchAccent }}
                            />

                            <StatusPill
                              label={pill.label}
                              accent={pill.accent}
                              bg={pill.bg}
                              border={pill.border}
                            />

                            <div className="relative z-10 mt-7 flex items-center gap-4">
                              <div className="min-w-0 flex-1">
                                <div className="text-lg font-extrabold text-black/90 truncate">
                                  {name}
                                </div>

                                <div className="mt-2 flex items-center gap-2 text-sm text-black/60">
  <span
    className="grid h-5 w-5 place-items-center rounded-full"
    style={{
      background: "rgba(22,163,74,0.12)",
      border: "1px solid rgba(22,163,74,0.25)",
    }}
  >
    <GiTennisBall size={12} color={matchAccent} />
  </span>
  <span>Tap to view profile</span>
</div>
                              </div>

                              <div
                                className="relative h-[84px] w-[84px] shrink-0 overflow-hidden rounded-2xl"
                                style={{
                                  border: "1px solid rgba(0,0,0,0.10)",
                                  background: "rgba(0,0,0,0.03)",
                                }}
                              >
                                {photo ? (
                                  <Image
                                    src={photo}
                                    alt={name}
                                    fill
                                    sizes="84px"
                                    className="object-cover"
                                  />
                                ) : (
                                  <div className="grid h-full w-full place-items-center text-2xl font-extrabold text-black/60">
                                    {name.trim().charAt(0).toUpperCase()}
                                  </div>
                                )}
                              </div>
                            </div>
                          </button>
                        );
                      })
                    )}
                  </div>
                </div>

                {/* ✅ REMOVED: progress bar section (as requested) */}
              </aside>
            </div>
          </main>
        </div>
      </div>

      {openPlayerId && (
  <div className="fixed inset-0 z-[999]">
    <div
      className="absolute inset-0 bg-black/40"
      onMouseDown={() => setOpenPlayerId(null)}
    />

    <div className="absolute inset-0 flex items-center justify-center p-4">
      <div
        className="w-full max-w-[560px] rounded-2xl overflow-hidden shadow-2xl"
        style={{ background: "#071B15" }}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div
          className="relative"
          style={{
            height: "min(88dvh, 820px)",
            maxHeight: "min(88dvh, 820px)",
          }}
        >
          <PlayerProfileView
            playerId={openPlayerId}
            onClose={() => setOpenPlayerId(null)}
          />

          {openPlayerCanMessage && (
            <div className="absolute bottom-0 left-0 right-0 p-4 bg-gradient-to-t from-black/35 to-transparent pointer-events-none">
              <div className="pointer-events-auto">
                <button
                  type="button"
                  onClick={() => {
                    const playerId = openPlayerId;
                    setOpenPlayerId(null);
                    if (playerId) openConversationWithPlayer(playerId);
                  }}
                  className="w-full rounded-2xl px-4 py-3 text-sm font-extrabold"
                  style={{
                    background: TM.neon,
                    color: TM.forest,
                  }}
                >
                  Send Message
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  </div>
)}

            {openInviteId && (
        <div className="fixed inset-0 z-[999]">
          <div
            className="absolute inset-0 bg-black/40"
            onMouseDown={() => setOpenInviteId(null)}
          />

          <div className="absolute inset-0 flex items-center justify-center p-4">
            <div
              className="w-[900px] max-w-[95vw] h-[85vh] max-h-[85svh] rounded-2xl overflow-hidden shadow-2xl bg-white border border-slate-200"
              onMouseDown={(e) => e.stopPropagation()}
            >
              <div className="flex items-center justify-between px-4 py-3 border-b border-slate-200 bg-slate-50">
                <div className="text-sm font-bold text-slate-900">Match Invite</div>

                <button
                  type="button"
                  onClick={() => setOpenInviteId(null)}
                  className="rounded-lg px-3 py-1.5 text-xs font-semibold border border-slate-200 bg-white hover:bg-slate-100"
                >
                  Close
                </button>
              </div>

              <InviteOverlayCard
                inviteId={openInviteId}
                onClose={() => setOpenInviteId(null)}
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}