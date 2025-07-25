"use client";

import { useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import Image from "next/image";

const DISMISS_KEY = "tm_ios_install_dismissed_at";
const DISMISS_PERIOD = 7 * 24 * 60 * 60 * 1000; // 7 days in ms

function isIos() {
  if (typeof window === "undefined") return false;
  const ua = window.navigator.userAgent.toLowerCase();
  return /iphone|ipad|ipod/.test(ua);
}

function isInStandaloneMode() {
  if (typeof window === "undefined") return false;
  return (
    // For modern iOS
    (window.navigator as any).standalone === true ||
    // For PWA browsers
    window.matchMedia("(display-mode: standalone)").matches
  );
}

export default function InstallPwaIosPrompt() {
  const [showInstall, setShowInstall] = useState(false);

  useEffect(() => {
    if (!isIos()) return;
    if (isInStandaloneMode()) return;

    const dismissedAt = localStorage.getItem(DISMISS_KEY);
    if (dismissedAt && Date.now() - Number(dismissedAt) < DISMISS_PERIOD) {
      return;
    }

    // Add a slight delay so banner doesn't feel jumpy on page load
    const timer = setTimeout(() => setShowInstall(true), 600);

    return () => clearTimeout(timer);
  }, []);

  const handleDismiss = () => {
    setShowInstall(false);
    localStorage.setItem(DISMISS_KEY, Date.now().toString());
  };

  return (
    <AnimatePresence>
      {showInstall && (
        <motion.div
          initial={{ y: -80, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: -80, opacity: 0 }}
          transition={{ duration: 0.3 }}
          className="fixed top-4 left-0 w-full z-50 flex justify-center"
        >
          <div className="bg-white rounded-2xl shadow-2xl px-6 py-5 flex flex-col items-center max-w-md border border-gray-200 gap-2">
            <div className="flex items-center gap-3 mb-2">
              <Image src="/logo.png" width={32} height={32} alt="TennisMate logo" className="rounded-full border" />
              <h3 className="font-bold text-lg">Add TennisMate to your Home Screen!</h3>
            </div>
            <ul className="text-gray-700 text-sm mb-2">
              <li>
                Tap the <span role="img" aria-label="Share"> <svg style={{ display: "inline", verticalAlign: "middle" }} width="20" height="20" viewBox="0 0 20 20"><path fill="#007AFF" d="M10.59 2.3a1 1 0 0 0-1.18 0l-4 3A1 1 0 0 0 6 7h2v5a1 1 0 0 0 2 0V7h2a1 1 0 0 0 .59-1.7l-4-3z"/><rect x="4" y="14" width="12" height="2" rx="1" fill="#007AFF"/></svg> </span>
                <b>Share</b> button in Safari.
              </li>
              <li>
                Scroll down and tap <b>Add to Home Screen</b>
              </li>
              <li>
                Tap <b>Add</b> (top right).
              </li>
              <li className="mt-2 text-green-700 font-medium">
                TennisMate works even better as an app!
              </li>
            </ul>
            <button
              className="mt-2 text-gray-400 underline text-xs"
              onClick={handleDismiss}
            >
              Maybe later
            </button>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
