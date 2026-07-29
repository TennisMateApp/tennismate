import type { AccountInitializationResult } from "@/lib/accountLifecycle";
import type { ReferralCandidate } from "@/lib/referralAttribution";
import {SKILL_OPTIONS, skillFromUTR, type SkillBand} from "@/lib/skill";

export const ONBOARDING_V2_PATH = "/signup-v2";
export const ONBOARDING_V2_RESEND_COOLDOWN_SECONDS = 60;
export const ONBOARDING_V2_PREAUTH_STEP_KEY = "tennismate:onboarding-v2-preauth-step";

export const ONBOARDING_V2_STEPS = [
  "welcome",
  "why",
  "eligibility",
  "account",
  "verify",
  "location",
  "skill",
  "availability",
  "club",
  "photo",
  "ready",
] as const;

export type OnboardingV2Step = (typeof ONBOARDING_V2_STEPS)[number];

export const ONBOARDING_V2_NUMBERED_STEPS = [
  "eligibility",
  "account",
  "verify",
  "location",
  "skill",
  "availability",
  "club",
  "photo",
] as const satisfies readonly OnboardingV2Step[];

const STEP_NAMES: Record<OnboardingV2Step, string> = {
  welcome: "Welcome",
  why: "Why TennisMate",
  eligibility: "Eligibility",
  account: "Account",
  verify: "Verification",
  location: "Location",
  skill: "Playing Level",
  availability: "Availability",
  club: "Club Membership",
  photo: "Profile Photo",
  ready: "Ready",
};

export type OnboardingV2StepMeta = {
  label: string;
  progress: number;
  numbered: boolean;
  position?: number;
  total?: number;
};

export function onboardingV2StepMeta(step: OnboardingV2Step): OnboardingV2StepMeta {
  const position = ONBOARDING_V2_NUMBERED_STEPS.indexOf(
    step as (typeof ONBOARDING_V2_NUMBERED_STEPS)[number]
  );
  if (position === -1) {
    return {
      label: STEP_NAMES[step],
      progress: step === "ready" ? 100 : 0,
      numbered: false,
    };
  }
  const number = position + 1;
  const total = ONBOARDING_V2_NUMBERED_STEPS.length;
  return {
    label: `Step ${number} of ${total} · ${STEP_NAMES[step]}`,
    progress: Math.round((number / total) * 100),
    numbered: true,
    position: number,
    total,
  };
}

export const ONBOARDING_V2_STEP_META = Object.fromEntries(
  ONBOARDING_V2_STEPS.map((step) => [step, onboardingV2StepMeta(step)])
) as Record<OnboardingV2Step, OnboardingV2StepMeta>;

export const ONBOARDING_V2_AVAILABILITY = [
  "Weekdays AM",
  "Weekdays PM",
  "Weekends AM",
  "Weekends PM",
] as const;

export type OnboardingV2Availability = (typeof ONBOARDING_V2_AVAILABILITY)[number];

export const ONBOARDING_V2_SKILL_QUESTIONS = [
  {
    prompt: "How consistently can you rally?",
    options: [
      {label: "I’m learning to keep the ball in play", score: 0},
      {label: "I can rally 5–10 shots at a steady pace", score: 1},
      {label: "I can sustain rallies with pace and direction", score: 2},
    ],
  },
  {
    prompt: "How confident are you serving?",
    options: [
      {label: "I’m still learning or mostly use a second serve", score: 0},
      {label: "I can usually start the point with my serve", score: 1},
      {label: "I have reliable first and second serves", score: 2},
    ],
  },
  {
    prompt: "Have you played organised competition?",
    options: [
      {label: "No organised competition", score: 0},
      {label: "Social fixtures or casual club competition", score: 2},
      {label: "Graded leagues or tournaments", score: 4},
    ],
  },
] as const;

export const ONBOARDING_V2_SKILL_DESCRIPTIONS: Record<SkillBand, string> = {
  lower_beginner: "Learning the basics and building confidence keeping the ball in play.",
  beginner: "Can play short rallies and is developing a reliable serve.",
  upper_beginner: "Can sustain steady rallies and is ready for more structured points.",
  lower_intermediate: "Comfortable rallying and beginning to use placement and consistency.",
  intermediate: "Plays competitive points with dependable strokes and serving.",
  upper_intermediate: "Uses pace, direction and tactics consistently in match play.",
  lower_advanced: "Strong all-court fundamentals with regular competitive experience.",
  advanced: "High-level consistency, pace and tactical awareness in competition.",
  upper_advanced: "Experienced tournament-level player with an accomplished all-court game.",
};

export function guidedSkillBand(total: number): SkillBand | null {
  if (!Number.isInteger(total) || total < 0 || total > 8) return null;
  return SKILL_OPTIONS[total]?.value ?? null;
}

export function validateOnboardingV2Tmr(rawValue: string) {
  const trimmed = rawValue.trim();
  if (!trimmed) return {valid: false as const, reason: "Enter your TennisMate Rating."};
  const rating = Number(trimmed);
  if (!Number.isFinite(rating) || rating < 1 || rating > 16.5) {
    return {valid: false as const, reason: "Enter a rating from 1.00 to 16.50."};
  }
  return {valid: true as const, rating, band: skillFromUTR(rating) as SkillBand};
}

export function isCanonicalSkillBand(value: unknown): value is SkillBand {
  return typeof value === "string" && SKILL_OPTIONS.some((option) => option.value === value);
}

export function canonicalAvailability(value: unknown): OnboardingV2Availability[] {
  if (!Array.isArray(value)) return [];
  const selected = new Set(value);
  return ONBOARDING_V2_AVAILABILITY.filter((option) => selected.has(option));
}

export function hasOnboardingV2Location(
  player: Record<string, unknown> | null | undefined,
  privatePlayer: Record<string, unknown> | null | undefined
) {
  return Boolean(
    typeof player?.postcode === "string" && /^[23]\d{3}$/.test(player.postcode.trim()) &&
    typeof privatePlayer?.lat === "number" && Number.isFinite(privatePlayer.lat) &&
    typeof privatePlayer?.lng === "number" && Number.isFinite(privatePlayer.lng) &&
    typeof privatePlayer?.geohash === "string" && privatePlayer.geohash.trim()
  );
}

export function hasOnboardingV2Photo(player: Record<string, unknown> | null | undefined) {
  return Boolean(
    typeof player?.photoURL === "string" && player.photoURL.trim() &&
    typeof player?.photoThumbURL === "string" && player.photoThumbURL.trim()
  );
}

export function resolveOnboardingV2ResumeStep(input: {
  player: Record<string, unknown> | null | undefined;
  privatePlayer: Record<string, unknown> | null | undefined;
}): OnboardingV2Step {
  if (!hasOnboardingV2Location(input.player, input.privatePlayer)) return "location";
  if (!isCanonicalSkillBand(input.player?.skillBand)) return "skill";
  if (!canonicalAvailability(input.player?.availability).length) return "availability";
  // Club membership is optional. Null is a valid skipped outcome and therefore
  // cannot block resume or activation.
  if (!hasOnboardingV2Photo(input.player)) return "photo";
  return "ready";
}

export function resolveOnboardingV2FinalizationStep(reasons: readonly string[]): OnboardingV2Step {
  if (reasons.some((reason) => [
    "account_not_initialized", "missing_name", "invalid_birth_year",
  ].includes(reason))) return "eligibility";
  if (reasons.some((reason) => [
    "invalid_postcode", "missing_coordinates", "missing_geohash",
  ].includes(reason))) return "location";
  if (reasons.includes("missing_skill")) return "skill";
  if (reasons.includes("missing_availability")) return "availability";
  if (reasons.includes("missing_photo")) return "photo";
  return "ready";
}

export function buildOnboardingV2SkillUpdate(input: {
  band: SkillBand;
  tmr?: number | null;
}) {
  const option = SKILL_OPTIONS.find((item) => item.value === input.band);
  if (!option) throw new Error("invalid_skill");
  const rating = typeof input.tmr === "number" && input.tmr >= 1 && input.tmr <= 16.5 ? input.tmr : null;
  return {
    skillBand: option.value,
    skillBandLabel: option.label,
    skillLevel: option.value.includes("beginner") ? "Beginner" :
      option.value.includes("intermediate") ? "Intermediate" : "Advanced",
    skillRating: rating,
    utr: rating,
  };
}

export function buildOnboardingV2AvailabilityUpdate(value: unknown) {
  const availability = canonicalAvailability(value);
  if (!availability.length || !Array.isArray(value) || availability.length !== value.length) {
    throw new Error("invalid_availability");
  }
  return {availability};
}

export function buildOnboardingV2ClubUpdate(input: {
  outcome: "selected" | "none" | "skipped";
  clubId?: string | null;
  clubName?: string | null;
}) {
  if (input.outcome === "selected") {
    if (!input.clubId || !input.clubName) throw new Error("invalid_club");
    return {clubStatus: "member" as const, clubId: input.clubId, clubName: input.clubName};
  }
  if (input.outcome === "none") {
    return {clubStatus: "none" as const, clubId: null, clubName: null};
  }
  return {clubStatus: null, clubId: null, clubName: null};
}

export function isOnboardingV2Destination(value: string | null | undefined) {
  if (!value) return false;
  return value === ONBOARDING_V2_PATH || value.startsWith(`${ONBOARDING_V2_PATH}?`);
}

export function resumableOnboardingV2PreAuthStep(value: string | null | undefined): OnboardingV2Step {
  if (value === "why" || value === "eligibility") return value;
  // Birth year is intentionally not persisted, so a refreshed account step
  // must reconfirm eligibility before Auth can be created.
  if (value === "account") return "eligibility";
  return "welcome";
}

export function onboardingV2Href(input?: {
  next?: string | null;
  ref?: string | null;
  rc?: string | null;
}) {
  const params = new URLSearchParams();
  if (input?.next?.startsWith("/") && !input.next.startsWith("//")) {
    params.set("next", input.next);
  }
  if (input?.ref) params.set("ref", input.ref);
  if (input?.rc) params.set("rc", input.rc);
  const query = params.toString();
  return query ? `${ONBOARDING_V2_PATH}?${query}` : ONBOARDING_V2_PATH;
}

export function validateAdultBirthYear(value: string, currentYear = new Date().getFullYear()) {
  const trimmed = value.trim();
  if (!/^\d{4}$/.test(trimmed)) {
    return { valid: false as const, reason: "Enter a four-digit birth year." };
  }

  const birthYear = Number(trimmed);
  const age = currentYear - birthYear;
  if (birthYear > currentYear || age > 110) {
    return { valid: false as const, reason: "Enter a valid birth year." };
  }
  if (age < 18) {
    return {
      valid: false as const,
      underage: true as const,
      reason: "TennisMate is currently for players aged 18+.",
    };
  }
  return { valid: true as const, birthYear };
}

export type OnboardingV2AccountFields = {
  name: string;
  email: string;
  password: string;
};

const ONBOARDING_V2_SPECIAL_CHARACTER = /[\^$*.\[\]{}()?"!@#%&/\\,><':;|_~]/;

export function validateOnboardingV2Account(fields: OnboardingV2AccountFields) {
  const errors: Partial<Record<keyof OnboardingV2AccountFields, string>> = {};
  const name = fields.name.trim();
  const email = fields.email.trim().toLowerCase();

  if (!name) errors.name = "Name is required.";
  else if (name.length > 60) errors.name = "Name must be 60 characters or fewer.";

  if (!email) errors.email = "Email is required.";
  else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    errors.email = "Enter a valid email address.";
  }

  if (!fields.password) errors.password = "Password is required.";
  else if (fields.password.length < 6) {
    errors.password = "Password must be at least 6 characters.";
  } else if (!/[A-Z]/.test(fields.password)) {
    errors.password = "Password must include an uppercase letter.";
  } else if (!ONBOARDING_V2_SPECIAL_CHARACTER.test(fields.password)) {
    errors.password = "Password must include a special character.";
  }

  return { errors, values: { name, email, password: fields.password } };
}

export type OnboardingV2PasswordValidationStatus = {
  isValid: boolean;
  meetsMinPasswordLength?: boolean;
  meetsMaxPasswordLength?: boolean;
  containsLowercaseLetter?: boolean;
  containsUppercaseLetter?: boolean;
  containsNumericCharacter?: boolean;
  containsNonAlphanumericCharacter?: boolean;
  passwordPolicy?: {
    customStrengthOptions?: {
      minPasswordLength?: number;
      maxPasswordLength?: number;
    };
  };
};

export function onboardingV2PasswordPolicyError(status: OnboardingV2PasswordValidationStatus) {
  if (status.isValid) return null;
  const missing: string[] = [];
  const strength = status.passwordPolicy?.customStrengthOptions;
  if (status.meetsMinPasswordLength === false) {
    missing.push(`at least ${strength?.minPasswordLength || 6} characters`);
  }
  if (status.meetsMaxPasswordLength === false) {
    missing.push(`no more than ${strength?.maxPasswordLength || 4096} characters`);
  }
  if (status.containsLowercaseLetter === false) missing.push("a lowercase letter");
  if (status.containsUppercaseLetter === false) missing.push("an uppercase letter");
  if (status.containsNumericCharacter === false) missing.push("a number");
  if (status.containsNonAlphanumericCharacter === false) missing.push("a special character");
  return missing.length
    ? `Password must include ${missing.join(", ")}.`
    : "Password does not meet the current security requirements.";
}

export type OnboardingV2SignupStage =
  | "referral_attribution"
  | "password_policy"
  | "input_revalidation"
  | "auth_create"
  | "auth_profile"
  | "account_initialization"
  | "verification_send";

function safeSignupErrorCode(error: unknown) {
  const candidate =
    typeof (error as {code?: unknown})?.code === "string"
      ? (error as {code: string}).code
      : error instanceof Error
        ? error.message
        : "unknown";
  return /^[a-z0-9_/-]{1,80}$/i.test(candidate) ? candidate : "unknown";
}

export function onboardingV2SignupFailureDetails(
  stage: OnboardingV2SignupStage,
  error: unknown,
  authAccountCreated: boolean
) {
  return {
    stage,
    code: safeSignupErrorCode(error),
    auth_account_created: authAccountCreated,
  };
}

export function maskEmail(email: string | null | undefined) {
  const [local = "", domain = ""] = (email || "").split("@");
  if (!local || !domain) return "your email";
  const visible = local.slice(0, Math.min(2, local.length));
  return `${visible}${"•".repeat(Math.max(3, local.length - visible.length))}@${domain}`;
}

export function onboardingV2AuthError(code: string | undefined) {
  if (code === "auth/email-already-in-use") {
    return "An account already exists for this email.";
  }
  if (code === "auth/weak-password") return "Password must be at least 6 characters.";
  if (code === "auth/password-does-not-meet-requirements") {
    return "Password does not meet the current security requirements.";
  }
  if (code === "auth/invalid-email") return "Enter a valid email address.";
  if (code === "auth/network-request-failed") {
    return "Check your connection and try again.";
  }
  if (code === "functions/unavailable" || code === "functions/deadline-exceeded") {
    return "Account setup is temporarily unavailable. Try again shortly.";
  }
  return "We couldn't create your account. Please try again.";
}

export async function createOnboardingV2Account<TUser>(input: {
  fields: OnboardingV2AccountFields;
  birthYear: string;
  referralCandidates: ReferralCandidate[];
  createAuthUser: (email: string, password: string) => Promise<TUser>;
  initializeAccount: (input: {
    user: TUser;
    displayName: string;
    birthYear: number;
    referralCandidates: ReferralCandidate[];
  }) => Promise<AccountInitializationResult>;
  sendInitialVerification: (input: {
    user: TUser;
    shouldSendVerification: boolean;
  }) => Promise<boolean>;
}) {
  const eligibility = validateAdultBirthYear(input.birthYear);
  if (!eligibility.valid) throw new Error("eligibility_invalid");

  const account = validateOnboardingV2Account(input.fields);
  if (Object.keys(account.errors).length) throw new Error("account_fields_invalid");

  const user = await input.createAuthUser(account.values.email, account.values.password);
  const initialization = await input.initializeAccount({
    user,
    displayName: account.values.name,
    birthYear: eligibility.birthYear,
    referralCandidates: input.referralCandidates,
  });
  const verificationSent = await input.sendInitialVerification({
    user,
    shouldSendVerification: initialization.shouldSendVerification,
  });

  return { user, initialization, verificationSent };
}
