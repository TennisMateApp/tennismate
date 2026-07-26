export type PublicPlayerReadinessData = {
  name?: unknown;
  postcode?: unknown;
  skillLevel?: unknown;
  skillBand?: unknown;
  skillRating?: unknown;
  utr?: unknown;
  availability?: unknown;
  photoURL?: unknown;
  photoThumbURL?: unknown;
  avatar?: unknown;
  profileComplete?: unknown;
  isMatchable?: unknown;
};

export type PrivatePlayerReadinessData = {
  birthYear?: unknown;
  lat?: unknown;
  lng?: unknown;
  geohash?: unknown;
};

export type ReadinessFailureReason =
  | "missing_account_shell"
  | "missing_name"
  | "missing_postcode"
  | "missing_skill"
  | "missing_birth_year"
  | "missing_availability"
  | "missing_photo"
  | "missing_private_location"
  | "profile_incomplete"
  | "match_me_disabled"
  | "email_unverified";

export type ReadinessResult = {
  ready: boolean;
  reasons: ReadinessFailureReason[];
};

const hasText = (value: unknown): value is string =>
  typeof value === "string" && value.trim().length > 0;

const hasFiniteNumber = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value);

export function hasPlayerSkill(player: PublicPlayerReadinessData | null | undefined) {
  return Boolean(
    player &&
      (hasText(player.skillLevel) ||
        hasText(player.skillBand) ||
        hasFiniteNumber(player.skillRating) ||
        hasFiniteNumber(player.utr))
  );
}

export function hasValidAdultBirthYear(
  value: unknown,
  currentYear = new Date().getFullYear()
) {
  if (!Number.isInteger(value)) return false;
  const birthYear = value as number;
  const age = currentYear - birthYear;
  return birthYear >= 1900 && birthYear <= currentYear && age >= 18 && age <= 110;
}

export function hasPrivateLocation(
  privatePlayer: PrivatePlayerReadinessData | null | undefined
) {
  return Boolean(
    privatePlayer &&
      hasFiniteNumber(privatePlayer.lat) &&
      hasFiniteNumber(privatePlayer.lng) &&
      hasText(privatePlayer.geohash)
  );
}

export function accountInitialized(input: {
  userExists: boolean;
  playerExists: boolean;
  privatePlayerExists: boolean;
}): ReadinessResult {
  const ready = input.userExists && input.playerExists && input.privatePlayerExists;
  return { ready, reasons: ready ? [] : ["missing_account_shell"] };
}

function baseProfileReasons(player: PublicPlayerReadinessData | null | undefined) {
  const reasons: ReadinessFailureReason[] = [];
  if (!hasText(player?.name)) reasons.push("missing_name");
  if (!/^\d{4}$/.test(hasText(player?.postcode) ? player.postcode.trim() : "")) {
    reasons.push("missing_postcode");
  }
  if (!hasPlayerSkill(player)) reasons.push("missing_skill");
  return reasons;
}

export function onboardingProfileReady(
  player: PublicPlayerReadinessData | null | undefined,
  privatePlayer: PrivatePlayerReadinessData | null | undefined
): ReadinessResult {
  const reasons = baseProfileReasons(player);
  if (!hasValidAdultBirthYear(privatePlayer?.birthYear)) reasons.push("missing_birth_year");
  if (!Array.isArray(player?.availability) || player.availability.length === 0) {
    reasons.push("missing_availability");
  }
  if (![player?.photoThumbURL, player?.photoURL, player?.avatar].some(hasText)) {
    reasons.push("missing_photo");
  }
  return { ready: reasons.length === 0, reasons };
}

export function matchMeReady(
  player: PublicPlayerReadinessData | null | undefined,
  privatePlayer: PrivatePlayerReadinessData | null | undefined
): ReadinessResult {
  const reasons = onboardingProfileReady(player, privatePlayer).reasons;
  if (player?.profileComplete !== true) reasons.push("profile_incomplete");
  if (player?.isMatchable === false) reasons.push("match_me_disabled");
  if (!hasPrivateLocation(privatePlayer)) reasons.push("missing_private_location");
  return { ready: reasons.length === 0, reasons };
}

export function profileRecoveryReady(
  player: PublicPlayerReadinessData | null | undefined,
  privatePlayer: PrivatePlayerReadinessData | null | undefined
): ReadinessResult {
  const reasons = onboardingProfileReady(player, privatePlayer).reasons;
  if (player?.profileComplete !== true) reasons.push("profile_incomplete");
  if (!hasPrivateLocation(privatePlayer)) reasons.push("missing_private_location");
  return { ready: reasons.length === 0, reasons };
}

export function candidateMatchable(
  player: PublicPlayerReadinessData | null | undefined,
  privatePlayer: PrivatePlayerReadinessData | null | undefined
): ReadinessResult {
  const reasons = onboardingProfileReady(player, privatePlayer).reasons;
  if (player?.profileComplete !== true) reasons.push("profile_incomplete");
  if (player?.isMatchable === false) reasons.push("match_me_disabled");
  if (!hasPrivateLocation(privatePlayer)) reasons.push("missing_private_location");
  return { ready: reasons.length === 0, reasons };
}

export function fullyActivated(input: {
  userExists: boolean;
  playerExists: boolean;
  privatePlayerExists: boolean;
  emailVerified: boolean;
  player: PublicPlayerReadinessData | null | undefined;
  privatePlayer: PrivatePlayerReadinessData | null | undefined;
}): ReadinessResult {
  const reasons: ReadinessFailureReason[] = [];
  if (!accountInitialized(input).ready) reasons.push("missing_account_shell");
  if (!input.emailVerified) reasons.push("email_unverified");
  reasons.push(...matchMeReady(input.player, input.privatePlayer).reasons);
  return { ready: reasons.length === 0, reasons: Array.from(new Set(reasons)) };
}
