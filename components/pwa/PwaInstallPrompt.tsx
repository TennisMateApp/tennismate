"use client";

import { useEffect, useMemo, useState } from "react";
import { Download, X } from "lucide-react";
import {
  markPwaInstalled,
  markPwaInstallPromptDismissed,
  recordPwaInstallVisit,
  shouldShowPwaInstallPrompt,
} from "@/lib/pwaInstallPromptState";

type BeforeInstallPromptChoice = {
  outcome: "accepted" | "dismissed";
  platform: string;
};

type BeforeInstallPromptEvent = Event & {
  platforms?: string[];
  userChoice: Promise<BeforeInstallPromptChoice>;
  prompt: () => Promise<void>;
};

type PwaInstallPromptProps = {
  onboardingComplete: boolean;
};

function isMobileViewport() {
  if (typeof window === "undefined") return false;
  return window.matchMedia?.("(max-width: 767px)")?.matches ?? false;
}

export default function PwaInstallPrompt({ onboardingComplete }: PwaInstallPromptProps) {
  const [installEvent, setInstallEvent] = useState<BeforeInstallPromptEvent | null>(null);
  const [visitCount, setVisitCount] = useState(0);
  const [dismissedThisSession, setDismissedThisSession] = useState(false);
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    setVisitCount(recordPwaInstallVisit());
    setIsMobile(isMobileViewport());

    const onResize = () => setIsMobile(isMobileViewport());
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  useEffect(() => {
    const onBeforeInstallPrompt = (event: Event) => {
      event.preventDefault();
      setInstallEvent(event as BeforeInstallPromptEvent);
    };

    const onAppInstalled = () => {
      markPwaInstalled();
      setInstallEvent(null);
      setDismissedThisSession(true);
    };

    window.addEventListener("beforeinstallprompt", onBeforeInstallPrompt);
    window.addEventListener("appinstalled", onAppInstalled);

    return () => {
      window.removeEventListener("beforeinstallprompt", onBeforeInstallPrompt);
      window.removeEventListener("appinstalled", onAppInstalled);
    };
  }, []);

  const shouldShow = useMemo(
    () =>
      Boolean(installEvent) &&
      !dismissedThisSession &&
      shouldShowPwaInstallPrompt({ onboardingComplete, visitCount }),
    [dismissedThisSession, installEvent, onboardingComplete, visitCount]
  );

  if (!shouldShow || !installEvent) return null;

  const copy = isMobile
    ? {
        title: "Add TennisMate to your phone",
        body: "Open it from your home screen for faster match planning.",
        action: "Add app",
      }
    : {
        title: "Install TennisMate",
        body: "Keep TennisMate one click away on this computer.",
        action: "Install app",
      };

  const dismiss = () => {
    markPwaInstallPromptDismissed();
    setDismissedThisSession(true);
  };

  const install = async () => {
    try {
      await installEvent.prompt();
      const choice = await installEvent.userChoice;
      if (choice.outcome === "accepted") {
        markPwaInstalled();
      } else {
        markPwaInstallPromptDismissed();
      }
    } finally {
      setInstallEvent(null);
      setDismissedThisSession(true);
    }
  };

  return (
    <div className="fixed inset-x-3 bottom-[calc(1rem+env(safe-area-inset-bottom,0px))] z-[85] sm:inset-x-auto sm:right-5 sm:w-[380px]">
      <div className="rounded-2xl border border-emerald-200 bg-white p-4 shadow-2xl">
        <div className="flex items-start gap-3">
          <div className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-emerald-50 text-emerald-800">
            <Download className="h-5 w-5" />
          </div>

          <div className="min-w-0 flex-1">
            <div className="text-sm font-black text-emerald-950">{copy.title}</div>
            <p className="mt-1 text-sm leading-5 text-slate-600">{copy.body}</p>

            <div className="mt-3 flex items-center gap-2">
              <button
                type="button"
                onClick={() => {
                  void install();
                }}
                className="rounded-full px-4 py-2 text-sm font-extrabold"
                style={{ background: "#39FF14", color: "#0B3D2E" }}
              >
                {copy.action}
              </button>
              <button
                type="button"
                onClick={dismiss}
                className="rounded-full border border-slate-200 px-4 py-2 text-sm font-bold text-slate-600"
              >
                Not now
              </button>
            </div>
          </div>

          <button
            type="button"
            onClick={dismiss}
            className="grid h-8 w-8 shrink-0 place-items-center rounded-full text-slate-500 hover:bg-slate-100"
            aria-label="Dismiss install prompt"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>
    </div>
  );
}
