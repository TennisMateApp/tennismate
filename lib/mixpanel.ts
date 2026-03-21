import mixpanel from "mixpanel-browser";

let initialized = false;

export function initMixpanel() {
  if (typeof window === "undefined") return;
  if (initialized) return;

  const token = process.env.NEXT_PUBLIC_MIXPANEL_TOKEN;

  if (!token) {
    console.warn("[Mixpanel] Missing NEXT_PUBLIC_MIXPANEL_TOKEN");
    return;
  }

  try {
    mixpanel.init(token, {
      debug: true,
      track_pageview: false,
      persistence: "localStorage",
    });

    initialized = true;
    console.log("[Mixpanel] initialized");
  } catch (err) {
    console.error("[Mixpanel] init failed", err);
  }
}

export function trackEvent(name: string, props?: Record<string, any>) {
  if (typeof window === "undefined") return;

  if (!initialized) {
    initMixpanel();
  }

  if (!initialized) {
    console.warn(`[Mixpanel] skipped "${name}" because Mixpanel is not initialized`);
    return;
  }

  try {
    mixpanel.track(name, props ?? {});
  } catch (err) {
    console.error(`[Mixpanel] track failed for "${name}"`, err);
  }
}

export function identifyUser(userId: string, props?: Record<string, any>) {
  if (typeof window === "undefined") return;

  if (!initialized) {
    initMixpanel();
  }

  if (!initialized) {
    console.warn("[Mixpanel] identify skipped because Mixpanel is not initialized");
    return;
  }

  try {
    mixpanel.identify(userId);
    if (props) {
      mixpanel.people.set(props);
    }
  } catch (err) {
    console.error("[Mixpanel] identify failed", err);
  }
}

export function resetMixpanel() {
  if (typeof window === "undefined") return;

  try {
    mixpanel.reset();
  } catch (err) {
    console.error("[Mixpanel] reset failed", err);
  }
}