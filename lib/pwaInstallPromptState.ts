"use client";

const STORAGE_PREFIX = "tm_pwa_install_prompt";
const DISMISSED_AT_KEY = `${STORAGE_PREFIX}:dismissed_at`;
const VISIT_COUNT_KEY = `${STORAGE_PREFIX}:visit_count`;
const SESSION_COUNTED_KEY = `${STORAGE_PREFIX}:session_counted`;
const INSTALLED_KEY = `${STORAGE_PREFIX}:installed`;

export const PWA_INSTALL_DISMISS_COOLDOWN_MS = 30 * 24 * 60 * 60 * 1000;
export const PWA_INSTALL_VISIT_THRESHOLD = 3;

export function isStandalonePwa() {
  if (typeof window === "undefined") return false;

  const isDisplayStandalone = window.matchMedia?.("(display-mode: standalone)")?.matches;
  const isIosStandalone =
    "standalone" in window.navigator &&
    (window.navigator as Navigator & { standalone?: boolean }).standalone === true;

  return Boolean(isDisplayStandalone || isIosStandalone);
}

export function isPwaMarkedInstalled() {
  if (typeof window === "undefined") return false;
  return window.localStorage.getItem(INSTALLED_KEY) === "1";
}

export function markPwaInstalled() {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(INSTALLED_KEY, "1");
}

export function getPwaInstallPromptDismissedAt() {
  if (typeof window === "undefined") return null;

  const value = Number(window.localStorage.getItem(DISMISSED_AT_KEY) || "0");
  return Number.isFinite(value) && value > 0 ? value : null;
}

export function markPwaInstallPromptDismissed(dismissedAt = Date.now()) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(DISMISSED_AT_KEY, String(dismissedAt));
}

export function isPwaInstallPromptInCooldown(now = Date.now()) {
  const dismissedAt = getPwaInstallPromptDismissedAt();
  if (!dismissedAt) return false;
  return now - dismissedAt < PWA_INSTALL_DISMISS_COOLDOWN_MS;
}

export function getPwaInstallVisitCount() {
  if (typeof window === "undefined") return 0;

  const value = Number(window.localStorage.getItem(VISIT_COUNT_KEY) || "0");
  return Number.isFinite(value) && value > 0 ? value : 0;
}

export function recordPwaInstallVisit() {
  if (typeof window === "undefined") return 0;

  if (window.sessionStorage.getItem(SESSION_COUNTED_KEY) === "1") {
    return getPwaInstallVisitCount();
  }

  const nextCount = getPwaInstallVisitCount() + 1;
  window.localStorage.setItem(VISIT_COUNT_KEY, String(nextCount));
  window.sessionStorage.setItem(SESSION_COUNTED_KEY, "1");
  return nextCount;
}

export function shouldShowPwaInstallPrompt({
  onboardingComplete,
  visitCount,
}: {
  onboardingComplete: boolean;
  visitCount: number;
}) {
  if (typeof window === "undefined") return false;
  if (isStandalonePwa()) return false;
  if (isPwaMarkedInstalled()) return false;
  if (isPwaInstallPromptInCooldown()) return false;

  return onboardingComplete || visitCount >= PWA_INSTALL_VISIT_THRESHOLD;
}
