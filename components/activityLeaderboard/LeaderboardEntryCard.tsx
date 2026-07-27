"use client";

import {Trophy, ChevronRight} from "lucide-react";
import {useRouter} from "next/navigation";
import {useEffect, useRef} from "react";
import {ANALYTICS_EVENTS} from "@/lib/analyticsEvents";

const trackHomeCardEvent = async (eventName: string, source: "mobile_home" | "desktop_home") => {
  const {trackEvent} = await import("@/lib/analytics");
  await trackEvent(eventName, {source});
};

export default function LeaderboardEntryCard({compact = false, source, labelledBy}: {compact?: boolean; source: "mobile_home" | "desktop_home"; labelledBy: string}) {
  const router = useRouter();
  const viewed = useRef(false);
  useEffect(() => {
    if (viewed.current) return;
    viewed.current = true;
    void trackHomeCardEvent(ANALYTICS_EVENTS.ACTIVITY_LEADERBOARD_HOME_CARD_VIEWED, source);
  }, [source]);
  return (
    <button
      type="button"
      onClick={() => {
        void trackHomeCardEvent(ANALYTICS_EVENTS.ACTIVITY_LEADERBOARD_HOME_CARD_CLICKED, source);
        router.push("/activity-leaderboard");
      }}
      className={`group relative w-full overflow-hidden rounded-3xl border border-emerald-900/15 bg-white text-left shadow-sm transition hover:-translate-y-0.5 hover:shadow-md active:scale-[0.99] ${compact ? "p-4" : "p-5"}`}
      aria-label="Open Activity Leaderboard"
      aria-labelledby={`${labelledBy} ${source}-activity-leaderboard-title`}
    >
      <div className="pointer-events-none absolute -right-10 -top-12 h-32 w-32 rounded-full bg-lime-200/40" />
      <div className="relative flex items-center gap-3">
        <div className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-emerald-950 text-lime-300">
          <Trophy className="h-5 w-5" />
        </div>
        <div className="min-w-0 flex-1">
          <div id={`${source}-activity-leaderboard-title`} className="text-sm font-black text-slate-900 sm:text-base">Activity Leaderboard</div>
          <div className="mt-0.5 text-xs font-medium text-slate-600 sm:text-sm">See this month&apos;s most active TennisMates</div>
        </div>
        <ChevronRight className="h-5 w-5 shrink-0 text-emerald-800 transition group-hover:translate-x-0.5" />
      </div>
    </button>
  );
}
