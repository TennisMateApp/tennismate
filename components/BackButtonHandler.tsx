"use client";

import { useEffect, useRef } from "react";
import { usePathname, useRouter } from "next/navigation";
import { Capacitor } from "@capacitor/core";
import { App } from "@capacitor/app";

const HOME_FALLBACK = "/home"; // change to "/" if you prefer

export default function BackButtonHandler() {
  const router = useRouter();
  const pathname = usePathname() || "";

  // Keep latest values without re-registering the listener on every route change
  const pathnameRef = useRef(pathname);
  const routerRef = useRef(router);

  useEffect(() => {
    pathnameRef.current = pathname;
  }, [pathname]);

  useEffect(() => {
    routerRef.current = router;
  }, [router]);

  useEffect(() => {
    // ✅ Only run on native Android/iOS (Capacitor)
    if (!Capacitor.isNativePlatform()) return;

    let handlePromise: Promise<{ remove: () => Promise<void> }> | null = null;

    handlePromise = App.addListener("backButton", ({ canGoBack }) => {
      // ✅ If the WebView can go back, do that (most reliable)
      if (canGoBack) {
        window.history.back();
        return;
      }

      // ✅ No history stack (cold-opened deep link etc.)
      // Route them to Home instead of exiting
      const currentPath = pathnameRef.current || "";
      if (currentPath !== HOME_FALLBACK) {
        routerRef.current.replace(HOME_FALLBACK);
        return;
      }

      // ✅ Already on home: do nothing (prevents exit)
      // If you WANT exit on home, uncomment:
      // App.exitApp();
    });

    return () => {
      if (handlePromise) {
        handlePromise.then((h) => h.remove()).catch(() => {});
      }
    };
  }, []);

  return null;
}
