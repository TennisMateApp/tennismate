import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import test from "node:test";

import {buildEditablePlayerProfileUpdate} from "../../lib/editablePlayerProfile";
import {resolveOnboardingV2ResumeStep} from "../../lib/onboardingV2";

const read = (path: string) => readFileSync(path, "utf8");
const accountLifecycle = read("lib/accountLifecycle.ts");
const authGate = read("components/AuthGate.tsx");
const layout = read("components/ClientLayoutWrapper.tsx");
const rules = read("firestore.rules");

const completeLocation = {
  player: {postcode: "3000"},
  privatePlayer: {lat: -37.81, lng: 144.96, geohash: "r1r0"},
};

test("incomplete account recovery uses Onboarding V2 instead of the legacy profile editor", () => {
  assert.match(accountLifecycle, /onboardingV2Href\(\{next\}\)/);
  assert.doesNotMatch(accountLifecycle, /profile\?edit=true&recovery=1/);
});

test("global and layout gates fail closed while redirecting incomplete users", () => {
  assert.match(authGate, /snapshot\.data\(\)\.profileComplete === true/);
  assert.match(authGate, /router\.replace\(onboardingV2Href\(\{next\}\)\)/);
  assert.match(layout, /shouldHoldIncompleteRender/);
  assert.match(layout, /router\.replace\(onboardingV2Href/);
  assert.doesNotMatch(layout, /tm_dismiss_profile_prompt|handleDismissProfilePrompt/);
});

test("resume chooses the earliest missing mandatory step", () => {
  assert.equal(resolveOnboardingV2ResumeStep({player: {}, privatePlayer: {}}), "location");
  assert.equal(resolveOnboardingV2ResumeStep({
    ...completeLocation,
    player: {...completeLocation.player},
  }), "skill");
  assert.equal(resolveOnboardingV2ResumeStep({
    ...completeLocation,
    player: {...completeLocation.player, skillBand: "intermediate"},
  }), "availability");
  assert.equal(resolveOnboardingV2ResumeStep({
    ...completeLocation,
    player: {
      ...completeLocation.player,
      skillBand: "intermediate",
      availability: ["Weekends AM"],
    },
  }), "photo");
});

const editableInput = (profileComplete: boolean, isMatchable: boolean) => ({
  name: "Player",
  postcode: "3000",
  bio: "",
  availability: ["Weekends AM"],
  gender: null,
  isMatchable,
  skillBand: "intermediate",
  skillBandLabel: "Intermediate",
  skillRating: 5,
  skillLevel: "Intermediate",
  photoURL: "https://example.test/photo.jpg",
  photoThumbURL: "https://example.test/thumb.jpg",
  clubId: null,
  clubName: null,
  clubStatus: null,
  profileComplete,
});

test("legacy editable payload never contains profileComplete", () => {
  const payload = buildEditablePlayerProfileUpdate(editableInput(true, true));
  assert.equal("profileComplete" in payload, false);
});

test("incomplete edits cannot request matchability while completed users can toggle it", () => {
  const incomplete = buildEditablePlayerProfileUpdate(editableInput(false, true));
  assert.equal("isMatchable" in incomplete, false);
  assert.equal(buildEditablePlayerProfileUpdate(editableInput(true, true)).isMatchable, true);
  assert.equal(buildEditablePlayerProfileUpdate(editableInput(true, false)).isMatchable, false);
});

test("rules reserve completion and restrict matchability to stored complete profiles", () => {
  assert.doesNotMatch(rules.match(/function editablePlayerProfileKeys[\s\S]*?\n    }/)?.[0] || "", /profileComplete/);
  assert.match(rules, /resource\.data\.get\("profileComplete", false\) == true/);
  assert.match(rules, /playerCreateCompletionStateValid\(\)/);
  assert.match(rules, /playerMatchabilityUpdateValid\(\)/);
});
