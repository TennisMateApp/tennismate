import mixpanel from "mixpanel-browser";

let initialized = false;

export function initMixpanel() {
  if (typeof window === "undefined") return;
  if (initialized) return;

  const token = process.env.NEXT_PUBLIC_MIXPANEL_TOKEN;

  if (!token) {
    console.warn("[Mixpanel] NEXT_PUBLIC_MIXPANEL_TOKEN is missing");
    return;
  }

  mixpanel.init(token, {
    debug: true,
    track_pageview: false,
    persistence: "localStorage",
  });

  initialized = true;
  console.log("[Mixpanel] initialized");
}

export function trackEvent(name: string, props?: Record<string, any>) {
  if (typeof window === "undefined") return;
  mixpanel.track(name, props);
}

export function identifyUser(userId: string, props?: Record<string, any>) {
  if (typeof window === "undefined") return;

  mixpanel.identify(userId);

  if (props) {
    mixpanel.people.set(props);
  }
}

export function resetMixpanel() {
  if (typeof window === "undefined") return;
  mixpanel.reset();
}