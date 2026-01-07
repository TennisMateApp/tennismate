"use client";

import { useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";
import { Capacitor } from "@capacitor/core";
import { App } from "@capacitor/app";

export default function BackButtonHandler() {
  const router = useRouter();
  const pathname = usePathname() || "";

useEffect(() => {
  if (!Capacitor.isNativePlatform()) return;

  let handle: { remove: () => Promise<void> } | null = null;

  (async () => {
    handle = await App.addListener("backButton", () => {
      if (window.history.length > 1) {
        router.back();
        return;
      }

      if (pathname !== "/home") {
        router.replace("/home");
        return;
      }

      // Do nothing on /home to prevent exiting
      // If you want to exit here, uncomment:
      // App.exitApp();
    });
  })();

  return () => {
    // remove listener on unmount
    if (handle) {
      handle.remove();
    }
  };
}, [router, pathname]);


  return null;
}
