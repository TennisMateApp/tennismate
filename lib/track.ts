// lib/track.ts
import { getAnalyticsSafe } from "./firebaseConfig";
import { logEvent, setUserId } from "firebase/analytics";

/**
 * Track a GA4 event safely (won’t crash SSR or if analytics isn't supported).
 */
export async function track(eventName: string, params?: Record<string, any>) {
  try {
    const analytics = await getAnalyticsSafe();
    if (!analytics) return;
    logEvent(analytics, eventName, params);
  } catch {
    // silent fail (tracking should never break the app)
  }
}

/**
 * Attach Firebase UID to GA (helps user-level funnels).
 * Call this after login (or whenever auth state becomes known).
 */
export async function trackSetUserId(uid: string | null) {
  try {
    const analytics = await getAnalyticsSafe();
    if (!analytics) return;
    setUserId(analytics, uid ?? null);
  } catch {
    // silent
  }
}
