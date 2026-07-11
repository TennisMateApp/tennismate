// Compatibility wrapper for older call sites. New product analytics should import
// from "@/lib/analytics" and use ANALYTICS_EVENTS constants directly.
import {
  clearAnalyticsUser,
  identifyAnalyticsUser,
  trackEvent,
} from "@/lib/analytics";

export async function track(eventName: string, params?: Record<string, any>) {
  await trackEvent(eventName, params);
}

export async function trackSetUserId(uid: string | null) {
  if (uid) {
    await identifyAnalyticsUser(uid);
  } else {
    await clearAnalyticsUser();
  }
}
