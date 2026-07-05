"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  collection,
  doc,
  limit,
  onSnapshot,
  query,
  serverTimestamp,
  setDoc,
  where,
} from "firebase/firestore";
import { db } from "@/lib/firebaseConfig";
import { track } from "@/lib/track";
import { trackEvent } from "@/lib/mixpanel";
import { resolveSmallProfilePhoto } from "@/lib/profilePhoto";

export type OnboardingChecklistKey =
  | "profileComplete"
  | "availabilityAdded"
  | "profilePhotoAdded"
  | "viewedRecommendedPlayers"
  | "firstMatchRequestSent";

export type OnboardingChecklist = Record<OnboardingChecklistKey, boolean>;
export type ActivationTourStep =
  | "welcome"
  | "showAround"
  | "nextGame"
  | "tennisMates"
  | "quickActions"
  | "matchMe"
  | "recommendedMatches"
  | "bestMatchInvite"
  | "completed";

type ActivationTourState = {
  status?: "not_started" | "in_progress" | "skipped" | "completed";
  currentStep?: ActivationTourStep;
  startedAt?: unknown;
  skippedAt?: unknown;
  completedAt?: unknown;
  firstMatchRequestSentAt?: unknown;
};

type OnboardingDocState = {
  activationTourStartedAt?: unknown;
  activationTourCompletedAt?: unknown;
  activationTourSkippedAt?: unknown;
  firstMatchRequestPromptShownAt?: unknown;
  activationTour?: ActivationTourState;
  checklist?: Partial<OnboardingChecklist>;
};

type UseOnboardingProgressOptions = {
  enabled?: boolean;
};

const ONBOARDING_DEBUG_FORCE_KEY = "tm_onboarding_debug_force";

const EMPTY_CHECKLIST: OnboardingChecklist = {
  profileComplete: false,
  availabilityAdded: false,
  profilePhotoAdded: false,
  viewedRecommendedPlayers: false,
  firstMatchRequestSent: false,
};

const CHECKLIST_LABELS: Record<OnboardingChecklistKey, string> = {
  profileComplete: "Complete profile",
  availabilityAdded: "Add availability",
  profilePhotoAdded: "Add profile photo",
  viewedRecommendedPlayers: "View recommended players",
  firstMatchRequestSent: "Send first match request",
};

export function isOnboardingDebugEnabled() {
  return (
    process.env.NODE_ENV !== "production" ||
    process.env.NEXT_PUBLIC_ENABLE_ONBOARDING_DEBUG === "true"
  );
}

export function clearBrowserOnboardingState() {
  if (typeof window === "undefined") return;

  [window.localStorage, window.sessionStorage].forEach((storage) => {
    Object.keys(storage).forEach((key) => {
      if (key.toLowerCase().includes("onboarding")) {
        storage.removeItem(key);
      }
    });
  });
}

function trackOnboardingEvent(name: string, props?: Record<string, unknown>) {
  void track(name, props);
  trackEvent(name, props);
}

function mergeChecklist(
  stored: Partial<OnboardingChecklist> | undefined,
  derived: Partial<OnboardingChecklist>
): OnboardingChecklist {
  return {
    ...EMPTY_CHECKLIST,
    ...(stored || {}),
    ...derived,
  };
}

export function getOnboardingChecklistLabel(key: OnboardingChecklistKey) {
  return CHECKLIST_LABELS[key];
}

export function useOnboardingProgress(uid?: string | null, options: UseOnboardingProgressOptions = {}) {
  const enabled = options.enabled ?? true;
  const [debugForceRestart, setDebugForceRestart] = useState(false);
  const [userOnboarding, setUserOnboarding] = useState<OnboardingDocState | null>(null);
  const [profileComplete, setProfileComplete] = useState(false);
  const [profilePhotoAdded, setProfilePhotoAdded] = useState(false);
  const [availabilityAdded, setAvailabilityAdded] = useState(false);
  const [profileAvailabilityAdded, setProfileAvailabilityAdded] = useState(false);
  const [firstMatchRequestSent, setFirstMatchRequestSent] = useState(false);
  const [firstMatchRequestLoaded, setFirstMatchRequestLoaded] = useState(false);
  const startedRef = useRef<string | null>(null);
  const completedRef = useRef<string | null>(null);
  const completionWritesRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (!isOnboardingDebugEnabled() || typeof window === "undefined") return;
    setDebugForceRestart(window.sessionStorage.getItem(ONBOARDING_DEBUG_FORCE_KEY) === "1");
  }, []);

  useEffect(() => {
    if (!uid) {
      setUserOnboarding(null);
      setProfileComplete(false);
      setProfilePhotoAdded(false);
      setAvailabilityAdded(false);
      setProfileAvailabilityAdded(false);
      setFirstMatchRequestSent(false);
      setFirstMatchRequestLoaded(false);
      return;
    }

    const unsubs = [
      onSnapshot(doc(db, "users", uid), (snap) => {
        setUserOnboarding((snap.data()?.onboarding || null) as OnboardingDocState | null);
      }),
      onSnapshot(doc(db, "players", uid), (snap) => {
        const data = snap.exists() ? snap.data() : null;
        setProfileComplete(data?.profileComplete === true);
        setProfilePhotoAdded(Boolean(resolveSmallProfilePhoto(data)));
        setProfileAvailabilityAdded(Array.isArray(data?.availability) && data.availability.length > 0);
      }),
      onSnapshot(doc(db, "availabilities", uid), (snap) => {
        const data = snap.exists() ? snap.data() : null;
        setAvailabilityAdded(snap.exists() && data?.status !== "cancelled");
      }),
      onSnapshot(
        query(collection(db, "match_requests"), where("fromUserId", "==", uid), limit(1)),
        (snap) => {
          setFirstMatchRequestSent(!snap.empty);
          setFirstMatchRequestLoaded(true);
        },
        (error) => {
          console.warn("[Onboarding] Could not load first match request status", error);
          setFirstMatchRequestLoaded(true);
        }
      ),
    ];

    return () => unsubs.forEach((unsub) => unsub());
  }, [uid]);

  const storedChecklist = userOnboarding?.checklist || {};
  const checklist = useMemo(() => {
    const next = mergeChecklist(storedChecklist, {
        profileComplete,
        availabilityAdded: availabilityAdded || profileAvailabilityAdded,
        profilePhotoAdded,
        firstMatchRequestSent: debugForceRestart ? false : firstMatchRequestSent,
      });
    return debugForceRestart ? { ...next, firstMatchRequestSent: false } : next;
  }, [
    availabilityAdded,
    debugForceRestart,
    firstMatchRequestSent,
    profileAvailabilityAdded,
    profileComplete,
    profilePhotoAdded,
    storedChecklist,
  ]);

  const hasSentFirstRequest = checklist.firstMatchRequestSent;
  const activationTour = userOnboarding?.activationTour || null;
  const tourStatus =
    debugForceRestart && activationTour?.status === "completed"
      ? "in_progress"
      : activationTour?.status || "not_started";
  const currentStep: ActivationTourStep =
    debugForceRestart && activationTour?.currentStep === "completed"
      ? "welcome"
      : activationTour?.currentStep ||
        (tourStatus === "completed" ? "completed" : "welcome");
  const isSkipped = debugForceRestart
    ? false
    : Boolean(userOnboarding?.activationTourSkippedAt || tourStatus === "skipped");
  const hasStarted = Boolean(
    userOnboarding?.activationTourStartedAt ||
      activationTour?.startedAt ||
      tourStatus === "in_progress"
  );
  const waitingForFinalOnboardingPrompt =
    tourStatus === "in_progress" && currentStep === "bestMatchInvite";
  const profileBasicsComplete = checklist.profileComplete && checklist.profilePhotoAdded;
  const allChecklistComplete = Object.values(checklist).every(Boolean);
  const isComplete =
    !debugForceRestart &&
    (Boolean(userOnboarding?.activationTourCompletedAt) ||
      tourStatus === "completed" ||
      (!waitingForFinalOnboardingPrompt && hasSentFirstRequest) ||
      (!waitingForFinalOnboardingPrompt && allChecklistComplete));
  const shouldShow = Boolean(
    (enabled || debugForceRestart) &&
      uid &&
      firstMatchRequestLoaded &&
      (debugForceRestart ||
        ((waitingForFinalOnboardingPrompt || !hasSentFirstRequest) &&
          !isSkipped &&
          tourStatus !== "completed" &&
          !userOnboarding?.activationTourCompletedAt))
  );

  const patchOnboarding = useCallback(
    async (patch: Record<string, unknown>) => {
      if (!uid) return;
      await setDoc(
        doc(db, "users", uid),
        {
          onboarding: patch,
        },
        { merge: true }
      );
    },
    [uid]
  );

  useEffect(() => {
    if (!enabled || !uid || hasStarted || userOnboarding === null || !firstMatchRequestLoaded) return;
    if (startedRef.current === uid) return;
    if (userOnboarding?.activationTourCompletedAt || firstMatchRequestSent || isSkipped) return;

    startedRef.current = uid;
    void patchOnboarding({
      activationTourStartedAt: serverTimestamp(),
      activationTour: {
        status: "in_progress",
        currentStep: "welcome",
        startedAt: serverTimestamp(),
      },
    });
    trackOnboardingEvent("onboarding_started", { uid });
  }, [
    enabled,
    firstMatchRequestLoaded,
    firstMatchRequestSent,
    hasStarted,
    isSkipped,
    patchOnboarding,
    uid,
    userOnboarding,
  ]);

  useEffect(() => {
    if (!uid || !userOnboarding) return;

    (Object.keys(checklist) as OnboardingChecklistKey[]).forEach((key) => {
      if (!checklist[key] || storedChecklist[key]) return;
      const writeKey = `${uid}:${key}`;
      if (completionWritesRef.current.has(writeKey)) return;
      completionWritesRef.current.add(writeKey);

      void patchOnboarding({
        checklist: {
          [key]: true,
        },
      });
      trackOnboardingEvent("onboarding_checklist_item_completed", {
        uid,
        item: key,
      });
    });
  }, [checklist, patchOnboarding, storedChecklist, uid, userOnboarding]);

  useEffect(() => {
    if (debugForceRestart) return;
    if (!uid || !isComplete || userOnboarding?.activationTourCompletedAt) return;
    if (completedRef.current === uid) return;

    completedRef.current = uid;
    void patchOnboarding({
      activationTourCompletedAt: serverTimestamp(),
      activationTour: {
        status: "completed",
        currentStep: "completed",
        completedAt: serverTimestamp(),
      },
    });
    trackOnboardingEvent("onboarding_completed", { uid });
  }, [debugForceRestart, isComplete, patchOnboarding, uid, userOnboarding?.activationTourCompletedAt]);

  const skip = useCallback(async () => {
    if (!uid) return;
    if (typeof window !== "undefined") {
      window.sessionStorage.removeItem(ONBOARDING_DEBUG_FORCE_KEY);
    }
    setDebugForceRestart(false);
    await patchOnboarding({
      activationTourSkippedAt: serverTimestamp(),
      activationTour: {
        status: "skipped",
        currentStep,
        skippedAt: serverTimestamp(),
      },
    });
    trackOnboardingEvent("onboarding_skipped", { uid });
  }, [currentStep, patchOnboarding, uid]);

  const setActivationTourStep = useCallback(
    async (step: ActivationTourStep) => {
      if (!uid) return;
      if (step === "completed" && typeof window !== "undefined") {
        window.sessionStorage.removeItem(ONBOARDING_DEBUG_FORCE_KEY);
        setDebugForceRestart(false);
      }
      await patchOnboarding({
        activationTour: {
          status: step === "completed" ? "completed" : "in_progress",
          currentStep: step,
          ...(step === "completed" ? { completedAt: serverTimestamp() } : {}),
        },
      });
      if (step === "recommendedMatches") {
        await patchOnboarding({
          checklist: {
            viewedRecommendedPlayers: true,
          },
        });
      }
    },
    [patchOnboarding, uid]
  );

  const restartActivationTour = useCallback(async () => {
    if (!uid || !isOnboardingDebugEnabled()) return;

    clearBrowserOnboardingState();
    window.sessionStorage.setItem(ONBOARDING_DEBUG_FORCE_KEY, "1");
    setDebugForceRestart(true);
    startedRef.current = null;
    completedRef.current = null;
    completionWritesRef.current.clear();

    const resetState: OnboardingDocState = {
      activationTourStartedAt: serverTimestamp(),
      activationTourCompletedAt: null,
      activationTourSkippedAt: null,
      firstMatchRequestPromptShownAt: null,
      activationTour: {
        status: "in_progress",
        currentStep: "welcome",
        startedAt: serverTimestamp(),
      },
      checklist: {
        viewedRecommendedPlayers: false,
        firstMatchRequestSent: false,
      },
    };

    setUserOnboarding(resetState);
    await patchOnboarding(resetState as unknown as Record<string, unknown>);
    trackOnboardingEvent("onboarding_debug_restarted", { uid });
  }, [patchOnboarding, uid]);

  const markViewedRecommendedPlayers = useCallback(async () => {
    if (!uid || checklist.viewedRecommendedPlayers) return;
    await patchOnboarding({
      checklist: {
        viewedRecommendedPlayers: true,
      },
    });
    trackOnboardingEvent("onboarding_checklist_item_completed", {
      uid,
      item: "viewedRecommendedPlayers",
    });
  }, [checklist.viewedRecommendedPlayers, patchOnboarding, uid]);

  const markFirstMatchRequestPromptShown = useCallback(async () => {
    if (!uid || userOnboarding?.firstMatchRequestPromptShownAt || checklist.firstMatchRequestSent) return;
    await patchOnboarding({ firstMatchRequestPromptShownAt: serverTimestamp() });
    trackOnboardingEvent("first_match_request_prompt_shown", { uid });
  }, [
    checklist.firstMatchRequestSent,
    patchOnboarding,
    uid,
    userOnboarding?.firstMatchRequestPromptShownAt,
  ]);

  const markFirstMatchRequestSent = useCallback(
    async (requestId?: string | null) => {
      if (!uid) return;
      if (waitingForFinalOnboardingPrompt) {
        await patchOnboarding({
          checklist: {
            firstMatchRequestSent: true,
          },
          activationTour: {
            status: "in_progress",
            currentStep: "bestMatchInvite",
            firstMatchRequestSentAt: serverTimestamp(),
          },
        });
        trackOnboardingEvent("first_match_request_sent", { uid, requestId: requestId || undefined });
        return;
      }

      if (typeof window !== "undefined") {
        window.sessionStorage.removeItem(ONBOARDING_DEBUG_FORCE_KEY);
      }
      setDebugForceRestart(false);
      await patchOnboarding({
        checklist: {
          firstMatchRequestSent: true,
        },
        activationTourCompletedAt: serverTimestamp(),
        activationTour: {
          status: "completed",
          currentStep: "completed",
          completedAt: serverTimestamp(),
          firstMatchRequestSentAt: serverTimestamp(),
        },
      });
      trackOnboardingEvent("first_match_request_sent", { uid, requestId: requestId || undefined });
      if (completedRef.current !== uid) {
        completedRef.current = uid;
        trackOnboardingEvent("onboarding_completed", { uid });
      }
    },
    [patchOnboarding, uid, waitingForFinalOnboardingPrompt]
  );

  return {
    checklist,
    isComplete,
    isSkipped,
    shouldShow,
    activationTour: {
      status: tourStatus,
      currentStep,
    },
    profileBasicsComplete,
    skip,
    setActivationTourStep,
    restartActivationTour,
    markViewedRecommendedPlayers,
    markFirstMatchRequestPromptShown,
    markFirstMatchRequestSent,
  };
}
