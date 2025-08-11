// lib/auth/getContinueUrl.ts
export function getContinueUrl(): string {
  const isLocal =
    typeof window !== "undefined" &&
    (window.location.hostname === "localhost" ||
     window.location.hostname === "127.0.0.1");

  // Force a single canonical domain in prod to avoid PWA preview domains
  const origin = isLocal ? "http://localhost:3000" : "https://tennis-mate.com.au";

  // We process verifyEmail on /match and show the success UI there
  return `${origin}/match?verified=1`;
}
