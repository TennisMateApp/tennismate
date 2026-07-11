"use client";

import type { Analytics } from "firebase/analytics";
import { app } from "@/lib/firebaseConfig";
import type { AnalyticsEventName } from "@/lib/analyticsEvents";

type AnalyticsValue = string | number | boolean | null | undefined;
type AnalyticsParams = Record<string, AnalyticsValue>;

let analyticsCache: Analytics | null = null;
let analyticsPromise: Promise<Analytics | null> | null = null;
let analyticsRuntimePromise: Promise<typeof import("firebase/analytics") | null> | null = null;

async function getAnalyticsRuntime() {
  if (typeof window === "undefined") return null;
  if (analyticsRuntimePromise) return analyticsRuntimePromise;

  analyticsRuntimePromise = import("firebase/analytics").catch(() => null);
  return analyticsRuntimePromise;
}

const BLOCKED_PARAM_KEYS = new Set([
  "email",
  "name",
  "displayName",
  "display_name",
  "phone",
  "phone_number",
  "phoneNumber",
  "message",
  "message_text",
  "message_body",
  "text",
  "body",
  "bio",
  "address",
  "token",
  "authToken",
  "auth_token",
  "accessToken",
  "access_token",
  "password",
  "uid",
  "userId",
  "user_id",
  "conversationId",
  "conversation_id",
  "matchRequestId",
  "match_request_id",
  "matchId",
  "match_id",
  "inviteId",
  "invite_id",
  "previousInviteId",
  "previous_invite_id",
  "historyId",
  "history_id",
  "playerId",
  "player_id",
  "opponentId",
  "opponent_id",
]);

async function getAnalyticsInstance() {
  if (typeof window === "undefined") return null;
  if (analyticsCache) return analyticsCache;
  if (analyticsPromise) return analyticsPromise;

  analyticsPromise = (async () => {
    try {
      const runtime = await getAnalyticsRuntime();
      if (!runtime || !(await runtime.isSupported())) return null;
      analyticsCache = runtime.getAnalytics(app);
      return analyticsCache;
    } catch {
      return null;
    } finally {
      analyticsPromise = null;
    }
  })();

  return analyticsPromise;
}

function getAppSurface() {
  if (typeof window === "undefined") return "web_browser";

  const standalone =
    window.matchMedia?.("(display-mode: standalone)")?.matches ||
    ("standalone" in window.navigator &&
      (window.navigator as Navigator & { standalone?: boolean }).standalone === true);

  return standalone ? "installed_pwa" : "web_browser";
}

function sanitizeParams(params?: AnalyticsParams) {
  const next: Record<string, string | number> = {
    app_surface: getAppSurface(),
  };

  Object.entries(params ?? {}).forEach(([key, value]) => {
    if (value == null) return;
    if (BLOCKED_PARAM_KEYS.has(key)) return;

    if (typeof value === "boolean") {
      next[key] = value ? 1 : 0;
      return;
    }

    if (typeof value === "number") {
      if (Number.isFinite(value)) next[key] = value;
      return;
    }

    const trimmed = value.trim();
    if (trimmed) next[key] = trimmed.slice(0, 100);
  });

  return next;
}

export async function trackEvent(eventName: AnalyticsEventName | string, params?: AnalyticsParams) {
  try {
    const safeParams = sanitizeParams(params);

    if (process.env.NODE_ENV !== "production") {
      console.info("[Analytics]", eventName, safeParams);
    }

    const analytics = await getAnalyticsInstance();
    if (!analytics) return;
    const runtime = await getAnalyticsRuntime();
    runtime?.logEvent(analytics, eventName, safeParams);
  } catch {
    // Analytics must never break the product experience.
  }
}

export async function identifyAnalyticsUser(userId: string, properties?: AnalyticsParams) {
  try {
    const analytics = await getAnalyticsInstance();
    if (!analytics) return;
    const runtime = await getAnalyticsRuntime();
    if (!runtime) return;

    runtime.setUserId(analytics, userId);
    runtime.setUserProperties(analytics, sanitizeParams(properties));
  } catch {
    // Analytics must never break auth or navigation.
  }
}

export async function clearAnalyticsUser() {
  try {
    const analytics = await getAnalyticsInstance();
    if (!analytics) return;
    const runtime = await getAnalyticsRuntime();
    runtime?.setUserId(analytics, null);
  } catch {
    // Analytics must never break logout.
  }
}

export function analyticsDistanceBand(distanceKm?: number | null) {
  if (typeof distanceKm !== "number" || !Number.isFinite(distanceKm)) return "unknown";
  if (distanceKm <= 5) return "0_to_5_km";
  if (distanceKm <= 10) return "5_to_10_km";
  if (distanceKm <= 15) return "10_to_15_km";
  if (distanceKm <= 25) return "15_to_25_km";
  return "over_25_km";
}

export function analyticsSkillBand(value?: string | null) {
  const normalized = String(value || "").toLowerCase();
  if (!normalized) return "unknown";
  if (normalized.includes("beginner")) return "beginner";
  if (normalized.includes("intermediate")) return "intermediate";
  if (normalized.includes("advanced") && normalized.includes("high")) return "high_advanced";
  if (normalized.includes("advanced")) return "advanced";
  return normalized.replace(/[^a-z0-9_]+/g, "_").slice(0, 40) || "unknown";
}

export function analyticsNotificationStatus() {
  if (typeof window === "undefined" || !("Notification" in window)) return "unsupported";
  return Notification.permission === "granted" ? "enabled" : "disabled";
}
