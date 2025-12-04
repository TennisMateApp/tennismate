"use client";

import { useEffect } from "react";
import { App as CapacitorApp } from "@capacitor/app";
import type { PluginListenerHandle } from "@capacitor/core";

export default function BackButtonHandler() {
  useEffect(() => {
    let listener: PluginListenerHandle | undefined;

    // Only run in a browser/Capacitor environment
    if (typeof window !== "undefined") {
      CapacitorApp.addListener("backButton", ({ canGoBack }) => {
        if (canGoBack) {
          // Go back in your SPA/webview history instead of closing the app
          window.history.back();
        } else {
          // We're on a "root" page with no more history
          // Optional: show a confirm dialog here instead of exiting immediately
          CapacitorApp.exitApp();
        }
      }).then((handle) => {
        listener = handle;
      });
    }

    return () => {
      if (listener) {
        listener.remove();
      }
    };
  }, []);

  return null;
}
