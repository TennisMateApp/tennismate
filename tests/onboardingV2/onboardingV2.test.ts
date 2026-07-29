import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  createOnboardingV2Account,
  isOnboardingV2Destination,
  maskEmail,
  onboardingV2AuthError,
  onboardingV2Href,
  onboardingV2PasswordPolicyError,
  onboardingV2SignupFailureDetails,
  ONBOARDING_V2_PATH,
  ONBOARDING_V2_NUMBERED_STEPS,
  ONBOARDING_V2_RESEND_COOLDOWN_SECONDS,
  ONBOARDING_V2_STEP_META,
  resumableOnboardingV2PreAuthStep,
  validateAdultBirthYear,
  validateOnboardingV2Account,
} from "../../lib/onboardingV2";

const flowSource = readFileSync("components/onboarding-v2/OnboardingV2Flow.tsx", "utf8");
const routeSource = readFileSync("app/signup-v2/page.tsx", "utf8");
const signupSource = readFileSync("app/signup/page.tsx", "utf8");
const shellSource = readFileSync("components/onboarding-v2/OnboardingV2Shell.tsx", "utf8");
const authGateSource = readFileSync("components/AuthGate.tsx", "utf8");
const layoutSource = readFileSync("components/ClientLayoutWrapper.tsx", "utf8");
const globalsSource = readFileSync("app/globals.css", "utf8");
const nextConfigSource = readFileSync("next.config.js", "utf8");

function validInput() {
  return {
    fields: { name: "Alex Player", email: "alex@example.com", password: "Secret!7" },
    birthYear: "1990",
    referralCandidates: [{ code: "CLUB25", source: "ref" as const }],
  };
}

test("V2 availability uses the explicit flag and preserves legacy signup as the fallback", () => {
  assert.equal(ONBOARDING_V2_PATH, "/signup-v2");
  assert.match(routeSource, /process\.env\.ONBOARDING_V2_ENABLED === "true"/);
  assert.doesNotMatch(routeSource, /VERCEL_ENV/);
  assert.match(nextConfigSource, /process\.env\.ONBOARDING_V2_ENABLED !== "true"/);
  assert.match(nextConfigSource, /source: "\/signup"/);
  assert.match(nextConfigSource, /destination: "\/signup-v2"/);
  assert.match(signupSource, /export default function SignupPage/);
  assert.match(signupSource, /postcode/);
  assert.match(authGateSource, /ONBOARDING_V2_PATH/);
});

test("Welcome uses the agreed concise heading and supporting copy", () => {
  assert.match(flowSource, /Find your next tennis partner\./);
  assert.match(flowSource, /Join local players organising matches through TennisMate\./);
  assert.match(flowSource, /Takes about 2 minutes\./);
  assert.match(flowSource, /Your progress is saved\./);
  assert.match(flowSource, /For players aged 18\+\./);
});

test("Why TennisMate uses the four agreed compact benefit labels", () => {
  [
    "Find players near you",
    "Play people at your level",
    "Match your availability",
    "Connect with your tennis club",
  ].forEach((label) => assert.match(flowSource, new RegExp(label)));
  assert.match(flowSource, /aria-hidden="true"/);
});

test("Eligibility and Account use the agreed headings without changing their controls", () => {
  assert.match(flowSource, /Confirm your year of birth/);
  assert.match(flowSource, /TennisMate is currently available to players aged 18\+\./);
  assert.match(flowSource, /Your birth year stays private and is not shown on your profile\./);
  assert.match(flowSource, /Create your TennisMate account/);
  assert.match(flowSource, /onboarding-v2-birth-year/);
  assert.match(flowSource, /onboarding-v2-password/);
});

test("deep-link helpers accept only the isolated onboarding destination", () => {
  assert.equal(isOnboardingV2Destination("/signup-v2"), true);
  assert.equal(isOnboardingV2Destination("/signup-v2?next=%2Fhome"), true);
  assert.equal(isOnboardingV2Destination("//signup-v2"), false);
  assert.equal(isOnboardingV2Destination("/signup-v2-unsafe"), false);
  assert.equal(onboardingV2Href({ next: "/match", ref: "ABC" }), "/signup-v2?next=%2Fmatch&ref=ABC");
});

test("under-18 eligibility fails before Auth or initialization can run", async () => {
  let authCalls = 0;
  let initializationCalls = 0;
  const currentYear = new Date().getFullYear();
  await assert.rejects(() => createOnboardingV2Account({
    ...validInput(),
    birthYear: String(currentYear - 17),
    createAuthUser: async () => { authCalls += 1; return { uid: "new" }; },
    initializeAccount: async () => {
      initializationCalls += 1;
      return { initialized: true, repairedDocuments: [], shouldSendVerification: true, referralCaptured: false };
    },
    sendInitialVerification: async () => true,
  }), /eligibility_invalid/);
  assert.equal(authCalls, 0);
  assert.equal(initializationCalls, 0);
});

test("valid adult account creation initializes exactly once and preserves referral candidates", async () => {
  let authCalls = 0;
  let initializationCalls = 0;
  let verificationCalls = 0;
  let receivedReferral: unknown;
  const result = await createOnboardingV2Account({
    ...validInput(),
    createAuthUser: async (email) => { authCalls += 1; return { uid: "new", email }; },
    initializeAccount: async (input) => {
      initializationCalls += 1;
      receivedReferral = input.referralCandidates;
      return { initialized: true, repairedDocuments: ["users"], shouldSendVerification: true, referralCaptured: true };
    },
    sendInitialVerification: async ({ shouldSendVerification }) => {
      verificationCalls += 1;
      return shouldSendVerification;
    },
  });
  assert.equal(authCalls, 1);
  assert.equal(initializationCalls, 1);
  assert.equal(verificationCalls, 1);
  assert.deepEqual(receivedReferral, validInput().referralCandidates);
  assert.equal(result.verificationSent, true);
});

test("apostrophes, uppercase surnames, and common name punctuation all reach Auth unchanged", async () => {
  const names = [
    "Michael O'BRIEN",
    "Michael OBrien",
    "MICHAEL OBRIEN",
    "Michael O’Brien",
    "Michael O-BRIEN",
    "Michael O.BRIEN",
    "Michael (Mick) OBRIEN",
  ];

  for (const name of names) {
    let authCalls = 0;
    let receivedName = "";
    const result = validateOnboardingV2Account({
      name,
      email: "michael.obrien@example.com",
      password: "Valid!1",
    });
    assert.deepEqual(result.errors, {});
    assert.equal(result.values.name, name);

    await createOnboardingV2Account({
      fields: {...result.values},
      birthYear: "1990",
      referralCandidates: [],
      createAuthUser: async (email) => {
        authCalls += 1;
        return {uid: "new", email};
      },
      initializeAccount: async ({displayName}) => {
        receivedName = displayName;
        return {initialized: true, repairedDocuments: [], shouldSendVerification: false, referralCaptured: false};
      },
      sendInitialVerification: async () => false,
    });
    assert.equal(authCalls, 1, `${name} should reach accounts:signUp`);
    assert.equal(receivedName, name);
  }
});

test("account validation matches the enforced uppercase and special-character password policy", () => {
  assert.equal(validateOnboardingV2Account({name: "Player", email: "p@example.com", password: "lower!1"}).errors.password, "Password must include an uppercase letter.");
  assert.equal(validateOnboardingV2Account({name: "Player", email: "p@example.com", password: "Upper11"}).errors.password, "Password must include a special character.");
  assert.equal(validateOnboardingV2Account({name: "Player", email: "p@example.com", password: "Upper'1"}).errors.password, undefined);
  assert.equal(onboardingV2PasswordPolicyError({
    isValid: false,
    containsUppercaseLetter: false,
    containsNonAlphanumericCharacter: false,
  }), "Password must include an uppercase letter, a special character.");
});

test("signup failure diagnostics include only stage, safe code, and account-created state", () => {
  assert.deepEqual(
    onboardingV2SignupFailureDetails(
      "auth_create",
      {code: "auth/password-does-not-meet-requirements", password: "never-log-this"},
      false
    ),
    {stage: "auth_create", code: "auth/password-does-not-meet-requirements", auth_account_created: false}
  );
  assert.deepEqual(
    onboardingV2SignupFailureDetails("referral_attribution", new Error("user value: secret"), false),
    {stage: "referral_attribution", code: "unknown", auth_account_created: false}
  );
});

test("adult validation enforces the agreed 18 to 110 range", () => {
  const year = new Date().getFullYear();
  assert.equal(validateAdultBirthYear(String(year - 18)).valid, true);
  assert.equal(validateAdultBirthYear(String(year - 110)).valid, true);
  assert.equal(validateAdultBirthYear(String(year - 17)).valid, false);
  assert.equal(validateAdultBirthYear(String(year - 111)).valid, false);
  assert.equal(validateAdultBirthYear("99").valid, false);
});

test("invalid required account fields stop before Auth", async () => {
  const invalidFields = [
    {name: "", email: "p@example.com", password: "Valid!1"},
    {name: "Player", email: "", password: "Valid!1"},
    {name: "Player", email: "invalid", password: "Valid!1"},
    {name: "Player", email: "p@example.com", password: ""},
    {name: "Player", email: "p@example.com", password: "lower!1"},
    {name: "Player", email: "p@example.com", password: "Upper11"},
  ];
  for (const fields of invalidFields) {
    let authCalls = 0;
    await assert.rejects(() => createOnboardingV2Account({
      fields,
      birthYear: "1990",
      referralCandidates: [],
      createAuthUser: async () => { authCalls += 1; return {uid: "new"}; },
      initializeAccount: async () => ({initialized: true, repairedDocuments: [], shouldSendVerification: false, referralCaptured: false}),
      sendInitialVerification: async () => false,
    }), /account_fields_invalid/);
    assert.equal(authCalls, 0);
  }
});

test("refresh preserves safe pre-Auth progress but requires birth year again before account creation", () => {
  assert.equal(resumableOnboardingV2PreAuthStep("why"), "why");
  assert.equal(resumableOnboardingV2PreAuthStep("eligibility"), "eligibility");
  assert.equal(resumableOnboardingV2PreAuthStep("account"), "eligibility");
  assert.equal(resumableOnboardingV2PreAuthStep("verify"), "welcome");
});

test("duplicate-email recovery is useful and the verification screen uses the frozen cooldown", () => {
  assert.equal(onboardingV2AuthError("auth/email-already-in-use"), "An account already exists for this email.");
  assert.equal(onboardingV2AuthError("auth/password-does-not-meet-requirements"), "Password does not meet the current security requirements.");
  assert.match(flowSource, /Sign in to continue/);
  assert.equal(ONBOARDING_V2_RESEND_COOLDOWN_SECONDS, 60);
  assert.match(flowSource, /window\.addEventListener\("focus"/);
  assert.match(flowSource, /visibilitychange/);
  const primaryIndex = flowSource.indexOf("I’ve verified my email");
  const emailAppIndex = flowSource.indexOf("Open email app");
  const resendIndex = flowSource.indexOf("Resend email", emailAppIndex);
  const signOutIndex = flowSource.indexOf("Sign out", resendIndex);
  assert.ok(primaryIndex > -1 && primaryIndex < emailAppIndex);
  assert.ok(emailAppIndex < resendIndex && resendIndex < signOutIndex);
  assert.match(flowSource, /<a href="mailto:" className=\{secondaryButton\}>Open email app<\/a>/);
  assert.match(flowSource, /Return here after verifying your email\./);
});

test("authenticated resume is server-derived and complete existing users are sent away", () => {
  assert.match(flowSource, /getDoc\(doc\(db, "players"/);
  assert.match(flowSource, /getDoc\(doc\(db, "players_private"/);
  assert.match(flowSource, /profileComplete === true/);
  assert.match(flowSource, /prepareExistingAccount/);
  assert.match(flowSource, /resolveOnboardingV2ResumeStep/);
});

test("V2 activation uses the trusted finalisation callable", () => {
  assert.match(flowSource, /finalizeOnboardingProfile\(\)/);
  assert.doesNotMatch(flowSource, /updateDoc\([^)]*profileComplete/);
  assert.match(flowSource, /We couldn’t finish profile setup\. Your progress is safe/);
});

test("mobile and desktop share one semantic shell and accessible progress model", () => {
  assert.match(shellSource, /role="progressbar"/);
  assert.match(shellSource, /aria-valuetext/);
  assert.match(shellSource, /min-h-11/);
  assert.match(shellSource, /lg:grid-cols/);
  assert.deepEqual(ONBOARDING_V2_STEP_META.welcome, {label: "Welcome", progress: 0, numbered: false});
  assert.equal(ONBOARDING_V2_NUMBERED_STEPS.length, 8);
  assert.equal(ONBOARDING_V2_STEP_META.photo.progress, 100);
  assert.equal(ONBOARDING_V2_STEP_META.ready.numbered, false);
});

test("step transitions are restrained and disabled for reduced-motion users", () => {
  assert.match(globalsSource, /onboarding-v2-step-enter 200ms/);
  assert.match(globalsSource, /translateY\(5px\)/);
  assert.match(globalsSource, /@media \(prefers-reduced-motion: reduce\)/);
  assert.match(globalsSource, /\.onboarding-v2-step-content\s*\{\s*animation: none;/);
  assert.match(shellSource, /key=\{step\}/);
});

test("floating feedback stays hidden on signup-v2 and V2 verification returns", () => {
  assert.match(layoutSource, /pathname\.startsWith\(ONBOARDING_V2_PATH\)/);
  assert.match(layoutSource, /isOnboardingV2VerificationReturn/);
  assert.match(layoutSource, /pathname\.startsWith\("\/verify-complete"\)/);
  assert.match(layoutSource, /isOnboardingV2Destination\(new URLSearchParams\(window\.location\.search\)\.get\("next"\)\)/);
  assert.match(layoutSource, /!hideFloatingFeedback/);
});

test("analytics calls use stable reasons and omit email, birth year, and password", () => {
  const analyticsCalls = [...flowSource.matchAll(/trackEvent\(([^;]+)\);/g)].map((match) => match[1]);
  assert.ok(analyticsCalls.length >= 9);
  analyticsCalls.forEach((call) => {
    assert.doesNotMatch(call, /\bemail\b/);
    assert.doesNotMatch(call, /\bbirthYear\b/);
    assert.doesNotMatch(call, /\bpassword\b/);
  });
  assert.match(flowSource, /onboarding_v2_step_viewed/);
  assert.match(flowSource, /eligibility_completed/);
  assert.match(flowSource, /account_created/);
  assert.match(flowSource, /verification_resend/);
});

test("masked verification copy does not reveal the full email local part", () => {
  assert.equal(maskEmail("alexander@example.com"), "al•••••••@example.com");
  assert.equal(maskEmail(null), "your email");
});
