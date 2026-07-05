"use client";

export type NotificationPromptVariant =
  | "onboarding_complete"
  | "after_match_request_sent"
  | "incoming_match_request"
  | "incoming_message"
  | "match_request_accepted"
  | "event_joined"
  | "home_banner";

export const NOTIFICATION_PROMPT_COOLDOWNS_MS: Record<NotificationPromptVariant, number | null> = {
  onboarding_complete: null,
  after_match_request_sent: 14 * 24 * 60 * 60 * 1000,
  incoming_match_request: 14 * 24 * 60 * 60 * 1000,
  incoming_message: 14 * 24 * 60 * 60 * 1000,
  match_request_accepted: 14 * 24 * 60 * 60 * 1000,
  event_joined: 30 * 24 * 60 * 60 * 1000,
  home_banner: 7 * 24 * 60 * 60 * 1000,
};

const STORAGE_PREFIX = "tm_notification_prompt";
const LAST_SHOWN_SESSION_KEY = `${STORAGE_PREFIX}:lastNotificationPromptShownAt`;
const SESSION_THROTTLE_MS = 10 * 60 * 1000;

type NotificationPromptDismissal = {
  dismissedAt: number;
};

type NotificationPromptShown = {
  shownAt: number;
};

export function isNotificationApiSupported() {
  return typeof window !== "undefined" && "Notification" in window;
}

export function getNotificationPermission(): NotificationPermission | "unsupported" {
  if (!isNotificationApiSupported()) return "unsupported";
  return window.Notification.permission;
}

export function getNotificationPromptStorageKey(variant: NotificationPromptVariant) {
  return `${STORAGE_PREFIX}:${variant}`;
}

function getNotificationPromptShownStorageKey(variant: NotificationPromptVariant) {
  return `${STORAGE_PREFIX}:${variant}:shown`;
}

export function getNotificationPromptDismissal(
  variant: NotificationPromptVariant
): NotificationPromptDismissal | null {
  if (typeof window === "undefined") return null;

  try {
    const raw = window.localStorage.getItem(getNotificationPromptStorageKey(variant));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<NotificationPromptDismissal>;
    return typeof parsed.dismissedAt === "number" ? { dismissedAt: parsed.dismissedAt } : null;
  } catch {
    return null;
  }
}

export function markNotificationPromptDismissed(
  variant: NotificationPromptVariant,
  dismissedAt = Date.now()
) {
  if (typeof window === "undefined") return;

  window.localStorage.setItem(
    getNotificationPromptStorageKey(variant),
    JSON.stringify({ dismissedAt } satisfies NotificationPromptDismissal)
  );
}

export function markNotificationPromptShown(variant: NotificationPromptVariant, shownAt = Date.now()) {
  if (typeof window === "undefined") return;

  window.sessionStorage.setItem(LAST_SHOWN_SESSION_KEY, String(shownAt));
  window.sessionStorage.setItem(
    getNotificationPromptShownStorageKey(variant),
    JSON.stringify({ shownAt } satisfies NotificationPromptShown)
  );
}

export function clearNotificationPromptDismissal(variant: NotificationPromptVariant) {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem(getNotificationPromptStorageKey(variant));
}

export function isNotificationPromptInCooldown(
  variant: NotificationPromptVariant,
  now = Date.now()
) {
  const dismissal = getNotificationPromptDismissal(variant);
  if (!dismissal) return false;

  const cooldownMs = NOTIFICATION_PROMPT_COOLDOWNS_MS[variant];
  if (cooldownMs == null) return true;

  return now - dismissal.dismissedAt < cooldownMs;
}

export function hasRegisteredPushDeviceToken() {
  if (typeof window === "undefined") return false;

  return Boolean(
    window.localStorage.getItem("tm_fcm_token") ||
      window.localStorage.getItem("tm_push_native_token") ||
      window.localStorage.getItem("tm_push_token")
  );
}

export function getLastNotificationPromptShownAt() {
  if (typeof window === "undefined") return null;

  const value = Number(window.sessionStorage.getItem(LAST_SHOWN_SESSION_KEY) || "0");
  return Number.isFinite(value) && value > 0 ? value : null;
}

export function isNotificationPromptSessionThrottled(now = Date.now()) {
  const lastShownAt = getLastNotificationPromptShownAt();
  if (!lastShownAt) return false;
  return now - lastShownAt < SESSION_THROTTLE_MS;
}

export function canShowNotificationPrompt(variant: NotificationPromptVariant) {
  const permission = getNotificationPermission();

  if (permission === "unsupported") return false;
  if (permission === "granted") return false;
  if (hasRegisteredPushDeviceToken()) return false;
  if (isNotificationPromptInCooldown(variant)) return false;
  if (isNotificationPromptSessionThrottled()) return false;

  return true;
}

export function shouldShowNotificationPrompt(variant: NotificationPromptVariant) {
  return canShowNotificationPrompt(variant);
}

export function resetNotificationPromptState() {
  if (typeof window === "undefined") return;

  const debugEnabled =
    process.env.NODE_ENV !== "production" ||
    process.env.NEXT_PUBLIC_ENABLE_ONBOARDING_DEBUG === "true";

  if (!debugEnabled) return;

  const localKeys: string[] = [];
  for (let index = 0; index < window.localStorage.length; index += 1) {
    const key = window.localStorage.key(index);
    if (key?.startsWith(STORAGE_PREFIX)) localKeys.push(key);
  }

  const sessionKeys: string[] = [];
  for (let index = 0; index < window.sessionStorage.length; index += 1) {
    const key = window.sessionStorage.key(index);
    if (key?.startsWith(STORAGE_PREFIX)) sessionKeys.push(key);
  }

  localKeys.forEach((key) => window.localStorage.removeItem(key));
  sessionKeys.forEach((key) => window.sessionStorage.removeItem(key));
}
