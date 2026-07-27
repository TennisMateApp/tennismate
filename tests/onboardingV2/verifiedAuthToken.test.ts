import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import test from "node:test";

import {
  invokeNearbyPlayersWithVerifiedTokenRecovery,
  NearbyPlayersLoadError,
} from "../../lib/nearbyPlayersClient";
import {ensureVerifiedAuthSession} from "../../lib/verifiedAuthSession";

function authUser(emailVerified = true) {
  const calls = {reload: 0, token: 0};
  const user = {
    emailVerified,
    async reload() { calls.reload += 1; },
    async getIdToken(forceRefresh?: boolean) {
      calls.token += 1;
      assert.equal(forceRefresh, true);
      return "test-token-never-logged";
    },
  };
  return {user, calls};
}

const staleClaimError = {
  code: "functions/permission-denied",
  message: "Verify your email before finding players.",
};

test("verification reloads the user and force-refreshes the token before becoming ready", async () => {
  const {user, calls} = authUser();
  assert.deepEqual(await ensureVerifiedAuthSession(user), {verified: true, tokenReady: true});
  assert.deepEqual(calls, {reload: 1, token: 1});
});

test("focus and Strict Mode style duplicate checks share one refresh", async () => {
  const {user, calls} = authUser();
  await Promise.all([
    ensureVerifiedAuthSession(user),
    ensureVerifiedAuthSession(user),
    ensureVerifiedAuthSession(user),
  ]);
  assert.deepEqual(calls, {reload: 1, token: 1});
  await ensureVerifiedAuthSession(user);
  assert.deepEqual(calls, {reload: 1, token: 1});
});

test("a failed token refresh is retryable and never marks the session ready", async () => {
  let tokenCalls = 0;
  const user = {
    emailVerified: true,
    async reload() {},
    async getIdToken() {
      tokenCalls += 1;
      if (tokenCalls === 1) throw new Error("offline");
      return "test-token-never-logged";
    },
  };
  await assert.rejects(ensureVerifiedAuthSession(user), /offline/);
  assert.deepEqual(await ensureVerifiedAuthSession(user), {verified: true, tokenReady: true});
  assert.equal(tokenCalls, 2);
});

test("the exact stale verified-email denial refreshes and retries once", async () => {
  const {user} = authUser();
  let invokes = 0;
  let refreshes = 0;
  const result = await invokeNearbyPlayersWithVerifiedTokenRecovery({}, {
    invoke: async () => {
      invokes += 1;
      if (invokes === 1) throw staleClaimError;
      return {players: [{uid: "player-2", distanceKm: 3}]};
    },
    currentUser: () => user,
    refreshVerifiedSession: async (_user, options) => {
      refreshes += 1;
      assert.equal(options?.force, true);
      return {verified: true, tokenReady: true};
    },
  });
  assert.equal(invokes, 2);
  assert.equal(refreshes, 1);
  assert.equal(result.players.length, 1);
});

test("a stale-token retry failure remains an error and is not retried indefinitely", async () => {
  const {user} = authUser();
  let invokes = 0;
  await assert.rejects(
    invokeNearbyPlayersWithVerifiedTokenRecovery({}, {
      invoke: async () => { invokes += 1; throw staleClaimError; },
      currentUser: () => user,
      refreshVerifiedSession: async () => ({verified: true, tokenReady: true}),
    }),
    (error) => error instanceof NearbyPlayersLoadError && error.kind === "verified_email_required"
  );
  assert.equal(invokes, 2);
});

test("other permission errors do not trigger token refresh or retry", async () => {
  const {user} = authUser();
  let invokes = 0;
  let refreshes = 0;
  await assert.rejects(
    invokeNearbyPlayersWithVerifiedTokenRecovery({}, {
      invoke: async () => {
        invokes += 1;
        throw {code: "functions/permission-denied", message: "Different permission denial"};
      },
      currentUser: () => user,
      refreshVerifiedSession: async () => {
        refreshes += 1;
        return {verified: true, tokenReady: true};
      },
    }),
    (error) => error instanceof NearbyPlayersLoadError && error.kind === "permission_denied"
  );
  assert.equal(invokes, 1);
  assert.equal(refreshes, 0);
});

test("a successful zero-player response remains a genuine empty result", async () => {
  const result = await invokeNearbyPlayersWithVerifiedTokenRecovery({}, {
    invoke: async () => ({players: []}),
    currentUser: () => null,
  });
  assert.deepEqual(result, {players: []});
});

test("Onboarding finalisation and Match navigation wait for verified token readiness", () => {
  const flow = readFileSync("components/onboarding-v2/OnboardingV2Flow.tsx", "utf8");
  const finalisationStart = flow.indexOf("const verifiedSession = await ensureVerifiedAuthSession(currentUser)");
  const finalizer = flow.indexOf("const result = await finalizeOnboardingProfile()", finalisationStart);
  assert.ok(finalisationStart >= 0 && finalizer > finalisationStart);
  assert.match(flow, /async function openMatchFromReady\(\)[\s\S]*await ensureVerifiedAuthSession\(user\)[\s\S]*router\.push\("\/match"\)/);
  assert.match(flow, /We couldn’t refresh your verified session\. Check your connection and try again\./);
});

test("Match Me renders callable failures before either mobile or desktop empty states", () => {
  const mobile = readFileSync("app/match/MatchClient.tsx", "utf8");
  const desktop = readFileSync("components/match/DesktopMatchPage.tsx", "utf8");
  const message = "We couldn’t load player recommendations.";
  assert.ok(mobile.indexOf("recommendationsLoadError ?") < mobile.indexOf("sortedMatches.length === 0 ?"));
  assert.ok(desktop.indexOf("props.recommendationsLoadError ?") < desktop.indexOf("visibleMatches.length === 0 ?"));
  assert.match(mobile, new RegExp(message.replace(".", "\\.")));
  assert.match(desktop, new RegExp(message.replace(".", "\\.")));
});

test("token values and sensitive Auth data are not logged by the refresh helpers", () => {
  const sessionSource = readFileSync("lib/verifiedAuthSession.ts", "utf8");
  const recoverySource = readFileSync("lib/nearbyPlayersClient.ts", "utf8");
  assert.doesNotMatch(sessionSource, /console\./);
  assert.doesNotMatch(recoverySource, /console\./);
});
