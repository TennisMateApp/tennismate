"use client";
import { useEffect, useMemo, useState } from "react";
import { auth } from "@/lib/firebaseConfig";
import { sendEmailVerification } from "firebase/auth";

type Props = {
  /** Called after the user clicks “I’ve verified” and we’ve reloaded auth */
  onVerified?: () => void;
  /** Optional override for the continue URL in the verification email */
  continueUrl?: string;
  /** Optional extra classes for layout tweaks */
  className?: string;
};

export default function VerifyEmailBanner({
  onVerified,
  continueUrl = "https://tennis-mate.com.au/verify-complete",
  className = "",
}: Props) {
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cooldown, setCooldown] = useState(0); // seconds until next resend

  const email = useMemo(() => auth.currentUser?.email ?? "", []);

  // Simple cooldown timer
  useEffect(() => {
    if (cooldown <= 0) return;
    const t = setInterval(() => setCooldown((c) => c - 1), 1000);
    return () => clearInterval(t);
  }, [cooldown]);

  async function resend() {
    if (!auth.currentUser || sending || cooldown > 0) return;
    setSending(true);
    setError(null);
    try {
      await sendEmailVerification(auth.currentUser, {
        url: continueUrl,
        handleCodeInApp: true,
      });
      setSent(true);
      setCooldown(45); // prevent rapid re-sends
    } catch (e: any) {
      // Common Firebase errors: auth/too-many-requests, auth/user-token-expired, etc.
      setError(
        e?.code === "auth/too-many-requests"
          ? "Too many attempts. Please wait a moment before trying again."
          : "Couldn’t send the email. Please try again."
      );
      // modest cooldown even on error to avoid hammering
      setCooldown(20);
    } finally {
      setSending(false);
    }
  }

  async function iveVerified() {
    // Reload the user so emailVerified is up-to-date
    await auth.currentUser?.reload();
    onVerified?.();
  }

  // If somehow rendered without a user, don’t show anything
  if (!auth.currentUser) return null;

  return (
    <div
      className={`bg-yellow-50 border border-yellow-200 rounded-2xl p-3 mx-2 mt-2 text-sm shadow-sm ${className}`}
      role="status"
      aria-live="polite"
    >
      <div className="flex items-start gap-3">
        <div className="flex-1">
          <div className="font-semibold">Verify your email</div>
          <div className="text-yellow-900/90 mt-0.5">
            To start sending match requests, please verify
            {email ? <> <b>{email}</b></> : " your email"}.
            {sent ? " Verification email sent." : null}
          </div>

          {error && <div className="text-red-600 mt-1">{error}</div>}

          <div className="mt-2 flex flex-wrap items-center gap-2">
            <button
              className="px-3 py-1 rounded-xl border hover:bg-yellow-100 disabled:opacity-60"
              onClick={resend}
              disabled={sending || cooldown > 0}
            >
              {sending
                ? "Sending…"
                : sent
                ? cooldown > 0
                  ? `Sent ✓ (retry in ${cooldown}s)`
                  : "Sent ✓"
                : cooldown > 0
                ? `Resend (${cooldown}s)`
                : "Resend email"}
            </button>

            <button
              className="px-3 py-1 rounded-xl border hover:bg-yellow-100"
              onClick={iveVerified}
              title="Click after you’ve tapped the link in your email"
            >
              I’ve verified
            </button>

            <span className="text-xs text-yellow-900/80 ml-1">
              Tip: check spam/junk if you don’t see it.
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
