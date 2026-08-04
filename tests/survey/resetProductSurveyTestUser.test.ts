import assert from "node:assert/strict";
import test from "node:test";

import {
  assertResetIsSafe,
  parseResetOptions,
  surveyResetTargets,
} from "../../scripts/resetProductSurveyTestUser";

test("reset targets exactly one survey document and one user-scoped dismissal key", () => {
  assert.deepEqual(surveyResetTargets("test-user-1"), {
    documentPath: "surveyResponses/product-survey-2026-08_test-user-1",
    localStorageKey: "tm_survey_dismissed_product-survey-2026-08_test-user-1",
  });
});

test("emulator reset defaults to a demo project and refuses a live project", () => {
  const options = parseResetOptions(["--uid=test-user-1", "--write"], "127.0.0.1:8188");
  assert.equal(options.project, "demo-tennismate-survey-reset");
  assert.doesNotThrow(() => assertResetIsSafe(options, "127.0.0.1:8188"));

  const unsafe = {...options, project: "tennismate-d8acb"};
  assert.throws(() => assertResetIsSafe(unsafe, "127.0.0.1:8188"), /demo-\*/);
});

test("non-emulator reset requires exact project and document confirmations", () => {
  const documentPath = "surveyResponses/product-survey-2026-08_test-user-1";
  const options = parseResetOptions([
    "--uid=test-user-1",
    "--project=tennismate-d8acb",
    "--confirm-project=tennismate-d8acb",
    `--confirm-document=${documentPath}`,
    "--write",
  ]);
  assert.deepEqual(assertResetIsSafe(options), surveyResetTargets("test-user-1"));
  assert.throws(() => assertResetIsSafe({...options, confirmDocument: `${documentPath}-other`}), /must exactly equal/);
  assert.throws(() => assertResetIsSafe({...options, confirmProject: null}), /confirm-project/);
  assert.throws(() => assertResetIsSafe({...options, project: "another-project"}), /restricted/);
});

test("UID parsing rejects missing and path-like values", () => {
  assert.throws(() => parseResetOptions([], "127.0.0.1:8188"), /--uid is required/);
  assert.throws(() => parseResetOptions(["--uid=someone/else"], "127.0.0.1:8188"), /without a slash/);
});
