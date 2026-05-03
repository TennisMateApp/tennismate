"use client";

import { useEffect } from "react";

const RELOAD_FLAG = "tm_sw_reload_for_update";

export default function ServiceWorkerUpdateHandler() {
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!("serviceWorker" in navigator)) return;

    let refreshing = false;

    const clearTimer = window.setTimeout(() => {
      window.sessionStorage.removeItem(RELOAD_FLAG);
    }, 5000);

    const reloadForFreshBundle = () => {
      if (refreshing) return;
      if (window.sessionStorage.getItem(RELOAD_FLAG) === "1") return;

      refreshing = true;
      window.sessionStorage.setItem(RELOAD_FLAG, "1");
      window.location.reload();
    };

    const onControllerChange = () => {
      console.log("[ServiceWorkerUpdateHandler] controllerchange: reloading for fresh bundle");
      reloadForFreshBundle();
    };

    navigator.serviceWorker.addEventListener("controllerchange", onControllerChange);

    navigator.serviceWorker.ready
      .then((registration) => registration.update())
      .catch((error) => {
        console.warn("[ServiceWorkerUpdateHandler] service worker update check failed", error);
      });

    return () => {
      window.clearTimeout(clearTimer);
      navigator.serviceWorker.removeEventListener("controllerchange", onControllerChange);
    };
  }, []);

  return null;
}
