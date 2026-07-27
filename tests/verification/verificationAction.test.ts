import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  createVerificationActionRunner,
  processVerificationAction,
} from "../../lib/verificationAction";

const actionPageSource = readFileSync("app/verify-complete/page.tsx", "utf8");
const legacyPageSource = readFileSync("app/verified/route.ts", "utf8");
const onboardingSource = readFileSync("components/onboarding-v2/OnboardingV2Flow.tsx", "utf8");
const authGateSource = readFileSync("components/AuthGate.tsx", "utf8");
const layoutSource = readFileSync("components/ClientLayoutWrapper.tsx", "utf8");

function dependencies(overrides: Partial<Parameters<typeof processVerificationAction>[0]["dependencies"]> = {}) {
  return {
    waitForAuthReady: async () => undefined,
    isCurrentUserVerified: () => false,
    applyCode: async () => undefined,
    reloadCurrentUser: async () => undefined,
    ...overrides,
  };
}

test("a valid action code reaches success", async () => {
  const result = await processVerificationAction({
    code: "valid-code",
    mode: "verifyEmail",
    dependencies: dependencies(),
  });
  assert.equal(result.state, "success");
});

test("signed-out verification succeeds without requiring an Auth user", async () => {
  let applied = 0;
  const result = await processVerificationAction({
    code: "valid-code",
    mode: "verifyEmail",
    dependencies: dependencies({
      isCurrentUserVerified: () => false,
      applyCode: async () => { applied += 1; },
    }),
  });
  assert.equal(applied, 1);
  assert.equal(result.state, "success");
});

test("an already-verified account is success and does not reapply the code", async () => {
  let applied = 0;
  const result = await processVerificationAction({
    code: "used-code",
    mode: "verifyEmail",
    dependencies: dependencies({
      isCurrentUserVerified: () => true,
      applyCode: async () => { applied += 1; },
    }),
  });
  assert.equal(applied, 0);
  assert.equal(result.state, "alreadyVerified");
});

test("invalid, expired, network and unexpected failures reach deterministic states", async () => {
  const cases = [
    ["auth/invalid-action-code", "invalid"],
    ["auth/expired-action-code", "expired"],
    ["auth/network-request-failed", "networkError"],
    ["auth/internal-error", "unexpectedError"],
  ] as const;

  for (const [code, expected] of cases) {
    const result = await processVerificationAction({
      code: "action-code",
      mode: "verifyEmail",
      dependencies: dependencies({
        applyCode: async () => { throw { code }; },
      }),
    });
    assert.equal(result.state, expected);
  }
});

test("malformed links leave checking through the invalid state", async () => {
  const result = await processVerificationAction({
    code: null,
    mode: null,
    dependencies: dependencies(),
  });
  assert.deepEqual(result, { state: "invalid", reason: "malformed" });
});

test("the bounded timeout cannot leave verification indefinitely checking", async () => {
  const result = await processVerificationAction({
    code: "slow-code",
    mode: "verifyEmail",
    timeoutMs: 10,
    dependencies: dependencies({
      applyCode: () => new Promise<void>(() => undefined),
    }),
  });
  assert.deepEqual(result, { state: "networkError", reason: "timeout" });
});

test("the action runner reuses one promise for Strict Mode effect replay", async () => {
  const runner = createVerificationActionRunner();
  let calls = 0;
  const run = async () => {
    calls += 1;
    return { state: "success" as const };
  };
  const first = runner("verifyEmail:same-code", run);
  const second = runner("verifyEmail:same-code", run);
  assert.equal(first, second);
  assert.equal((await second).state, "success");
  assert.equal(calls, 1);
});

test("successful verification has stable return instructions and no app-opening action", () => {
  assert.doesNotMatch(actionPageSource, /router\.(push|replace)/);
  assert.doesNotMatch(actionPageSource, /resolveAccountDestination/);
  assert.doesNotMatch(actionPageSource, /Open TennisMate/);
  assert.doesNotMatch(actionPageSource, /<Link|window\.location\.(assign|replace|href)/);
  assert.match(actionPageSource, /Your account is verified\./);
  assert.match(actionPageSource, /Please navigate back to the TennisMate app to continue\./);
  assert.match(actionPageSource, /Please return to the device where you started setting up TennisMate\./);
  assert.match(actionPageSource, /!successful && view\.state !== "checking"/);
  assert.match(actionPageSource, /Verification is taking longer than expected/);
});

test("legacy /verified links remain understandable and code links use the canonical handler", () => {
  assert.match(legacyPageSource, /Email verified/);
  assert.match(legacyPageSource, /Please return to the device where you started setting up TennisMate\./);
  assert.doesNotMatch(legacyPageSource, /Open TennisMate|href="\/login"/);
  assert.match(legacyPageSource, /new URL\("\/verify-complete"/);
  assert.match(legacyPageSource, /if \(code\)/);
});

test("the original onboarding session still detects verification on focus and foreground", () => {
  assert.match(onboardingSource, /window\.addEventListener\("focus"/);
  assert.match(onboardingSource, /visibilitychange/);
  assert.match(onboardingSource, /await user\.reload\(\)/);
  assert.match(onboardingSource, /I’ve verified my email/);
  assert.match(onboardingSource, /Continue profile setup/);
});

test("Auth and application chrome are bypassed on standalone verification pages", () => {
  assert.match(authGateSource, /isStandaloneVerificationRoute/);
  assert.match(authGateSource, /return <>\{children\}<\/>/);
  assert.match(layoutSource, /Email action pages must not wait for or render application chrome/);
  assert.match(layoutSource, /if \(isStandaloneVerificationRoute\) return <>\{children\}<\/>/);
});
