"use client";

import Link from "next/link";
import {useCallback, useEffect, useMemo, useState} from "react";
import {onAuthStateChanged} from "firebase/auth";
import {useRouter, useSearchParams} from "next/navigation";
import {AlertCircle, ArrowLeft, ChevronDown, Info, Trophy} from "lucide-react";
import {auth} from "@/lib/firebaseConfig";
import {
  clearActivityLeaderboardCache,
  listPublishedActivityMonths,
  PublishedLeaderboard,
  readPublishedActivityLeaderboard,
} from "@/lib/activityLeaderboardClient";
import {activityLeaderboardViewState, defaultPublishedMonth, formatActivityMonth} from "@/lib/activityLeaderboardModel";
import LeaderboardRows, {LeaderboardRow} from "@/components/activityLeaderboard/LeaderboardRows";
import {ANALYTICS_EVENTS} from "@/lib/analyticsEvents";

const INITIAL_ROW_COUNT = 10;
const trackActivityEvent = async (eventName: string, params?: Record<string, string>) => {
  const {trackEvent} = await import("@/lib/analytics");
  await trackEvent(eventName, params);
};

function LoadingState() {
  return <div className="space-y-2" aria-label="Loading leaderboard">{Array.from({length: 5}, (_, index) => <div key={index} className="h-[74px] animate-pulse rounded-2xl bg-black/5" />)}</div>;
}

export default function ActivityLeaderboardClient() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const requestedMonth = searchParams.get("month");
  const [uid, setUid] = useState<string | null>(auth.currentUser?.uid || null);
  const [authReady, setAuthReady] = useState(Boolean(auth.currentUser));
  const [months, setMonths] = useState<string[]>([]);
  const [selectedMonth, setSelectedMonth] = useState<string | null>(null);
  const [leaderboard, setLeaderboard] = useState<PublishedLeaderboard | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "unavailable" | "error">("loading");
  const [showAll, setShowAll] = useState(false);

  useEffect(() => onAuthStateChanged(auth, (user) => {
    setUid(user?.uid || null);
    setAuthReady(true);
  }), []);

  const loadMonths = useCallback(async () => {
    if (!uid) return;
    setStatus("loading");
    try {
      const published = await listPublishedActivityMonths();
      setMonths(published);
      const requested = requestedMonth && /^\d{4}-\d{2}$/.test(requestedMonth) ? requestedMonth : null;
      setSelectedMonth(requested || defaultPublishedMonth(published));
      if (!requested && !published.length) setStatus("unavailable");
    } catch {
      setStatus("error");
    }
  }, [requestedMonth, uid]);

  useEffect(() => {if (authReady && uid) void loadMonths();}, [authReady, loadMonths, uid]);

  useEffect(() => {
    if (!uid || !selectedMonth) return;
    let active = true;
    setShowAll(false);
    setStatus("loading");
    void readPublishedActivityLeaderboard(selectedMonth)
      .then((result) => {
        if (!active) return;
        setLeaderboard(result);
        setStatus(result ? "ready" : "unavailable");
      })
      .catch(() => {if (active) setStatus("error");});
    return () => {active = false;};
  }, [selectedMonth, uid]);

  const currentUserRow = useMemo(() => leaderboard?.rows.find((row) => row.playerId === uid) || null, [leaderboard, uid]);
  const viewState = activityLeaderboardViewState(status, Boolean(leaderboard), leaderboard?.rows.length || 0);
  const currentUserIndex = currentUserRow ? leaderboard?.rows.findIndex((row) => row.playerId === uid) ?? -1 : -1;
  const visibleRows = leaderboard?.rows.slice(0, showAll ? leaderboard.rows.length : INITIAL_ROW_COUNT) || [];
  const currentUserOutsideRange = Boolean(currentUserRow && currentUserIndex >= INITIAL_ROW_COUNT && !showAll);

  const changeMonth = (month: string) => {
    const currentMonth = new Date().toISOString().slice(0, 7);
    void trackActivityEvent(ANALYTICS_EVENTS.ACTIVITY_LEADERBOARD_MONTH_CHANGED, {
      selected_month_category: month === currentMonth ? "current" : "historical",
    });
    setSelectedMonth(month);
    router.replace(`/activity-leaderboard?month=${encodeURIComponent(month)}`, {scroll: false});
  };

  const retry = () => {
    clearActivityLeaderboardCache();
    setLeaderboard(null);
    void loadMonths();
  };

  return (
    <div className="min-h-screen bg-[#F7FAF8] px-4 pb-28 pt-5 sm:px-6 lg:pb-12 lg:pt-8">
      <div className="mx-auto max-w-3xl">
        <div className="mb-5 flex items-center justify-between gap-3">
          <Link href="/home" className="inline-flex min-h-11 items-center gap-2 rounded-full px-2 text-sm font-bold text-emerald-950 hover:bg-black/5">
            <ArrowLeft className="h-5 w-5" /> Home
          </Link>
          {months.length > 0 && selectedMonth && (
            <label className="relative">
              <span className="sr-only">Leaderboard month</span>
              <select
                value={selectedMonth}
                onChange={(event) => changeMonth(event.target.value)}
                className="min-h-11 appearance-none rounded-full border border-black/10 bg-white py-2 pl-4 pr-10 text-sm font-extrabold text-slate-800 shadow-sm outline-none focus:ring-2 focus:ring-emerald-300"
              >
                {!months.includes(selectedMonth) && <option value={selectedMonth}>{formatActivityMonth(selectedMonth)} — unavailable</option>}
                {months.map((month) => <option key={month} value={month}>{formatActivityMonth(month)}</option>)}
              </select>
              <ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
            </label>
          )}
        </div>

        <header className="relative overflow-hidden rounded-[28px] bg-emerald-950 px-5 py-6 text-white shadow-lg sm:px-7 sm:py-8">
          <div className="absolute -right-10 -top-16 h-44 w-44 rounded-full bg-lime-300/15" />
          <div className="relative flex items-start gap-4">
            <div className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-lime-300 text-emerald-950"><Trophy className="h-6 w-6" /></div>
            <div>
              <p className="text-xs font-black uppercase tracking-[0.2em] text-lime-300">Monthly activity</p>
              <h1 className="mt-1 text-2xl font-black tracking-tight sm:text-3xl">Activity Leaderboard</h1>
              <p className="mt-2 max-w-xl text-sm leading-relaxed text-white/75">A friendly celebration of completed matches recorded in TennisMate and the people you play with.</p>
            </div>
          </div>
        </header>

        <main className="mt-5 rounded-[28px] border border-black/10 bg-white p-3 shadow-sm sm:p-5">
          {selectedMonth && <div className="mb-4 px-1"><h2 className="text-lg font-black text-slate-900">{formatActivityMonth(selectedMonth)}</h2><p className="text-xs font-medium text-slate-500">Published monthly standings</p></div>}
          {viewState === "loading" && <LoadingState />}
          {viewState === "error" && (
            <div className="rounded-2xl bg-rose-50 p-6 text-center"><AlertCircle className="mx-auto h-7 w-7 text-rose-600" /><h2 className="mt-2 font-black text-slate-900">We couldn&apos;t load the leaderboard</h2><p className="mt-1 text-sm text-slate-600">Please check your connection and try again.</p><button onClick={retry} className="mt-4 min-h-11 rounded-full bg-emerald-950 px-5 text-sm font-black text-white">Try again</button></div>
          )}
          {viewState === "unavailable" && (
            <div className="rounded-2xl bg-slate-50 p-7 text-center"><Info className="mx-auto h-7 w-7 text-slate-500" /><h2 className="mt-2 font-black text-slate-900">No published leaderboard for this month</h2><p className="mt-1 text-sm text-slate-600">Choose another published month, or check back after the next update.</p></div>
          )}
          {viewState === "empty" && leaderboard && (
            <div className="rounded-2xl bg-emerald-50 p-7 text-center"><h2 className="font-black text-emerald-950">The court is ready</h2><p className="mt-1 text-sm text-slate-600">There are no published rankings for this month yet.</p></div>
          )}
          {viewState === "ranked" && leaderboard && (
            <>
              <LeaderboardRows currentUserId={uid} rows={visibleRows} />
              {leaderboard.rows.length > INITIAL_ROW_COUNT && (
                <button type="button" onClick={() => setShowAll((value) => !value)} className="mt-4 min-h-11 w-full rounded-2xl border border-black/10 text-sm font-extrabold text-emerald-900 hover:bg-emerald-50">{showAll ? "Show top 10" : `Show all ${leaderboard.rows.length}`}</button>
              )}
              {currentUserOutsideRange && currentUserRow && (
                <section className="mt-5 border-t border-black/10 pt-5" aria-labelledby="your-position"><h2 id="your-position" className="mb-2 text-sm font-black text-slate-900">Your position</h2><ul><LeaderboardRow row={currentUserRow} currentUserId={uid} isTied={leaderboard.rows.filter((row) => row.rank === currentUserRow.rank).length > 1} /></ul></section>
              )}
              {!currentUserRow && (
                <div className="mt-5 rounded-2xl bg-emerald-50 p-4"><div className="font-black text-emerald-950">Want to join the standings?</div><p className="mt-1 text-sm leading-relaxed text-slate-600">Record a completed match in TennisMate this month. Your position will appear after a leaderboard update.</p></div>
              )}
              {leaderboard.malformedRowCount > 0 && <p className="mt-4 text-center text-xs text-slate-500">Some unavailable rows were safely omitted.</p>}
            </>
          )}
        </main>

        <details className="group mt-5 rounded-[24px] border border-black/10 bg-white p-5 shadow-sm" onToggle={(event) => {
          if (event.currentTarget.open) void trackActivityEvent(ANALYTICS_EVENTS.ACTIVITY_LEADERBOARD_POINTS_HELP_OPENED);
        }}>
          <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between font-black text-slate-900"><span className="flex items-center gap-2"><Info className="h-5 w-5 text-emerald-800" />How points work</span><ChevronDown className="h-5 w-5 transition group-open:rotate-180" /></summary>
          <div className="mt-4 space-y-4 text-sm leading-relaxed text-slate-600">
            <h2 className="text-base font-black text-slate-900">How to earn Activity Points</h2>
            <section><h3 className="font-black text-slate-800">Step 1 — Find a player</h3><p className="mt-1">Use <strong className="text-slate-800">Match Me</strong> to send a <strong className="text-slate-800">Match Request</strong>. Once it&apos;s accepted, organise your game through TennisMate <strong className="text-slate-800">Chat</strong>.</p></section>
            <section><h3 className="font-black text-slate-800">Step 2 — Schedule your match</h3><p className="mt-1">In Chat, tap <strong className="text-slate-800">Next Match</strong>, create a <strong className="text-slate-800">Match Invite</strong>, and have your opponent accept it.</p></section>
            <section><h3 className="font-black text-slate-800">Step 3 — Play your match</h3><p className="mt-1">Meet at the scheduled time and enjoy your match.</p></section>
            <section><h3 className="font-black text-slate-800">Step 4 — Confirm the result</h3><p className="mt-1">Around 30 minutes after the scheduled match time, TennisMate sends both players a notification and an in-app prompt. Confirm that the match was played and optionally record the score. Both players receive Activity Points.</p></section>
            <section><h3 className="font-black text-slate-800">Points</h3><ul className="mt-1 list-disc space-y-1 pl-5"><li><strong className="text-slate-800">10 points</strong> per completed match.</li><li><strong className="text-slate-800">5 bonus points</strong> for every different opponent each month.</li><li>Only the first four completed matches against the same opponent each month earn match points.</li></ul></section>
            <section><h3 className="font-black text-slate-800">When will my points appear?</h3><p className="mt-1">Points normally appear after completed matches have been processed. Some matches may take a little longer if they require review.</p></section>
          </div>
        </details>
      </div>
    </div>
  );
}
