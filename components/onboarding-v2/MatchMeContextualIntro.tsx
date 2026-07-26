"use client";

import {useEffect, useRef} from "react";
import {X} from "lucide-react";

import {
  ONBOARDING_V2_MATCH_INTRO_STEPS,
} from "@/lib/onboardingGuidance";

export default function MatchMeContextualIntro({
  stepIndex,
  hasRecommendations,
  onNext,
  onSkip,
}: {
  stepIndex: number;
  hasRecommendations: boolean;
  onNext: () => void;
  onSkip: (method: "skip" | "close" | "escape") => void;
}) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);
  const step = ONBOARDING_V2_MATCH_INTRO_STEPS[stepIndex] || ONBOARDING_V2_MATCH_INTRO_STEPS[0];

  useEffect(() => {
    previousFocusRef.current = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;
    return () => previousFocusRef.current?.focus?.({preventScroll: true});
  }, []);

  useEffect(() => {
    dialogRef.current?.focus({preventScroll: true});
    const target = hasRecommendations
      ? document.querySelector<HTMLElement>(`[data-v2-intro-target="${step.target}"]`)
      : null;
    if (!target) return;

    const previous = {
      outline: target.style.outline,
      outlineOffset: target.style.outlineOffset,
      scrollMargin: target.style.scrollMargin,
    };
    target.style.outline = "3px solid #39FF14";
    target.style.outlineOffset = "4px";
    target.style.scrollMargin = "140px 0 180px";

    const rect = target.getBoundingClientRect();
    const targetIsVisible = rect.top >= 88 && rect.bottom <= window.innerHeight - 180;
    if (!targetIsVisible) {
      const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      target.scrollIntoView({
        behavior: reducedMotion ? "auto" : "smooth",
        block: "center",
      });
    }

    return () => {
      target.style.outline = previous.outline;
      target.style.outlineOffset = previous.outlineOffset;
      target.style.scrollMargin = previous.scrollMargin;
    };
  }, [hasRecommendations, step.target]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      onSkip("escape");
    };
    document.addEventListener("keydown", onKeyDown, true);
    return () => document.removeEventListener("keydown", onKeyDown, true);
  }, [onSkip]);

  return (
    <div
      ref={dialogRef}
      role="dialog"
      aria-modal="false"
      aria-labelledby="onboarding-v2-match-intro-title"
      aria-describedby="onboarding-v2-match-intro-body"
      tabIndex={-1}
      className="fixed inset-x-3 bottom-[calc(env(safe-area-inset-bottom)+5.5rem)] z-[180] max-h-[min(70dvh,420px)] overflow-y-auto rounded-3xl border border-emerald-950/15 bg-white p-5 shadow-2xl outline-none sm:left-auto sm:right-5 sm:w-[390px] lg:bottom-6 lg:right-8"
    >
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-xs font-extrabold uppercase tracking-[0.14em] text-emerald-900/55" aria-live="polite">
            Step {step.number} of {ONBOARDING_V2_MATCH_INTRO_STEPS.length}
          </p>
          <h2 id="onboarding-v2-match-intro-title" className="mt-2 text-lg font-black text-emerald-950">
            {step.heading}
          </h2>
        </div>
        <button
          type="button"
          onClick={() => onSkip("close")}
          className="grid min-h-11 min-w-11 place-items-center rounded-xl text-emerald-950/55 hover:bg-emerald-950/[0.06] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-700"
          aria-label="Close Match Me introduction"
        >
          <X size={19} aria-hidden="true" />
        </button>
      </div>

      <p id="onboarding-v2-match-intro-body" className="mt-3 text-sm font-medium leading-6 text-slate-600">
        {step.body}
      </p>
      {!hasRecommendations ? (
        <p className="mt-3 rounded-2xl bg-emerald-50 px-3 py-2.5 text-xs font-semibold text-emerald-950/70">
          No recommendations are available right now. You can still explore filters or return later.
        </p>
      ) : null}

      <div className="mt-5 flex items-center justify-between gap-3">
        <button
          type="button"
          onClick={() => onSkip("skip")}
          className="min-h-11 rounded-xl px-3 text-sm font-bold text-emerald-900 underline-offset-4 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-700"
        >
          Skip
        </button>
        <button
          type="button"
          onClick={onNext}
          className="min-h-11 rounded-xl bg-[#0B3D2E] px-5 py-2.5 text-sm font-extrabold text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-700"
        >
          {step.number === ONBOARDING_V2_MATCH_INTRO_STEPS.length ? "Got it" : "Next"}
        </button>
      </div>
    </div>
  );
}
