"use client";

import { useEffect, useRef } from "react";
import {
  canShowNotificationPrompt,
  getNotificationPermission,
  markNotificationPromptDismissed,
  markNotificationPromptShown,
  type NotificationPromptVariant,
} from "@/lib/notificationPromptState";

type NotificationPromptMode = "modal" | "banner" | "toast";

type NotificationPromptCopy = {
  title: string;
  body: string;
  enableLabel: string;
  dismissLabel: string;
  deniedBody?: string;
};

export type NotificationPromptProps = {
  variant: NotificationPromptVariant;
  mode: NotificationPromptMode;
  onEnable: () => void;
  onDismiss?: () => void;
  isOpen: boolean;
};

const COPY_BY_VARIANT: Record<NotificationPromptVariant, NotificationPromptCopy> = {
  onboarding_complete: {
    title: "Stay in the loop",
    body: "Get match updates and messages as they happen.",
    enableLabel: "Enable notifications",
    dismissLabel: "Not now",
  },
  after_match_request_sent: {
    title: "Watch for replies",
    body: "We can notify you when your match request gets a response.",
    enableLabel: "Notify me",
    dismissLabel: "Not now",
  },
  incoming_match_request: {
    title: "New match requests",
    body: "Get notified when someone wants to play.",
    enableLabel: "Enable alerts",
    dismissLabel: "Not now",
  },
  incoming_message: {
    title: "Chat alerts",
    body: "Know when a TennisMate sends you a message.",
    enableLabel: "Enable alerts",
    dismissLabel: "Not now",
  },
  match_request_accepted: {
    title: "Match updates",
    body: "Get notified when your matches move forward.",
    enableLabel: "Enable alerts",
    dismissLabel: "Not now",
  },
  event_joined: {
    title: "Event reminders",
    body: "Get updates for events you join.",
    enableLabel: "Enable reminders",
    dismissLabel: "Not now",
  },
  home_banner: {
    title: "Turn on notifications",
    body: "Do not miss messages, match replies or event updates.",
    enableLabel: "Enable",
    dismissLabel: "Dismiss",
  },
};

function modeClasses(mode: NotificationPromptMode) {
  if (mode === "banner") {
    return {
      root: "w-full rounded-2xl border border-emerald-200 bg-emerald-50 p-4 shadow-sm",
      panel: "",
    };
  }

  if (mode === "toast") {
    return {
      root: "fixed bottom-5 left-4 right-4 z-[90] sm:left-auto sm:right-5 sm:w-[360px]",
      panel: "rounded-2xl border border-slate-200 bg-white p-4 shadow-2xl",
    };
  }

  return {
    root: "fixed inset-0 z-[90] flex items-center justify-center bg-black/35 px-4",
    panel: "w-full max-w-sm rounded-3xl bg-white p-5 shadow-2xl",
  };
}

export default function NotificationPrompt({
  variant,
  mode,
  onEnable,
  onDismiss,
  isOpen,
}: NotificationPromptProps) {
  const hasRenderedThisPromptRef = useRef(false);
  const canShow = isOpen && (hasRenderedThisPromptRef.current || canShowNotificationPrompt(variant));

  const permission = getNotificationPermission();
  const copy = COPY_BY_VARIANT[variant];
  const classes = modeClasses(mode);
  const isDenied = permission === "denied";

  useEffect(() => {
    if (!canShow) return;
    if (hasRenderedThisPromptRef.current) return;
    hasRenderedThisPromptRef.current = true;
    markNotificationPromptShown(variant);
  }, [canShow, variant]);

  useEffect(() => {
    if (isOpen) return;
    hasRenderedThisPromptRef.current = false;
  }, [isOpen]);

  if (!canShow) return null;

  const handleDismiss = () => {
    markNotificationPromptDismissed(variant);
    onDismiss?.();
  };

  const content = (
    <div className={classes.panel || undefined}>
      <div className="pr-2">
        <div className="text-base font-black text-emerald-950">{copy.title}</div>
        <p className="mt-1 text-sm font-medium leading-5 text-slate-600">
          {isDenied
            ? copy.deniedBody || "Notifications are blocked in your browser settings."
            : copy.body}
        </p>
      </div>

      <div className="mt-4 flex items-center gap-2">
        {!isDenied && (
          <button
            type="button"
            onClick={onEnable}
            className="rounded-full px-4 py-2 text-sm font-extrabold"
            style={{ background: "#39FF14", color: "#0B3D2E" }}
          >
            {copy.enableLabel}
          </button>
        )}
        <button
          type="button"
          onClick={handleDismiss}
          className="rounded-full border border-slate-200 px-4 py-2 text-sm font-bold text-slate-600"
        >
          {copy.dismissLabel}
        </button>
      </div>
    </div>
  );

  return <div className={classes.root}>{content}</div>;
}
