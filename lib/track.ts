// lib/track.ts
import { logEvent, setUserId } from "firebase/analytics";
import { getAnalyticsSafe } from "./firebaseConfig";

/**
 * Track a GA4 event safely (won’t crash SSR and won’t fire until Analytics is supported).
 */
export async function track(eventName: string, params?: Record<string, any>) {
  try {
    const a = await getAnalyticsSafe();
    if (!a) return;
    logEvent(a, eventName, params);
  } catch {
    // silent fail (tracking should never break the app)
  }
}

/**
 * Attach Firebase UID to GA (helps user-level funnels).
 */
export async function trackSetUserId(uid: string | null) {
  try {
    const a = await getAnalyticsSafe();
    if (!a) return;
    setUserId(a, uid ?? null);
  } catch {
    // silent
  }
}
