import * as admin from "firebase-admin";
import {HttpsError, onCall} from "firebase-functions/v2/https";

const serverTimestamp = admin.firestore.FieldValue.serverTimestamp;

type ReferralSource = "session" | "ref" | "rc" | "cookie";
type ReferralCandidate = {code?: unknown; source?: unknown};

type InitializeRequest = {
  displayName?: unknown;
  birthYear?: unknown;
  referralCandidates?: unknown;
  journey?: unknown;
};

export type OnboardingJourney = "onboarding_v2" | null;

const hasText = (value: unknown): value is string =>
  typeof value === "string" && value.trim().length > 0;

export function normalizeReferralCode(value: unknown) {
  return typeof value === "string" ?
    value.trim().toUpperCase().replace(/[^A-Z0-9_-]/g, "").slice(0, 40) :
    "";
}

export function validAdultBirthYear(value: unknown, currentYear = new Date().getFullYear()) {
  if (!Number.isInteger(value)) return false;
  const birthYear = value as number;
  const age = currentYear - birthYear;
  return birthYear >= 1900 && birthYear <= currentYear && age >= 18 && age <= 110;
}

export function sanitizeReferralCandidates(value: unknown) {
  if (!Array.isArray(value)) return [];
  const validSources = new Set<ReferralSource>(["session", "ref", "rc", "cookie"]);
  const seen = new Set<string>();
  return value.flatMap((candidate: ReferralCandidate) => {
    const code = normalizeReferralCode(candidate?.code);
    const source = candidate?.source as ReferralSource;
    if (!code || !validSources.has(source) || seen.has(code)) return [];
    seen.add(code);
    return [{code, source}];
  }).slice(0, 4);
}

export function parseOnboardingJourney(value: unknown): OnboardingJourney {
  if (value === undefined || value === null) return null;
  if (value === "onboarding_v2") return value;
  throw new HttpsError("invalid-argument", "Unknown onboarding journey.");
}

export function buildOnboardingV2StartState(input: {
  existingOnboarding: unknown;
  journey: OnboardingJourney;
  profileComplete: boolean;
  timestamp: unknown;
}): Record<string, unknown> | null {
  if (input.journey !== "onboarding_v2" || input.profileComplete) return null;
  const existing = input.existingOnboarding !== null &&
    typeof input.existingOnboarding === "object" &&
    !Array.isArray(input.existingOnboarding) ?
    input.existingOnboarding as Record<string, unknown> : {};
  if (existing.v2StartedAt) return null;
  return {...existing, v2StartedAt: input.timestamp};
}

async function resolveReferral(
  uid: string,
  candidates: Array<{code: string; source: ReferralSource}>
) {
  const db = admin.firestore();
  for (const candidate of candidates) {
    const snapshot = await db.collection("users")
      .where("referralCode", "==", candidate.code)
      .limit(2)
      .get();
    const referrer = snapshot.docs.find((item) => item.id !== uid);
    if (referrer) return {...candidate, referrerUid: referrer.id};
  }
  return null;
}

export const initializeOnboardingAccount = onCall({region: "australia-southeast2"}, async (request) => {
  if (!request.auth) throw new HttpsError("unauthenticated", "Sign in is required.");
  const uid = request.auth.uid;
  const data = (request.data || {}) as InitializeRequest;
  const displayName = hasText(data.displayName) ? data.displayName.trim().slice(0, 60) : "";
  const birthYear = validAdultBirthYear(data.birthYear) ? data.birthYear as number : null;
  const email = typeof request.auth.token.email === "string" ? request.auth.token.email : "";
  const emailVerified = request.auth.token.email_verified === true;
  const referralCandidates = sanitizeReferralCandidates(data.referralCandidates);
  const journey = parseOnboardingJourney(data.journey);
  const referral = await resolveReferral(uid, referralCandidates);
  const db = admin.firestore();

  const userRef = db.collection("users").doc(uid);
  const playerRef = db.collection("players").doc(uid);
  const privateRef = db.collection("players_private").doc(uid);
  let shouldSendVerification = false;
  let referralCaptured = false;
  let repairedDocuments: string[] = [];

  console.log("[onboarding_foundation] initialization_started", {
    hasDisplayName: Boolean(displayName),
    hasBirthYear: birthYear !== null,
    referralCandidateCount: referralCandidates.length,
  });

  try {
    await db.runTransaction(async (transaction) => {
      const [userSnapshot, playerSnapshot, privateSnapshot] = await Promise.all([
        transaction.get(userRef),
        transaction.get(playerRef),
        transaction.get(privateRef),
      ]);
      const userData = userSnapshot.data() || {};
      const playerData = playerSnapshot.data() || {};
      const privateData = privateSnapshot.data() || {};
      repairedDocuments = [
        ...(!userSnapshot.exists ? ["users"] : []),
        ...(!playerSnapshot.exists ? ["players"] : []),
        ...(!privateSnapshot.exists ? ["players_private"] : []),
      ];

      const userPatch: Record<string, unknown> = {
        accountInitialization: {
          status: "initialized",
          version: 1,
          updatedAt: serverTimestamp(),
        },
        updatedAt: serverTimestamp(),
      };
      const onboardingV2StartState = buildOnboardingV2StartState({
        existingOnboarding: userData.onboarding,
        journey,
        profileComplete: playerData.profileComplete === true,
        timestamp: serverTimestamp(),
      });
      if (onboardingV2StartState) userPatch.onboarding = onboardingV2StartState;
      if (!userSnapshot.exists) {
        Object.assign(userPatch, {
          name: displayName,
          email,
          requireVerification: !emailVerified,
          createdAt: serverTimestamp(),
        });
      } else {
        if (!hasText(userData.name) && displayName) userPatch.name = displayName;
        if (!hasText(userData.email) && email) userPatch.email = email;
        if (!("requireVerification" in userData)) userPatch.requireVerification = !emailVerified;
      }
      if (!emailVerified && !userData.verificationInitialSendClaimedAt) {
        userPatch.verificationInitialSendClaimedAt = serverTimestamp();
        shouldSendVerification = true;
      }
      if (!userData.referralAttribution && referral) {
        userPatch.referralAttribution = {
          referrerUid: referral.referrerUid,
          code: referral.code,
          source: referral.source,
          capturedAt: serverTimestamp(),
        };
        referralCaptured = true;
      }
      transaction.set(userRef, userPatch, {merge: true});

      if (!playerSnapshot.exists) {
        transaction.set(playerRef, {
          name: displayName,
          nameLower: displayName.toLocaleLowerCase("en-AU"),
          profileComplete: false,
          isMatchable: false,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
      } else if (playerData.profileComplete !== true) {
        const playerPatch: Record<string, unknown> = {
          isMatchable: false,
          updatedAt: serverTimestamp(),
        };
        if (!hasText(playerData.name) && displayName) {
          playerPatch.name = displayName;
          playerPatch.nameLower = displayName.toLocaleLowerCase("en-AU");
        }
        transaction.set(playerRef, playerPatch, {merge: true});
      }

      const privatePatch: Record<string, unknown> = {updatedAt: serverTimestamp()};
      if (!privateSnapshot.exists) privatePatch.createdAt = serverTimestamp();
      if (!hasText(privateData.email) && email) privatePatch.email = email;
      if (!validAdultBirthYear(privateData.birthYear) && birthYear !== null) {
        privatePatch.birthYear = birthYear;
      }
      transaction.set(privateRef, privatePatch, {merge: true});
    });
  } catch (error) {
    console.error("[onboarding_foundation] initialization_failed", {
      reason: "transaction_failed",
      errorCode: error instanceof Error ? error.name : "unknown",
    });
    throw new HttpsError("internal", "Account setup could not be completed.");
  }

  console.log("[onboarding_foundation] initialization_completed", {
    repairedDocuments,
    shouldSendVerification,
    referralCaptured,
  });
  if (repairedDocuments.length) {
    console.log("[onboarding_foundation] partial_account_repair_completed", {
      repairedDocuments,
    });
  }
  if (referralCaptured) {
    console.log("[onboarding_foundation] referral_captured", {source: referral?.source});
  }

  return {
    initialized: true,
    repairedDocuments,
    shouldSendVerification,
    referralCaptured,
  };
});

type WaitlistRequest = {postcode?: unknown; displayName?: unknown};

export const submitOnboardingWaitlist = onCall({region: "australia-southeast2"}, async (request) => {
  if (!request.auth) throw new HttpsError("unauthenticated", "Sign in is required.");
  const uid = request.auth.uid;
  const data = (request.data || {}) as WaitlistRequest;
  const postcode = typeof data.postcode === "string" ? data.postcode.trim() : "";
  if (!/^\d{4}$/.test(postcode) || postcode[0] === "2" || postcode[0] === "3") {
    throw new HttpsError("invalid-argument", "An unsupported Australian postcode is required.");
  }
  const displayName = hasText(data.displayName) ? data.displayName.trim().slice(0, 60) : "";
  const email = typeof request.auth.token.email === "string" ? request.auth.token.email : "";
  const db = admin.firestore();
  const waitlistRef = db.collection("waitlist_users").doc(uid);
  await db.runTransaction(async (transaction) => {
    const waitlistSnapshot = await transaction.get(waitlistRef);
    transaction.set(waitlistRef, {
      name: displayName,
      email,
      postcode,
      status: "waitlisted",
      source: "signupForm",
      submittedBy: uid,
      updatedAt: serverTimestamp(),
      ...(!waitlistSnapshot.exists ? {createdAt: serverTimestamp()} : {}),
    }, {merge: true});
    transaction.set(db.collection("users").doc(uid), {
      accountStatus: "waitlisted",
      waitlistPostcode: postcode,
      updatedAt: serverTimestamp(),
    }, {merge: true});
    transaction.set(db.collection("players").doc(uid), {
      profileComplete: false,
      isMatchable: false,
      updatedAt: serverTimestamp(),
    }, {merge: true});
  });
  console.log("[onboarding_foundation] waitlist_submission_completed", {region: "unsupported"});
  return {waitlisted: true};
});
