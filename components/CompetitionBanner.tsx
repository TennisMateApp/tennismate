"use client";

import { useEffect, useState } from "react";
import { auth, db } from "@/lib/firebase"; // ✅ adjust if your firebase export path differs
import { doc, getDoc, setDoc, serverTimestamp } from "firebase/firestore";

import { Capacitor } from "@capacitor/core";
import Image from "next/image";

export default function CompetitionBanner() {
  const [loading, setLoading] = useState(true);
  const [visible, setVisible] = useState(false);

  const IOS_APP_ID = "6755902082";
  const ANDROID_PACKAGE = "com.tennismate.app";

  useEffect(() => {
    const run = async () => {
      const user = auth.currentUser;
      if (!user) {
        setLoading(false);
        return;
      }

      const ref = doc(db, "users", user.uid);
      const snap = await getDoc(ref);

      // ✅ If user already tapped "Leave a Review", never show again
      const clickedAt = snap.exists() ? snap.data()?.reviewBannerClickedAt : null;

      setVisible(!clickedAt);
      setLoading(false);
    };

    run().catch(() => setLoading(false));
  }, []);

const openStoreReview = async () => {
  const isNative = Capacitor.isNativePlatform();
  const platform = Capacitor.getPlatform(); // "ios" | "android" | "web"

  const iosUrlApp = `itms-apps://itunes.apple.com/app/id${IOS_APP_ID}?action=write-review`;
  const iosUrlWeb = `https://apps.apple.com/app/id${IOS_APP_ID}?action=write-review`;

  const androidUrlApp = `market://details?id=${ANDROID_PACKAGE}`;
  const androidUrlWeb = `https://play.google.com/store/apps/details?id=${ANDROID_PACKAGE}`;

  // ✅ Decide destination FIRST (sync), so we can open immediately
  let destination = androidUrlWeb;

  if (isNative) {
    if (platform === "ios") destination = iosUrlApp;
    else if (platform === "android") destination = androidUrlApp;
  } else {
    // Web/PWA: detect iOS vs Android
    const ua = navigator.userAgent || "";
    const isIOS =
      /iPad|iPhone|iPod/.test(ua) ||
      (navigator.platform === "MacIntel" && (navigator as any).maxTouchPoints > 1);

    destination = isIOS ? iosUrlWeb : androidUrlWeb;
  }

  // ✅ 1) OPEN IMMEDIATELY (must be synchronous to avoid popup blocking)
  // Try new tab first; if blocked, fall back to same-tab navigation.
  // Web/PWA: use same-tab so Back returns to the app
if (platform === "web") {
  window.location.href = destination;
  setVisible(false);
} else {
  // Native: open externally
  const opened = window.open(destination, "_blank", "noopener,noreferrer");
  if (!opened) window.location.href = destination;
  setVisible(false);
}

  // ✅ 2) Hide immediately (UX)
  setVisible(false);

  // ✅ 3) Persist click AFTER opening (async safe)
  try {
    const user = auth.currentUser;
    if (user) {
      const ref = doc(db, "users", user.uid);
      await setDoc(ref, { reviewBannerClickedAt: serverTimestamp() }, { merge: true });
    }
  } catch (e) {
    console.warn("[CompetitionBanner] Failed to persist review click:", e);
  }
};


  const dismiss = async () => {
    // Optional: store that they dismissed (NOT permanent)
    const user = auth.currentUser;
    if (user) {
      const ref = doc(db, "users", user.uid);
      await setDoc(ref, { reviewBannerDismissedAt: serverTimestamp() }, { merge: true });
    }
    setVisible(false);
  };

  if (loading || !visible) return null;

  if (loading || !visible) return null;

  return (
    <div className="mb-6">
      <div className="relative overflow-hidden rounded-2xl border shadow-sm">
{/* Background image */}
<Image
  src="/images/promocourt.jpg"
  alt="TennisMate promo background"
  fill
  priority
  className="object-cover"
/>

{/* Light contrast overlay */}
<div className="absolute inset-0 bg-black/30" />

{/* Soft highlight wash */}
<div className="absolute inset-0 bg-gradient-to-t from-black/40 via-transparent to-white/10" />
{/* Text scrim (darkens only the left side so text stays readable over court lines) */}
<div className="absolute inset-0 bg-gradient-to-r from-black/60 via-black/25 to-transparent" />




        {/* Content */}
        <div className="relative p-5 sm:p-6 pb-12 sm:pb-6 text-white drop-shadow-[0_2px_10px_rgba(0,0,0,0.55)]">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              {/* Top badges */}
              <div className="flex flex-wrap items-center gap-2">
                <span className="inline-flex items-center gap-2 rounded-full bg-white/15 px-3 py-1 text-xs font-semibold backdrop-blur">
                  🎟️ Competition
                </span>
                <span className="inline-flex items-center gap-2 rounded-full bg-black/20 px-3 py-1 text-xs font-semibold backdrop-blur">
                  AO • 24 Jan 2026
                </span>
              </div>

              {/* Title */}
              <h3 className="mt-3 text-lg sm:text-xl font-extrabold tracking-tight">
                Win 2 × Australian Open Ground Passes
              </h3>

              {/* Body */}
<p className="mt-2 max-w-xl text-sm sm:text-base text-white/90">
  Enter in under a minute — just leave a review on the App Store or Google Play.
</p>



              {/* Actions */}
              <div className="mt-4 flex flex-wrap items-center gap-3">
                <button
                  onClick={openStoreReview}
                  className="inline-flex items-center justify-center rounded-xl bg-white px-4 py-2 text-sm font-semibold text-slate-900 shadow-sm hover:bg-white/90 active:scale-[0.99]"
                >
                  Leave a Review
                </button>
                

                {/* Optional secondary action (remove if you don’t want it) */}

              </div>
            </div>

            <button
  type="button"
  onClick={() =>
    window.open(
      "https://tennis-mate.com.au/ao-ticket-comp-t%26cs",
      "_blank",
      "noopener,noreferrer"
    )
  }
  className="absolute bottom-3 right-3 sm:bottom-4 sm:right-4 inline-flex items-center justify-center rounded-lg border border-white/25 bg-white/10 px-3 py-1.5 text-xs font-semibold text-white/90 backdrop-blur hover:bg-white/15"
>
  T&amp;Cs
</button>
<button
  onClick={dismiss}
  aria-label="Dismiss"
  className="rounded-xl bg-white/10 px-2 py-1 text-xl leading-none text-white/90 backdrop-blur hover:bg-white/15"
>
  ×
</button>

          </div>

          {/* Subtle footer */}
          <div className="mt-5 text-xs text-white/80">
            Winner announced after the competition closes. Reviews can be positive or negative — we just want honest feedback.
          </div>
        </div>
      </div>
    </div>
  );
}
