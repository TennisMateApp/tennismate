"use client";

import { useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";
import { Capacitor } from "@capacitor/core";
import { App } from "@capacitor/app";

export default function BackButtonHandler() {
  const router = useRouter();
  const pathname = usePathname() || "";

  useEffect(() => {
    // ✅ Only run on native apps (Android/iOS via Capacitor)
    if (!Capacitor.isNativePlatform()) return;

    const sub = App.addListener("backButton", () => {
      // ✅ If we have browser history, navigate back inside the app
      if (window.history.length > 1) {
        router.back();
        return;
      }

      // ✅ If there is NO history (cold-opened deep link), go to Home instead of exiting
      if (pathname !== "/home") {
        router.replace("/home");
        return;
      }

      // ✅ If already on /home, do nothing (prevents exit)
      // If you WANT exit on home, uncomment the next line:
      // App.exitApp();
    });

    return () => {
      sub.remove();
    };
  }, [router, pathname]);

  return null;
}
