import assert from "node:assert/strict";
import test from "node:test";

import {
  accountInitialized,
  candidateMatchable,
  matchMeReady,
  onboardingProfileReady,
  profileRecoveryReady,
  fullyActivated,
} from "../../lib/profileReadiness";

const completePlayer = {
  name: "Alex Player",
  postcode: "3068",
  skillBand: "intermediate",
  availability: ["Weekends AM"],
  photoURL: "/avatar.jpg",
  profileComplete: true,
  isMatchable: true,
};
const privateLocation = { birthYear: 1990, lat: -37.8, lng: 145, geohash: "r1r0" };

test("account initialization requires all three document boundaries", () => {
  assert.equal(accountInitialized({ userExists: true, playerExists: true, privatePlayerExists: true }).ready, true);
  assert.equal(accountInitialized({ userExists: true, playerExists: false, privatePlayerExists: true }).ready, false);
});

test("onboarding profile readiness identifies missing required fields", () => {
  assert.equal(onboardingProfileReady(completePlayer, privateLocation).ready, true);
  const result = onboardingProfileReady({ ...completePlayer, availability: [] }, privateLocation);
  assert.equal(result.ready, false);
  assert.ok(result.reasons.includes("missing_availability"));
});

test("match readiness requires private coordinates and visibility", () => {
  assert.equal(matchMeReady(completePlayer, privateLocation).ready, true);
  assert.ok(matchMeReady(completePlayer, {}).reasons.includes("missing_private_location"));
  assert.ok(candidateMatchable({ ...completePlayer, isMatchable: false }, privateLocation).reasons.includes("match_me_disabled"));
  assert.ok(candidateMatchable({ ...completePlayer, profileComplete: false }, privateLocation).reasons.includes("profile_incomplete"));
  assert.ok(matchMeReady({ ...completePlayer, skillBand: "" }, privateLocation).reasons.includes("missing_skill"));
});

test("profile recovery can complete a hidden profile without forcing visibility", () => {
  assert.equal(profileRecoveryReady({ ...completePlayer, isMatchable: false }, privateLocation).ready, true);
});

test("full activation adds document and verification state to profile readiness", () => {
  assert.equal(fullyActivated({
    userExists: true,
    playerExists: true,
    privatePlayerExists: true,
    emailVerified: true,
    player: completePlayer,
    privatePlayer: privateLocation,
  }).ready, true);
  assert.ok(fullyActivated({
    userExists: true,
    playerExists: true,
    privatePlayerExists: true,
    emailVerified: false,
    player: completePlayer,
    privatePlayer: privateLocation,
  }).reasons.includes("email_unverified"));
});
