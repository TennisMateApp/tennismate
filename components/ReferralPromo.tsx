"use client";

import { useEffect, useMemo, useState } from "react";
import { onAuthStateChanged } from "firebase/auth";
import { auth, db } from "@/lib/firebase";
import { doc, getDoc } from "firebase/firestore";
import { Gift, Copy, Check, X } from "lucide-react";
import Link from "next/link"; // NEW

const STORAGE_KEY_DISMISSED = "referralPromoDismissed";

export default function ReferralPromo() {
  const [referralUrl, setReferralUrl] = useState<string>("");
  const [copied, setCopied] = useState(false);
  const [open, setOpen] = useState(false);
  const [dismissed, setDismissed] = useState<boolean>(false);

  // Respect prior dismissal
  useEffect(() => {
    try {
      setDismissed(localStorage.getItem(STORAGE_KEY_DISMISSED) === "1");
    } catch {}
  }, []);

  // Build the user's referral link (but we won't show it in the UI)
  useEffect(() => {
    const off = onAuthStateChanged(auth, async (user) => {
      if (!user) return;
      const snap = await getDoc(doc(db, "users", user.uid));
      const code = (snap.get("referralCode") || "").toString();
      if (!code) return;

      const base =
        process.env.NEXT_PUBLIC_APP_BASE_URL ||
        (typeof window !== "undefined" ? window.location.origin : "");

      // Update the path if your sign-up route differs
      setReferralUrl(`${base}/signup?ref=${encodeURIComponent(code)}`);
    });

    return () => off();
  }, []);

  const handleCopy = async () => {
    if (!referralUrl) return;
    try {
      await navigator.clipboard.writeText(referralUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {}
  };

  const handleDismiss = () => {
    setDismissed(true);
    try {
      localStorage.setItem(STORAGE_KEY_DISMISSED, "1");
    } catch {}
  };

  if (dismissed || !referralUrl) return null;

  return (
    <>
      {/* Compact inline banner */}
      <div
        className="mt-3 mb-3 rounded-xl border border-green-200/60 bg-green-50 px-3 py-2 shadow-sm ring-1 ring-green-100/40 flex items-center gap-3"
        role="region"
        aria-label="Referral promotion"
      >
        <Gift className="h-4 w-4 text-green-700 shrink-0" aria-hidden="true" />

        {/* Clicking the text opens the modal (no extra buttons on the bar) */}
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="text-left text-[13px] leading-tight text-green-900 hover:underline focus:outline-none"
          aria-haspopup="dialog"
        >
          Refer a mate & enter the draw for a $100 Tennis Warehouse Gift Voucher. See details & T&Cs.
        </button>

        <div className="ml-auto flex items-center gap-2">
          {/* NEW: tiny T&Cs link on the banner (separate from the modal trigger) */}
          <Link
            href="/legal/referral-competition-terms"
            className="text-[12px] text-green-800 underline underline-offset-2 hover:text-green-900"
            aria-label="View full Terms and Conditions"
          >
            T&Cs
          </Link>

          <button
            type="button"
            onClick={handleCopy}
            className="inline-flex items-center gap-1 rounded-md bg-green-600 px-2.5 py-1.5 text-xs font-medium text-white hover:bg-green-700 focus:outline-none"
            aria-label="Copy your referral link"
          >
            {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
            {copied ? "Copied" : "Copy link"}
          </button>

          <button
            type="button"
            onClick={handleDismiss}
            className="rounded-md p-1 text-green-800/70 hover:bg-green-100"
            aria-label="Dismiss promotion"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* Modal with details + T&Cs */}
      {open && (
        <div
          className="fixed inset-0 z-40 flex items-center justify-center"
          role="dialog"
          aria-modal="true"
        >
          <div
            className="absolute inset-0 bg-black/40"
            onClick={() => setOpen(false)}
            aria-hidden="true"
          />
          <div className="relative z-50 w-[92vw] max-w-xl rounded-2xl bg-white p-5 shadow-xl ring-1 ring-black/10">
            <div className="flex items-start gap-3">
              <Gift className="h-5 w-5 text-green-700 mt-0.5" aria-hidden="true" />
              <div className="min-w-0">
                <h2 className="text-base font-semibold text-gray-900">
                  Refer friends. Win a $100 Tennis Warehouse Gift Voucher.
                </h2>
                <p className="mt-1 text-sm text-gray-600">
                  Invite friends with your link. When they verify email, add a profile photo,
                  and they send their first Match Request, you earn an entry into the draw.
                </p>
                <p className="mt-1 text-sm text-gray-600">
                  Competition runs from 9am 23/08/2025 to 12pm 23/09/2025.
                </p>

                {/* Quick actions */}
                <div className="mt-3 flex items-center gap-2">
                  <button
                    type="button"
                    onClick={handleCopy}
                    className="inline-flex items-center gap-1 rounded-md bg-green-600 px-3 py-2 text-sm font-medium text-white hover:bg-green-700 focus:outline-none"
                  >
                    {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                    {copied ? "Link copied" : "Copy referral link"}
                  </button>
                </div>

                {/* T&Cs (short version; adjust as needed) */}
                <div className="mt-4 rounded-lg bg-gray-50 p-3 ring-1 ring-gray-200/60">
                  <h3 className="text-sm font-semibold text-gray-900">Key Terms</h3>
                  <ul className="mt-1.5 list-disc space-y-1 pl-5 text-xs text-gray-700">
                    <li>Eligible entrants: Australia, 18+.</li>
                    <li>
                      How to enter: share your referral link; each <em>qualified referral</em> earns 1 entry.
                    </li>
                    <li>
                      Qualified referral: the referred user signs up via your link, verifies their email,
                      adds a profile photo, and <strong>sends at least one match request to someone other than the referrer</strong>.
                    </li>
                    <li>Prize: $100 Tennis Warehouse Gift Voucher.</li>
                    <li>Winner selection: random draw; winner notified by email within 7 days.</li>
                    <li>Promoter: TennisMate. No cash alternative. See full terms for details.</li>
                  </ul>
                  <p className="mt-2 text-xs text-gray-500">
                    By participating you agree to the{" "}
                    <Link
                      href="/legal/referral-competition-terms" // NEW
                      className="underline underline-offset-2"
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      full Terms &amp; Conditions
                    </Link>
                    .
                  </p>
                </div>
              </div>

              <button
                type="button"
                onClick={() => setOpen(false)}
                className="ml-auto -mr-1 rounded-md p-1 text-gray-500 hover:bg-gray-100"
                aria-label="Close terms"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
