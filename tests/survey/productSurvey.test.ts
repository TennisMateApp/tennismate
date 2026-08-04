import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import test from "node:test";

import {
  buildSurveyPayload,
  canonicalSurveyUserName,
  EMPTY_SURVEY_ANSWERS,
  EMPTY_SURVEY_PROMPT_DISMISSAL,
  getSurveyPromptVisibility,
  isSurveyPromptDismissed,
  nextSurveyPromptDismissal,
  parseSurveyPromptDismissal,
  PRODUCT_SURVEY_ID,
  SURVEY_PROMPT_SNOOZE_MS,
  submitSurveyResponse,
  surveyDismissalKey,
  surveyResponseId,
  toggleSurveyChoice,
  validateSurveyStep,
  type SurveyAnswers,
} from "../../lib/productSurvey";
import {hasCompletedProductSurvey} from "../../lib/productSurveyCompletion";

function completeAnswers(): SurveyAnswers {
  return {
    ...EMPTY_SURVEY_ANSWERS,
    playFrequency: "2_3_per_week",
    reasons: ["new_people", "nearby_players"],
    playedThroughTennisMate: "yes_2_5",
    matchBarriers: ["availability_mismatch"],
    favouriteFeature: "match_me",
    desiredFeatures: ["better_recommendations", "player_stats"],
    eventInterest: "yes",
    premiumPrice: "3_5_aud",
    premiumFeatures: ["advanced_filters"],
    oneThingChange: "  Make scheduling easier.  ",
    oneThingWell: "  Helps me find players.  ",
  };
}

test("unauthenticated users cannot surface the prompt and /survey remains protected", () => {
  assert.equal(getSurveyPromptVisibility({uid: null, completionKnown: true, completed: false, dismissed: false}), false);
  const authGate = readFileSync("components/AuthGate.tsx", "utf8");
  assert.doesNotMatch(authGate, /PUBLIC_ROUTES[\s\S]*["']\/survey["']/);
  assert.match(authGate, /router\.replace\(`\/login\?next=/);
});

test("each step validates its required answers", () => {
  assert.deepEqual(Object.keys(validateSurveyStep(1, EMPTY_SURVEY_ANSWERS)), ["playFrequency", "reasons", "playedThroughTennisMate", "matchBarriers"]);
  assert.deepEqual(Object.keys(validateSurveyStep(2, EMPTY_SURVEY_ANSWERS)), ["favouriteFeature", "desiredFeatures", "eventInterest"]);
  assert.deepEqual(Object.keys(validateSurveyStep(3, EMPTY_SURVEY_ANSWERS)), ["premiumPrice", "premiumFeatures", "oneThingChange", "oneThingWell"]);
  const answers = completeAnswers();
  assert.deepEqual(validateSurveyStep(1, answers), {});
  assert.deepEqual(validateSurveyStep(2, answers), {});
  assert.deepEqual(validateSurveyStep(3, answers), {});
});

test("desired features stop at three selections", () => {
  const selected = ["better_recommendations", "player_stats", "match_history"];
  assert.deepEqual(toggleSurveyChoice(selected, "achievements", {max: 3}), selected);
  assert.deepEqual(toggleSurveyChoice(selected, "player_stats", {max: 3}), ["better_recommendations", "match_history"]);
});

test("exclusive barrier and premium choices clear conflicting selections", () => {
  assert.deepEqual(toggleSurveyChoice(["no_response", "other"], "no_difficulty", {exclusive: ["not_tried", "no_difficulty"]}), ["no_difficulty"]);
  assert.deepEqual(toggleSurveyChoice(["none"], "advanced_filters", {exclusive: ["none"]}), ["advanced_filters"]);
});

test("successful submission uses the stable document id and machine-readable payload", async () => {
  let writtenId = "";
  let writtenPayload: ReturnType<typeof buildSurveyPayload> | null = null;
  const marker = {server: "timestamp"};
  const payload = await submitSurveyResponse({
    uid: "player-1",
    userName: "  Current Player  ",
    answers: completeAnswers(),
    submittedAt: marker,
    create: async (id, nextPayload) => { writtenId = id; writtenPayload = nextPayload; },
  });
  assert.equal(writtenId, `${PRODUCT_SURVEY_ID}_player-1`);
  assert.equal(payload.userId, "player-1");
  assert.equal(payload.userName, "Current Player");
  assert.equal(payload.oneThingChange, "Make scheduling easier.");
  assert.deepEqual(writtenPayload, payload);
});

test("a failed submission rejects without changing retained answers", async () => {
  const answers = completeAnswers();
  const before = structuredClone(answers);
  await assert.rejects(submitSurveyResponse({
    uid: "player-1",
    userName: "Current Player",
    answers,
    submittedAt: {},
    create: async () => { throw new Error("offline"); },
  }), /offline/);
  assert.deepEqual(answers, before);
});

test("completed users never see the prompt, while dismissal does not block direct survey access", () => {
  assert.equal(getSurveyPromptVisibility({uid: "player-1", completionKnown: true, completed: true, dismissed: false}), false);
  assert.equal(getSurveyPromptVisibility({uid: "player-1", completionKnown: true, completed: false, dismissed: true}), false);
  const surveyPage = readFileSync("app/survey/page.tsx", "utf8");
  assert.doesNotMatch(surveyPage, /surveyDismissalKey|tm_survey_dismissed/);
  assert.match(surveyPage, /hasCompletedProductSurvey\(user\.uid\)/);
});

test("incomplete users see the Home prompt and Take survey navigates directly to /survey", () => {
  assert.equal(getSurveyPromptVisibility({uid: "player-1", completionKnown: true, completed: false, dismissed: false}), true);
  const prompt = readFileSync("components/survey/SurveyPrompt.tsx", "utf8");
  assert.match(prompt, /router\.push\("\/survey"\)/);
  assert.match(prompt, />Take survey</);
});

test("the first dismissal snoozes for seven days without marking survey completion", () => {
  const now = Date.UTC(2026, 7, 4);
  const first = nextSurveyPromptDismissal(EMPTY_SURVEY_PROMPT_DISMISSAL, now);
  assert.deepEqual(first, {
    dismissalCount: 1,
    hiddenUntil: now + SURVEY_PROMPT_SNOOZE_MS,
    permanentlyDismissed: false,
  });
  assert.equal(isSurveyPromptDismissed(first, now + SURVEY_PROMPT_SNOOZE_MS - 1), true);
  assert.equal("completed" in first, false);
});

test("the prompt is eligible after seven days and a second dismissal hides it permanently", () => {
  const now = Date.UTC(2026, 7, 4);
  const first = nextSurveyPromptDismissal(EMPTY_SURVEY_PROMPT_DISMISSAL, now);
  assert.equal(isSurveyPromptDismissed(first, now + SURVEY_PROMPT_SNOOZE_MS), false);
  const second = nextSurveyPromptDismissal(first, now + SURVEY_PROMPT_SNOOZE_MS);
  assert.deepEqual(second, {dismissalCount: 2, hiddenUntil: null, permanentlyDismissed: true});
  assert.equal(isSurveyPromptDismissed(second, now + (10 * SURVEY_PROMPT_SNOOZE_MS)), true);
  assert.deepEqual(parseSurveyPromptDismissal(JSON.stringify(second), now), second);
});

test("dismissal storage is namespaced by survey and user and never gates direct survey access", () => {
  assert.equal(surveyDismissalKey("player-1"), `tm_survey_dismissed_${PRODUCT_SURVEY_ID}_player-1`);
  assert.notEqual(surveyDismissalKey("player-1"), surveyDismissalKey("player-2"));
  const surveyPage = readFileSync("app/survey/page.tsx", "utf8");
  assert.doesNotMatch(surveyPage, /surveyDismissalKey|localStorage/);
});

test("completion status uses the deterministic document and propagates lookup failures safely", async () => {
  let lookedUp = "";
  assert.equal(await hasCompletedProductSurvey("player-1", async (documentId) => {
    lookedUp = documentId;
    return false;
  }), false);
  assert.equal(lookedUp, `${PRODUCT_SURVEY_ID}_player-1`);
  assert.equal(await hasCompletedProductSurvey("player-1", async () => true), true);
  await assert.rejects(hasCompletedProductSurvey("player-1", async () => {
    throw new Error("temporary network failure");
  }), /temporary network failure/);

  const prompt = readFileSync("components/survey/SurveyPrompt.tsx", "utf8");
  const settings = readFileSync("components/profile/ProfileSettingsMenu.tsx", "utf8");
  assert.match(prompt, /useProductSurveyCompletion\(uid\)/);
  assert.match(settings, /surveyCompletionStatus === "error"/);
});

test("UI and rules both prevent duplicate submissions", () => {
  const surveyPage = readFileSync("app/survey/page.tsx", "utf8");
  const rules = readFileSync("firestore.rules", "utf8");
  assert.match(surveyPage, /submittingRef\.current/);
  assert.match(surveyPage, /disabled=\{submitting\}/);
  assert.match(rules, /match \/surveyResponses\/\{responseId\}[\s\S]*allow create:[\s\S]*allow update, delete: if false;/);
});

test("response id is deterministic per survey and user", () => {
  assert.equal(surveyResponseId("abc"), "product-survey-2026-08_abc");
});

test("canonical player names are normalized safely without entering survey form state", () => {
  assert.equal(canonicalSurveyUserName("  Current Player  "), "Current Player");
  assert.equal(canonicalSurveyUserName(null), "");
  assert.equal(canonicalSurveyUserName("x".repeat(120)).length, 100);
  assert.equal("userName" in EMPTY_SURVEY_ANSWERS, false);
  assert.equal("userId" in EMPTY_SURVEY_ANSWERS, false);
});

test("the page reads the canonical player name but creates a response only in final submit", () => {
  const surveyPage = readFileSync("app/survey/page.tsx", "utf8");
  assert.match(surveyPage, /getDoc\(doc\(db, "players", user\.uid\)\)/);
  assert.match(surveyPage, /userName,\s*answers,/);
  assert.equal((surveyPage.match(/setDoc\(doc\(db, "surveyResponses"/g) || []).length, 1);
  const submitStart = surveyPage.indexOf("const submit = async");
  assert.ok(submitStart >= 0);
  assert.ok(surveyPage.indexOf("setDoc(doc(db, \"surveyResponses\"", submitStart) > submitStart);
});

test("completion state and analytics occur only after the successful create resolves", () => {
  const surveyPage = readFileSync("app/survey/page.tsx", "utf8");
  const submitBlock = surveyPage.slice(surveyPage.indexOf("const submit = async"), surveyPage.indexOf("if (loading)"));
  const createIndex = submitBlock.indexOf("await submitSurveyResponse");
  assert.ok(createIndex >= 0);
  assert.ok(submitBlock.indexOf("ANALYTICS_EVENTS.SURVEY_COMPLETED") > createIndex);
  assert.ok(submitBlock.indexOf("setCompleted(true)") > createIndex);
  assert.match(submitBlock, /catch \(error\)[\s\S]*setSubmitError\(/);
});

test("question headings render inside padded cards without using the visible fieldset legend", () => {
  const surveyPage = readFileSync("app/survey/page.tsx", "utf8");
  assert.match(surveyPage, /<legend className="sr-only">/);
  assert.match(surveyPage, /id=\{titleId\} className="flex min-w-0 items-start gap-2/);
  assert.match(surveyPage, /rounded-3xl border border-emerald-950\/10 bg-white p-4 shadow-sm sm:p-5/);
  assert.match(surveyPage, /min-w-0 break-words leading-5/);
  assert.doesNotMatch(surveyPage, /<legend className="w-full/);
});

test("survey header reuses the standardized app header and back control", () => {
  const surveyPage = readFileSync("app/survey/page.tsx", "utf8");
  assert.match(surveyPage, /<CourtsBackButton onClick=\{back\}/);
  assert.match(surveyPage, /grid-cols-\[minmax\(0,1fr\)_minmax\(0,2fr\)_minmax\(0,1fr\)\]/);
  assert.match(surveyPage, /if \(step > 1\)[\s\S]*setStep\(\(current\) => current - 1\)/);
  assert.match(surveyPage, /window\.history\.length > 1\) router\.back\(\)/);
});
