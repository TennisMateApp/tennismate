"use client";

import Image from "next/image";
import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Mail, Loader2, ShieldCheck } from "lucide-react";
import { onAuthStateChanged, sendEmailVerification, signOut } from "firebase/auth";

import { auth } from "@/lib/firebaseConfig";
import {
  initializeOrRepairAccount,
  resolveAccountDestination,
  sendInitialVerificationIfClaimed,
} from "@/lib/accountLifecycle";
import { safeNextDestination, verificationContinueUrl } from "@/lib/verificationFlow";
import { trackEvent } from "@/lib/analytics";

type Notice = { kind: "info" | "success" | "error"; text: string } | null;

export default function VerifyEmailPage() {
  const router = useRouter();
  const params = useSearchParams();
  const next = safeNextDestination(params.get("next"), "/home");
  const [ready, setReady] = useState(false);
  const [sending, setSending] = useState(false);
  const [checking, setChecking] = useState(false);
  const [cooldown, setCooldown] = useState(0);
  const [notice, setNotice] = useState<Notice>(null);

  async function continueIfVerified() {
    const user = auth.currentUser;
    if (!user) return false;
    await user.reload();
    if (!user.emailVerified) return false;
    router.replace(await resolveAccountDestination(user, next));
    return true;
  }

  useEffect(() => {
    return onAuthStateChanged(auth, async (user) => {
      if (!user) {
        router.replace(`/login?next=${encodeURIComponent(next)}`);
        return;
      }
      await user.reload();
      if (user.emailVerified) {
        router.replace(await resolveAccountDestination(user, next));
        return;
      }
      try {
        const initialized = await initializeOrRepairAccount({ user });
        const sent = await sendInitialVerificationIfClaimed({
          user,
          shouldSendVerification: initialized.shouldSendVerification,
          next,
        });
        if (sent) {
          void trackEvent("verification_sent", { send_type: "initial_resume" });
          setCooldown(60);
          setNotice({ kind: "success", text: "Verification email sent. Check your inbox." });
        }
      } catch {
        setNotice({
          kind: "error",
          text: "We couldn't prepare verification automatically. You can resend below.",
        });
      }
      setReady(true);
    });
  }, [next, router]);

  useEffect(() => {
    if (!cooldown) return;
    const timer = window.setInterval(() => setCooldown((value) => Math.max(0, value - 1)), 1000);
    return () => window.clearInterval(timer);
  }, [cooldown]);

  useEffect(() => {
    const checkOnFocus = () => void continueIfVerified();
    window.addEventListener("focus", checkOnFocus);
    return () => window.removeEventListener("focus", checkOnFocus);
  });

  async function resend() {
    if (!auth.currentUser || cooldown > 0) return;
    setSending(true);
    setNotice(null);
    try {
      await sendEmailVerification(auth.currentUser, {
        url: verificationContinueUrl(next),
        handleCodeInApp: true,
      });
      setCooldown(60);
      void trackEvent("verification_sent", { send_type: "resend" });
      setNotice({ kind: "success", text: "Verification email sent. Check your inbox." });
    } catch (error) {
      const code = (error as { code?: string })?.code || "";
      setNotice({
        kind: "error",
        text: code.includes("too-many-requests")
          ? "Please wait a little longer before requesting another email."
          : "We couldn't send the email. Check your connection and try again.",
      });
    } finally {
      setSending(false);
    }
  }

  async function checkVerification() {
    setChecking(true);
    const verified = await continueIfVerified().catch(() => false);
    if (!verified) setNotice({ kind: "info", text: "Not verified yet. Open the link in your email, then try again." });
    setChecking(false);
  }

  if (!ready) return null;
  const email = auth.currentUser?.email || "";
  const maskedEmail = email ? email.replace(/(.{2}).+(@.+)/, "$1•••$2") : "your email";

  return (
    <div className="relative min-h-screen overflow-hidden">
      <div className="fixed inset-0 bg-cover bg-center" style={{ backgroundImage: "url('/images/tennis-court.jpg')" }} aria-hidden="true" />
      <div className="fixed inset-0 bg-white/60 dark:bg-black/50" aria-hidden="true" />
      <div className="relative z-10 min-h-screen grid place-items-center px-4 py-20">
        <div className="w-full max-w-lg rounded-2xl bg-white/90 p-7 shadow-lg ring-1 ring-black/5 dark:bg-gray-900/90">
          <Image src="/logo.png" alt="TennisMate" width={64} height={64} className="mx-auto rounded-full shadow" priority />
          <div className="mt-6 flex items-start gap-4">
            <div className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-green-100"><ShieldCheck className="h-6 w-6 text-green-700" /></div>
            <div><p className="text-xs font-medium uppercase tracking-wide text-gray-500">Step 2 of 2</p><h1 className="text-2xl font-semibold">Verify your email</h1><p className="mt-1 text-sm text-gray-600 dark:text-gray-300">We sent a verification link to <span className="font-medium">{maskedEmail}</span>.</p></div>
          </div>

          {notice && <div role="status" className={`mt-5 rounded-xl border px-4 py-3 text-sm ${notice.kind === "error" ? "border-red-200 bg-red-50 text-red-800" : notice.kind === "success" ? "border-green-200 bg-green-50 text-green-800" : "border-blue-200 bg-blue-50 text-blue-800"}`}>{notice.text}</div>}

          <div className="mt-6 flex flex-wrap gap-3">
            <button onClick={resend} disabled={sending || cooldown > 0} className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-green-700 px-4 py-2.5 text-sm font-medium text-white disabled:opacity-60">
              {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Mail className="h-4 w-4" />}
              {sending ? "Sending…" : cooldown ? `Resend in ${cooldown}s` : "Resend verification email"}
            </button>
            <button onClick={checkVerification} disabled={checking} className="min-h-11 rounded-xl border border-green-200 bg-green-50 px-4 py-2.5 text-sm font-medium text-green-800 disabled:opacity-60">{checking ? "Checking…" : "I've verified — continue"}</button>
          </div>

          <p className="mt-6 text-sm leading-relaxed text-gray-600 dark:text-gray-300">You can open the link on this or another device. If you use another device, sign in there to continue. Check spam if it has not arrived.</p>
          <button onClick={async () => { await signOut(auth); router.replace(`/login?next=${encodeURIComponent(next)}`); }} className="mt-4 text-sm font-medium text-red-600">Log out</button>
        </div>
      </div>
    </div>
  );
}
