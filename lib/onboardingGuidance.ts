export type OnboardingV2MatchIntroStatus = "not_started" | "completed" | "skipped";
export type OnboardingV2HomeWelcomeStatus = "not_seen" | "dismissed" | "used_find_players";
export type OnboardingV2EntrySource = "ready_primary" | "ready_secondary" | "home_card";
export type OnboardingV2MatchIntroStep = {
  number: 1 | 2 | 3;
  name: "recommendations" | "profile" | "invite";
  heading: string;
  body: string;
  target: "recommendations" | "profile" | "invite";
};

export const ONBOARDING_V2_MATCH_INTRO_STEPS: readonly OnboardingV2MatchIntroStep[] = [
  {
    number: 1,
    name: "recommendations",
    heading: "Your recommended players",
    body: "These players are matched using your location, playing level and availability.",
    target: "recommendations",
  },
  {
    number: 2,
    name: "profile",
    heading: "View a player profile",
    body: "Open a profile to check their level, availability and club before inviting them.",
    target: "profile",
  },
  {
    number: 3,
    name: "invite",
    heading: "Send your first match request",
    body: "When you find a good match, invite them to play.",
    target: "invite",
  },
] as const;

export const ONBOARDING_V2_ENTRY_SOURCE_KEY = "tm_onboarding_v2_entry_source";

type UnknownRecord = Record<string, unknown>;

const asRecord = (value: unknown): UnknownRecord | null =>
  value !== null && typeof value === "object" && !Array.isArray(value) ?
    value as UnknownRecord : null;

const hasTimestampValue = (value: unknown) => {
  if (value instanceof Date) return !Number.isNaN(value.getTime());
  const candidate = asRecord(value);
  return typeof candidate?.toDate === "function" ||
    (typeof candidate?.seconds === "number" && typeof candidate?.nanoseconds === "number");
};

const onboardingState = (userData: unknown) => {
  const user = asRecord(userData);
  return user ? asRecord(user.onboarding) : null;
};

export function isOnboardingV2Started(userData: unknown) {
  return hasTimestampValue(onboardingState(userData)?.v2StartedAt);
}

export function isOnboardingV2Completed(userData: unknown) {
  const onboarding = onboardingState(userData);
  return isOnboardingV2Started(userData) &&
    onboarding?.version === 2 &&
    hasTimestampValue(onboarding.completedAt);
}

export function getMatchIntroStatus(
  userData: unknown
): OnboardingV2MatchIntroStatus | null {
  if (!isOnboardingV2Completed(userData)) return null;
  const state = asRecord(onboardingState(userData)?.matchIntro);
  return state?.status === "not_started" ||
    state?.status === "completed" ||
    state?.status === "skipped" ? state.status : null;
}

export function getHomeWelcomeStatus(
  userData: unknown
): OnboardingV2HomeWelcomeStatus | null {
  if (!isOnboardingV2Completed(userData)) return null;
  const state = asRecord(onboardingState(userData)?.homeWelcome);
  return state?.status === "not_seen" ||
    state?.status === "dismissed" ||
    state?.status === "used_find_players" ? state.status : null;
}

export function shouldShowOnboardingV2MatchIntro(input: {
  stateLoaded: boolean;
  v2Completed: boolean;
  status: OnboardingV2MatchIntroStatus | null;
  profileActivated: boolean;
  emailVerified: boolean;
  hasSentFirstRequest: boolean;
}) {
  return input.stateLoaded &&
    input.v2Completed &&
    input.status === "not_started" &&
    input.profileActivated &&
    input.emailVerified &&
    !input.hasSentFirstRequest;
}

export function shouldShowOnboardingV2HomeWelcome(input: {
  stateLoaded: boolean;
  v2Completed: boolean;
  status: OnboardingV2HomeWelcomeStatus | null;
  accountHealthy: boolean;
  higherPriorityPrompt: boolean;
}) {
  return input.stateLoaded &&
    input.v2Completed &&
    input.status === "not_seen" &&
    input.accountHealthy &&
    !input.higherPriorityPrompt;
}

export function markOnboardingV2EntrySource(source: OnboardingV2EntrySource) {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.setItem(ONBOARDING_V2_ENTRY_SOURCE_KEY, source);
  } catch {
    // The persisted Firestore status remains the eligibility source of truth.
  }
}

export function consumeOnboardingV2EntrySource(): OnboardingV2EntrySource | null {
  if (typeof window === "undefined") return null;
  try {
    const value = window.sessionStorage.getItem(ONBOARDING_V2_ENTRY_SOURCE_KEY);
    window.sessionStorage.removeItem(ONBOARDING_V2_ENTRY_SOURCE_KEY);
    return value === "ready_primary" || value === "ready_secondary" || value === "home_card"
      ? value
      : null;
  } catch {
    return null;
  }
}
