"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { applyActionCode } from "firebase/auth";
import { CheckCircle2, Loader2, MailWarning, RefreshCw } from "lucide-react";

import { trackEvent } from "@/lib/analytics";
import { auth } from "@/lib/firebaseConfig";
import {
  createVerificationActionRunner,
  processVerificationAction,
  verificationOpenDestination,
  type VerificationActionResult,
  type VerificationActionState,
} from "@/lib/verificationAction";

type VerificationView = {
  state: VerificationActionState;
  reason?: VerificationActionResult["reason"];
  signedIn: boolean;
};

const content: Record<Exclude<VerificationActionState, "checking" | "success">, { heading: string; body: string }> = {
  alreadyVerified: {
    heading: "Email already verified",
    body: "Your TennisMate email has already been confirmed.",
  },
  expired: {
    heading: "This verification link has expired.",
    body: "Return to TennisMate and request a new verification email.",
  },
  invalid: {
    heading: "This verification link is not valid.",
    body: "Return to TennisMate and request a new email.",
  },
  networkError: {
    heading: "We couldn’t confirm your email because of a connection problem.",
    body: "Check your connection and try again.",
  },
  unexpectedError: {
    heading: "We couldn’t confirm your email.",
    body: "Return to TennisMate and request a new verification email.",
  },
};

export default function VerifyCompletePage() {
  const params = useSearchParams();
  const code = params.get("oobCode");
  const mode = params.get("mode");
  const destination = verificationOpenDestination(params.get("next"));
  const runnerRef = useRef(createVerificationActionRunner());
  const trackedRef = useRef(false);
  const [view, setView] = useState<VerificationView>({ state: "checking", signedIn: false });

  useEffect(() => {
    let active = true;
    const key = `${mode || "missing"}:${code || "missing"}`;
    const result = runnerRef.current(key, () => processVerificationAction({
      code,
      mode,
      dependencies: {
        waitForAuthReady: () => auth.authStateReady(),
        isCurrentUserVerified: () => auth.currentUser?.emailVerified === true,
        applyCode: (actionCode) => applyActionCode(auth, actionCode),
        reloadCurrentUser: async () => {
          if (auth.currentUser) await auth.currentUser.reload();
        },
      },
    }));

    void result.then((next) => {
      if (!active) return;
      setView({ ...next, signedIn: Boolean(auth.currentUser) });
      if (
        !trackedRef.current &&
        (next.state === "success" || next.state === "alreadyVerified")
      ) {
        trackedRef.current = true;
        void trackEvent("verification_completed", {
          session_state: auth.currentUser ? "signed_in" : "other_device",
        });
      }
    });

    return () => {
      active = false;
    };
  }, [code, mode]);

  const successful = view.state === "success" || view.state === "alreadyVerified";
  const timedOut = view.state === "networkError" && view.reason === "timeout";
  const display = view.state === "checking"
    ? { heading: "Verifying your email…", body: "This should only take a moment." }
    : view.state === "success"
      ? {
          heading: "Email verified",
          body: view.signedIn
            ? "Your TennisMate account has been verified. Return to the TennisMate app to continue setting up your profile."
            : "Your email has been confirmed. Return to the device where you started setting up TennisMate.",
        }
      : timedOut
        ? {
            heading: "Verification is taking longer than expected.",
            body: "Check your connection and try opening the link again.",
          }
        : content[view.state];

  return (
    <main className="grid min-h-dvh place-items-center bg-[#f5f5f0] px-5 py-[max(2rem,env(safe-area-inset-top))]">
      <section className="w-full max-w-md rounded-2xl bg-white p-7 text-center shadow-sm ring-1 ring-black/5" aria-live="polite">
        <div className="flex items-center justify-center gap-2">
          <Image src="/logo.png" alt="" width={36} height={36} className="rounded-full" priority />
          <span className="text-lg font-semibold text-[#0B3D2E]">TennisMate</span>
        </div>
        <div className={`mx-auto mt-7 grid h-14 w-14 place-items-center rounded-full ${successful ? "bg-emerald-100 text-emerald-700" : view.state === "checking" ? "bg-slate-100 text-slate-600" : "bg-amber-100 text-amber-800"}`}>
          {view.state === "checking" ? <Loader2 className="h-7 w-7 animate-spin" aria-hidden="true" /> : successful ? <CheckCircle2 className="h-7 w-7" aria-hidden="true" /> : <MailWarning className="h-7 w-7" aria-hidden="true" />}
        </div>
        <h1 className="mt-5 text-2xl font-semibold text-slate-950">{display.heading}</h1>
        <p className="mt-2 text-sm leading-6 text-slate-600">{display.body}</p>

        {view.state !== "checking" ? (
          <div className="mt-6 space-y-3">
            <Link href={destination} className="inline-flex min-h-11 w-full items-center justify-center rounded-xl bg-[#0B3D2E] px-4 py-2.5 text-sm font-semibold text-white hover:bg-[#125540]">
              Open TennisMate
            </Link>
            {!successful ? (
              <button type="button" onClick={() => window.location.reload()} className="inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-xl border border-emerald-200 px-4 py-2.5 text-sm font-semibold text-emerald-800 hover:bg-emerald-50">
                <RefreshCw className="h-4 w-4" aria-hidden="true" />
                Try again
              </button>
            ) : null}
            <p className="text-xs leading-5 text-slate-500">You can also close this page and switch back to the TennisMate app.</p>
          </div>
        ) : null}
      </section>
    </main>
  );
}
