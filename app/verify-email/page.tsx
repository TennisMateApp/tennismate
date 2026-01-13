"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import { auth } from "@/lib/firebaseConfig";
import { onAuthStateChanged, sendEmailVerification, signOut } from "firebase/auth";
import { Mail, ShieldCheck, Loader2 } from "lucide-react";

// Use your verified custom domain for email action links (Universal/App Links)
const APP_ORIGIN =
  process.env.NEXT_PUBLIC_APP_ORIGIN || "https://tennis-mate.com.au";

// After verification, send the user back into the app
const buildVerifyReturnUrl = () => `${APP_ORIGIN}/auth/email-action?mode=verify`;


export default function VerifyEmailPage() {
  const router = useRouter();
  const [ready, setReady] = useState(false);
  const [sending, setSending] = useState(false);
  const [cooldown, setCooldown] = useState(0);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (u) => {
      if (!u) {
        router.replace("/login");
        return;
      }

      await u.reload();

      // If already verified, just send them into the app
      if (u.emailVerified) {
        router.replace("/home");
        return;
      }

      setReady(true);
    });

    return () => unsub();
  }, [router]);

  useEffect(() => {
    if (!cooldown) return;
    const t = setInterval(() => setCooldown((c) => (c > 0 ? c - 1 : 0)), 1000);
    return () => clearInterval(t);
  }, [cooldown]);

  async function sendEmail() {
    if (!auth.currentUser || cooldown > 0) return;
    setSending(true);

    try {
      const returnUrl = buildVerifyReturnUrl();

await sendEmailVerification(auth.currentUser, {
  url: returnUrl,
  handleCodeInApp: true, // keeps the "tap link → open app" style flow

  // App IDs MUST match your actual builds
  iOS: { bundleId: "au.com.tennismatch.tennismate" },
  android: {
    packageName: "com.tennismate.app",
    installApp: true,
    minimumVersion: "1",
  },
});


      setCooldown(60);
      alert("Verification email sent. Check your inbox.");
    } catch (e: any) {
      console.error("sendEmailVerification failed:", e);
      const code = e?.code || "unknown";
      const message = e?.message || "Unknown error";
      alert(`Could not send verification email. (${code}) ${message}`);
    } finally {
      setSending(false);
    }
  }

  const email = auth.currentUser?.email || "";
  const maskedEmail = email ? email.replace(/(.{2}).+(@.+)/, "$1•••$2") : "";

  if (!ready) return null;

  return (
    <div className="relative min-h-screen overflow-hidden">
      <div
        className="fixed inset-0 z-0 bg-cover bg-center"
        style={{ backgroundImage: "url('/images/tennis-court.jpg')" }}
        aria-hidden="true"
      />
      <div
        className="fixed inset-0 z-10 bg-white/60 dark:bg-black/50 pointer-events-none"
        aria-hidden="true"
      />
      <div className="absolute top-6 left-1/2 -translate-x-1/2 z-30 text-center select-none">
        <Image
          src="/logo.png"
          alt="TennisMate"
          width={72}
          height={72}
          className="rounded-full shadow-lg ring-1 ring-black/10"
          priority
        />
        <div className="mt-2 text-sm font-semibold text-gray-800 dark:text-gray-100">
          TennisMate
        </div>
      </div>

      <div className="relative z-20 min-h-screen grid place-items-center px-4 pt-24">
        <div className="w-full max-w-lg">
          <div className="bg-white/80 dark:bg-gray-900/80 backdrop-blur rounded-2xl shadow-lg ring-1 ring-black/5 dark:ring-white/10 p-8">
            <p className="text-xs tracking-wide uppercase text-gray-600 dark:text-gray-400 mb-2">
              Step 2 of 2
            </p>
            <div className="flex items-start gap-4">
              <div className="shrink-0 inline-flex h-12 w-12 items-center justify-center rounded-full bg-green-100 dark:bg-green-900/30">
                <ShieldCheck className="h-6 w-6 text-green-600 dark:text-green-400" />
              </div>
              <div>
                <h1 className="text-2xl font-semibold tracking-tight">Verify your email</h1>
                <p className="mt-1 text-sm text-gray-700 dark:text-gray-300">
                  To start sending match requests, please verify your email
                  {maskedEmail ? (
                    <>
                      {" "}
                      <span className="font-medium text-gray-900 dark:text-gray-100">
                        {maskedEmail}
                      </span>
                      .
                    </>
                  ) : (
                    "."
                  )}
                </p>
              </div>
            </div>

            <div className="mt-6 flex flex-wrap items-center gap-3">
  <button
    onClick={sendEmail}
    disabled={sending || cooldown > 0}
    className="inline-flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-medium text-white bg-green-600 hover:bg-green-700 disabled:opacity-60 disabled:cursor-not-allowed"
  >
    {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Mail className="h-4 w-4" />}
    {sending ? "Sending…" : cooldown ? `Resend in ${cooldown}s` : "Send verification email"}
  </button>

  <button
    type="button"
    onClick={async () => {
      const u = auth.currentUser;
      if (!u) return;
      await u.reload();
      if (u.emailVerified) router.replace("/home");
      else alert("Not verified yet. Please tap the link in your email, then try again.");
    }}
    className="inline-flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-medium text-green-700 bg-green-50 hover:bg-green-100 border border-green-200"
  >
    I've verified my email — continue
  </button>
</div>


            <div className="mt-6 space-y-2 text-sm text-gray-700 dark:text-gray-300">
              <p className="leading-relaxed">
                We’ll email you a link. Tap it on this device to return straight to TennisMate.
                If you open it on another device, just sign in there with the same email.
              </p>
              <div className="flex flex-wrap gap-2">
                <a
                  href="https://mail.google.com"
                  target="_blank"
                  rel="noreferrer"
                  className="rounded-lg border border-gray-200 dark:border-gray-700 px-3 py-1.5 hover:bg-gray-50 dark:hover:bg-gray-800"
                >
                  Open Gmail
                </a>
                <a
                  href="https://outlook.live.com/mail/0/inbox"
                  target="_blank"
                  rel="noreferrer"
                  className="rounded-lg border border-gray-200 dark:border-gray-700 px-3 py-1.5 hover:bg-gray-50 dark:hover:bg-gray-800"
                >
                  Open Outlook
                </a>
                <button
                  onClick={async () => {
                    await signOut(auth);
                    router.replace("/login");
                  }}
                  className="ml-auto rounded-lg px-3 py-1.5 text-red-600 hover:bg-red-50 dark:hover:bg-red-950/30"
                >
                  Log out
                </button>
              </div>
              <p className="text-xs text-gray-600 dark:text-gray-400">
                Tip: check your spam folder if you don’t see the email within a minute.
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
