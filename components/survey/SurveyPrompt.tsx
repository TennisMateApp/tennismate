"use client";

import {useEffect, useState} from "react";
import {useRouter} from "next/navigation";
import {MessageCircleQuestion, X} from "lucide-react";
import {trackEvent} from "@/lib/analytics";
import {ANALYTICS_EVENTS} from "@/lib/analyticsEvents";
import {
  EMPTY_SURVEY_PROMPT_DISMISSAL,
  getSurveyPromptVisibility,
  isSurveyPromptDismissed,
  nextSurveyPromptDismissal,
  parseSurveyPromptDismissal,
  PRODUCT_SURVEY_ID,
  surveyDismissalKey,
  type SurveyPromptDismissalState,
} from "@/lib/productSurvey";
import {useProductSurveyCompletion} from "@/lib/productSurveyCompletion";

export default function SurveyPrompt({uid}: {uid: string | null}) {
  const router = useRouter();
  const {completionKnown, completed} = useProductSurveyCompletion(uid);
  const [dismissed, setDismissed] = useState(false);
  const [dismissalState, setDismissalState] = useState<SurveyPromptDismissalState>(EMPTY_SURVEY_PROMPT_DISMISSAL);

  useEffect(() => {
    if (!uid) {
      setDismissalState(EMPTY_SURVEY_PROMPT_DISMISSAL);
      setDismissed(false);
      return;
    }

    try {
      const key = surveyDismissalKey(uid);
      const raw = localStorage.getItem(key);
      const state = parseSurveyPromptDismissal(raw);
      if (raw === "1") localStorage.setItem(key, JSON.stringify(state));
      setDismissalState(state);
      setDismissed(isSurveyPromptDismissed(state));
    } catch {
      setDismissalState(EMPTY_SURVEY_PROMPT_DISMISSAL);
      setDismissed(false);
    }
  }, [uid]);

  if (!getSurveyPromptVisibility({uid, completionKnown, completed, dismissed})) return null;

  const dismiss = () => {
    if (!uid) return;
    const nextState = nextSurveyPromptDismissal(dismissalState);
    try { localStorage.setItem(surveyDismissalKey(uid), JSON.stringify(nextState)); } catch { /* best effort */ }
    setDismissalState(nextState);
    setDismissed(true);
    void trackEvent(ANALYTICS_EVENTS.SURVEY_DISMISSED, {surveyId: PRODUCT_SURVEY_ID, source: "home_card"});
  };

  return (
    <section className="relative overflow-hidden rounded-3xl border border-emerald-950/10 bg-emerald-950 p-5 text-white shadow-sm" aria-labelledby="survey-prompt-title">
      <div className="pointer-events-none absolute -right-10 -top-12 h-36 w-36 rounded-full bg-[#39FF14]/10" />
      <button type="button" onClick={dismiss} aria-label="Maybe later" className="absolute right-3 top-3 grid h-9 w-9 place-items-center rounded-xl text-white/60 hover:bg-white/10 focus:outline-none focus:ring-2 focus:ring-[#39FF14]"><X size={18} /></button>
      <div className="flex items-start gap-3 pr-9">
        <div className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl border border-white/10 bg-white/10"><MessageCircleQuestion size={22} aria-hidden="true" /></div>
        <div>
          <h2 id="survey-prompt-title" className="text-base font-black">Help shape TennisMate 🎾</h2>
          <p className="mt-1 text-sm font-semibold leading-5 text-white/70">Got 2 minutes? Tell us what&apos;s working and what you&apos;d like to see next.</p>
        </div>
      </div>
      <div className="mt-4 flex flex-wrap gap-3">
        <button type="button" onClick={() => router.push("/survey")} className="rounded-2xl bg-[#39FF14] px-4 py-2.5 text-sm font-extrabold text-emerald-950 focus:outline-none focus:ring-2 focus:ring-white focus:ring-offset-2 focus:ring-offset-emerald-950">Take survey</button>
        <button type="button" onClick={dismiss} className="rounded-2xl px-3 py-2.5 text-sm font-bold text-white/70 hover:text-white focus:outline-none focus:ring-2 focus:ring-[#39FF14]">Maybe later</button>
      </div>
    </section>
  );
}
