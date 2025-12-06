"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { auth } from "@/lib/firebaseConfig";
import { onAuthStateChanged } from "firebase/auth";

const IOS_URL = "https://apps.apple.com/au/app/tennismate-australia/id6755902082";
const ANDROID_URL =
  "https://play.google.com/store/apps/details?id=com.tennismate.app&hl=en_AU";

type Platform = "ios" | "android" | "web";

function detectPlatform(): Platform {
  if (typeof navigator === "undefined") return "web";
  const ua = navigator.userAgent || "";

  if (/iphone|ipad|ipod/i.test(ua)) return "ios";
  if (/android/i.test(ua)) return "android";
  return "web";
}

function isMobileBrowser(): boolean {
  if (typeof window === "undefined" || typeof navigator === "undefined") return false;

  const ua = navigator.userAgent || "";
  const isMobile = /android|iphone|ipad|ipod/i.test(ua);

  // Don’t show if running as an installed PWA / standalone
  const isStandalone =
    (window.matchMedia &&
      window.matchMedia("(display-mode: standalone)").matches) ||
    // iOS PWA standalone hint
    // @ts-ignore
    window.navigator.standalone === true;

  return isMobile && !isStandalone;
}

export default function GetTheAppPrompt() {
  const [open, setOpen] = useState(false);
  const [platform, setPlatform] = useState<Platform>("web");
  const timerRef = useRef<number | null>(null);

  useEffect(() => {
    if (typeof window === "undefined") return;

    // Already dismissed? Don’t show again.
    const dismissed = window.localStorage.getItem("tm_app_prompt_dismissed_v1");
    if (dismissed === "true") return;

    // Only for mobile browsers, not desktop or standalone PWA.
    if (!isMobileBrowser()) return;

    setPlatform(detectPlatform());

    const unsubscribe = onAuthStateChanged(auth, (user) => {
      // Only start timer once user is logged in
      if (!user) return;

      // Prevent multiple timers if auth changes
      if (timerRef.current !== null) return;

      // Show after 20 seconds of being logged in
      timerRef.current = window.setTimeout(() => {
        setOpen(true);
      }, 20_000);
    });

    return () => {
      unsubscribe();
      if (timerRef.current !== null) {
        window.clearTimeout(timerRef.current);
      }
    };
  }, []);

  const handleClose = () => {
    setOpen(false);
    if (typeof window !== "undefined") {
      window.localStorage.setItem("tm_app_prompt_dismissed_v1", "true");
    }
  };

  if (!open) return null;

  const primaryStoreUrl = platform === "ios" ? IOS_URL : ANDROID_URL;

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/40 px-4">
      <div className="w-full max-w-sm rounded-2xl bg-white p-5 shadow-xl">
        <div className="flex items-start justify-between gap-3">
          <h2 className="text-base font-semibold">
            Get the TennisMate app
          </h2>
          <button
            onClick={handleClose}
            aria-label="Close"
            className="text-sm text-gray-400 hover:text-gray-700"
          >
            ✕
          </button>
        </div>

        <p className="mt-2 text-sm text-gray-600">
          For faster match requests, push notifications and a smoother experience,
          use the TennisMate app on your phone.
        </p>

        <div className="mt-4 flex flex-col gap-2">
          <Link
            href={primaryStoreUrl}
            target="_blank"
            className="w-full rounded-full bg-green-600 px-4 py-2 text-center text-sm font-semibold text-white"
          >
            {platform === "ios"
              ? "Open in the App Store"
              : platform === "android"
              ? "Open in Google Play"
              : "Download the app"}
          </Link>

          {/* Optional: show both store links if you want */}
          <div className="flex flex-col gap-2 text-xs text-gray-500">
            <div className="flex items-center justify-center gap-2">
              <Link
                href={IOS_URL}
                target="_blank"
                className="underline hover:text-gray-700"
              >
                iOS App Store
              </Link>
              <span>•</span>
              <Link
                href={ANDROID_URL}
                target="_blank"
                className="underline hover:text-gray-700"
              >
                Google Play
              </Link>
            </div>
          </div>

          <button
            onClick={handleClose}
            className="mt-1 w-full rounded-full border border-gray-300 px-4 py-2 text-sm text-gray-700"
          >
            Continue in browser
          </button>
        </div>
      </div>
    </div>
  );
}
