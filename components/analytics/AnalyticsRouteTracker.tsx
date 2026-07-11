"use client";

import { useEffect, useRef } from "react";
import { usePathname } from "next/navigation";
import { trackEvent } from "@/lib/analytics";
import { ANALYTICS_EVENTS } from "@/lib/analyticsEvents";

const UUID_OR_ID_SEGMENT =
  /^(?:[a-zA-Z0-9_-]{16,}|[a-f0-9]{20,}|[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12})$/i;

export function normalizeAnalyticsPath(pathname: string) {
  const clean = pathname.split("?")[0].replace(/\/+$/, "") || "/";
  const parts = clean.split("/").filter(Boolean);

  if (parts[0] === "players" && parts[1]) return "/players/[playerId]";
  if (parts[0] === "messages" && parts[1]) return "/messages/[conversationId]";
  if (parts[0] === "events" && parts[1] && parts[1] !== "new") return "/events/[eventId]";
  if (parts[0] === "invites" && parts[1]) return "/invites/[inviteId]";
  if (parts[0] === "coaches" && parts[1]) return "/coaches/[coachId]";
  if (parts[0] === "r" && parts[1]) return "/r/[code]";

  if (parts[0] === "matches" && parts[1] === "history" && parts[2]) {
    return "/matches/history/[historyId]";
  }
  if (parts[0] === "matches" && parts[1]) {
    if (parts[2] === "complete") return "/matches/[matchId]/complete";
    if (parts[2] === "feedback") return "/matches/[matchId]/feedback";
    if (parts[2] === "summary") return "/matches/[matchId]/summary";
    return "/matches/[matchId]";
  }

  return `/${parts.map((part) => (UUID_OR_ID_SEGMENT.test(part) ? "[id]" : part)).join("/")}`;
}

function pageNameForPath(path: string) {
  const names: Record<string, string> = {
    "/": "landing",
    "/home": "home",
    "/match": "match",
    "/matches": "matches",
    "/messages": "messages",
    "/directory": "directory",
    "/events": "events",
    "/events/new": "event_create",
    "/courts": "courts",
    "/coaches": "coaches",
    "/profile": "own_profile",
    "/settings": "settings",
    "/calendar": "calendar",
    "/players/[playerId]": "player_profile",
    "/messages/[conversationId]": "conversation",
    "/events/[eventId]": "event_detail",
    "/matches/[matchId]": "match_detail",
    "/matches/[matchId]/complete": "score_entry",
    "/matches/[matchId]/feedback": "match_feedback",
    "/matches/[matchId]/summary": "match_summary",
    "/matches/history/[historyId]": "match_history_detail",
    "/invites/[inviteId]": "invite_detail",
    "/coaches/[coachId]": "coach_profile",
  };

  return names[path] || path.replace(/^\//, "").replace(/\//g, "_").replace(/\[[^\]]+\]/g, "detail") || "unknown";
}

export default function AnalyticsRouteTracker() {
  const pathname = usePathname();
  const previousPathRef = useRef<string | null>(null);
  const lastTrackedPathRef = useRef<string | null>(null);

  useEffect(() => {
    if (!pathname) return;

    const pagePath = normalizeAnalyticsPath(pathname);
    if (lastTrackedPathRef.current === pagePath) return;

    const previousPagePath = previousPathRef.current || "session_entry";
    lastTrackedPathRef.current = pagePath;
    previousPathRef.current = pagePath;

    void trackEvent(ANALYTICS_EVENTS.APP_PAGE_VIEW, {
      page_name: pageNameForPath(pagePath),
      page_path: pagePath,
      previous_page_path: previousPagePath,
    });
  }, [pathname]);

  return null;
}
