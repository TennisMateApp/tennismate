export type PublicReadinessData = {
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

export type PrivateReadinessData = {
  birthYear?: unknown;
  lat?: unknown;
  lng?: unknown;
  geohash?: unknown;
};

export type BackendReadinessReason =
  | "missing_name"
  | "missing_postcode"
  | "missing_skill"
  | "profile_incomplete"
  | "match_me_disabled"
  | "missing_birth_year"
  | "missing_availability"
  | "missing_photo"
  | "missing_private_location";

const hasText = (value: unknown): value is string =>
  typeof value === "string" && value.trim().length > 0;

const hasFiniteNumber = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value);

export function backendHasPlayerSkill(player: PublicReadinessData | null | undefined) {
  return Boolean(
    player &&
      (hasText(player.skillLevel) ||
        hasText(player.skillBand) ||
        hasFiniteNumber(player.skillRating) ||
        hasFiniteNumber(player.utr))
  );
}

export function backendHasPrivateLocation(
  privatePlayer: PrivateReadinessData | null | undefined
) {
  return Boolean(
    privatePlayer &&
      hasFiniteNumber(privatePlayer.lat) &&
      hasFiniteNumber(privatePlayer.lng) &&
      hasText(privatePlayer.geohash)
  );
}

export function backendCandidateReadiness(
  player: PublicReadinessData | null | undefined,
  privatePlayer: PrivateReadinessData | null | undefined
) {
  const reasons: BackendReadinessReason[] = [];
  if (!hasText(player?.name)) reasons.push("missing_name");
  if (!/^\d{4}$/.test(hasText(player?.postcode) ? player.postcode.trim() : "")) {
    reasons.push("missing_postcode");
  }
  if (!backendHasPlayerSkill(player)) reasons.push("missing_skill");
  if (!Array.isArray(player?.availability) || player.availability.length === 0) {
    reasons.push("missing_availability");
  }
  if (![player?.photoThumbURL, player?.photoURL, player?.avatar].some(hasText)) {
    reasons.push("missing_photo");
  }
  if (player?.profileComplete !== true) reasons.push("profile_incomplete");
  if (player?.isMatchable === false) reasons.push("match_me_disabled");
  const birthYear = privatePlayer?.birthYear;
  const currentYear = new Date().getFullYear();
  const age = typeof birthYear === "number" ? currentYear - birthYear : Number.NaN;
  if (!Number.isInteger(birthYear) || age < 18 || age > 110) reasons.push("missing_birth_year");
  if (!backendHasPrivateLocation(privatePlayer)) reasons.push("missing_private_location");
  return {ready: reasons.length === 0, reasons};
}
