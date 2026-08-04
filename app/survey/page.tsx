"use client";

import {useEffect, useRef, useState} from "react";
import {useRouter} from "next/navigation";
import {onAuthStateChanged} from "firebase/auth";
import {doc, getDoc, serverTimestamp, setDoc} from "firebase/firestore";
import {Check, ChevronLeft, ChevronRight, LoaderCircle} from "lucide-react";
import CourtsBackButton from "@/components/CourtsBackButton";
import {auth, db} from "@/lib/firebaseConfig";
import {trackEvent} from "@/lib/analytics";
import {ANALYTICS_EVENTS} from "@/lib/analyticsEvents";
import {
  DESIRED_FEATURE_OPTIONS,
  EMPTY_SURVEY_ANSWERS,
  EVENT_INTEREST_OPTIONS,
  FAVOURITE_FEATURE_OPTIONS,
  MATCH_BARRIER_OPTIONS,
  PLAYED_OPTIONS,
  PLAY_FREQUENCY_OPTIONS,
  PREMIUM_FEATURE_OPTIONS,
  PREMIUM_PRICE_OPTIONS,
  PRODUCT_SURVEY_ID,
  PRODUCT_SURVEY_STEPS,
  REASON_OPTIONS,
  submitSurveyResponse,
  SURVEY_OTHER_TEXT_LIMIT,
  SURVEY_TEXT_LIMIT,
  SurveyAnswers,
  surveyResponseId,
  toggleSurveyChoice,
  validateSurveyStep,
} from "@/lib/productSurvey";
import {hasCompletedProductSurvey} from "@/lib/productSurveyCompletion";

type Option = readonly [string, string];

function Question({number, title, hint, error, children}: {
  number: number;
  title: string;
  hint?: string;
  error?: string;
  children: React.ReactNode;
}) {
  const errorId = `question-${number}-error`;
  const titleId = `question-${number}-title`;
  return (
    <fieldset className="min-w-0 rounded-3xl border border-emerald-950/10 bg-white p-4 shadow-sm sm:p-5" aria-labelledby={titleId} aria-describedby={error ? errorId : undefined}>
      <legend className="sr-only">{number}. {title}</legend>
      <div id={titleId} className="flex min-w-0 items-start gap-2 text-base font-black leading-6 text-emerald-950">
        <span className="shrink-0 text-emerald-700" aria-hidden="true">{number}.</span>
        <span className="min-w-0 break-words">{title}</span>
      </div>
      {hint ? <p className="mt-2 text-sm font-medium leading-5 text-emerald-950/55">{hint}</p> : null}
      <div className="mt-5 space-y-2.5">{children}</div>
      {error ? <p id={errorId} role="alert" className="mt-3 text-sm font-bold text-red-700">{error}</p> : null}
    </fieldset>
  );
}

function ChoiceList({name, options, value, multiple = false, disabledValues = [], onChange}: {
  name: string;
  options: readonly Option[];
  value: string | string[];
  multiple?: boolean;
  disabledValues?: string[];
  onChange: (value: string) => void;
}) {
  const selected = (option: string) => Array.isArray(value) ? value.includes(option) : value === option;
  return <>{options.map(([option, label]) => {
    const checked = selected(option);
    const disabled = disabledValues.includes(option) && !checked;
    return (
      <label key={option} className={`flex min-h-12 cursor-pointer items-center gap-3 rounded-2xl border px-4 py-3 text-sm font-bold transition ${checked ? "border-emerald-800 bg-emerald-50 text-emerald-950 ring-1 ring-emerald-800" : "border-black/10 bg-white text-black/70 hover:border-emerald-900/25"} ${disabled ? "cursor-not-allowed opacity-45" : ""}`}>
        <input type={multiple ? "checkbox" : "radio"} name={name} value={option} checked={checked} disabled={disabled} onChange={() => onChange(option)} className="sr-only" />
        <span aria-hidden="true" className={`grid h-5 w-5 shrink-0 place-items-center border ${multiple ? "rounded-md" : "rounded-full"} ${checked ? "border-emerald-800 bg-emerald-800 text-white" : "border-black/25 bg-white"}`}>{checked ? <Check size={13} strokeWidth={3} /> : null}</span>
        <span className="min-w-0 break-words leading-5">{label}</span>
      </label>
    );
  })}</>;
}

function OtherInput({id, value, onChange}: {id: string; value: string; onChange: (value: string) => void}) {
  return (
    <div className="pt-1">
      <label className="sr-only" htmlFor={id}>Other details (optional)</label>
      <input id={id} value={value} maxLength={SURVEY_OTHER_TEXT_LIMIT} onChange={(event) => onChange(event.target.value)} placeholder="Tell us more (optional)" className="w-full rounded-2xl border border-black/15 bg-white px-4 py-3 text-base text-emerald-950 outline-none transition placeholder:text-black/35 focus:border-emerald-700 focus:ring-2 focus:ring-emerald-700/15" />
    </div>
  );
}

function LongAnswer({id, value, onChange, error}: {id: string; value: string; onChange: (value: string) => void; error?: string}) {
  return (
    <div>
      <textarea id={id} value={value} maxLength={SURVEY_TEXT_LIMIT} rows={5} onChange={(event) => onChange(event.target.value)} aria-invalid={Boolean(error)} className="w-full resize-y rounded-2xl border border-black/15 bg-white px-4 py-3 text-base leading-6 text-emerald-950 outline-none transition placeholder:text-black/35 focus:border-emerald-700 focus:ring-2 focus:ring-emerald-700/15" />
      <div className="mt-1 text-right text-xs font-semibold text-black/40">{value.length}/{SURVEY_TEXT_LIMIT}</div>
    </div>
  );
}

export default function SurveyPage() {
  const router = useRouter();
  const [uid, setUid] = useState<string | null>(null);
  const [userName, setUserName] = useState("");
  const [loading, setLoading] = useState(true);
  const [completed, setCompleted] = useState(false);
  const [step, setStep] = useState(1);
  const [answers, setAnswers] = useState<SurveyAnswers>({...EMPTY_SURVEY_ANSWERS});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [submitError, setSubmitError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const startedRef = useRef(false);
  const submittingRef = useRef(false);
  const viewedUidRef = useRef<string | null>(null);

  useEffect(() => onAuthStateChanged(auth, (user) => {
    if (!user) {
      setUid(null);
      setUserName("");
      setLoading(false);
      return;
    }
    setUid(user.uid);
    setUserName("");
    if (viewedUidRef.current !== user.uid) {
      viewedUidRef.current = user.uid;
      void trackEvent(ANALYTICS_EVENTS.SURVEY_VIEWED, {surveyId: PRODUCT_SURVEY_ID});
    }
    const completionCheck = hasCompletedProductSurvey(user.uid)
      .then(setCompleted)
      .catch(() => setSubmitError("We couldn't check your survey status. You can still fill it out and try again."));
    const playerNameCheck = getDoc(doc(db, "players", user.uid))
      .then((snapshot) => {
        const name = snapshot.data()?.name;
        setUserName(typeof name === "string" ? name : "");
      })
      .catch(() => setUserName(""));
    void Promise.all([completionCheck, playerNameCheck]).finally(() => setLoading(false));
  }), []);

  const update = <K extends keyof SurveyAnswers>(key: K, value: SurveyAnswers[K]) => {
    if (!startedRef.current) {
      startedRef.current = true;
      void trackEvent(ANALYTICS_EVENTS.SURVEY_STARTED, {surveyId: PRODUCT_SURVEY_ID});
    }
    setAnswers((current) => ({...current, [key]: value}));
    setErrors((current) => ({...current, [key]: ""}));
  };

  const next = () => {
    const nextErrors = validateSurveyStep(step, answers);
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length) {
      window.scrollTo({top: 0, behavior: "smooth"});
      return;
    }
    void trackEvent(ANALYTICS_EVENTS.SURVEY_STEP_COMPLETED, {surveyId: PRODUCT_SURVEY_ID, step});
    setStep((current) => Math.min(PRODUCT_SURVEY_STEPS, current + 1));
    window.scrollTo({top: 0, behavior: "smooth"});
  };

  const back = () => {
    if (step > 1) {
      setErrors({});
      setStep((current) => current - 1);
      window.scrollTo({top: 0, behavior: "smooth"});
      return;
    }
    if (typeof window !== "undefined" && window.history.length > 1) router.back();
    else router.push("/home");
  };

  const submit = async () => {
    const nextErrors = validateSurveyStep(3, answers);
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length || !uid || submittingRef.current) return;

    submittingRef.current = true;
    setSubmitting(true);
    setSubmitError("");
    try {
      await submitSurveyResponse({
        uid,
        userName,
        answers,
        submittedAt: serverTimestamp(),
        create: (documentId, payload) => setDoc(doc(db, "surveyResponses", documentId), payload),
      });
      void trackEvent(ANALYTICS_EVENTS.SURVEY_STEP_COMPLETED, {surveyId: PRODUCT_SURVEY_ID, step: 3});
      void trackEvent(ANALYTICS_EVENTS.SURVEY_COMPLETED, {surveyId: PRODUCT_SURVEY_ID});
      setCompleted(true);
    } catch (error) {
      console.warn("[Survey] submission failed", error);
      try {
        const existing = await getDoc(doc(db, "surveyResponses", surveyResponseId(uid)));
        if (existing.exists()) {
          setCompleted(true);
          return;
        }
      } catch { /* retain the original save error */ }
      setSubmitError("We couldn't save your feedback. Check your connection and try again—your answers are still here.");
    } finally {
      submittingRef.current = false;
      setSubmitting(false);
    }
  };

  if (loading) return <div className="grid min-h-[70vh] place-items-center"><LoaderCircle className="h-7 w-7 animate-spin text-emerald-800" aria-label="Loading survey" /></div>;
  if (!uid) return null;

  if (completed) {
    return (
      <main className="min-h-[calc(100dvh-5rem)] bg-[#F7FAF8] px-4 py-10">
        <section className="mx-auto max-w-xl rounded-3xl border border-emerald-950/10 bg-white p-8 text-center shadow-sm">
          <div className="mx-auto grid h-16 w-16 place-items-center rounded-full bg-[#39FF14]/20 text-3xl" aria-hidden="true">🎾</div>
          <h1 className="mt-5 text-3xl font-black tracking-tight text-emerald-950">Thanks!</h1>
          <p className="mt-3 text-base font-medium text-emerald-950/65">Your feedback will help shape what we build next.</p>
          <button type="button" onClick={() => router.push("/home")} className="mt-7 rounded-2xl bg-emerald-950 px-5 py-3 text-sm font-extrabold text-white focus:outline-none focus:ring-2 focus:ring-[#39FF14] focus:ring-offset-2">Back to home</button>
        </section>
      </main>
    );
  }

  const desiredAtLimit = answers.desiredFeatures.length >= 3;
  return (
    <main className="min-h-screen bg-[#F7FAF8] pb-8">
      <div className="sticky top-0 z-20 border-b border-emerald-950/10 bg-[#F7FAF8]/95 px-0 py-4 backdrop-blur sm:px-4">
        <div className="mx-auto max-w-2xl">
          <div className="grid min-w-0 grid-cols-[minmax(0,1fr)_minmax(0,2fr)_minmax(0,1fr)] items-start gap-x-3">
            <div className="col-start-1 row-start-1 flex min-w-0 justify-self-start">
              <div className="-my-2 shrink-0">
                <CourtsBackButton onClick={back} label={step > 1 ? "Previous survey step" : "Back"} title={step > 1 ? "Previous survey step" : "Back"} />
              </div>
            </div>
            <div className="col-start-2 row-start-1 min-w-0 justify-self-stretch text-center">
              <div className="text-xs font-black uppercase tracking-[0.18em] text-emerald-700">Product survey</div>
              <div className="mt-0.5 text-sm font-extrabold text-emerald-950">Step {step} of {PRODUCT_SURVEY_STEPS}</div>
            </div>
            <div className="col-start-3 row-start-1 min-h-11 min-w-0" aria-hidden="true" />
          </div>
          <div className="mt-3 h-2 overflow-hidden rounded-full bg-emerald-950/10" role="progressbar" aria-label="Survey progress" aria-valuemin={1} aria-valuemax={3} aria-valuenow={step}><div className="h-full rounded-full bg-[#39FF14] transition-all" style={{width: `${(step / PRODUCT_SURVEY_STEPS) * 100}%`}} /></div>
        </div>
      </div>

      <form className="mx-auto max-w-2xl px-0 py-6 sm:px-4" onSubmit={(event) => {event.preventDefault(); void submit();}} noValidate>
        <div className="mb-6"><p className="text-xs font-black uppercase tracking-[0.18em] text-emerald-700">{step === 1 ? "Your tennis" : step === 2 ? "TennisMate" : "Premium & feedback"}</p><h1 className="mt-1 text-2xl font-black tracking-tight text-emerald-950">{step === 1 ? "Tell us about your game" : step === 2 ? "What should we improve?" : "One last step"}</h1></div>
        {submitError ? <div role="alert" className="mb-5 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-bold text-red-800">{submitError}</div> : null}

        <div className="space-y-5">
          {step === 1 ? <>
            <Question number={1} title="How often do you currently play tennis?" error={errors.playFrequency}><ChoiceList name="playFrequency" options={PLAY_FREQUENCY_OPTIONS} value={answers.playFrequency} onChange={(value) => update("playFrequency", value)} /></Question>
            <Question number={2} title="What are your main reasons for using TennisMate?" hint="Select all that apply." error={errors.reasons}><ChoiceList name="reasons" options={REASON_OPTIONS} value={answers.reasons} multiple onChange={(value) => update("reasons", toggleSurveyChoice(answers.reasons, value))} />{answers.reasons.includes("other") ? <OtherInput id="reasonsOther" value={answers.reasonsOther} onChange={(value) => update("reasonsOther", value)} /> : null}</Question>
            <Question number={3} title="Have you successfully played with someone you met through TennisMate?" error={errors.playedThroughTennisMate}><ChoiceList name="playedThroughTennisMate" options={PLAYED_OPTIONS} value={answers.playedThroughTennisMate} onChange={(value) => update("playedThroughTennisMate", value)} /></Question>
            <Question number={4} title="What has made it difficult to organise a match through TennisMate?" hint="Select all that apply." error={errors.matchBarriers}><ChoiceList name="matchBarriers" options={MATCH_BARRIER_OPTIONS} value={answers.matchBarriers} multiple onChange={(value) => update("matchBarriers", toggleSurveyChoice(answers.matchBarriers, value, {exclusive: ["not_tried", "no_difficulty"]}))} />{answers.matchBarriers.includes("other") ? <OtherInput id="matchBarriersOther" value={answers.matchBarriersOther} onChange={(value) => update("matchBarriersOther", value)} /> : null}</Question>
          </> : null}

          {step === 2 ? <>
            <Question number={5} title="What is your favourite TennisMate feature?" error={errors.favouriteFeature}><ChoiceList name="favouriteFeature" options={FAVOURITE_FEATURE_OPTIONS} value={answers.favouriteFeature} onChange={(value) => update("favouriteFeature", value)} />{answers.favouriteFeature === "other" ? <OtherInput id="favouriteFeatureOther" value={answers.favouriteFeatureOther} onChange={(value) => update("favouriteFeatureOther", value)} /> : null}</Question>
            <Question number={6} title="Which of these would make TennisMate more valuable to you?" hint={`${answers.desiredFeatures.length}/3 selected`} error={errors.desiredFeatures}><ChoiceList name="desiredFeatures" options={DESIRED_FEATURE_OPTIONS} value={answers.desiredFeatures} multiple disabledValues={desiredAtLimit ? DESIRED_FEATURE_OPTIONS.map(([value]) => value) : []} onChange={(value) => update("desiredFeatures", toggleSurveyChoice(answers.desiredFeatures, value, {max: 3}))} />{answers.desiredFeatures.includes("other") ? <OtherInput id="desiredFeaturesOther" value={answers.desiredFeaturesOther} onChange={(value) => update("desiredFeaturesOther", value)} /> : null}</Question>
            <Question number={7} title="Are you interested in participating in future TennisMate group programs or events?" error={errors.eventInterest}><ChoiceList name="eventInterest" options={EVENT_INTEREST_OPTIONS} value={answers.eventInterest} onChange={(value) => update("eventInterest", value)} /></Question>
          </> : null}

          {step === 3 ? <>
            <Question number={8} title="If TennisMate introduced Premium, what would you consider a reasonable monthly price?" error={errors.premiumPrice}><ChoiceList name="premiumPrice" options={PREMIUM_PRICE_OPTIONS} value={answers.premiumPrice} onChange={(value) => update("premiumPrice", value)} /></Question>
            <Question number={9} title="Which Premium features would you consider paying for?" hint="Select all that apply." error={errors.premiumFeatures}><ChoiceList name="premiumFeatures" options={PREMIUM_FEATURE_OPTIONS} value={answers.premiumFeatures} multiple onChange={(value) => update("premiumFeatures", toggleSurveyChoice(answers.premiumFeatures, value, {exclusive: ["none"]}))} />{answers.premiumFeatures.includes("other") ? <OtherInput id="premiumFeaturesOther" value={answers.premiumFeaturesOther} onChange={(value) => update("premiumFeaturesOther", value)} /> : null}</Question>
            <Question number={10} title="If you could change ONE thing about TennisMate, what would it be?" error={errors.oneThingChange}><LongAnswer id="oneThingChange" value={answers.oneThingChange} onChange={(value) => update("oneThingChange", value)} error={errors.oneThingChange} /></Question>
            <Question number={11} title="What is the ONE thing TennisMate does really well?" error={errors.oneThingWell}><LongAnswer id="oneThingWell" value={answers.oneThingWell} onChange={(value) => update("oneThingWell", value)} error={errors.oneThingWell} /></Question>
          </> : null}
        </div>

        <div className="mt-7 flex items-center justify-between gap-3">
          {step > 1 ? <button type="button" onClick={back} className="inline-flex min-h-12 items-center gap-2 rounded-2xl border border-emerald-950/15 bg-white px-5 text-sm font-extrabold text-emerald-950 focus:outline-none focus:ring-2 focus:ring-emerald-700"><ChevronLeft size={18} />Back</button> : <div />}
          {step < PRODUCT_SURVEY_STEPS ? <button type="button" onClick={next} className="inline-flex min-h-12 items-center gap-2 rounded-2xl bg-emerald-950 px-6 text-sm font-extrabold text-white focus:outline-none focus:ring-2 focus:ring-[#39FF14] focus:ring-offset-2">Continue<ChevronRight size={18} /></button> : <button type="submit" disabled={submitting} className="inline-flex min-h-12 items-center gap-2 rounded-2xl bg-[#39FF14] px-6 text-sm font-extrabold text-emerald-950 shadow-sm focus:outline-none focus:ring-2 focus:ring-emerald-800 focus:ring-offset-2 disabled:cursor-wait disabled:opacity-60">{submitting ? <><LoaderCircle size={18} className="animate-spin" />Saving…</> : "Submit feedback"}</button>}
        </div>
      </form>
    </main>
  );
}
