import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import test from "node:test";

import {
  getClubMembershipPromptVisibility,
} from "../../lib/clubMembershipPrompt";
import {
  getHomeWelcomeStatus,
  shouldShowOnboardingV2HomeWelcome,
} from "../../lib/onboardingGuidance";

const NOW = Date.UTC(2026, 6, 26);
const timestamp = {seconds: 20, nanoseconds: 0};
const v2User = {
  onboarding: {
    v2StartedAt: timestamp,
    version: 2,
    completedAt: timestamp,
    homeWelcome: {status: "not_seen", updatedAt: null},
  },
};
const baseEligibility = {
  stateLoaded: true,
  v2Completed: true,
  status: getHomeWelcomeStatus(v2User),
  accountHealthy: true,
} as const;

const homeSource = readFileSync("app/home/HomeClient.tsx", "utf8");
const promptSource = readFileSync("components/clubs/ClubMembershipPrompt.tsx", "utf8");
const visibilityHookSource = readFileSync("lib/useClubMembershipPromptVisibility.ts", "utf8");
const progressSource = readFileSync("lib/useOnboardingProgress.ts", "utf8");
const readySource = readFileSync("components/onboarding-v2/OnboardingV2Flow.tsx", "utf8");
const matchSource = readFileSync("app/match/MatchClient.tsx", "utf8");
const desktopHomeSource = readFileSync("components/home/DesktopDashboardHome.tsx", "utf8");

function eligibilityWithClubPrompt(clubPromptBlocksWelcome: boolean) {
  return shouldShowOnboardingV2HomeWelcome({
    ...baseEligibility,
    higherPriorityPrompt: clubPromptBlocksWelcome,
  });
}

test("a genuinely visible club prompt delays the V2 Home welcome", () => {
  const prompt = getClubMembershipPromptVisibility({
    uid: "player-1",
    clubStatus: null,
    storageReady: true,
    storedDismissal: null,
    now: NOW,
  });
  assert.deepEqual(prompt, {ready: true, visible: true, blocksWelcome: true});
  assert.equal(eligibilityWithClubPrompt(prompt.blocksWelcome), false);
});

test("a dismissed club prompt with null status allows the welcome", () => {
  const prompt = getClubMembershipPromptVisibility({
    uid: "player-1",
    clubStatus: null,
    storageReady: true,
    storedDismissal: String(NOW - 1000),
    now: NOW,
  });
  assert.deepEqual(prompt, {ready: true, visible: false, blocksWelcome: false});
  assert.equal(eligibilityWithClubPrompt(prompt.blocksWelcome), true);
});

test("selected club and not-a-member outcomes do not block the welcome", () => {
  for (const clubStatus of ["member", "none"] as const) {
    const prompt = getClubMembershipPromptVisibility({
      uid: "player-1",
      clubStatus,
      storageReady: false,
      storedDismissal: null,
      now: NOW,
    });
    assert.deepEqual(prompt, {ready: true, visible: false, blocksWelcome: false});
    assert.equal(eligibilityWithClubPrompt(prompt.blocksWelcome), true);
  }
});

test("notification and unresolved club priority are temporary and reactive", () => {
  assert.equal(shouldShowOnboardingV2HomeWelcome({...baseEligibility, higherPriorityPrompt: true}), false);
  assert.equal(shouldShowOnboardingV2HomeWelcome({...baseEligibility, higherPriorityPrompt: false}), true);

  const unresolved = getClubMembershipPromptVisibility({
    uid: "player-1",
    clubStatus: null,
    storageReady: false,
    storedDismissal: null,
    now: NOW,
  });
  const resolved = getClubMembershipPromptVisibility({
    uid: "player-1",
    clubStatus: null,
    storageReady: true,
    storedDismissal: null,
    resolvedInSession: true,
    now: NOW,
  });
  assert.deepEqual(unresolved, {ready: false, visible: false, blocksWelcome: true});
  assert.deepEqual(resolved, {ready: true, visible: false, blocksWelcome: false});
});

test("malformed and future dismissals safely leave the club prompt visible", () => {
  for (const storedDismissal of ["invalid", String(NOW + 1000)]) {
    assert.equal(getClubMembershipPromptVisibility({
      uid: "player-1",
      clubStatus: null,
      storageReady: true,
      storedDismissal,
      now: NOW,
    }).visible, true);
  }
  assert.deepEqual(getClubMembershipPromptVisibility({
    uid: null,
    clubStatus: null,
    storageReady: true,
    storedDismissal: null,
  }), {ready: false, visible: false, blocksWelcome: false});
});

test("Club prompt rendering and Home priority share one visibility controller", () => {
  assert.match(homeSource, /useClubMembershipPromptVisibility\(uid, clubStatus\)/);
  assert.match(homeSource, /clubPromptVisibility\.blocksWelcome/);
  assert.match(homeSource, /visibility=\{clubPromptVisibility\}/);
  assert.match(promptSource, /visibility\.visible/);
  assert.match(promptSource, /visibility\.dismiss/);
  assert.match(promptSource, /visibility\.resolve/);
  assert.doesNotMatch(promptSource, /localStorage|getItem|shouldShowClubMembershipPrompt/);
  assert.match(visibilityHookSource, /catch \{[\s\S]*setStoredDismissal\(null\)/);
});

test("nearby-player loading and failure are absent from welcome eligibility", () => {
  const eligibilityBlock = homeSource.slice(
    homeSource.indexOf("const shouldShowV2HomeWelcome"),
    homeSource.indexOf("useEffect(() =>", homeSource.indexOf("const shouldShowV2HomeWelcome")),
  );
  assert.doesNotMatch(eligibilityBlock, /homeBootstrapping|nearbyActive|nearbyPlayers/);
  assert.match(homeSource, /setHomeBootstrapping\(false\)/);
  assert.match(homeSource, /loadNearbyActivePlayers failed/);
});

test("Ready and Match intro never consume homeWelcome", () => {
  const readyActions = readySource.slice(readySource.indexOf("Find my first match"));
  const matchIntro = matchSource.slice(
    matchSource.indexOf("const matchIntroEligible"),
    matchSource.indexOf("const matchIntroOverlay"),
  );
  assert.doesNotMatch(readyActions, /setHomeWelcomeStatus|onboarding\.homeWelcome/);
  assert.doesNotMatch(matchIntro, /setHomeWelcomeStatus|onboarding\.homeWelcome/);
});

test("only Home welcome actions request terminal homeWelcome transitions", () => {
  assert.equal((homeSource.match(/setHomeWelcomeStatus\("dismissed"\)/g) || []).length, 1);
  assert.equal((homeSource.match(/setHomeWelcomeStatus\("used_find_players"\)/g) || []).length, 1);
  assert.equal((progressSource.match(/"onboarding\.homeWelcome"/g) || []).length, 1);
  assert.doesNotMatch(homeSource.slice(0, homeSource.indexOf("handleDismissV2HomeWelcome")), /setHomeWelcomeStatus/);
});

test("missing or malformed V2 guidance state remains ineligible", () => {
  for (const user of [
    {onboarding: {...v2User.onboarding, homeWelcome: undefined}},
    {onboarding: {...v2User.onboarding, homeWelcome: []}},
    {onboarding: {...v2User.onboarding, homeWelcome: {status: "invalid"}}},
  ]) {
    const status = getHomeWelcomeStatus(user);
    assert.equal(status, null);
    assert.equal(shouldShowOnboardingV2HomeWelcome({...baseEligibility, status, higherPriorityPrompt: false}), false);
  }
});

test("mobile and desktop render the same precomputed welcome card", () => {
  assert.match(homeSource, /const v2HomeWelcomeCard = shouldShowV2HomeWelcome/);
  assert.match(homeSource, /v2WelcomeCard=\{v2HomeWelcomeCard\}/);
  assert.match(homeSource, /\{v2HomeWelcomeCard \? <div className="mt-4">\{v2HomeWelcomeCard\}/);
  assert.match(desktopHomeSource, /\{v2WelcomeCard\}/);
});
