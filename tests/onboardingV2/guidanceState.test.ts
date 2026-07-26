import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import test from "node:test";

import {
  getHomeWelcomeStatus,
  getMatchIntroStatus,
  isOnboardingV2Completed,
  isOnboardingV2Started,
} from "../../lib/onboardingGuidance";

const timestamp = {seconds: 10, nanoseconds: 0};

test("valid V2 state exposes trusted start, completion and guidance statuses", () => {
  const user = {
    onboarding: {
      v2StartedAt: timestamp,
      version: 2,
      completedAt: timestamp,
      matchIntro: {status: "not_started", updatedAt: null},
      homeWelcome: {status: "not_seen", updatedAt: null},
    },
  };
  assert.equal(isOnboardingV2Started(user), true);
  assert.equal(isOnboardingV2Completed(user), true);
  assert.equal(getMatchIntroStatus(user), "not_started");
  assert.equal(getHomeWelcomeStatus(user), "not_seen");
});

test("legacy, missing and malformed state safely disables V2 guidance", () => {
  [null, {}, {onboarding: null}, {onboarding: {version: 2}}, {
    onboarding: {v2StartedAt: "bad", version: 2, completedAt: timestamp},
  }].forEach((user) => {
    assert.equal(isOnboardingV2Started(user), false);
    assert.equal(isOnboardingV2Completed(user), false);
    assert.equal(getMatchIntroStatus(user), null);
    assert.equal(getHomeWelcomeStatus(user), null);
  });
});

test("malformed optional guidance never becomes eligible", () => {
  const user = {
    onboarding: {
      v2StartedAt: timestamp,
      version: 2,
      completedAt: timestamp,
      matchIntro: {status: "reset"},
      homeWelcome: [],
    },
  };
  assert.equal(isOnboardingV2Completed(user), true);
  assert.equal(getMatchIntroStatus(user), null);
  assert.equal(getHomeWelcomeStatus(user), null);
});

test("generic account repair does not infer the V2 journey", () => {
  const lifecycle = readFileSync("lib/accountLifecycle.ts", "utf8");
  const login = readFileSync("app/login/LoginClient.tsx", "utf8");
  assert.match(lifecycle, /journey\?: "onboarding_v2"/);
  assert.doesNotMatch(login, /journey:\s*"onboarding_v2"/);
});
