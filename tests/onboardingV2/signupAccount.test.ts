import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import test from "node:test";

import {createOnboardingV2Account, validateOnboardingV2Account} from "../../lib/onboardingV2";
import {
  emailDomainOnly,
  getSignupPasswordRequirements,
  isSignupPasswordValid,
  mapSignupAuthError,
  signupFailureDiagnostics,
  SIGNUP_PASSWORD_ERROR,
} from "../../lib/signupAccount";

const legacySource = readFileSync("app/signup/page.tsx", "utf8");
const v2Source = readFileSync("components/onboarding-v2/OnboardingV2Flow.tsx", "utf8");
const modalSource = readFileSync("components/SignupErrorModal.tsx", "utf8");

test("password validation requires length, a number, and any non-alphanumeric character", () => {
  assert.deepEqual(getSignupPasswordRequirements("Ab1!xy"), {length: true, number: true, special: true});
  assert.equal(isSignupPasswordValid("a1!"), false);
  assert.equal(isSignupPasswordValid("abcdef!"), false);
  assert.equal(isSignupPasswordValid("abcdef1"), false);
  assert.equal(isSignupPasswordValid("abcdef1!"), true);
  assert.equal(isSignupPasswordValid("abcdef1 "), true);
});

test("invalid passwords stop account creation before Firebase Auth is called", async () => {
  for (const password of ["a1!", "abcdef!", "abcdef1"]) {
    let authCalls = 0;
    await assert.rejects(() => createOnboardingV2Account({
      fields: {name: "Alex", email: "alex@example.com", password},
      birthYear: "1990",
      referralCandidates: [],
      createAuthUser: async () => {authCalls += 1; return {uid: "new"};},
      initializeAccount: async () => ({initialized: true, repairedDocuments: [], shouldSendVerification: false, referralCaptured: false}),
      sendInitialVerification: async () => false,
    }), /account_fields_invalid/);
    assert.equal(authCalls, 0);
    assert.equal(validateOnboardingV2Account({name: "Alex", email: "alex@example.com", password}).errors.password, SIGNUP_PASSWORD_ERROR);
  }
});

test("known Firebase Auth failures map to actionable, field-aware messages", () => {
  assert.deepEqual(mapSignupAuthError("auth/email-already-in-use"), {
    message: "An account already exists with this email address. Sign in or reset your password.",
    field: "email",
    showAccountActions: true,
  });
  assert.equal(mapSignupAuthError("auth/invalid-email").message, "Enter a valid email address.");
  assert.equal(mapSignupAuthError("auth/weak-password").message, SIGNUP_PASSWORD_ERROR);
  assert.match(mapSignupAuthError("auth/network-request-failed").message, /internet connection/);
  assert.match(mapSignupAuthError("auth/too-many-requests").message, /Wait a few minutes/);
  assert.match(mapSignupAuthError("auth/operation-not-allowed").message, /temporarily unavailable/);
  assert.match(mapSignupAuthError("auth/user-disabled").message, /Contact TennisMate support/);
  assert.match(mapSignupAuthError("auth/unauthorized-domain").message, /verification email/);
  assert.match(mapSignupAuthError("auth/not-recognised").message, /Something went wrong/);
});

test("diagnostics retain the Firebase code but never the full email or password data", () => {
  const diagnostics = signupFailureDiagnostics({
    code: "auth/network-request-failed",
    route: "/signup",
    platform: "ios",
    appVersion: "1.2.3",
    clientValidationPassed: true,
    email: "Player.Name@gmail.com",
    stage: "authentication",
  });
  assert.equal(emailDomainOnly("Player.Name@gmail.com"), "gmail.com");
  assert.equal(diagnostics.firebase_error_code, "auth/network-request-failed");
  assert.equal(diagnostics.email_domain, "gmail.com");
  assert.doesNotMatch(JSON.stringify(diagnostics), /Player\.Name|"password"/i);
});

test("both signup UIs expose an accessible live checklist and preserve single-submit state", () => {
  for (const source of [legacySource, v2Source]) {
    assert.match(source, /At least 6 characters/);
    assert.match(source, /At least 1 number/);
    assert.match(source, /At least 1 special character/);
    assert.match(source, /aria-invalid/);
    assert.match(source, /aria-describedby/);
    assert.match(source, /role="alert"/);
    assert.match(source, /Creating (?:Account|account)…/);
  }
  assert.match(legacySource, /if \(submissionRef\.current\) return/);
  assert.match(v2Source, /if \(accountSubmissionRef\.current\) return/);
  assert.match(legacySource, /finishSubmission\(\)/);
  assert.match(v2Source, /accountSubmissionRef\.current = false/);
});

test("existing-account recovery offers Sign In and Reset Password actions", () => {
  assert.match(modalSource, /Sign In/);
  assert.match(modalSource, /Reset Password/);
  assert.match(v2Source, />Sign In</);
  assert.match(v2Source, />Reset Password</);
  assert.match(modalSource, /role="dialog"/);
  assert.match(modalSource, /aria-modal="true"/);
});

test("post-auth setup failures are not described as authentication failures", () => {
  for (const source of [legacySource, v2Source]) {
    assert.match(source, /authUserCreated/);
    assert.match(source, /stage: setupFailed \? "account_setup" : "authentication"/);
    assert.match(source, /Your account was created, but setup did not finish/);
    assert.match(source, /Your progress is safe/);
  }
});

test("failure handling keeps entered state and clears only corrected field errors", () => {
  assert.doesNotMatch(legacySource, /setFormData\(\{\s*name: ""/);
  assert.doesNotMatch(v2Source, /setAccount\(\{\s*name: ""/);
  assert.match(legacySource, /becomesValid \?/);
  assert.match(v2Source, /validateOnboardingV2Account\(next\)\.errors\[field\]/);
});
