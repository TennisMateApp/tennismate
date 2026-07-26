import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import test from "node:test";
import {HttpsError} from "firebase-functions/v2/https";

import {
  buildOnboardingV2StartState,
  parseOnboardingJourney,
} from "../../onboardingFoundation";

test("existing initializer requests without journey remain valid", () => {
  assert.equal(parseOnboardingJourney(undefined), null);
  assert.equal(parseOnboardingJourney(null), null);
});

test("initializer accepts only the authorized V2 journey value", () => {
  assert.equal(parseOnboardingJourney("onboarding_v2"), "onboarding_v2");
  assert.throws(
    () => parseOnboardingJourney("legacy"),
    (error: unknown) => error instanceof HttpsError && error.code === "invalid-argument"
  );
});

test("V2 initialization writes the start marker once and preserves onboarding data", () => {
  const timestamp = {serverTimestamp: true};
  assert.deepEqual(buildOnboardingV2StartState({
    existingOnboarding: {
      activationTour: {status: "in_progress"},
      checklist: {profileComplete: false},
    },
    journey: "onboarding_v2",
    profileComplete: false,
    timestamp,
  }), {
    activationTour: {status: "in_progress"},
    checklist: {profileComplete: false},
    v2StartedAt: timestamp,
  });

  const original = {seconds: 1, nanoseconds: 0};
  assert.equal(buildOnboardingV2StartState({
    existingOnboarding: {v2StartedAt: original},
    journey: "onboarding_v2",
    profileComplete: false,
    timestamp,
  }), null);
});

test("legacy initialization and complete profile repair do not write the marker", () => {
  const timestamp = {serverTimestamp: true};
  assert.equal(buildOnboardingV2StartState({
    existingOnboarding: {}, journey: null, profileComplete: false, timestamp,
  }), null);
  assert.equal(buildOnboardingV2StartState({
    existingOnboarding: {}, journey: "onboarding_v2", profileComplete: true, timestamp,
  }), null);
});

test("only the isolated V2 flow sends journey and current signup remains unchanged", () => {
  const flow = readFileSync("../components/onboarding-v2/OnboardingV2Flow.tsx", "utf8");
  const signup = readFileSync("../app/signup/page.tsx", "utf8");
  const login = readFileSync("../app/login/LoginClient.tsx", "utf8");
  assert.match(flow, /journey: "onboarding_v2"/);
  assert.doesNotMatch(signup, /journey:\s*"onboarding_v2"/);
  assert.doesNotMatch(login, /journey:\s*"onboarding_v2"/);
});
