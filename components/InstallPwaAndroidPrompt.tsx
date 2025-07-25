"use client";

import { useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import Image from "next/image";
import { CheckCircle, Bell, Zap } from "lucide-react";

const DISMISS_KEY = "tm_install_dismissed_at";
const DISMISS_PERIOD = 7 * 24 * 60 * 60 * 1000; // 7 days in ms

export default function InstallPwaAndroidPrompt() {
  const [deferredPrompt, setDeferredPrompt] = useState<any>(null);
  const [showInstall, setShowInstall] = useState(false);
  const [installing, setInstalling] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;
    // Check if dismissed within the last 7 days
    const dismissedAt = localStorage.getItem(DISMISS_KEY);
    if (
      dismissedAt &&
      Date.now() - Number(dismissedAt) < DISMISS_PERIOD
    )
      return;

    const handler = (e: any) => {
      e.preventDefault();
      setDeferredPrompt(e);
      setShowInstall(true);
    };
    window.addEventListener("beforeinstallprompt", handler);

    return () => window.removeEventListener("beforeinstallprompt", handler);
  }, []);

  const handleInstallClick = async () => {
    if (!deferredPrompt) return;
    setInstalling(true);
    deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    setShowInstall(false);
    setDeferredPrompt(null);
    setInstalling(false);
    if (outcome === "dismissed") {
      localStorage.setItem(DISMISS_KEY, Date.now().toString());
    }
  };

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
              <li className="flex items-center gap-1">
                <CheckCircle className="w-4 h-4 text-green-600" /> One-tap access to matches and messages
              </li>
              <li className="flex items-center gap-1">
                <Bell className="w-4 h-4 text-blue-500" /> Real-time notifications
              </li>
              <li className="flex items-center gap-1">
                <Zap className="w-4 h-4 text-yellow-500" /> Fast, app-like experience
              </li>
            </ul>
            <button
              onClick={handleInstallClick}
              className="bg-green-600 hover:bg-green-700 text-white px-6 py-2 rounded-full font-bold shadow"
              disabled={installing}
            >
              {installing ? "Installing..." : "Add to Home Screen"}
            </button>
            <button
              className="mt-2 text-gray-400 underline text-xs"
              onClick={handleDismiss}
              disabled={installing}
            >
              Maybe later
            </button>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
