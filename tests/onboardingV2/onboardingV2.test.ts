import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  createOnboardingV2Account,
  isOnboardingV2Destination,
  maskEmail,
  onboardingV2AuthError,
  onboardingV2Href,
  ONBOARDING_V2_PATH,
  ONBOARDING_V2_NUMBERED_STEPS,
  ONBOARDING_V2_RESEND_COOLDOWN_SECONDS,
  ONBOARDING_V2_STEP_META,
  resumableOnboardingV2PreAuthStep,
  validateAdultBirthYear,
} from "../../lib/onboardingV2";

const flowSource = readFileSync("components/onboarding-v2/OnboardingV2Flow.tsx", "utf8");
const routeSource = readFileSync("app/signup-v2/page.tsx", "utf8");
const signupSource = readFileSync("app/signup/page.tsx", "utf8");
const shellSource = readFileSync("components/onboarding-v2/OnboardingV2Shell.tsx", "utf8");
const authGateSource = readFileSync("components/AuthGate.tsx", "utf8");
const layoutSource = readFileSync("components/ClientLayoutWrapper.tsx", "utf8");
const globalsSource = readFileSync("app/globals.css", "utf8");

function validInput() {
  return {
    fields: { name: "Alex Player", email: "alex@example.com", password: "secret7" },
    birthYear: "1990",
    referralCandidates: [{ code: "CLUB25", source: "ref" as const }],
  };
}

test("V2 uses an isolated route and leaves the current signup implementation available", () => {
  assert.equal(ONBOARDING_V2_PATH, "/signup-v2");
  assert.match(routeSource, /ONBOARDING_V2_ENABLED/);
  assert.match(routeSource, /VERCEL_ENV === "production"/);
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

test("adult validation enforces the agreed 18 to 110 range", () => {
  const year = new Date().getFullYear();
  assert.equal(validateAdultBirthYear(String(year - 18)).valid, true);
  assert.equal(validateAdultBirthYear(String(year - 110)).valid, true);
  assert.equal(validateAdultBirthYear(String(year - 17)).valid, false);
  assert.equal(validateAdultBirthYear(String(year - 111)).valid, false);
  assert.equal(validateAdultBirthYear("99").valid, false);
});

test("refresh preserves safe pre-Auth progress but requires birth year again before account creation", () => {
  assert.equal(resumableOnboardingV2PreAuthStep("why"), "why");
  assert.equal(resumableOnboardingV2PreAuthStep("eligibility"), "eligibility");
  assert.equal(resumableOnboardingV2PreAuthStep("account"), "eligibility");
  assert.equal(resumableOnboardingV2PreAuthStep("verify"), "welcome");
});

test("duplicate-email recovery is useful and the verification screen uses the frozen cooldown", () => {
  assert.equal(onboardingV2AuthError("auth/email-already-in-use"), "An account already exists for this email.");
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
  assert.match(globalsSource, /\.onboarding-v2-step-content\s*\{\s*animation: none;/s);
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
  const analyticsCalls = [...flowSource.matchAll(/trackEvent\(([^;]+)\);/gs)].map((match) => match[1]);
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
