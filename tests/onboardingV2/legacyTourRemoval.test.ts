import assert from "node:assert/strict";
import {existsSync, readFileSync} from "node:fs";
import test from "node:test";

const read = (path: string) => readFileSync(path, "utf8");

const layoutSource = read("components/ClientLayoutWrapper.tsx");
const homeSource = read("app/home/HomeClient.tsx");
const desktopHomeSource = read("components/home/DesktopDashboardHome.tsx");
const matchSource = read("app/match/MatchClient.tsx");
const desktopMatchSource = read("components/match/DesktopMatchPage.tsx");
const progressSource = read("lib/useOnboardingProgress.ts");
const guidanceSource = read("lib/onboardingGuidance.ts");
const analyticsSource = read("lib/analyticsEvents.ts");
const signupSource = read("app/signup/page.tsx");

test("the legacy tour component and global mount are removed", () => {
  assert.equal(existsSync("components/onboarding/OnboardingTour.tsx"), false);
  assert.doesNotMatch(layoutSource, /OnboardingTour|restartTennisMateOnboarding|restartOnboarding/);
  assert.doesNotMatch(layoutSource, /onboarding\.shouldShow|onboarding\.activationTour/);
});

test("Home has no mobile or desktop legacy targets or overlay orchestration", () => {
  assert.doesNotMatch(homeSource, /data-onboarding-target|activationTour|onboarding\.shouldShow/);
  assert.doesNotMatch(desktopHomeSource, /data-onboarding-target|activationTour/);
  assert.match(homeSource, /HomeWelcomeCard/);
  assert.match(homeSource, /ClubMembershipPrompt/);
  assert.match(layoutSource, /Complete your profile to get better match recommendations/);
});

test("Match Me has no legacy targets, highlights or progression writes", () => {
  assert.doesNotMatch(matchSource, /data-onboarding-target|activationTour|shouldHighlightFirstMatchRequest/);
  assert.doesNotMatch(desktopMatchSource, /data-onboarding-target|highlightFirstMatchRequest/);
  assert.doesNotMatch(matchSource, /markViewedRecommendedPlayers|markFirstMatchRequestPromptShown|markFirstMatchRequestSent/);
  assert.match(matchSource, /data-v2-intro-target="recommendations"/);
  assert.match(desktopMatchSource, /data-v2-intro-target="recommendations"/);
});

test("historical activationTour data is not read or written at runtime", () => {
  assert.doesNotMatch(progressSource, /activationTour|setDoc|patchOnboarding/);
  assert.doesNotMatch(guidanceSource, /activationTour|shouldShowLegacyOnboarding/);
  assert.match(progressSource, /"onboarding\.matchIntro": \{status, updatedAt: serverTimestamp\(\)\}/);
  assert.match(progressSource, /"onboarding\.homeWelcome": \{status, updatedAt: serverTimestamp\(\)\}/);
});

test("legacy-only analytics are gone while V2 guidance analytics remain exact", () => {
  assert.doesNotMatch(analyticsSource, /ONBOARDING_(STARTED|STEP_VIEWED|COMPLETED)/);
  assert.doesNotMatch(progressSource, /onboarding_(started|step_viewed|skipped|completed)/);
  assert.match(analyticsSource, /onboarding_v2_match_intro_started/);
  assert.match(analyticsSource, /onboarding_v2_home_welcome_viewed/);
});

test("first-request creation and success remain a single normal product path", () => {
  assert.equal((matchSource.match(/createMatchRequestWithRelationship\(/g) || []).length, 1);
  assert.match(matchSource, /trackEvent\("match_request_sent"/);
  assert.match(matchSource, /if \(!onboarding\.hasSentFirstRequest\) \{\s*setFirstRequestSuccessVisible\(true\)/);
  assert.match(matchSource, /await finishMatchIntro\("completed", "match_request"\)/);
});

test("notification prompts no longer wait for a removed tour", () => {
  const notificationBlock = matchSource.slice(
    matchSource.indexOf("const maybeShowAfterMatchRequestNotificationPrompt"),
    matchSource.indexOf("const closeMatchRequestNotificationPrompt"),
  );
  assert.match(notificationBlock, /shouldShowNotificationPrompt\("after_match_request_sent"\)/);
  assert.doesNotMatch(notificationBlock, /onboarding|activationTour/);
  assert.match(homeSource, /shouldShowNotificationPrompt\("home_banner"\)/);
});

test("current signup and V2 contextual guidance remain separate", () => {
  assert.doesNotMatch(signupSource, /OnboardingTour|activationTour/);
  assert.match(matchSource, /MatchMeContextualIntro/);
  assert.match(homeSource, /shouldShowOnboardingV2HomeWelcome/);
});
