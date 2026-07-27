import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import test from "node:test";

import {classifyPostcode} from "../../lib/postcodeEligibility";
import {SKILL_OPTIONS, skillFromUTR} from "../../lib/skill";
import {
  buildOnboardingV2AvailabilityUpdate,
  buildOnboardingV2ClubUpdate,
  buildOnboardingV2SkillUpdate,
  canonicalAvailability,
  guidedSkillBand,
  hasOnboardingV2Location,
  hasOnboardingV2Photo,
  ONBOARDING_V2_AVAILABILITY,
  ONBOARDING_V2_NUMBERED_STEPS,
  ONBOARDING_V2_SKILL_QUESTIONS,
  ONBOARDING_V2_STEP_META,
  ONBOARDING_V2_STEPS,
  resolveOnboardingV2FinalizationStep,
  resolveOnboardingV2ResumeStep,
  validateOnboardingV2Tmr,
} from "../../lib/onboardingV2";

const flowSource = readFileSync("components/onboarding-v2/OnboardingV2Flow.tsx", "utf8");
const shellSource = readFileSync("components/onboarding-v2/OnboardingV2Shell.tsx", "utf8");
const photoSource = readFileSync("components/onboarding-v2/OnboardingProfilePhotoStep.tsx", "utf8");
const clubSource = readFileSync("components/clubs/ClubMembershipSelector.tsx", "utf8");
const lifecycleSource = readFileSync("lib/accountLifecycle.ts", "utf8");

const location = {birthYear: 1990, lat: -37.8, lng: 145, geohash: "r1r0"};
const completePlayer = {
  name: "Alex Player",
  postcode: "3068",
  skillBand: "intermediate",
  availability: ["Weekends AM"],
  photoURL: "https://example.test/avatar_full.jpg",
  photoThumbURL: "https://example.test/avatar_thumb.jpg",
};

test("shared step order includes all five new numbered steps and unnumbered Ready", () => {
  assert.deepEqual(ONBOARDING_V2_STEPS, [
    "welcome", "why", "eligibility", "account", "verify", "location", "skill",
    "availability", "club", "photo", "ready",
  ]);
  assert.deepEqual(ONBOARDING_V2_NUMBERED_STEPS.slice(3), [
    "location", "skill", "availability", "club", "photo",
  ]);
  assert.equal(ONBOARDING_V2_STEP_META.ready.numbered, false);
  assert.equal(ONBOARDING_V2_STEP_META.photo.progress, 100);
  ONBOARDING_V2_NUMBERED_STEPS.forEach((step, index) => {
    assert.equal(ONBOARDING_V2_STEP_META[step].position, index + 1);
    assert.equal(
      ONBOARDING_V2_STEP_META[step].progress,
      Math.round(((index + 1) / ONBOARDING_V2_NUMBERED_STEPS.length) * 100)
    );
  });
  assert.match(shellSource, /meta\.numbered/);
});

test("location classifier distinguishes invalid, unsupported, unknown and supported coordinates", () => {
  assert.equal(classifyPostcode("30", null).kind, "invalid");
  assert.equal(classifyPostcode("4000", null).kind, "unsupported");
  assert.equal(classifyPostcode("3068", null).kind, "unknown");
  assert.deepEqual(classifyPostcode("3068", {lat: -37.8, lng: 145}), {
    kind: "supported", postcode: "3068", lat: -37.8, lng: 145,
  });
  assert.equal(classifyPostcode("3068", {lat: null, lng: null}).kind, "unknown");
});

test("location persistence requires coordinates and uses public/private boundaries", () => {
  assert.equal(hasOnboardingV2Location(completePlayer, location), true);
  assert.equal(hasOnboardingV2Location(completePlayer, {...location, lat: null}), false);
  assert.match(flowSource, /doc\(db, "postcodes", normalized\)/);
  assert.match(flowSource, /doc\(db, "players_private", currentUser\.uid\)/);
  assert.match(flowSource, /geohashForLocation/);
  assert.match(flowSource, /markUnsupportedPostcodeWaitlist/);
  assert.match(flowSource, /We couldn’t locate that postcode\. Check the four digits and try again\./);
  assert.doesNotMatch(flowSource, /alert\(/);
});

test("all guided answer combinations map totals zero through eight to canonical bands", () => {
  const totals = new Set<number>();
  for (const rally of ONBOARDING_V2_SKILL_QUESTIONS[0].options) {
    for (const serve of ONBOARDING_V2_SKILL_QUESTIONS[1].options) {
      for (const competition of ONBOARDING_V2_SKILL_QUESTIONS[2].options) {
        totals.add(rally.score + serve.score + competition.score);
      }
    }
  }
  assert.deepEqual([...totals].sort((a, b) => a - b), [0, 1, 2, 3, 4, 5, 6, 7, 8]);
  assert.deepEqual([...totals].sort((a, b) => a - b).map(guidedSkillBand), SKILL_OPTIONS.map((option) => option.value));
});

test("guided recommendation can be accepted, overridden or restarted", () => {
  assert.match(flowSource, /Use this level/);
  assert.match(flowSource, /Choose a different level/);
  assert.match(flowSource, /Restart questions/);
  assert.match(flowSource, /override: Boolean/);
  assert.doesNotMatch(flowSource, /guidedAnswers[^\n]*updateDoc/);
});

test("manual selection exposes all nine existing canonical bands", () => {
  assert.equal(SKILL_OPTIONS.length, 9);
  SKILL_OPTIONS.forEach((option) => {
    const update = buildOnboardingV2SkillUpdate({band: option.value});
    assert.equal(update.skillBand, option.value);
    assert.equal(update.skillBandLabel, option.label);
  });
  assert.match(flowSource, /ONBOARDING_V2_SKILL_DESCRIPTIONS/);
});

test("TMR validates the frozen range and derives the current mapping", () => {
  assert.equal(validateOnboardingV2Tmr("0.99").valid, false);
  assert.equal(validateOnboardingV2Tmr("16.51").valid, false);
  const valid = validateOnboardingV2Tmr("6.20");
  assert.equal(valid.valid, true);
  if (valid.valid) assert.equal(valid.band, skillFromUTR(6.2));
  assert.match(flowSource, /onboarding-v2-tmr-override/);
});

test("final skill is required and questionnaire answers are not persisted", () => {
  assert.throws(() => buildOnboardingV2SkillUpdate({band: "invalid" as never}), /invalid_skill/);
  assert.match(flowSource, /Choose a playing level to continue\./);
  assert.doesNotMatch(flowSource, /questionnaireAnswers|guided_answers|guidedAnswers:/);
});

test("availability requires canonical values and supports multi-select", () => {
  assert.equal(ONBOARDING_V2_AVAILABILITY.length, 4);
  assert.deepEqual(buildOnboardingV2AvailabilityUpdate(["Weekdays AM", "Weekends PM"]), {
    availability: ["Weekdays AM", "Weekends PM"],
  });
  assert.throws(() => buildOnboardingV2AvailabilityUpdate([]), /invalid_availability/);
  assert.throws(() => buildOnboardingV2AvailabilityUpdate(["Whenever"]), /invalid_availability/);
  assert.deepEqual(canonicalAvailability(["Weekends AM", "unknown"]), ["Weekends AM"]);
  assert.match(flowSource, /role="checkbox"/);
  assert.match(flowSource, /aria-checked=\{selected\}/);
});

test("club selected, none and skipped outcomes remain distinct", () => {
  assert.deepEqual(buildOnboardingV2ClubUpdate({
    outcome: "selected", clubId: "court-1", clubName: "Clifton Hill Tennis Club",
  }), {clubStatus: "member", clubId: "court-1", clubName: "Clifton Hill Tennis Club"});
  assert.deepEqual(buildOnboardingV2ClubUpdate({outcome: "none"}), {
    clubStatus: "none", clubId: null, clubName: null,
  });
  assert.deepEqual(buildOnboardingV2ClubUpdate({outcome: "skipped"}), {
    clubStatus: null, clubId: null, clubName: null,
  });
  assert.match(flowSource, /<ClubMembershipSelector/);
  assert.match(clubSource, /Request it and we&apos;ll review it\./);
  assert.doesNotMatch(clubSource, /handleRequestSubmit[\s\S]{0,600}onChange\(/);
});

test("club resume restores member and none values while optional null never blocks activation", () => {
  assert.match(flowSource, /stored\.player\.clubStatus === "member" \|\| stored\.player\.clubStatus === "none"/);
  assert.equal(resolveOnboardingV2ResumeStep({player: completePlayer, privatePlayer: location}), "ready");
  assert.equal(resolveOnboardingV2ResumeStep({
    player: {...completePlayer, clubStatus: "none", clubId: null, clubName: null},
    privatePlayer: location,
  }), "ready");
});

test("photo is required, uses both existing paths and cannot complete on failed upload", () => {
  assert.equal(hasOnboardingV2Photo(completePlayer), true);
  assert.equal(hasOnboardingV2Photo({...completePlayer, photoThumbURL: ""}), false);
  assert.match(photoSource, /PROFILE_FULL_PATH\(uid\)/);
  assert.match(photoSource, /PROFILE_THUMB_PATH\(uid\)/);
  assert.match(photoSource, /photoURL: nextPhotoURL/);
  assert.match(photoSource, /photoThumbURL: nextPhotoThumbURL/);
  assert.match(photoSource, /Your earlier progress is safe/);
  assert.doesNotMatch(photoSource, /Skip for now/i);
  assert.match(photoSource, /role="dialog"/);
  assert.match(photoSource, /aria-modal="true"/);
});

test("resume selects the earliest actual missing required step", () => {
  assert.equal(resolveOnboardingV2ResumeStep({player: {}, privatePlayer: location}), "location");
  assert.equal(resolveOnboardingV2ResumeStep({player: {postcode: "3068"}, privatePlayer: location}), "skill");
  assert.equal(resolveOnboardingV2ResumeStep({
    player: {postcode: "3068", skillBand: "intermediate"}, privatePlayer: location,
  }), "availability");
  assert.equal(resolveOnboardingV2ResumeStep({
    player: {...completePlayer, photoThumbURL: ""}, privatePlayer: location,
  }), "photo");
  assert.equal(resolveOnboardingV2ResumeStep({player: completePlayer, privatePlayer: location}), "ready");
  assert.equal(resolveOnboardingV2FinalizationStep(["missing_photo"]), "photo");
  assert.equal(resolveOnboardingV2FinalizationStep(["missing_geohash", "missing_skill"]), "location");
  assert.equal(resolveOnboardingV2FinalizationStep(["email_not_verified"]), "ready");
});

test("verification pending preserves progress and blocks trusted activation", () => {
  assert.match(flowSource, /Email verification pending/);
  assert.match(flowSource, /One final step: verify your email to start finding players\./);
  assert.match(flowSource, /if \(!verifiedSession\.verified \|\| !verifiedSession\.tokenReady\)/);
  assert.match(flowSource, /I’ve verified — continue/);
  assert.match(flowSource, /window\.addEventListener\("focus"/);
  assert.match(flowSource, /visibilitychange/);
});

test("Ready uses the trusted idempotent callable and does not launch the old Home tour", () => {
  assert.match(lifecycleSource, /httpsCallable<Record<string, never>, OnboardingFinalizationResult>/);
  assert.match(flowSource, /await finalizeOnboardingProfile\(\)/);
  assert.match(flowSource, /result\.alreadyFinalized/);
  assert.match(flowSource, /Find my first match/);
  assert.match(flowSource, /Go to Home/);
  assert.doesNotMatch(flowSource, /OnboardingTour|tourComplete|onboardingTour/);
});

test("milestone analytics use safe metadata and omit sensitive values", () => {
  [
    "onboarding_v2_location_completed",
    "onboarding_v2_skill_started",
    "onboarding_v2_skill_recommended",
    "onboarding_v2_skill_completed",
    "onboarding_v2_availability_completed",
    "onboarding_v2_club_completed",
    "onboarding_v2_club_skipped",
    "onboarding_v2_photo_started",
    "onboarding_v2_photo_completed",
    "onboarding_v2_ready_viewed",
    "onboarding_v2_profile_completed",
  ].forEach((eventName) => assert.match(flowSource, new RegExp(eventName)));
  const calls = [...flowSource.matchAll(/trackEvent\("onboarding_v2_[^"]+",\s*\{([^}]]*)\}/g)];
  calls.forEach((call) => {
    assert.doesNotMatch(call[1], /email|birthYear|postcode|clubName|photoURL|uid/);
  });
});

test("skill progress, club results and responsive shell retain accessible semantics", () => {
  assert.match(flowSource, /Question \$\{guidedQuestion \+ 1\} of 3/);
  assert.match(flowSource, /<fieldset/);
  assert.match(clubSource, /role="listbox"/);
  assert.match(clubSource, /role="option"/);
  assert.match(shellSource, /lg:grid-cols/);
  assert.match(shellSource, /min-h-11/);
  assert.match(shellSource, /aria-live="polite"/);
});
