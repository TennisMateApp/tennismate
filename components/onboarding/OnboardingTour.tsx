"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import NotificationPrompt from "@/components/notifications/NotificationPrompt";
import { shouldShowNotificationPrompt } from "@/lib/notificationPromptState";
import { registerTennisMateNotifications } from "@/lib/registerNotifications";
import type { ActivationTourStep } from "@/lib/useOnboardingProgress";
import { trackEvent } from "@/lib/analytics";
import { ANALYTICS_EVENTS } from "@/lib/analyticsEvents";

type TourState = {
  status?: string;
  currentStep: ActivationTourStep;
};

type Props = {
  tour: TourState;
  shouldShow: boolean;
  onSkip: () => void;
  onStepChange: (step: ActivationTourStep) => void | Promise<void>;
};

type CardPosition = "top" | "bottom" | "center";

type Rect = {
  top: number;
  left: number;
  width: number;
  height: number;
};

type ViewportRect = {
  width: number;
  height: number;
  safeTop: number;
  safeBottom: number;
  bottomNavHeight: number;
};

const RESUME_STEP_KEY = "tm_onboarding_resume_step";
const GAP = 16;
const EDGE = 16;
const HIGHLIGHT_PAD = 6;
const DEFAULT_CARD_HEIGHT = 168;

const STEP_ORDER: ActivationTourStep[] = [
  "welcome",
  "showAround",
  "nextGame",
  "tennisMates",
  "quickActions",
  "matchMe",
  "recommendedMatches",
  "bestMatchInvite",
];

const STEP_CONFIG: Record<
  Exclude<ActivationTourStep, "completed">,
  {
    title: string;
    body: string;
    button?: string;
    target?: string;
    cardPosition: CardPosition;
    waitsForAction?: boolean;
  }
> = {
  welcome: {
    title: "Welcome to TennisMate.",
    body: "Let's show you the fastest way to find, connect and play.",
    button: "Next",
    cardPosition: "center",
  },
  showAround: {
    title: "A quick tour.",
    body: "You will see where matches, players and actions live.",
    button: "Next",
    cardPosition: "center",
  },
  nextGame: {
    title: "Next Game",
    body: "Your upcoming matches appear here.",
    button: "Next",
    target: "next-game",
    cardPosition: "bottom",
  },
  tennisMates: {
    title: "My TennisMates",
    body: "Accepted matches and conversations appear here.",
    button: "Next",
    target: "tennis-mates",
    cardPosition: "bottom",
  },
  quickActions: {
    title: "Quick Actions",
    body: "Everything you need is one tap away.",
    button: "Next",
    target: "quick-actions",
    cardPosition: "top",
  },
  matchMe: {
    title: "Match Me",
    body: "Tap Match Me to find compatible players.",
    target: "match-me",
    cardPosition: "top",
    waitsForAction: true,
  },
  recommendedMatches: {
    title: "Recommended Players",
    body: "These are your recommended TennisMates.",
    button: "Next",
    target: "recommended-matches",
    cardPosition: "top",
  },
  bestMatchInvite: {
    title: "Your best match",
    body: "This is your highest ranked match. Tap Invite to Play to send your first request.",
    target: "best-match-invite",
    cardPosition: "top",
    waitsForAction: true,
  },
};

function getNextStep(step: ActivationTourStep): ActivationTourStep | null {
  const index = STEP_ORDER.indexOf(step);
  return index >= 0 ? STEP_ORDER[index + 1] || null : null;
}

function getCssPxVar(name: string) {
  if (typeof window === "undefined") return 0;
  const raw = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  const parsed = Number.parseFloat(raw);
  return Number.isFinite(parsed) ? parsed : 0;
}

function getBottomNavHeight(viewportHeight: number) {
  if (typeof document === "undefined") return 0;
  const footer = document.querySelector<HTMLElement>("footer");
  if (!footer) return 0;
  const rect = footer.getBoundingClientRect();
  const isVisibleBottomNav =
    rect.height > 0 && rect.top < viewportHeight && rect.bottom > viewportHeight - 140;
  return isVisibleBottomNav ? Math.min(rect.height, viewportHeight * 0.28) : 0;
}

function getViewportRect(): ViewportRect {
  if (typeof window === "undefined") {
    return { width: 390, height: 800, safeTop: 16, safeBottom: 0, bottomNavHeight: 0 };
  }

  const visualViewport = window.visualViewport;
  const height = visualViewport?.height ?? window.innerHeight;
  const width = visualViewport?.width ?? window.innerWidth;
  const offsetTop = visualViewport?.offsetTop ?? 0;
  const safeTop = offsetTop + Math.max(12, getCssPxVar("--safe-top"));
  const safeBottom = Math.max(0, getCssPxVar("--safe-bottom"));

  return {
    width,
    height,
    safeTop,
    safeBottom,
    bottomNavHeight: getBottomNavHeight(height),
  };
}

function readTargetRect(targetName: string): Rect | null {
  if (typeof document === "undefined") return null;
  const element = document.querySelector<HTMLElement>(`[data-onboarding-target="${targetName}"]`);
  if (!element) return null;

  const rect = element.getBoundingClientRect();
  return {
    top: rect.top - HIGHLIGHT_PAD,
    left: rect.left - HIGHLIGHT_PAD,
    width: rect.width + HIGHLIGHT_PAD * 2,
    height: rect.height + HIGHLIGHT_PAD * 2,
  };
}

function getCardStyle(position: CardPosition, measuredHeight: number) {
  const viewport = getViewportRect();
  const height = measuredHeight || DEFAULT_CARD_HEIGHT;
  const width = Math.min(360, viewport.width - EDGE * 2);
  const left = Math.max(EDGE, (viewport.width - width) / 2);

  if (position === "center") {
    return {
      left,
      top: Math.max(viewport.safeTop + EDGE, (viewport.height - height) / 2),
      width,
    };
  }

  if (position === "top") {
    return {
      left,
      top: viewport.safeTop + EDGE,
      width,
    };
  }

  return {
    left,
    bottom: viewport.safeBottom + viewport.bottomNavHeight + EDGE,
    width,
  };
}

function getTargetCenterRatio(position: CardPosition) {
  if (position === "top") return 0.48;
  if (position === "bottom") return 0.32;
  return 0.5;
}

function scrollTargetIntoTourSpace(
  targetName: string,
  position: CardPosition,
  measuredCardHeight: number
) {
  if (typeof window === "undefined") return false;
  const element = document.querySelector<HTMLElement>(`[data-onboarding-target="${targetName}"]`);
  if (!element) return false;

  const viewport = getViewportRect();
  const rect = element.getBoundingClientRect();
  const targetCenter = rect.top + rect.height / 2;
  const cardHeight = measuredCardHeight || DEFAULT_CARD_HEIGHT;
  const usableTop = viewport.safeTop + EDGE;
  const usableBottom = viewport.height - viewport.safeBottom - viewport.bottomNavHeight - EDGE;
  const availableTop = position === "top" ? usableTop + cardHeight + GAP : usableTop;
  const availableBottom = position === "bottom" ? usableBottom - cardHeight - GAP : usableBottom;
  const desiredCenter =
    availableTop + (availableBottom - availableTop) * getTargetCenterRatio(position);
  const delta = targetCenter - desiredCenter;

  if (Math.abs(delta) > 4) {
    window.scrollBy({ top: delta, behavior: "smooth" });
  }

  return true;
}

export default function OnboardingTour({ tour, shouldShow, onSkip, onStepChange }: Props) {
  const router = useRouter();
  const pathname = usePathname() || "";
  const step = tour.currentStep;
  const config = step === "completed" ? null : STEP_CONFIG[step];
  const targetName = config?.target;
  const cardRef = useRef<HTMLDivElement>(null);
  const [targetRect, setTargetRect] = useState<Rect | null>(null);
  const [cardHeight, setCardHeight] = useState(DEFAULT_CARD_HEIGHT);
  const [ready, setReady] = useState(false);
  const [showNotificationPrompt, setShowNotificationPrompt] = useState(false);
  const viewedStepsRef = useRef<Set<ActivationTourStep>>(new Set());
  const startedTrackedRef = useRef(false);

  const cardStyle = useMemo(
    () => (config ? getCardStyle(config.cardPosition, cardHeight) : undefined),
    [cardHeight, config]
  );

  useEffect(() => {
    if (!shouldShow || !config || step === "completed") return;

    if (!startedTrackedRef.current) {
      startedTrackedRef.current = true;
      void trackEvent(ANALYTICS_EVENTS.ONBOARDING_STARTED, {
        tour_version: "activation_v1",
      });
    }

    if (viewedStepsRef.current.has(step)) return;
    viewedStepsRef.current.add(step);
    void trackEvent(ANALYTICS_EVENTS.ONBOARDING_STEP_VIEWED, {
      step_name: step,
      step_number: STEP_ORDER.indexOf(step) + 1,
      tour_version: "activation_v1",
    });
  }, [config, shouldShow, step]);

  useEffect(() => {
    const el = cardRef.current;
    if (!el) return;

    const update = () => {
      const rect = el.getBoundingClientRect();
      setCardHeight(rect.height || DEFAULT_CARD_HEIGHT);
    };

    update();

    let ro: ResizeObserver | null = null;
    if ("ResizeObserver" in window) {
      ro = new ResizeObserver(update);
      ro.observe(el);
    }

    window.addEventListener("resize", update);
    window.visualViewport?.addEventListener("resize", update);
    return () => {
      ro?.disconnect();
      window.removeEventListener("resize", update);
      window.visualViewport?.removeEventListener("resize", update);
    };
  }, [config]);

  useEffect(() => {
    if (!shouldShow || !config) return;
    if (step === "matchMe" && pathname.startsWith("/match")) return;
    if (["nextGame", "tennisMates", "quickActions", "matchMe"].includes(step) && pathname !== "/home") {
      router.push("/home");
    }
  }, [config, pathname, router, shouldShow, step]);

  useEffect(() => {
    if (!shouldShow || !pathname.startsWith("/match")) return;
    if (typeof window === "undefined") return;

    const pendingStep = window.sessionStorage.getItem(RESUME_STEP_KEY);
    if (pendingStep !== "recommendedMatches") return;

    window.sessionStorage.removeItem(RESUME_STEP_KEY);
    if (step !== "recommendedMatches") {
      void onStepChange("recommendedMatches");
    }
  }, [onStepChange, pathname, shouldShow, step]);

  useEffect(() => {
    if (!shouldShow) return;
    if (step === "matchMe" && pathname.startsWith("/match")) {
      void onStepChange("recommendedMatches");
    }
  }, [onStepChange, pathname, shouldShow, step]);

  useEffect(() => {
    if (!shouldShow || !config?.waitsForAction || !targetName) return;

    const completeWithNotificationGate = () => {
      if (shouldShowNotificationPrompt("onboarding_complete")) {
        setShowNotificationPrompt(true);
        return;
      }

      void onStepChange("completed");
    };

    const handleTargetClick = async (event: MouseEvent) => {
      const target = event.target as HTMLElement | null;
      const matchedTarget = target?.closest<HTMLElement>(
        `[data-onboarding-target="${targetName}"]`
      );
      if (!matchedTarget) return;

      if (step === "matchMe") {
        event.preventDefault();
        event.stopPropagation();
        window.sessionStorage.setItem(RESUME_STEP_KEY, "recommendedMatches");
        await onStepChange("recommendedMatches");
        router.push("/match");
        return;
      }

      window.setTimeout(() => {
        completeWithNotificationGate();
      }, 0);
    };

    document.addEventListener("click", handleTargetClick, true);
    return () => document.removeEventListener("click", handleTargetClick, true);
  }, [config?.waitsForAction, onStepChange, router, shouldShow, step, targetName]);

  useEffect(() => {
    if (!shouldShow || !config || !targetName) {
      setTargetRect(null);
      setReady(Boolean(shouldShow && config && !targetName));
      return;
    }

    let raf = 0;
    let settleTimer: number | null = null;
    let retryTimer: number | null = null;
    let attempts = 0;

    const settle = () => {
      const nextRect = readTargetRect(targetName);
      if (!nextRect) return;
      setTargetRect(nextRect);
      setReady(true);
    };

    const update = () => {
      window.cancelAnimationFrame(raf);
      setReady(false);
      raf = window.requestAnimationFrame(() => {
        const found = scrollTargetIntoTourSpace(targetName, config.cardPosition, cardHeight);
        if (!found) {
          setTargetRect(null);
          attempts += 1;
          if (attempts < 30) retryTimer = window.setTimeout(update, 180);
          return;
        }

        attempts = 0;
        if (settleTimer) window.clearTimeout(settleTimer);
        settleTimer = window.setTimeout(settle, 420);
      });
    };

    update();

    const visualViewport = window.visualViewport;
    window.addEventListener("resize", update);
    window.addEventListener("scroll", settle, true);
    visualViewport?.addEventListener("resize", update);
    visualViewport?.addEventListener("scroll", settle);

    return () => {
      window.cancelAnimationFrame(raf);
      if (settleTimer) window.clearTimeout(settleTimer);
      if (retryTimer) window.clearTimeout(retryTimer);
      window.removeEventListener("resize", update);
      window.removeEventListener("scroll", settle, true);
      visualViewport?.removeEventListener("resize", update);
      visualViewport?.removeEventListener("scroll", settle);
    };
  }, [cardHeight, config, shouldShow, targetName]);

  if (!shouldShow || !config || step === "completed") return null;
  if (targetName && !targetRect && !showNotificationPrompt) return null;

  const handleNext = async () => {
    const next = getNextStep(step);
    if (!next) return;

    if (next === "recommendedMatches") {
      window.sessionStorage.setItem(RESUME_STEP_KEY, "recommendedMatches");
      await onStepChange(next);
      router.push("/match");
      return;
    }

    await onStepChange(next);
  };

  const finishAfterNotificationPrompt = async () => {
    setShowNotificationPrompt(false);
    await onStepChange("completed");
    void trackEvent(ANALYTICS_EVENTS.ONBOARDING_COMPLETED, {
      tour_version: "activation_v1",
    });
  };

  const handleEnableNotifications = async () => {
    try {
      await registerTennisMateNotifications();
    } finally {
      await finishAfterNotificationPrompt();
    }
  };

  const backdropPanels = targetRect
    ? [
        { key: "top", style: { top: 0, left: 0, width: "100%", height: targetRect.top } },
        {
          key: "left",
          style: { top: targetRect.top, left: 0, width: targetRect.left, height: targetRect.height },
        },
        {
          key: "right",
          style: {
            top: targetRect.top,
            left: targetRect.left + targetRect.width,
            right: 0,
            height: targetRect.height,
          },
        },
        {
          key: "bottom",
          style: { top: targetRect.top + targetRect.height, left: 0, width: "100%", bottom: 0 },
        },
      ]
    : null;

  return (
    <div className="fixed inset-0 z-[90] pointer-events-none">
      {backdropPanels ? (
        backdropPanels.map((panel) => (
          <div
            key={panel.key}
            className="absolute bg-emerald-950/55 pointer-events-auto transition-opacity duration-200"
            style={{ ...panel.style, opacity: ready ? 1 : 0 }}
          />
        ))
      ) : (
        <div className="absolute inset-0 bg-emerald-950/55 pointer-events-auto" />
      )}

      {targetRect && (
        <div
          className="absolute rounded-[22px] border-2 border-[#39FF14] shadow-[0_0_28px_rgba(57,255,20,0.42)] pointer-events-none transition-opacity duration-200"
          style={{
            top: targetRect.top,
            left: targetRect.left,
            width: targetRect.width,
            height: targetRect.height,
            opacity: ready ? 1 : 0,
          }}
        />
      )}

      <div
        ref={cardRef}
        className="absolute rounded-3xl bg-white p-5 shadow-2xl pointer-events-auto transition-opacity duration-200"
        style={{
          ...cardStyle,
          opacity: ready ? 1 : 0,
        }}
      >
        <button
          type="button"
          onClick={onSkip}
          className="absolute right-4 top-4 text-xs font-extrabold text-slate-400"
        >
          Skip
        </button>

        <div className="pr-10">
          <div className="text-[11px] font-extrabold uppercase tracking-[0.16em] text-emerald-700">
            Getting Started
          </div>
          <h2 className="mt-2 text-xl font-black leading-tight text-emerald-950">{config.title}</h2>
          <p className="mt-2 text-sm font-semibold leading-5 text-slate-600">{config.body}</p>
        </div>

        {config.button && (
          <button
            type="button"
            onClick={handleNext}
            className="mt-4 h-11 w-full rounded-full text-sm font-extrabold"
            style={{ background: "#39FF14", color: "#0B3D2E" }}
          >
            {config.button}
          </button>
        )}
      </div>

      <div className="pointer-events-auto">
        <NotificationPrompt
          variant="onboarding_complete"
          mode="modal"
          isOpen={showNotificationPrompt}
          onEnable={() => {
            void handleEnableNotifications();
          }}
          onDismiss={() => {
            void finishAfterNotificationPrompt();
          }}
        />
      </div>
    </div>
  );
}
