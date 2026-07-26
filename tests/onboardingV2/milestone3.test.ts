import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import test from "node:test";

import {
  getHomeWelcomeStatus,
  getMatchIntroStatus,
  isOnboardingV2Completed,
  ONBOARDING_V2_MATCH_INTRO_STEPS,
  shouldShowOnboardingV2HomeWelcome,
  shouldShowOnboardingV2MatchIntro,
} from "../../lib/onboardingGuidance";

const timestamp = {seconds: 20, nanoseconds: 0};
const v2User = {
  onboarding: {
    v2StartedAt: timestamp,
    version: 2,
    completedAt: timestamp,
    matchIntro: {status: "not_started", updatedAt: null},
    homeWelcome: {status: "not_seen", updatedAt: null},
  },
};

const progressSource = readFileSync("lib/useOnboardingProgress.ts", "utf8");
const readySource = readFileSync("components/onboarding-v2/OnboardingV2Flow.tsx", "utf8");
const matchSource = readFileSync("app/match/MatchClient.tsx", "utf8");
const desktopMatchSource = readFileSync("components/match/DesktopMatchPage.tsx", "utf8");
const introSource = readFileSync("components/onboarding-v2/MatchMeContextualIntro.tsx", "utf8");
const homeSource = readFileSync("app/home/HomeClient.tsx", "utf8");
const homeCardSource = readFileSync("components/onboarding-v2/HomeWelcomeCard.tsx", "utf8");
const analyticsSource = readFileSync("lib/analyticsEvents.ts", "utf8");

test("trusted V2 completion remains the contextual-guidance boundary", () => {
  assert.equal(isOnboardingV2Completed(v2User), true);
  assert.equal(getMatchIntroStatus(v2User), "not_started");
  assert.equal(getHomeWelcomeStatus(v2User), "not_seen");
  assert.doesNotMatch(progressSource, /activationTour|shouldShowLegacyOnboarding/);
});

test("guidance eligibility is bound to server state loaded for the active account", () => {
  assert.match(
    progressSource,
    /const userOnboardingLoaded = Boolean\(uid && userOnboardingLoadedForUid === uid\)/,
  );
  assert.match(
    progressSource,
    /\}, \(\) => \{\s*setUserOnboarding\(null\);\s*setUserOnboardingLoadedForUid\(null\);/,
  );
});

test("removed legacy state is neither read nor written by the shared runtime hook", () => {
  assert.doesNotMatch(progressSource, /activationTour|onboarding_(started|skipped|completed)/);
  assert.doesNotMatch(progressSource, /setDoc|patchOnboarding/);
});

test("Ready actions route directly and set only a non-sensitive session source signal", () => {
  assert.match(readySource, /markOnboardingV2EntrySource\("ready_primary"\); router\.push\("\/match"\)/);
  assert.match(readySource, /markOnboardingV2EntrySource\("ready_secondary"\); router\.push\("\/home"\)/);
  assert.match(readySource, /\{activated \? <div/);
  assert.doesNotMatch(readySource, /router\.push\("\/home"\)[\s\S]*router\.push\("\/match"\)/);
});

test("Match Me introduction has exactly the agreed three steps and copy", () => {
  assert.deepEqual(ONBOARDING_V2_MATCH_INTRO_STEPS.map(({number, name, heading}) => ({number, name, heading})), [
    {number: 1, name: "recommendations", heading: "Your recommended players"},
    {number: 2, name: "profile", heading: "View a player profile"},
    {number: 3, name: "invite", heading: "Send your first match request"},
  ]);
  assert.match(ONBOARDING_V2_MATCH_INTRO_STEPS[0].body, /location, playing level and availability/);
  assert.match(ONBOARDING_V2_MATCH_INTRO_STEPS[1].body, /level, availability and club/);
});

test("Match Me eligibility is V2-only, activated, verified, first-visit state", () => {
  const eligible = {
    stateLoaded: true,
    v2Completed: true,
    status: getMatchIntroStatus(v2User),
    profileActivated: true,
    emailVerified: true,
    hasSentFirstRequest: false,
  } as const;
  assert.equal(shouldShowOnboardingV2MatchIntro(eligible), true);
  assert.equal(shouldShowOnboardingV2MatchIntro({...eligible, v2Completed: false}), false);
  assert.equal(shouldShowOnboardingV2MatchIntro({...eligible, status: "completed"}), false);
  assert.equal(shouldShowOnboardingV2MatchIntro({...eligible, status: "skipped"}), false);
  assert.equal(shouldShowOnboardingV2MatchIntro({...eligible, hasSentFirstRequest: true}), false);
});

test("missing recommendations use static guidance and stable targets exist on mobile and desktop", () => {
  assert.match(introSource, /No recommendations are available right now/);
  assert.match(introSource, /hasRecommendations \?/);
  ["recommendations", "profile", "invite"].forEach((target) => {
    assert.match(matchSource, new RegExp(`data-v2-intro-target=.*${target}`));
    assert.match(desktopMatchSource, new RegExp(`data-v2-intro-target=.*${target}`));
  });
});

test("request and profile interactions preserve the existing action paths", () => {
  assert.match(matchSource, /const completesActiveMatchIntro = matchIntroOpen/);
  assert.match(matchSource, /await finishMatchIntro\("completed", "match_request"\)/);
  assert.equal((matchSource.match(/createMatchRequestWithRelationship\(/g) || []).length, 1);
  assert.match(matchSource, /openMatchPlayerProfile/);
  assert.match(matchSource, /if \(matchIntroOpen\) setMatchIntroStepIndex\(2\)/);
  assert.match(desktopMatchSource, /onClick=\{\(\) => onViewProfile/);
});

test("Home welcome is one-time, V2-only and yields to higher-priority prompts", () => {
  const eligible = {
    stateLoaded: true,
    v2Completed: true,
    status: getHomeWelcomeStatus(v2User),
    accountHealthy: true,
    higherPriorityPrompt: false,
  } as const;
  assert.equal(shouldShowOnboardingV2HomeWelcome(eligible), true);
  assert.equal(shouldShowOnboardingV2HomeWelcome({...eligible, v2Completed: false}), false);
  assert.equal(shouldShowOnboardingV2HomeWelcome({...eligible, status: "dismissed"}), false);
  assert.equal(shouldShowOnboardingV2HomeWelcome({...eligible, higherPriorityPrompt: true}), false);
  assert.match(homeSource, /shouldShowHomeNotificationBanner \|\|/);
  assert.match(homeSource, /clubPromptVisibility\.blocksWelcome/);
});

test("Home welcome uses agreed copy and persists both allowed outcomes", () => {
  assert.match(homeCardSource, /Welcome to your TennisMate home/);
  assert.match(homeCardSource, /See upcoming matches, messages, events and player activity here\./);
  assert.match(homeCardSource, /Find players/);
  assert.match(homeCardSource, /Dismiss/);
  assert.match(homeSource, /setHomeWelcomeStatus\("dismissed"\)/);
  assert.match(homeSource, /setHomeWelcomeStatus\("used_find_players"\)/);
  assert.match(homeSource, /markOnboardingV2EntrySource\("home_card"\)/);
  assert.match(homeSource, /router\.push\("\/match"\)/);
});

test("guidance persistence uses only rule-authorized terminal transitions", () => {
  assert.match(progressSource, /"onboarding\.matchIntro": \{status, updatedAt: serverTimestamp\(\)\}/);
  assert.match(progressSource, /"onboarding\.homeWelcome": \{status, updatedAt: serverTimestamp\(\)\}/);
  assert.match(progressSource, /matchIntroStatus !== "not_started"/);
  assert.match(progressSource, /homeWelcomeStatus !== "not_seen"/);
  assert.doesNotMatch(progressSource, /"onboarding\.version"/);
});

test("analytics names are exact, deduplicated and metadata remains non-sensitive", () => {
  [
    "onboarding_v2_match_intro_started",
    "onboarding_v2_match_intro_step_viewed",
    "onboarding_v2_match_intro_completed",
    "onboarding_v2_match_intro_skipped",
    "onboarding_v2_home_welcome_viewed",
    "onboarding_v2_home_welcome_dismissed",
    "onboarding_v2_home_welcome_find_players",
  ].forEach((name) => assert.match(analyticsSource, new RegExp(name)));
  assert.match(matchSource, /matchIntroViewedStepsRef/);
  assert.match(matchSource, /matchIntroTerminalEventRef/);
  const introAnalyticsBlock = matchSource.slice(
    matchSource.indexOf("ONBOARDING_V2_MATCH_INTRO_STARTED"),
    matchSource.indexOf("const matchIntroOverlay"),
  );
  assert.doesNotMatch(introAnalyticsBlock, /email:|uid:|postcode:|club:|skill:|birthYear:/);
});

test("contextual UI is keyboard accessible, reduced-motion aware and bottom-nav safe", () => {
  assert.match(introSource, /role="dialog"/);
  assert.match(introSource, /Step \{step\.number\} of/);
  assert.match(introSource, /event\.key !== "Escape"/);
  assert.match(introSource, /prefers-reduced-motion: reduce/);
  assert.match(introSource, /env\(safe-area-inset-bottom\)/);
  assert.match(introSource, /min-h-11/);
  assert.match(homeCardSource, /aria-labelledby/);
});
