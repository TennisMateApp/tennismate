export type ReferralCandidateSource = "ref" | "rc" | "cookie" | "session";

export type ReferralCandidate = {
  code: string;
  source: ReferralCandidateSource;
};

export const REFERRAL_SESSION_KEY = "tennismate:first-touch-referral";

export function normalizeReferralCode(value: unknown) {
  return typeof value === "string"
    ? value.trim().toUpperCase().replace(/[^A-Z0-9_-]/g, "").slice(0, 40)
    : "";
}

export function referralCookieValue(cookieHeader: string) {
  const entry = cookieHeader
    .split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith("referral_code="));
  if (!entry) return "";
  try {
    return normalizeReferralCode(decodeURIComponent(entry.slice("referral_code=".length)));
  } catch {
    return "";
  }
}

export function collectReferralCandidates(input: {
  stored?: string | null;
  ref?: string | null;
  rc?: string | null;
  cookie?: string | null;
}) {
  const ordered: ReferralCandidate[] = [
    { code: normalizeReferralCode(input.stored), source: "session" },
    { code: normalizeReferralCode(input.ref), source: "ref" },
    { code: normalizeReferralCode(input.rc), source: "rc" },
    { code: normalizeReferralCode(input.cookie), source: "cookie" },
  ];
  const seen = new Set<string>();
  return ordered.filter(({ code }) => Boolean(code) && !seen.has(code) && seen.add(code));
}

