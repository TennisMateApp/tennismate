"use client";

import Image from "next/image";
import Link from "next/link";
import {useRouter, useSearchParams} from "next/navigation";
import {useCallback, useEffect, useMemo, useRef, useState} from "react";
import {
  Check,
  CheckCircle2,
  CircleX,
  ChevronRight,
  Eye,
  EyeOff,
  Loader2,
  Mail,
  MapPin,
  ShieldCheck,
  Sparkles,
  Users,
} from "lucide-react";
import {
  createUserWithEmailAndPassword,
  onAuthStateChanged,
  sendEmailVerification,
  signOut,
  updateProfile,
  type User,
} from "firebase/auth";
import {
  doc,
  getDoc,
  serverTimestamp,
  updateDoc,
  writeBatch,
  type DocumentData,
} from "firebase/firestore";
import {geohashForLocation} from "geofire-common";

import ClubMembershipSelector, {
  type ClubMembershipValue,
} from "@/components/clubs/ClubMembershipSelector";
import OnboardingProfilePhotoStep from "@/components/onboarding-v2/OnboardingProfilePhotoStep";
import OnboardingV2Shell from "@/components/onboarding-v2/OnboardingV2Shell";
import {trackEvent} from "@/lib/analytics";
import {
  finalizeOnboardingProfile,
  initializeOrRepairAccount,
  markUnsupportedPostcodeWaitlist,
  sendInitialVerificationIfClaimed,
} from "@/lib/accountLifecycle";
import {auth, db} from "@/lib/firebaseConfig";
import {classifyPostcode} from "@/lib/postcodeEligibility";
import {
  collectReferralCandidates,
  referralCookieValue,
  REFERRAL_SESSION_KEY,
} from "@/lib/referralAttribution";
import {SKILL_OPTIONS, skillFromUTR, type SkillBand} from "@/lib/skill";
import {safeNextDestination, verificationContinueUrl} from "@/lib/verificationFlow";
import {markOnboardingV2EntrySource} from "@/lib/onboardingGuidance";
import {ensureVerifiedAuthSession} from "@/lib/verifiedAuthSession";
import {platform as runtimePlatform} from "@/lib/runtime";
import {
  getSignupPasswordRequirements,
  mapSignupAuthError,
  signupFailureDiagnostics,
} from "@/lib/signupAccount";
import {
  buildOnboardingV2AvailabilityUpdate,
  buildOnboardingV2ClubUpdate,
  buildOnboardingV2SkillUpdate,
  canonicalAvailability,
  createOnboardingV2Account,
  guidedSkillBand,
  hasOnboardingV2Photo,
  maskEmail,
  onboardingV2AuthError,
  onboardingV2Href,
  ONBOARDING_V2_AVAILABILITY,
  ONBOARDING_V2_PREAUTH_STEP_KEY,
  ONBOARDING_V2_RESEND_COOLDOWN_SECONDS,
  ONBOARDING_V2_SKILL_DESCRIPTIONS,
  ONBOARDING_V2_SKILL_QUESTIONS,
  resolveOnboardingV2FinalizationStep,
  resolveOnboardingV2ResumeStep,
  resumableOnboardingV2PreAuthStep,
  validateAdultBirthYear,
  validateOnboardingV2Account,
  validateOnboardingV2Tmr,
  type OnboardingV2AccountFields,
  type OnboardingV2Availability,
  type OnboardingV2Step,
} from "@/lib/onboardingV2";

type Notice = {kind: "info" | "success" | "error"; text: string} | null;
type SkillMode = "choice" | "guided" | "recommendation" | "manual" | "tmr";
type StoredProfile = {
  user: DocumentData;
  player: DocumentData;
  privatePlayer: DocumentData;
};

const primaryButton =
  "inline-flex min-h-11 w-full items-center justify-center rounded-xl bg-[#0B3D2E] px-5 py-3 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-[#125540] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-700 disabled:cursor-not-allowed disabled:opacity-60";
const secondaryButton =
  "inline-flex min-h-11 w-full items-center justify-center rounded-xl border border-emerald-200 bg-white px-5 py-3 text-sm font-semibold text-[#0B3D2E] transition-colors hover:bg-emerald-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-700 disabled:cursor-not-allowed disabled:opacity-60";
const textButton =
  "inline-flex min-h-11 w-full items-center justify-center rounded-xl px-4 py-2 text-sm font-semibold text-emerald-800 hover:bg-emerald-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-700 disabled:opacity-50";
const inputClass =
  "mt-2 min-h-11 w-full rounded-xl border border-slate-300 bg-white px-3.5 py-2.5 text-base text-slate-950 outline-none transition focus:border-emerald-700 focus:ring-2 focus:ring-emerald-100";

function fieldErrorId(field: string) {
  return `onboarding-v2-${field}-error`;
}

function noticeView(notice: Notice) {
  if (!notice) return null;
  return (
    <div role={notice.kind === "error" ? "alert" : "status"} className={`rounded-xl border px-4 py-3 text-sm ${notice.kind === "error" ? "border-red-200 bg-red-50 text-red-800" : notice.kind === "success" ? "border-emerald-200 bg-emerald-50 text-emerald-800" : "border-blue-200 bg-blue-50 text-blue-800"}`}>
      {notice.text}
    </div>
  );
}

export default function OnboardingV2Flow() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const intendedNext = safeNextDestination(searchParams.get("next"), "/home");
  const resumeHref = useMemo(
    () => onboardingV2Href({next: intendedNext, ref: searchParams.get("ref"), rc: searchParams.get("rc")}),
    [intendedNext, searchParams]
  );
  const headingRef = useRef<HTMLHeadingElement>(null);
  const accountSubmissionRef = useRef(false);
  const resumedUserRef = useRef<string | null>(null);
  const viewedStepsRef = useRef(new Set<string>());
  const verificationTrackedRef = useRef(false);
  const milestoneEventsRef = useRef(new Set<string>());

  const [step, setStep] = useState<OnboardingV2Step>("welcome");
  const [authReady, setAuthReady] = useState(false);
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [birthYear, setBirthYear] = useState("");
  const [underage, setUnderage] = useState(false);
  const [recoveringExistingAccount, setRecoveringExistingAccount] = useState(false);
  const [account, setAccount] = useState<OnboardingV2AccountFields>({name: "", email: "", password: ""});
  const [errors, setErrors] = useState<Record<string, string | undefined>>({});
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const [verified, setVerified] = useState(false);
  const [cooldown, setCooldown] = useState(0);
  const [notice, setNotice] = useState<Notice>(null);
  const [playerData, setPlayerData] = useState<DocumentData>({});
  const [privatePlayerData, setPrivatePlayerData] = useState<DocumentData>({});
  const [postcode, setPostcode] = useState("");
  const [unsupportedPostcode, setUnsupportedPostcode] = useState("");
  const [skillMode, setSkillMode] = useState<SkillMode>("choice");
  const [guidedQuestion, setGuidedQuestion] = useState(0);
  const [guidedAnswers, setGuidedAnswers] = useState<Array<number | null>>([null, null, null]);
  const [recommendedBand, setRecommendedBand] = useState<SkillBand | null>(null);
  const [selectedBand, setSelectedBand] = useState<SkillBand | null>(null);
  const [tmrValue, setTmrValue] = useState("");
  const [availability, setAvailability] = useState<OnboardingV2Availability[]>([]);
  const [club, setClub] = useState<ClubMembershipValue>({clubId: null, clubName: null, clubStatus: null});
  const [photoURL, setPhotoURL] = useState("");
  const [photoThumbURL, setPhotoThumbURL] = useState("");
  const [activated, setActivated] = useState(false);

  const referralCandidates = useCallback(() => collectReferralCandidates({
    stored: sessionStorage.getItem(REFERRAL_SESSION_KEY),
    ref: searchParams.get("ref"),
    rc: searchParams.get("rc"),
    cookie: referralCookieValue(document.cookie),
  }), [searchParams]);

  const trackOnce = useCallback((key: string, eventName: string, properties?: Record<string, string | number | boolean>) => {
    if (milestoneEventsRef.current.has(key)) return;
    milestoneEventsRef.current.add(key);
    void trackEvent(eventName, properties);
  }, []);

  useEffect(() => {
    const candidates = referralCandidates();
    if (!sessionStorage.getItem(REFERRAL_SESSION_KEY) && candidates[0]) {
      sessionStorage.setItem(REFERRAL_SESSION_KEY, candidates[0].code);
    }
  }, [referralCandidates]);

  useEffect(() => {
    if (viewedStepsRef.current.has(step)) return;
    viewedStepsRef.current.add(step);
    void trackEvent("onboarding_v2_step_viewed", {step_name: step});
    if (step === "ready") trackOnce("ready_viewed", "onboarding_v2_ready_viewed", {step_name: "ready"});
  }, [step, trackOnce]);

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => headingRef.current?.focus());
    return () => window.cancelAnimationFrame(frame);
  }, [step, guidedQuestion, skillMode]);

  const markVerified = useCallback(() => {
    setVerified(true);
    setNotice({kind: "success", text: "Email verified. Your profile progress is safe."});
    if (!verificationTrackedRef.current) {
      verificationTrackedRef.current = true;
      void trackEvent("verification_completed", {flow: "onboarding_v2"});
    }
  }, []);

  const checkVerification = useCallback(async (showPendingMessage = false) => {
    const user = auth.currentUser;
    if (!user) return false;
    try {
      const session = await ensureVerifiedAuthSession(user);
      if (session.verified && session.tokenReady) {
        markVerified();
        return true;
      }
      if (showPendingMessage) {
        setNotice({kind: "info", text: "Not verified yet. Open the link in your email, then try again."});
      }
    } catch {
      setNotice({kind: "error", text: "We couldn’t refresh your verified session. Check your connection and try again."});
    }
    return false;
  }, [markVerified]);

  const prepareExistingAccount = useCallback(async (user: User, knownBirthYear?: number) => {
    const initialized = await initializeOrRepairAccount({
      user,
      journey: "onboarding_v2",
      ...(knownBirthYear ? {birthYear: knownBirthYear} : {}),
    });
    const sent = await sendInitialVerificationIfClaimed({
      user,
      shouldSendVerification: initialized.shouldSendVerification,
      next: resumeHref,
    }).catch(() => false);
    if (sent) {
      setCooldown(ONBOARDING_V2_RESEND_COOLDOWN_SECONDS);
      setNotice({kind: "success", text: "Verification email sent. Check your inbox."});
      void trackEvent("verification_sent", {send_type: "initial_resume", flow: "onboarding_v2"});
    }
    const session = await ensureVerifiedAuthSession(user);
    if (session.verified && session.tokenReady) markVerified();
    return initialized;
  }, [markVerified, resumeHref]);

  const applyStoredProfile = useCallback((stored: StoredProfile) => {
    setPlayerData(stored.player);
    setPrivatePlayerData(stored.privatePlayer);
    setPostcode(typeof stored.player.postcode === "string" ? stored.player.postcode : "");
    setSelectedBand(SKILL_OPTIONS.some((option) => option.value === stored.player.skillBand) ? stored.player.skillBand as SkillBand : null);
    const rating = typeof stored.player.skillRating === "number" ? stored.player.skillRating : typeof stored.player.utr === "number" ? stored.player.utr : null;
    setTmrValue(rating === null ? "" : String(rating));
    setAvailability(canonicalAvailability(stored.player.availability));
    setClub({
      clubId: typeof stored.player.clubId === "string" ? stored.player.clubId : null,
      clubName: typeof stored.player.clubName === "string" ? stored.player.clubName : null,
      clubStatus: stored.player.clubStatus === "member" || stored.player.clubStatus === "none" ? stored.player.clubStatus : null,
    });
    setPhotoURL(typeof stored.player.photoURL === "string" ? stored.player.photoURL : "");
    setPhotoThumbURL(typeof stored.player.photoThumbURL === "string" ? stored.player.photoThumbURL : "");
    setActivated(stored.player.profileComplete === true && stored.player.isMatchable === true);
  }, []);

  const loadStoredProfile = useCallback(async (user: User): Promise<StoredProfile> => {
    const [userSnapshot, playerSnapshot, privateSnapshot] = await Promise.all([
      getDoc(doc(db, "users", user.uid)),
      getDoc(doc(db, "players", user.uid)),
      getDoc(doc(db, "players_private", user.uid)),
    ]);
    const stored = {
      user: userSnapshot.data() || {},
      player: playerSnapshot.data() || {},
      privatePlayer: privateSnapshot.data() || {},
    };
    applyStoredProfile(stored);
    return stored;
  }, [applyStoredProfile]);

  useEffect(() => onAuthStateChanged(auth, (user) => {
    setCurrentUser(user);
    if (!user) {
      resumedUserRef.current = null;
      setStep(resumableOnboardingV2PreAuthStep(sessionStorage.getItem(ONBOARDING_V2_PREAUTH_STEP_KEY)));
      setAuthReady(true);
      return;
    }
    if (accountSubmissionRef.current || resumedUserRef.current === user.uid) {
      setAuthReady(true);
      return;
    }
    resumedUserRef.current = user.uid;
    void (async () => {
      try {
        await prepareExistingAccount(user);
        const stored = await loadStoredProfile(user);
        if (stored.user.accountStatus === "waitlisted") {
          router.replace("/waitlist");
          return;
        }
        if (stored.player.profileComplete === true) {
          router.replace(intendedNext);
          return;
        }
        if (typeof stored.privatePlayer.birthYear !== "number") {
          setRecoveringExistingAccount(true);
          setStep("eligibility");
          return;
        }
        setStep(resolveOnboardingV2ResumeStep(stored));
      } catch {
        setNotice({kind: "error", text: "We couldn’t resume setup. Check your connection and try again."});
      } finally {
        setAuthReady(true);
      }
    })();
  }), [intendedNext, loadStoredProfile, prepareExistingAccount, router]);

  useEffect(() => {
    if (!cooldown) return;
    const timer = window.setInterval(() => setCooldown((value) => Math.max(0, value - 1)), 1000);
    return () => window.clearInterval(timer);
  }, [cooldown]);

  useEffect(() => {
    if (!currentUser || step === "welcome" || step === "why" || step === "eligibility" || step === "account") return;
    const check = () => void checkVerification(false);
    const onVisibility = () => {
      if (document.visibilityState === "visible") check();
    };
    window.addEventListener("focus", check);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.removeEventListener("focus", check);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [checkVerification, currentUser, step]);

  function move(nextStep: OnboardingV2Step) {
    setNotice(null);
    setErrors({});
    if (["welcome", "why", "eligibility", "account"].includes(nextStep)) {
      sessionStorage.setItem(ONBOARDING_V2_PREAUTH_STEP_KEY, nextStep);
    }
    setStep(nextStep);
  }

  async function continueProfileSetup() {
    if (!currentUser) return;
    setBusy(true);
    try {
      const stored = await loadStoredProfile(currentUser);
      if (stored.user.accountStatus === "waitlisted") {
        router.replace("/waitlist");
        return;
      }
      move(resolveOnboardingV2ResumeStep(stored));
    } catch {
      setNotice({kind: "error", text: "We couldn’t load your saved profile. Please try again."});
    } finally {
      setBusy(false);
    }
  }

  async function submitEligibility(event: React.FormEvent) {
    event.preventDefault();
    const result = validateAdultBirthYear(birthYear);
    if (!result.valid) {
      setErrors({birthYear: result.reason});
      setUnderage("underage" in result && result.underage === true);
      return;
    }
    setUnderage(false);
    setErrors({});
    void trackEvent("eligibility_completed", {result: "adult"});
    if (currentUser && recoveringExistingAccount) {
      setBusy(true);
      try {
        await prepareExistingAccount(currentUser, result.birthYear);
        await continueProfileSetup();
      } catch {
        setNotice({kind: "error", text: "We couldn’t save eligibility. Please try again."});
      } finally {
        setBusy(false);
      }
      return;
    }
    move("account");
  }

  async function submitAccount(event: React.FormEvent) {
    event.preventDefault();
    if (accountSubmissionRef.current) return;
    const validation = validateOnboardingV2Account(account);
    if (Object.keys(validation.errors).length) {
      setErrors(validation.errors);
      const firstInvalid = (["name", "email", "password"] as const).find((field) => validation.errors[field]);
      if (firstInvalid) requestAnimationFrame(() => document.getElementById(`onboarding-v2-${firstInvalid}`)?.focus());
      return;
    }
    setErrors({});
    setNotice(null);
    setBusy(true);
    accountSubmissionRef.current = true;
    void trackEvent("account_creation_started", {flow: "onboarding_v2"});
    let authUserCreated = false;
    try {
      const result = await createOnboardingV2Account({
        fields: account,
        birthYear,
        referralCandidates: referralCandidates(),
        createAuthUser: async (email, password) => {
          const credential = await createUserWithEmailAndPassword(auth, email, password);
          authUserCreated = true;
          await updateProfile(credential.user, {displayName: account.name.trim()});
          setCurrentUser(credential.user);
          void trackEvent("account_created", {method: "email_password"});
          return credential.user;
        },
        initializeAccount: ({user, displayName, birthYear: year, referralCandidates: candidates}) =>
          initializeOrRepairAccount({
            user,
            displayName,
            birthYear: year,
            referralCandidates: candidates,
            journey: "onboarding_v2",
          }),
        sendInitialVerification: ({user, shouldSendVerification}) =>
          sendInitialVerificationIfClaimed({user, shouldSendVerification, next: resumeHref}),
      });
      void trackEvent("account_initialization_completed", {
        repaired_document_count: result.initialization.repairedDocuments.length,
        referral_captured: result.initialization.referralCaptured,
        flow: "onboarding_v2",
      });
      if (result.verificationSent) {
        setCooldown(ONBOARDING_V2_RESEND_COOLDOWN_SECONDS);
        setNotice({kind: "success", text: "Verification email sent. Check your inbox."});
        void trackEvent("verification_sent", {send_type: "initial", flow: "onboarding_v2"});
      }
      sessionStorage.removeItem(ONBOARDING_V2_PREAUTH_STEP_KEY);
      setStep("verify");
    } catch (error) {
      const code = (error as {code?: string})?.code || "unknown";
      const setupFailed = authUserCreated || Boolean(auth.currentUser);
      const diagnostics = signupFailureDiagnostics({
        code,
        route: "/signup-v2",
        platform: runtimePlatform(),
        appVersion: process.env.NEXT_PUBLIC_APP_VERSION,
        clientValidationPassed: true,
        email: account.email,
        stage: setupFailed ? "account_setup" : "authentication",
      });
      console.error("[signup_failed]", diagnostics);
      void trackEvent("signup_failed", diagnostics);
      if (setupFailed) {
        setNotice({kind: "error", text: "Your account was created, but setup did not finish. Your progress is safe—sign in again to resume."});
      } else {
        const mapped = mapSignupAuthError(code);
        setNotice(mapped.field ? null : {kind: "error", text: onboardingV2AuthError(code)});
        if (mapped.field) {
          setErrors((current) => ({...current, [mapped.field!]: mapped.message}));
          requestAnimationFrame(() => document.getElementById(`onboarding-v2-${mapped.field}`)?.focus());
        }
      }
    } finally {
      accountSubmissionRef.current = false;
      setBusy(false);
      setAuthReady(true);
    }
  }

  async function resendVerification() {
    if (!currentUser || cooldown > 0 || busy) return;
    setBusy(true);
    setNotice(null);
    try {
      await sendEmailVerification(currentUser, {url: verificationContinueUrl(resumeHref), handleCodeInApp: true});
      setCooldown(ONBOARDING_V2_RESEND_COOLDOWN_SECONDS);
      setNotice({kind: "success", text: "Verification email sent. Check your inbox."});
      void trackEvent("verification_resend", {result: "sent", flow: "onboarding_v2"});
    } catch (error) {
      const code = (error as {code?: string})?.code || "";
      setNotice({kind: "error", text: code.includes("too-many-requests") ? "Please wait a little longer before requesting another email." : "We couldn’t send the email. Check your connection and try again."});
      void trackEvent("verification_resend", {result: "failed", reason: code || "unknown"});
    } finally {
      setBusy(false);
    }
  }

  async function submitLocation(event: React.FormEvent) {
    event.preventDefault();
    if (!currentUser || busy) return;
    setErrors({});
    setUnsupportedPostcode("");
    const normalized = postcode.trim();
    if (!/^\d{4}$/.test(normalized)) {
      setErrors({postcode: "Enter exactly four numeric digits."});
      return;
    }
    if (normalized[0] !== "2" && normalized[0] !== "3") {
      setUnsupportedPostcode(normalized);
      return;
    }
    setBusy(true);
    try {
      const postcodeSnapshot = await getDoc(doc(db, "postcodes", normalized));
      const eligibility = classifyPostcode(normalized, postcodeSnapshot.exists() ? postcodeSnapshot.data() : null);
      if (eligibility.kind === "unknown") {
        setErrors({postcode: "We couldn’t locate that postcode. Check the four digits and try again."});
        return;
      }
      if (eligibility.kind !== "supported") {
        if (eligibility.kind === "unsupported") setUnsupportedPostcode(normalized);
        else setErrors({postcode: "Enter exactly four numeric digits."});
        return;
      }
      const geohash = geohashForLocation([eligibility.lat, eligibility.lng]);
      if (!Number.isFinite(eligibility.lat) || !Number.isFinite(eligibility.lng) || !geohash) {
        setErrors({postcode: "We couldn’t locate that postcode. Check the four digits and try again."});
        return;
      }
      const batch = writeBatch(db);
      batch.set(doc(db, "players", currentUser.uid), {postcode: normalized, updatedAt: serverTimestamp()}, {merge: true});
      batch.set(doc(db, "players_private", currentUser.uid), {
        email: currentUser.email || "",
        postcode: normalized,
        lat: eligibility.lat,
        lng: eligibility.lng,
        geohash,
        updatedAt: serverTimestamp(),
      }, {merge: true});
      await batch.commit();
      setPlayerData((value) => ({...value, postcode: normalized}));
      setPrivatePlayerData((value) => ({...value, postcode: normalized, lat: eligibility.lat, lng: eligibility.lng, geohash}));
      void trackEvent("onboarding_v2_location_completed", {step_name: "location"});
      move("skill");
    } catch (error) {
      console.error("[OnboardingV2] location save failed", error);
      setNotice({kind: "error", text: "We couldn’t save your postcode. Check your connection and try again."});
    } finally {
      setBusy(false);
    }
  }

  async function joinWaitlist() {
    if (!currentUser || !unsupportedPostcode || busy) return;
    setBusy(true);
    try {
      await markUnsupportedPostcodeWaitlist({
        postcode: unsupportedPostcode,
        displayName: String(playerData.name || currentUser.displayName || account.name || ""),
      });
      router.replace("/waitlist");
    } catch {
      setNotice({kind: "error", text: "We couldn’t join the waitlist. Please try again."});
    } finally {
      setBusy(false);
    }
  }

  function startSkill(mode: Exclude<SkillMode, "choice" | "recommendation">) {
    setSkillMode(mode);
    setErrors({});
    trackOnce(`skill_started_${mode}`, "onboarding_v2_skill_started", {selection_method: mode});
  }

  function answerGuidedQuestion(score: number) {
    const answers = [...guidedAnswers];
    answers[guidedQuestion] = score;
    setGuidedAnswers(answers);
    if (guidedQuestion < ONBOARDING_V2_SKILL_QUESTIONS.length - 1) {
      setGuidedQuestion((value) => value + 1);
      return;
    }
    const total = answers.reduce<number>((sum, answer) => sum + (answer ?? 0), 0);
    const band = guidedSkillBand(total);
    setRecommendedBand(band);
    setSelectedBand(band);
    setSkillMode("recommendation");
    if (band) void trackEvent("onboarding_v2_skill_recommended", {selection_method: "guided", recommended_band: band});
  }

  async function saveSkill(input: {band: SkillBand | null; method: "guided" | "manual" | "tmr"; tmr?: number | null; recommended?: SkillBand | null}) {
    if (!currentUser || !input.band || busy) {
      setErrors({skill: "Choose a playing level to continue."});
      return;
    }
    setBusy(true);
    setErrors({});
    try {
      const update = buildOnboardingV2SkillUpdate({band: input.band, tmr: input.tmr});
      await updateDoc(doc(db, "players", currentUser.uid), {...update, updatedAt: serverTimestamp()});
      setPlayerData((value) => ({...value, ...update}));
      setSelectedBand(input.band);
      void trackEvent("onboarding_v2_skill_completed", {
        selection_method: input.method,
        recommended_band: input.recommended || "none",
        final_band: input.band,
        override: Boolean(input.recommended && input.recommended !== input.band),
      });
      move("availability");
    } catch {
      setNotice({kind: "error", text: "We couldn’t save your playing level. Please try again."});
    } finally {
      setBusy(false);
    }
  }

  function updateTmr(value: string) {
    const normalized = value.replace(/[^\d.]/g, "").slice(0, 5);
    setTmrValue(normalized);
    setErrors((current) => ({...current, tmr: undefined}));
    const result = validateOnboardingV2Tmr(normalized);
    if (result.valid) {
      setRecommendedBand(result.band);
      setSelectedBand(result.band);
    } else {
      setRecommendedBand(null);
      setSelectedBand(null);
    }
  }

  async function saveTmrSkill() {
    const result = validateOnboardingV2Tmr(tmrValue);
    if (!result.valid) {
      setErrors({tmr: result.reason});
      return;
    }
    await saveSkill({band: selectedBand || result.band, method: "tmr", tmr: result.rating, recommended: result.band});
  }

  async function saveAvailability() {
    if (!currentUser || busy) return;
    if (!availability.length) {
      setErrors({availability: "Choose at least one time that usually works."});
      return;
    }
    setBusy(true);
    try {
      const update = buildOnboardingV2AvailabilityUpdate(availability);
      await updateDoc(doc(db, "players", currentUser.uid), {...update, updatedAt: serverTimestamp()});
      setPlayerData((value) => ({...value, ...update}));
      void trackEvent("onboarding_v2_availability_completed", {availability_count: availability.length});
      move("club");
    } catch {
      setNotice({kind: "error", text: "We couldn’t save your availability. Please try again."});
    } finally {
      setBusy(false);
    }
  }

  async function saveClub(outcome: "selected" | "none" | "skipped") {
    if (!currentUser || busy) return;
    if (outcome !== "skipped" && !club.clubStatus) {
      setErrors({club: "Select a club, choose ‘I’m not a club member’, or skip this step."});
      return;
    }
    setBusy(true);
    try {
      const update = buildOnboardingV2ClubUpdate({outcome, clubId: club.clubId, clubName: club.clubName});
      await updateDoc(doc(db, "players", currentUser.uid), {...update, updatedAt: serverTimestamp()});
      setClub(update);
      setPlayerData((value) => ({...value, ...update}));
      if (outcome === "skipped") {
        void trackEvent("onboarding_v2_club_skipped", {club_outcome: "skipped"});
      } else {
        void trackEvent("onboarding_v2_club_completed", {club_outcome: outcome});
      }
      move("photo");
    } catch {
      setNotice({kind: "error", text: "We couldn’t save your club choice. Please try again."});
    } finally {
      setBusy(false);
    }
  }

  async function showReady() {
    if (!currentUser || busy) return;
    setBusy(true);
    setNotice(null);
    try {
      const stored = await loadStoredProfile(currentUser);
      const missingStep = resolveOnboardingV2ResumeStep(stored);
      if (missingStep !== "ready") {
        setNotice({kind: "error", text: "One required profile detail still needs your attention."});
        setStep(missingStep);
        return;
      }
      const verifiedSession = await ensureVerifiedAuthSession(currentUser);
      setVerified(verifiedSession.verified && verifiedSession.tokenReady);
      if (!verifiedSession.verified || !verifiedSession.tokenReady) {
        setActivated(false);
        setStep("ready");
        return;
      }
      const result = await finalizeOnboardingProfile();
      if (!result.finalized) {
        if (result.missingRequirements.includes("waitlisted")) {
          router.replace("/waitlist");
          return;
        }
        const repairStep = resolveOnboardingV2FinalizationStep(result.missingRequirements);
        if (repairStep !== "ready") setStep(repairStep);
        setNotice({kind: "error", text: "We couldn’t activate your profile yet. Review the required step and try again."});
        return;
      }
      setActivated(true);
      setPlayerData((value) => ({...value, profileComplete: true, isMatchable: true}));
      trackOnce("profile_completed", "onboarding_v2_profile_completed", {result: result.alreadyFinalized ? "already_complete" : "completed"});
      setStep("ready");
    } catch (error) {
      console.error("[OnboardingV2] finalisation failed", error);
      setNotice({kind: "error", text: "We couldn’t finish profile setup. Your progress is safe—please try again."});
    } finally {
      setBusy(false);
    }
  }

  async function openMatchFromReady() {
    const user = auth.currentUser;
    if (!user || busy) return;
    setBusy(true);
    setNotice(null);
    try {
      const session = await ensureVerifiedAuthSession(user);
      if (!session.verified || !session.tokenReady) {
        setVerified(false);
        setNotice({kind: "info", text: "Verify your email before finding players."});
        return;
      }
      markOnboardingV2EntrySource("ready_primary");
      router.push("/match");
    } catch {
      setNotice({kind: "error", text: "We couldn’t refresh your verified session. Check your connection and try again."});
    } finally {
      setBusy(false);
    }
  }

  function profileVerificationStatus() {
    if (verified || step === "verify" || step === "ready") return null;
    return (
      <div className="mb-5 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950" role="status">
        <p className="font-semibold">Email verification pending</p>
        <p className="mt-1">Check your inbox or resend.</p>
        <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1">
          <button type="button" className="min-h-11 font-semibold underline underline-offset-4" onClick={() => move("verify")}>Verification instructions</button>
          <button type="button" className="min-h-11 font-semibold underline underline-offset-4 disabled:opacity-50" onClick={() => void resendVerification()} disabled={busy || cooldown > 0}>{cooldown > 0 ? `Resend in ${cooldown}s` : "Resend email"}</button>
        </div>
      </div>
    );
  }

  if (!authReady) {
    return <main className="grid min-h-dvh place-items-center bg-[#f5f5f0]"><div role="status" className="flex items-center gap-2 text-sm font-medium text-slate-600"><Loader2 className="h-5 w-5 animate-spin" aria-hidden="true" />Resuming setup…</div></main>;
  }

  const status = noticeView(notice);
  const accountPasswordRequirements = getSignupPasswordRequirements(account.password);

  if (step === "welcome") {
    return <OnboardingV2Shell step={step} heading="Find your next tennis partner." headingRef={headingRef} helper={<>Join local players organising matches through TennisMate.</>} status={status}><div className="grid gap-3 rounded-2xl bg-emerald-50 p-4 text-sm text-emerald-950 sm:grid-cols-3">{["Takes about 2 minutes.", "Your progress is saved.", "For players aged 18+."].map((item) => <div key={item} className="flex items-center gap-2"><Check className="h-4 w-4 shrink-0 text-emerald-700" aria-hidden="true" />{item}</div>)}</div><div className="mt-7 space-y-3"><button type="button" className={primaryButton} onClick={() => {void trackEvent("signup_started", {entry_point: "signup_v2"}); move("why");}}>Get started</button><Link className={secondaryButton} href={`/login?next=${encodeURIComponent(resumeHref)}`}>Already have an account? Sign in</Link></div></OnboardingV2Shell>;
  }

  if (step === "why") {
    const benefits = [[MapPin, "Find players near you"], [Sparkles, "Play people at your level"], [Users, "Match your availability"], [ShieldCheck, "Connect with your tennis club"]] as const;
    return <OnboardingV2Shell step={step} heading="Build a profile that works for you" headingRef={headingRef} helper="We’ll use your profile to:" onBack={() => move("welcome")} status={status}><ul className="space-y-2">{benefits.map(([Icon, text]) => <li key={text} className="flex items-center gap-3 rounded-xl border border-slate-200 px-4 py-2.5 text-sm font-medium text-slate-800"><span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-emerald-50 text-emerald-700"><Icon className="h-4 w-4" aria-hidden="true" /></span>{text}</li>)}</ul><button type="button" className={`${primaryButton} mt-7`} onClick={() => move("eligibility")}>Build my profile</button></OnboardingV2Shell>;
  }

  if (step === "eligibility") {
    return <OnboardingV2Shell step={step} heading={underage ? "TennisMate is currently for players aged 18+." : "Confirm your year of birth"} headingRef={headingRef} helper={underage ? "We can’t create an account for you at this time." : "TennisMate is currently available to players aged 18+. Your birth year stays private and is not shown on your profile."} onBack={underage ? () => {setUnderage(false); setErrors({}); setBirthYear("");} : recoveringExistingAccount ? undefined : () => move("why")} status={status}>{underage ? <div className="rounded-2xl border border-amber-200 bg-amber-50 p-5 text-sm leading-6 text-amber-950">Use Back to review the eligibility information. No account or profile record has been created.</div> : <form onSubmit={submitEligibility} noValidate><label htmlFor="onboarding-v2-birth-year" className="text-sm font-semibold text-slate-800">Birth year</label><input id="onboarding-v2-birth-year" className={inputClass} value={birthYear} onChange={(event) => {setBirthYear(event.target.value.replace(/\D/g, "").slice(0, 4)); setErrors({});}} inputMode="numeric" autoComplete="bday-year" required aria-invalid={Boolean(errors.birthYear)} aria-describedby={errors.birthYear ? fieldErrorId("birthYear") : "onboarding-v2-birth-year-help"} placeholder="e.g. 1994" /><p id="onboarding-v2-birth-year-help" className="mt-2 text-xs leading-5 text-slate-500">Required to confirm you are between 18 and 110.</p>{errors.birthYear ? <p id={fieldErrorId("birthYear")} className="mt-2 text-sm font-medium text-red-700">{errors.birthYear}</p> : null}<button type="submit" className={`${primaryButton} mt-7`} disabled={busy}>{busy ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />Saving…</> : "Continue"}</button></form>}</OnboardingV2Shell>;
  }

  if (step === "account") {
    const updateAccountField = (field: keyof OnboardingV2AccountFields, value: string) => {
      const next = {...account, [field]: value};
      setAccount(next);
      if (!validateOnboardingV2Account(next).errors[field]) {
        setErrors((current) => ({...current, [field]: undefined}));
      }
    };
    const existingAccount = errors.email?.includes("already exists");
    return <OnboardingV2Shell step={step} heading="Create your TennisMate account" headingRef={headingRef} helper="Use an email address you can open now. We’ll send a verification link automatically." onBack={() => move("eligibility")} status={status}><form onSubmit={submitAccount} noValidate className="space-y-5">{(["name", "email"] as const).map((field) => <div key={field}><label htmlFor={`onboarding-v2-${field}`} className="text-sm font-semibold capitalize text-slate-800">{field}</label><input id={`onboarding-v2-${field}`} className={inputClass} type={field === "email" ? "email" : "text"} autoComplete={field} value={account[field]} onChange={(event) => updateAccountField(field, event.target.value)} required aria-invalid={Boolean(errors[field])} aria-describedby={errors[field] ? fieldErrorId(field) : undefined} />{errors[field] ? <p id={fieldErrorId(field)} role="alert" className="mt-2 text-sm font-medium text-red-700">{errors[field]}</p> : null}</div>)}<div><label htmlFor="onboarding-v2-password" className="text-sm font-semibold text-slate-800">Password</label><div className="relative"><input id="onboarding-v2-password" className={`${inputClass} pr-12`} type={showPassword ? "text" : "password"} autoComplete="new-password" value={account.password} onChange={(event) => updateAccountField("password", event.target.value)} required aria-invalid={Boolean(errors.password)} aria-describedby={`onboarding-v2-password-requirements${errors.password ? ` ${fieldErrorId("password")}` : ""}`} /><button type="button" onClick={() => setShowPassword((value) => !value)} className="absolute right-1 top-3 grid h-10 w-10 place-items-center rounded-lg text-slate-500 hover:bg-slate-100" aria-label={showPassword ? "Hide password" : "Show password"}>{showPassword ? <EyeOff className="h-5 w-5" aria-hidden="true" /> : <Eye className="h-5 w-5" aria-hidden="true" />}</button></div>{errors.password ? <p id={fieldErrorId("password")} role="alert" className="mt-2 text-sm font-medium text-red-700">{errors.password}</p> : null}<div id="onboarding-v2-password-requirements" className="mt-3 rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm"><p className="font-semibold text-slate-800">Password requirements</p><ul className="mt-2 space-y-1">{([['length', 'At least 6 characters'], ['number', 'At least 1 number'], ['special', 'At least 1 special character']] as const).map(([key, label]) => {const valid = accountPasswordRequirements[key]; return <li key={key} className="flex items-center gap-2">{valid ? <CheckCircle2 className="h-4 w-4 text-emerald-700" aria-hidden="true" /> : <CircleX className="h-4 w-4 text-red-600" aria-hidden="true" />}<span>{label}<span className="sr-only"> — {valid ? "requirement met" : "requirement not met"}</span></span></li>;})}</ul></div></div><p className="text-xs leading-5 text-slate-500">By creating an account, you agree to our <Link href="/terms" target="_blank" rel="noopener noreferrer" className="font-semibold text-emerald-800 underline">Terms</Link> and <Link href="/privacy" target="_blank" rel="noopener noreferrer" className="font-semibold text-emerald-800 underline">Privacy Policy</Link>.</p><button type="submit" className={primaryButton} disabled={busy}>{busy ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />Creating account…</> : "Create account"}</button>{existingAccount ? <div className="space-y-3"><Link href={`/login?next=${encodeURIComponent(resumeHref)}&email=${encodeURIComponent(account.email.trim())}`} className={secondaryButton}>Sign In</Link><Link href={`/forgot-password?email=${encodeURIComponent(account.email.trim())}`} className={secondaryButton}>Reset Password</Link></div> : null}</form></OnboardingV2Shell>;
  }

  if (step === "verify") {
    return <OnboardingV2Shell step={step} heading={verified ? "Email verified" : "Check your email"} headingRef={headingRef} helper={verified ? "Your email is confirmed. Continue your profile setup." : <>We sent a verification link automatically to <strong className="font-semibold text-slate-900">{maskEmail(currentUser?.email)}</strong>. You can continue setting up your profile while you wait.</>} status={status}><div className="rounded-2xl border border-emerald-100 bg-emerald-50 p-5"><div className="flex items-start gap-3"><span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-white text-emerald-700">{verified ? <CheckCircle2 className="h-5 w-5" aria-hidden="true" /> : <Mail className="h-5 w-5" aria-hidden="true" />}</span><div><p className="font-semibold text-emerald-950">{verified ? "Verification complete" : "Open the link in your inbox"}</p><p className="mt-1 text-sm leading-6 text-emerald-900/75">Return here after verifying your email.</p></div></div></div><div className="mt-6 space-y-3">{!verified ? <><button type="button" className={primaryButton} onClick={() => void checkVerification(true)} disabled={busy}>I’ve verified my email</button><a href="mailto:" className={secondaryButton}>Open email app</a><button type="button" className={textButton} onClick={() => void resendVerification()} disabled={busy || cooldown > 0}>{cooldown > 0 ? `Resend in ${cooldown}s` : "Resend email"}</button><button type="button" className={secondaryButton} onClick={() => void continueProfileSetup()} disabled={busy}>Continue profile setup</button></> : <button type="button" className={primaryButton} onClick={() => void continueProfileSetup()} disabled={busy}>Continue profile setup</button>}<button type="button" className="min-h-11 w-full rounded-xl px-4 py-2 text-sm font-medium text-slate-500 hover:bg-slate-50 hover:text-slate-700" onClick={async () => {await signOut(auth); router.replace(`/login?next=${encodeURIComponent(resumeHref)}`);}}>Sign out</button></div></OnboardingV2Shell>;
  }

  if (step === "location") {
    return <OnboardingV2Shell step={step} heading="Where do you usually play?" headingRef={headingRef} helper="We use your postcode to find players nearby and calculate distance." onBack={() => move("verify")} status={status}>{profileVerificationStatus()}<p className="mb-5 rounded-xl bg-slate-50 px-4 py-3 text-sm leading-6 text-slate-600">Your postcode may be visible to signed-in players. Your precise location stays private.</p>{unsupportedPostcode ? <div className="rounded-2xl border border-amber-200 bg-amber-50 p-5 text-amber-950"><p className="font-semibold">TennisMate isn’t available in that region yet.</p><p className="mt-2 text-sm leading-6">Join the waitlist and we’ll let you know when local matching is available.</p><div className="mt-5 space-y-3"><button type="button" className={primaryButton} onClick={() => void joinWaitlist()} disabled={busy}>Join waitlist</button><button type="button" className={secondaryButton} onClick={() => {setUnsupportedPostcode(""); setPostcode("");}}>Use another postcode</button></div></div> : <form onSubmit={submitLocation} noValidate><label htmlFor="onboarding-v2-postcode" className="text-sm font-semibold text-slate-800">Postcode</label><input id="onboarding-v2-postcode" className={inputClass} value={postcode} onChange={(event) => {setPostcode(event.target.value.replace(/\D/g, "").slice(0, 4)); setErrors({});}} inputMode="numeric" autoComplete="postal-code" maxLength={4} required aria-invalid={Boolean(errors.postcode)} aria-describedby={errors.postcode ? fieldErrorId("postcode") : "onboarding-v2-postcode-help"} /><p id="onboarding-v2-postcode-help" className="mt-2 text-xs text-slate-500">Enter four digits.</p>{errors.postcode ? <p id={fieldErrorId("postcode")} role="alert" className="mt-2 text-sm font-medium text-red-700">{errors.postcode}</p> : null}<button type="submit" className={`${primaryButton} mt-7`} disabled={busy}>{busy ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />Saving location…</> : "Continue"}</button></form>}</OnboardingV2Shell>;
  }

  if (step === "skill") {
    const guided = ONBOARDING_V2_SKILL_QUESTIONS[guidedQuestion];
    const skillBack = skillMode === "choice" ? () => move("location") : skillMode === "guided" && guidedQuestion > 0 ? () => setGuidedQuestion((value) => value - 1) : skillMode === "recommendation" ? () => {setSkillMode("guided"); setGuidedQuestion(2);} : () => setSkillMode("choice");
    return <OnboardingV2Shell step={step} heading={skillMode === "guided" ? guided.prompt : "What’s your playing level?"} headingRef={headingRef} helper={skillMode === "guided" ? `Question ${guidedQuestion + 1} of 3` : "Accurate levels help us recommend players who will give you a competitive, enjoyable game."} onBack={skillBack} status={status}>{profileVerificationStatus()}{skillMode === "choice" ? <div className="space-y-3">{[["guided", "Help me choose", "Answer three quick questions"], ["manual", "I know my level", "Choose from all nine TennisMate levels"], ["tmr", "I know my TMR", "Enter your TennisMate Rating"]].map(([mode, label, copy]) => <button key={mode} type="button" className="flex min-h-16 w-full items-center justify-between rounded-2xl border border-slate-200 p-4 text-left hover:border-emerald-400 hover:bg-emerald-50" onClick={() => startSkill(mode as "guided" | "manual" | "tmr")}><span><span className="block font-semibold text-slate-950">{label}</span><span className="mt-1 block text-sm text-slate-600">{copy}</span></span><ChevronRight className="h-5 w-5 text-slate-400" aria-hidden="true" /></button>)}</div> : null}{skillMode === "guided" ? <fieldset><legend className="sr-only">Question {guidedQuestion + 1} of 3: {guided.prompt}</legend><div className="space-y-3">{guided.options.map((option) => {const selected = guidedAnswers[guidedQuestion] === option.score; return <button key={option.label} type="button" aria-pressed={selected} className={`flex min-h-14 w-full items-center gap-3 rounded-2xl border p-4 text-left ${selected ? "border-emerald-700 bg-emerald-50 ring-2 ring-emerald-100" : "border-slate-200 hover:border-emerald-400"}`} onClick={() => answerGuidedQuestion(option.score)}>{selected ? <CheckCircle2 className="h-5 w-5 shrink-0 text-emerald-700" aria-hidden="true" /> : <span className="h-5 w-5 shrink-0 rounded-full border-2 border-slate-300" aria-hidden="true" />}<span className="text-sm font-medium">{option.label}</span></button>;})}</div></fieldset> : null}{skillMode === "recommendation" && recommendedBand ? <div><div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-5"><p className="text-sm font-semibold text-emerald-800">Recommended level</p><p className="mt-1 text-2xl font-semibold text-emerald-950">{SKILL_OPTIONS.find((item) => item.value === recommendedBand)?.label}</p><p className="mt-2 text-sm leading-6 text-emerald-900">This is a starting recommendation based on your answers, not a formal rating.</p></div><div className="mt-5 space-y-3"><button type="button" className={primaryButton} disabled={busy} onClick={() => void saveSkill({band: recommendedBand, method: "guided", recommended: recommendedBand})}>Use this level</button><button type="button" className={secondaryButton} onClick={() => {setSelectedBand(recommendedBand); setSkillMode("manual");}}>Choose a different level</button><button type="button" className={textButton} onClick={() => {setGuidedAnswers([null, null, null]); setGuidedQuestion(0); setRecommendedBand(null); setSkillMode("guided");}}>Restart questions</button></div></div> : null}{skillMode === "manual" ? <fieldset><legend className="sr-only">Choose one of nine playing levels</legend><div className="max-h-[52dvh] space-y-2 overflow-y-auto pr-1">{SKILL_OPTIONS.map((option) => {const selected = selectedBand === option.value; return <button key={option.value} type="button" aria-pressed={selected} className={`min-h-14 w-full rounded-2xl border p-3 text-left ${selected ? "border-emerald-700 bg-emerald-50 ring-2 ring-emerald-100" : "border-slate-200"}`} onClick={() => setSelectedBand(option.value)}><span className="flex items-center gap-2 font-semibold">{selected ? <CheckCircle2 className="h-4 w-4 text-emerald-700" aria-hidden="true" /> : null}{option.label}</span><span className="mt-1 block text-xs leading-5 text-slate-600">{ONBOARDING_V2_SKILL_DESCRIPTIONS[option.value]}</span></button>;})}</div>{errors.skill ? <p role="alert" className="mt-3 text-sm font-medium text-red-700">{errors.skill}</p> : null}<button type="button" className={`${primaryButton} mt-5`} disabled={busy} onClick={() => void saveSkill({band: selectedBand, method: recommendedBand ? "guided" : "manual", recommended: recommendedBand})}>Continue</button></fieldset> : null}{skillMode === "tmr" ? <div><label htmlFor="onboarding-v2-tmr" className="text-sm font-semibold text-slate-800">TennisMate Rating</label><input id="onboarding-v2-tmr" className={inputClass} value={tmrValue} onChange={(event) => updateTmr(event.target.value)} inputMode="decimal" placeholder="1.00–16.50" aria-invalid={Boolean(errors.tmr)} aria-describedby={errors.tmr ? fieldErrorId("tmr") : "onboarding-v2-tmr-help"} /><p id="onboarding-v2-tmr-help" className="mt-2 text-xs text-slate-500">Enter a value from 1.00 to 16.50.</p>{errors.tmr ? <p id={fieldErrorId("tmr")} role="alert" className="mt-2 text-sm font-medium text-red-700">{errors.tmr}</p> : null}{recommendedBand ? <div className="mt-4 rounded-2xl bg-emerald-50 p-4"><p className="text-sm text-emerald-900">Recommended from your rating: <strong>{SKILL_OPTIONS.find((item) => item.value === recommendedBand)?.label}</strong></p><label htmlFor="onboarding-v2-tmr-override" className="mt-4 block text-sm font-semibold text-emerald-950">Choose a different level (optional)</label><select id="onboarding-v2-tmr-override" className={inputClass} value={selectedBand || recommendedBand} onChange={(event) => setSelectedBand(event.target.value as SkillBand)}>{SKILL_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></div> : null}<button type="button" className={`${primaryButton} mt-6`} disabled={busy} onClick={() => void saveTmrSkill()}>Continue</button></div> : null}</OnboardingV2Shell>;
  }

  if (step === "availability") {
    return <OnboardingV2Shell step={step} heading="When do you usually play?" headingRef={headingRef} helper="Choose every time that generally works. You can change this any time." onBack={() => move("skill")} status={status}>{profileVerificationStatus()}<fieldset aria-describedby={errors.availability ? fieldErrorId("availability") : undefined}><legend className="sr-only">Select all times you are available</legend><div className="grid gap-3 sm:grid-cols-2">{ONBOARDING_V2_AVAILABILITY.map((option) => {const selected = availability.includes(option); return <button key={option} type="button" role="checkbox" aria-checked={selected} className={`flex min-h-14 items-center gap-3 rounded-2xl border p-4 text-left font-semibold ${selected ? "border-emerald-700 bg-emerald-50 ring-2 ring-emerald-100" : "border-slate-200 hover:border-emerald-400"}`} onClick={() => {setAvailability((values) => selected ? values.filter((value) => value !== option) : [...values, option]); setErrors({});}}>{selected ? <CheckCircle2 className="h-5 w-5 text-emerald-700" aria-hidden="true" /> : <span className="h-5 w-5 rounded-md border-2 border-slate-300" aria-hidden="true" />}<span>{option}<span className="sr-only">, {selected ? "selected" : "not selected"}</span></span></button>;})}</div></fieldset>{errors.availability ? <p id={fieldErrorId("availability")} role="alert" className="mt-3 text-sm font-medium text-red-700">{errors.availability}</p> : null}<button type="button" className={`${primaryButton} mt-7`} onClick={() => void saveAvailability()} disabled={busy}>Continue</button></OnboardingV2Shell>;
  }

  if (step === "club") {
    return <OnboardingV2Shell step={step} heading="Are you a member of a tennis club?" headingRef={headingRef} helper="Connect with players representing your club and use club filters in Match Me." onBack={() => move("availability")} status={status}>{profileVerificationStatus()}{currentUser ? <ClubMembershipSelector value={club} onChange={(selection) => {setClub(selection); setErrors({});}} submittedBy={currentUser.uid} disabled={busy} /> : null}{errors.club ? <p role="alert" className="mt-3 text-sm font-medium text-red-700">{errors.club}</p> : null}<div className="mt-7 space-y-3"><button type="button" className={primaryButton} disabled={busy || !club.clubStatus} onClick={() => void saveClub(club.clubStatus === "member" ? "selected" : "none")}>Continue</button><button type="button" className={textButton} disabled={busy} onClick={() => void saveClub("skipped")}>Skip</button></div></OnboardingV2Shell>;
  }

  if (step === "photo") {
    return <OnboardingV2Shell step={step} heading="Add a profile photo" headingRef={headingRef} helper="A clear photo helps other players recognise who they’re meeting and builds trust." onBack={() => move("club")} status={status}>{profileVerificationStatus()}{currentUser ? <OnboardingProfilePhotoStep uid={currentUser.uid} photoURL={photoURL} photoThumbURL={photoThumbURL} onStarted={() => trackOnce("photo_started", "onboarding_v2_photo_started", {photo_outcome: "started"})} onComplete={(value) => {setPhotoURL(value.photoURL); setPhotoThumbURL(value.photoThumbURL); setPlayerData((current) => ({...current, ...value})); trackOnce("photo_completed", "onboarding_v2_photo_completed", {photo_outcome: "completed"});}} /> : null}<button type="button" className={`${primaryButton} mt-5`} disabled={busy || !hasOnboardingV2Photo({photoURL, photoThumbURL})} onClick={() => void showReady()}>{busy ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />Checking profile…</> : "Continue"}</button><p className="mt-2 text-center text-xs text-slate-500">A profile photo is required to continue.</p></OnboardingV2Shell>;
  }

  const skillLabel = SKILL_OPTIONS.find((option) => option.value === playerData.skillBand)?.label || "—";
  const readyPhoto = photoThumbURL || photoURL;
  return <OnboardingV2Shell step="ready" heading={activated ? "You’re ready to play" : "Your profile is ready"} headingRef={headingRef} helper={activated ? "Your TennisMate profile is complete." : "One final step: verify your email to start finding players."} status={status}><div className="rounded-2xl border border-slate-200 bg-slate-50 p-5"><div className="flex items-center gap-4">{readyPhoto ? <div className="relative h-16 w-16 shrink-0 overflow-hidden rounded-full"><Image src={readyPhoto} alt="Your profile photo" fill sizes="64px" className="object-cover" unoptimized /></div> : null}<div><p className="text-lg font-semibold text-slate-950">{String(playerData.name || currentUser?.displayName || account.name || "TennisMate player")}</p><p className="text-sm text-slate-600">{skillLabel} · {postcode}</p></div></div><dl className="mt-5 grid gap-3 text-sm sm:grid-cols-2"><div><dt className="font-semibold text-slate-500">Availability</dt><dd className="mt-1 text-slate-900">{availability.join(", ")}</dd></div>{club.clubStatus === "member" && club.clubName ? <div><dt className="font-semibold text-slate-500">Club</dt><dd className="mt-1 text-slate-900">{club.clubName}</dd></div> : null}</dl></div>{activated ? <div className="mt-6 space-y-3"><button type="button" className={primaryButton} disabled={busy} onClick={() => void openMatchFromReady()}>{busy ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />Checking session…</> : "Find my first match"}</button><button type="button" className={secondaryButton} onClick={() => {markOnboardingV2EntrySource("ready_secondary"); router.push("/home");}}>Go to Home</button></div> : <div className="mt-6 space-y-3"><button type="button" className={primaryButton} disabled={busy} onClick={async () => {const isVerified = await checkVerification(true); if (isVerified) await showReady();}}>I’ve verified — continue</button><button type="button" className={secondaryButton} disabled={busy || cooldown > 0} onClick={() => void resendVerification()}>{cooldown > 0 ? `Resend in ${cooldown}s` : "Resend email"}</button><button type="button" className={textButton} onClick={() => move("verify")}>Return to verification instructions</button></div>}</OnboardingV2Shell>;
}
