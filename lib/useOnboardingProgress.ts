"use client";

import {useCallback, useEffect, useMemo, useState} from "react";
import {
  collection,
  doc,
  limit,
  onSnapshot,
  query,
  serverTimestamp,
  updateDoc,
  where,
} from "firebase/firestore";

import {db} from "@/lib/firebaseConfig";
import {
  getHomeWelcomeStatus,
  getMatchIntroStatus,
  isOnboardingV2Completed,
  type OnboardingV2HomeWelcomeStatus,
  type OnboardingV2MatchIntroStatus,
} from "@/lib/onboardingGuidance";
import {resolveSmallProfilePhoto} from "@/lib/profilePhoto";

export type OnboardingChecklistKey =
  | "profileComplete"
  | "availabilityAdded"
  | "profilePhotoAdded"
  | "viewedRecommendedPlayers"
  | "firstMatchRequestSent";

export type OnboardingChecklist = Record<OnboardingChecklistKey, boolean>;

type OnboardingDocState = {
  v2StartedAt?: unknown;
  version?: unknown;
  completedAt?: unknown;
  matchIntro?: {status?: unknown; updatedAt?: unknown};
  homeWelcome?: {status?: unknown; updatedAt?: unknown};
  checklist?: Partial<OnboardingChecklist>;
};

const EMPTY_CHECKLIST: OnboardingChecklist = {
  profileComplete: false,
  availabilityAdded: false,
  profilePhotoAdded: false,
  viewedRecommendedPlayers: false,
  firstMatchRequestSent: false,
};

function mergeChecklist(
  stored: Partial<OnboardingChecklist> | undefined,
  derived: Partial<OnboardingChecklist>,
): OnboardingChecklist {
  return {
    ...EMPTY_CHECKLIST,
    ...(stored || {}),
    ...derived,
  };
}

export function useOnboardingProgress(uid?: string | null) {
  const [userOnboarding, setUserOnboarding] = useState<OnboardingDocState | null>(null);
  const [userOnboardingLoadedForUid, setUserOnboardingLoadedForUid] = useState<string | null>(null);
  const [profileComplete, setProfileComplete] = useState(false);
  const [profilePhotoAdded, setProfilePhotoAdded] = useState(false);
  const [availabilityAdded, setAvailabilityAdded] = useState(false);
  const [profileAvailabilityAdded, setProfileAvailabilityAdded] = useState(false);
  const [firstMatchRequestSent, setFirstMatchRequestSent] = useState(false);
  const [firstMatchRequestLoaded, setFirstMatchRequestLoaded] = useState(false);

  useEffect(() => {
    if (!uid) {
      setUserOnboarding(null);
      setUserOnboardingLoadedForUid(null);
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
        setUserOnboardingLoadedForUid(uid);
      }, () => {
        setUserOnboarding(null);
        setUserOnboardingLoadedForUid(null);
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
        },
      ),
    ];

    return () => unsubs.forEach((unsub) => unsub());
  }, [uid]);

  const storedChecklist = userOnboarding?.checklist || {};
  const userOnboardingLoaded = Boolean(uid && userOnboardingLoadedForUid === uid);
  const checklist = useMemo(() => mergeChecklist(storedChecklist, {
    profileComplete,
    availabilityAdded: availabilityAdded || profileAvailabilityAdded,
    profilePhotoAdded,
    firstMatchRequestSent,
  }), [
    availabilityAdded,
    firstMatchRequestSent,
    profileAvailabilityAdded,
    profileComplete,
    profilePhotoAdded,
    storedChecklist,
  ]);

  const hasSentFirstRequest = checklist.firstMatchRequestSent;
  const onboardingUserData = {onboarding: userOnboarding};
  const v2Completed = isOnboardingV2Completed(onboardingUserData);
  const matchIntroStatus = getMatchIntroStatus(onboardingUserData);
  const homeWelcomeStatus = getHomeWelcomeStatus(onboardingUserData);
  const profileBasicsComplete = checklist.profileComplete && checklist.profilePhotoAdded;

  const setMatchIntroStatus = useCallback(async (
    status: Exclude<OnboardingV2MatchIntroStatus, "not_started">,
  ) => {
    if (!uid || !v2Completed || !matchIntroStatus) return false;
    if (matchIntroStatus === status) return true;
    if (matchIntroStatus !== "not_started") return false;
    await updateDoc(doc(db, "users", uid), {
      "onboarding.matchIntro": {status, updatedAt: serverTimestamp()},
    });
    return true;
  }, [matchIntroStatus, uid, v2Completed]);

  const setHomeWelcomeStatus = useCallback(async (
    status: Exclude<OnboardingV2HomeWelcomeStatus, "not_seen">,
  ) => {
    if (!uid || !v2Completed || !homeWelcomeStatus) return false;
    if (homeWelcomeStatus === status) return true;
    if (homeWelcomeStatus !== "not_seen") return false;
    await updateDoc(doc(db, "users", uid), {
      "onboarding.homeWelcome": {status, updatedAt: serverTimestamp()},
    });
    return true;
  }, [homeWelcomeStatus, uid, v2Completed]);

  return {
    checklist,
    isComplete: v2Completed || hasSentFirstRequest,
    userOnboardingLoaded,
    firstMatchRequestLoaded,
    v2Completed,
    matchIntroStatus,
    homeWelcomeStatus,
    hasSentFirstRequest,
    profileBasicsComplete,
    setMatchIntroStatus,
    setHomeWelcomeStatus,
  };
}
