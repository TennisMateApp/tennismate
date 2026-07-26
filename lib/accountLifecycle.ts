"use client";

import type { User } from "firebase/auth";
import { sendEmailVerification } from "firebase/auth";
import { doc, getDoc } from "firebase/firestore";
import { httpsCallable } from "firebase/functions";

import { db } from "@/lib/firebaseConfig";
import { getFunctionsClient } from "@/lib/getFunctionsClient";
import { matchMeReady } from "@/lib/profileReadiness";
import type { ReferralCandidate } from "@/lib/referralAttribution";
import { safeNextDestination, verificationContinueUrl } from "@/lib/verificationFlow";

export type AccountInitializationResult = {
  initialized: boolean;
  repairedDocuments: string[];
  shouldSendVerification: boolean;
  referralCaptured: boolean;
};

export type OnboardingFinalizationResult = {
  finalized: boolean;
  alreadyFinalized: boolean;
  missingRequirements: string[];
};

export async function initializeOrRepairAccount(input: {
  user: User;
  displayName?: string;
  birthYear?: number | null;
  referralCandidates?: ReferralCandidate[];
  journey?: "onboarding_v2";
}) {
  const callable = httpsCallable<
    {
      displayName?: string;
      birthYear?: number | null;
      referralCandidates?: ReferralCandidate[];
      journey?: "onboarding_v2";
    },
    AccountInitializationResult
  >(getFunctionsClient(), "initializeOnboardingAccount");
  const result = await callable({
    displayName: input.displayName || input.user.displayName || "",
    birthYear: input.birthYear ?? null,
    referralCandidates: input.referralCandidates || [],
    ...(input.journey ? {journey: input.journey} : {}),
  });
  return result.data;
}

export async function sendInitialVerificationIfClaimed(input: {
  user: User;
  shouldSendVerification: boolean;
  next?: string;
}) {
  if (input.user.emailVerified || !input.shouldSendVerification) return false;
  await sendEmailVerification(input.user, {
    url: verificationContinueUrl(input.next),
    handleCodeInApp: true,
  });
  return true;
}

export async function markUnsupportedPostcodeWaitlist(input: {
  postcode: string;
  displayName: string;
}) {
  const callable = httpsCallable<
    { postcode: string; displayName: string },
    { waitlisted: boolean }
  >(getFunctionsClient(), "submitOnboardingWaitlist");
  return (await callable(input)).data;
}

export async function finalizeOnboardingProfile() {
  const callable = httpsCallable<Record<string, never>, OnboardingFinalizationResult>(
    getFunctionsClient(),
    "finalizeOnboardingProfile"
  );
  return (await callable({})).data;
}

export async function resolveAccountDestination(user: User, requestedNext?: string | null) {
  const next = safeNextDestination(requestedNext, "/home");
  const initialization = await initializeOrRepairAccount({ user });
  await sendInitialVerificationIfClaimed({
    user,
    shouldSendVerification: initialization.shouldSendVerification,
    next,
  }).catch(() => false);

  await user.reload();
  if (!user.emailVerified) return `/verify-email?next=${encodeURIComponent(next)}`;

  const [userSnapshot, playerSnapshot, privateSnapshot] = await Promise.all([
    getDoc(doc(db, "users", user.uid)),
    getDoc(doc(db, "players", user.uid)),
    getDoc(doc(db, "players_private", user.uid)),
  ]);
  if (userSnapshot.data()?.accountStatus === "waitlisted") return "/waitlist";
  const player = playerSnapshot.exists() ? playerSnapshot.data() : null;
  const privatePlayer = privateSnapshot.exists() ? privateSnapshot.data() : null;
  const readiness = matchMeReady(player, privatePlayer);
  if (!readiness.ready) {
    const reason = readiness.reasons[0] || "profile_incomplete";
    return `/profile?edit=true&recovery=1&reason=${encodeURIComponent(reason)}&next=${encodeURIComponent(next)}`;
  }
  return next;
}
