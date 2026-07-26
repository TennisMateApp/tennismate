export type VerificationErrorKind = "expired" | "invalid" | "already_used" | "network" | "unknown";

export function verificationContinueUrl(next = "/home") {
  const origin =
    process.env.NEXT_PUBLIC_APP_ORIGIN ||
    (typeof window !== "undefined" ? window.location.origin : "https://tennis-mate.com.au");
  const url = new URL("/verify-complete", origin);
  url.searchParams.set("verification", "1");
  if (next.startsWith("/") && !next.startsWith("//")) url.searchParams.set("next", next);
  return url.toString();
}

export function safeNextDestination(value: string | null | undefined, fallback = "/home") {
  return value && value.startsWith("/") && !value.startsWith("//") ? value : fallback;
}

export function classifyVerificationError(error: unknown): VerificationErrorKind {
  const normalized =
    typeof error === "string"
      ? error
      : typeof (error as { code?: unknown })?.code === "string"
        ? String((error as { code: string }).code)
        : "";
  if (normalized === "auth/expired-action-code") return "expired";
  if (normalized === "auth/invalid-action-code") return "already_used";
  if (normalized === "auth/network-request-failed") return "network";
  if (normalized === "auth/invalid-email" || normalized === "auth/user-disabled") return "invalid";
  return "unknown";
}
