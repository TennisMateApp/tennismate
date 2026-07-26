"use client";

import Image from "next/image";
import { ArrowLeft } from "lucide-react";
import type { ReactNode, RefObject } from "react";

import {
  ONBOARDING_V2_STEP_META,
  type OnboardingV2Step,
} from "@/lib/onboardingV2";

export default function OnboardingV2Shell({
  step,
  heading,
  helper,
  headingRef,
  onBack,
  children,
  status,
}: {
  step: OnboardingV2Step;
  heading: string;
  helper?: ReactNode;
  headingRef: RefObject<HTMLHeadingElement | null>;
  onBack?: () => void;
  children: ReactNode;
  status?: ReactNode;
}) {
  const meta = ONBOARDING_V2_STEP_META[step];

  return (
    <main className="min-h-dvh overflow-x-hidden bg-[#f5f5f0] text-slate-950">
      <div className="mx-auto flex min-h-dvh w-full max-w-6xl flex-col lg:grid lg:grid-cols-[minmax(300px,0.8fr)_minmax(480px,1.2fr)] lg:items-stretch">
        <aside className="relative overflow-hidden bg-[#0B3D2E] px-5 pb-4 pt-[max(0.75rem,env(safe-area-inset-top))] text-white sm:px-8 lg:flex lg:flex-col lg:justify-between lg:px-10 lg:py-10">
          <div className="pointer-events-none absolute inset-0 opacity-[0.12]" aria-hidden="true">
            <div className="absolute -right-16 top-8 h-52 w-72 rounded-[2rem] border-2 border-white" />
            <div className="absolute -right-16 top-[6.5rem] h-px w-72 bg-white" />
            <div className="absolute right-20 top-8 h-52 w-px bg-white" />
          </div>
          <div className="relative flex items-center gap-3">
            <Image src="/logo.png" alt="" width={40} height={40} className="rounded-full" priority />
            <span className="text-lg font-semibold tracking-tight">TennisMate</span>
          </div>
          <div className="relative mt-8 hidden max-w-sm lg:block">
            <p className="text-2xl font-semibold leading-tight">Your next tennis connection starts here.</p>
            <p className="mt-4 text-sm leading-6 text-white/75">A short, guided setup for local matches and community tennis.</p>
          </div>
        </aside>

        <section className="flex flex-1 flex-col bg-white px-5 pb-[max(2rem,env(safe-area-inset-bottom))] pt-3 sm:px-10 lg:justify-center lg:px-16 lg:py-12">
          <div className="mx-auto w-full max-w-xl">
            <div className={onBack ? "flex min-h-11 items-center" : "h-1"}>
              {onBack ? (
                <button type="button" onClick={onBack} className="-ml-2 inline-flex min-h-11 items-center gap-2 rounded-xl px-2 text-sm font-semibold text-[#0B3D2E] hover:bg-emerald-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-700">
                  <ArrowLeft className="h-4 w-4" aria-hidden="true" />
                  Back
                </button>
              ) : <span />}
            </div>

            <div className="mt-2">
              <div className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">
                {meta.label}
              </div>
              {meta.numbered ? (
                <div
                  className="mt-2 h-2 overflow-hidden rounded-full bg-slate-100"
                  role="progressbar"
                  aria-label="Onboarding progress"
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-valuenow={meta.progress}
                  aria-valuetext={`${meta.label}, ${meta.progress}% complete`}
                >
                  <div className="h-full rounded-full bg-[#20A464] transition-[width] duration-200" style={{ width: `${meta.progress}%` }} />
                </div>
              ) : null}
            </div>

            <div key={step} className="onboarding-v2-step-content mt-5">
              <h1 ref={headingRef} tabIndex={-1} className="text-3xl font-semibold tracking-tight text-slate-950 outline-none sm:text-4xl">
                {heading}
              </h1>
              {helper ? <div className="mt-2 text-base leading-7 text-slate-600">{helper}</div> : null}
              <div className="mt-6">{children}</div>
              <div className="mt-4 min-h-6" aria-live="polite" aria-atomic="true">
                {status}
              </div>
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}
