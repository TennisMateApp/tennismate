import * as admin from "firebase-admin";
import {CallableRequest, HttpsError, onCall} from "firebase-functions/v2/https";

const CANONICAL_SKILL_BANDS = new Set([
  "lower_beginner",
  "beginner",
  "upper_beginner",
  "lower_intermediate",
  "intermediate",
  "upper_intermediate",
  "lower_advanced",
  "advanced",
  "upper_advanced",
]);

const CANONICAL_AVAILABILITY = new Set([
  "Weekdays AM",
  "Weekdays PM",
  "Weekends AM",
  "Weekends PM",
]);

export type OnboardingFinalizationRequirement =
  | "email_not_verified"
  | "account_not_initialized"
  | "missing_name"
  | "invalid_postcode"
  | "missing_skill"
  | "missing_availability"
  | "missing_photo"
  | "invalid_birth_year"
  | "missing_coordinates"
  | "missing_geohash"
  | "waitlisted"
  | "onboarding_v2_not_started";

export type OnboardingFinalizationResponse = {
  finalized: boolean;
  alreadyFinalized: boolean;
  missingRequirements: OnboardingFinalizationRequirement[];
};

type StoredDocument = {
  exists: boolean;
  data: Record<string, unknown>;
};

export type StoredOnboardingState = {
  emailVerified: boolean;
  user: StoredDocument;
  player: StoredDocument;
  privatePlayer: StoredDocument;
  postcode: StoredDocument;
};

export type OnboardingFinalizationDecision = OnboardingFinalizationResponse & {
  playerUpdate: {profileComplete: true; isMatchable?: true} | null;
};

type V2MarkerOutcome = "written" | "preserved";
type StoredFinalizationResult = OnboardingFinalizationResponse & {
  v2MarkerOutcome?: V2MarkerOutcome;
};

type FinalizationDependencies = {
  getAuthUser: (uid: string) => Promise<{emailVerified: boolean}>;
  finalizeStoredProfile: (
    uid: string,
    emailVerified: boolean
  ) => Promise<StoredFinalizationResult>;
};

const hasText = (value: unknown): value is string =>
  typeof value === "string" && value.trim().length > 0;

const isFiniteCoordinate = (value: unknown, min: number, max: number) =>
  typeof value === "number" && Number.isFinite(value) && value >= min && value <= max;

const asRecord = (value: unknown): Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value) ?
    value as Record<string, unknown> : {};

const isStoredTimestamp = (value: unknown) =>
  value instanceof admin.firestore.Timestamp;

function hasTrustedOnboardingV2Start(user: Record<string, unknown>) {
  return isStoredTimestamp(asRecord(user.onboarding).v2StartedAt);
}

export function buildOnboardingV2CompletionUpdate(
  user: Record<string, unknown>,
  timestamp: unknown
) {
  const onboarding = asRecord(user.onboarding);
  const alreadyMarked = onboarding.version === 2 && isStoredTimestamp(onboarding.completedAt);
  const patch: Record<string, unknown> = {"onboarding.version": 2};
  if (!alreadyMarked) patch["onboarding.completedAt"] = timestamp;
  if (!("matchIntro" in onboarding)) {
    patch["onboarding.matchIntro"] = {status: "not_started", updatedAt: null};
  }
  if (!("homeWelcome" in onboarding)) {
    patch["onboarding.homeWelcome"] = {status: "not_seen", updatedAt: null};
  }
  return {
    patch,
    markerOutcome: (alreadyMarked ? "preserved" : "written") as V2MarkerOutcome,
  };
}

function hasSupportedPostcode(state: StoredOnboardingState) {
  const postcode = state.player.data.postcode;
  if (typeof postcode !== "string" || !/^[23]\d{3}$/.test(postcode.trim())) return false;
  if (!state.postcode.exists) return false;
  return isFiniteCoordinate(state.postcode.data.lat, -90, 90) &&
    isFiniteCoordinate(state.postcode.data.lng, -180, 180);
}

function hasCanonicalSkill(player: Record<string, unknown>) {
  return typeof player.skillBand === "string" && CANONICAL_SKILL_BANDS.has(player.skillBand);
}

function hasCanonicalAvailability(player: Record<string, unknown>) {
  return Array.isArray(player.availability) &&
    player.availability.some((value) =>
      typeof value === "string" && CANONICAL_AVAILABILITY.has(value)
    );
}

function hasRequiredPhotos(player: Record<string, unknown>) {
  return hasText(player.photoURL) && hasText(player.photoThumbURL);
}

function hasAdultBirthYear(value: unknown, currentYear: number) {
  if (!Number.isInteger(value)) return false;
  const birthYear = value as number;
  const age = currentYear - birthYear;
  return birthYear >= 1900 && birthYear <= currentYear && age >= 18 && age <= 110;
}

export function evaluateOnboardingFinalization(
  state: StoredOnboardingState,
  currentYear = new Date().getFullYear()
): OnboardingFinalizationDecision {
  if (!state.emailVerified) {
    return rejected(["email_not_verified"]);
  }

  if (!state.user.exists || !state.player.exists || !state.privatePlayer.exists) {
    return rejected(["account_not_initialized"]);
  }

  if (state.user.data.accountStatus === "waitlisted") {
    return rejected(["waitlisted"]);
  }

  if (!hasTrustedOnboardingV2Start(state.user.data)) {
    return rejected(["onboarding_v2_not_started"]);
  }

  const missingRequirements: OnboardingFinalizationRequirement[] = [];
  const player = state.player.data;
  const privatePlayer = state.privatePlayer.data;

  if (!hasText(player.name)) missingRequirements.push("missing_name");
  if (!hasSupportedPostcode(state)) missingRequirements.push("invalid_postcode");
  if (!hasCanonicalSkill(player)) missingRequirements.push("missing_skill");
  if (!hasCanonicalAvailability(player)) missingRequirements.push("missing_availability");
  if (!hasRequiredPhotos(player)) missingRequirements.push("missing_photo");
  if (!hasAdultBirthYear(privatePlayer.birthYear, currentYear)) {
    missingRequirements.push("invalid_birth_year");
  }
  if (!isFiniteCoordinate(privatePlayer.lat, -90, 90) ||
      !isFiniteCoordinate(privatePlayer.lng, -180, 180)) {
    missingRequirements.push("missing_coordinates");
  }
  if (!hasText(privatePlayer.geohash)) missingRequirements.push("missing_geohash");

  if (missingRequirements.length) return rejected(missingRequirements);

  // Phase 0 deliberately sets incomplete account shells to isMatchable=false.
  // A false value represents an explicit visibility choice only after a profile
  // has already reached profileComplete=true in the frozen legacy model.
  const explicitlyHidden = player.profileComplete === true && player.isMatchable === false;
  const alreadyFinalized = player.profileComplete === true &&
    (explicitlyHidden || player.isMatchable === true);

  if (alreadyFinalized) {
    return {
      finalized: true,
      alreadyFinalized: true,
      missingRequirements: [],
      playerUpdate: null,
    };
  }

  return {
    finalized: true,
    alreadyFinalized: false,
    missingRequirements: [],
    playerUpdate: explicitlyHidden ? {profileComplete: true} : {
      profileComplete: true,
      isMatchable: true,
    },
  };
}

function rejected(
  missingRequirements: OnboardingFinalizationRequirement[]
): OnboardingFinalizationDecision {
  return {
    finalized: false,
    alreadyFinalized: false,
    missingRequirements,
    playerUpdate: null,
  };
}

async function finalizeStoredProfile(
  uid: string,
  emailVerified: boolean
): Promise<StoredFinalizationResult> {
  const db = admin.firestore();
  return db.runTransaction(async (transaction) => {
    const userRef = db.collection("users").doc(uid);
    const playerRef = db.collection("players").doc(uid);
    const privateRef = db.collection("players_private").doc(uid);
    const [userSnapshot, playerSnapshot, privateSnapshot] = await Promise.all([
      transaction.get(userRef),
      transaction.get(playerRef),
      transaction.get(privateRef),
    ]);
    const playerData = playerSnapshot.data() || {};
    const postcodeValue = playerData.postcode;
    const postcodeRef = typeof postcodeValue === "string" && postcodeValue.trim() ?
      db.collection("postcodes").doc(postcodeValue.trim()) :
      null;
    const postcodeSnapshot = postcodeRef ? await transaction.get(postcodeRef) : null;
    const decision = evaluateOnboardingFinalization({
      emailVerified,
      user: {exists: userSnapshot.exists, data: userSnapshot.data() || {}},
      player: {exists: playerSnapshot.exists, data: playerData},
      privatePlayer: {exists: privateSnapshot.exists, data: privateSnapshot.data() || {}},
      postcode: {
        exists: postcodeSnapshot?.exists === true,
        data: postcodeSnapshot?.data() || {},
      },
    });

    if (decision.playerUpdate) {
      transaction.update(playerRef, {
        ...decision.playerUpdate,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      });
    }

    let v2MarkerOutcome: V2MarkerOutcome | undefined;
    if (decision.finalized) {
      const completion = buildOnboardingV2CompletionUpdate(
        userSnapshot.data() || {},
        admin.firestore.FieldValue.serverTimestamp()
      );
      transaction.update(
        userRef,
        completion.patch as admin.firestore.UpdateData<admin.firestore.DocumentData>
      );
      v2MarkerOutcome = completion.markerOutcome;
    }

    return {
      finalized: decision.finalized,
      alreadyFinalized: decision.alreadyFinalized,
      missingRequirements: decision.missingRequirements,
      v2MarkerOutcome,
    };
  });
}

const defaultDependencies: FinalizationDependencies = {
  getAuthUser: async (uid) => {
    const user = await admin.auth().getUser(uid);
    return {emailVerified: user.emailVerified};
  },
  finalizeStoredProfile,
};

export async function handleFinalizeOnboardingProfile(
  request: Pick<CallableRequest<unknown>, "auth" | "data">,
  dependencies: FinalizationDependencies = defaultDependencies
): Promise<OnboardingFinalizationResponse> {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "Sign in is required.");
  }

  const uid = request.auth.uid;
  console.log("[onboarding_finalisation] finalisation_started", {uid});

  let authUser: {emailVerified: boolean};
  try {
    authUser = await dependencies.getAuthUser(uid);
  } catch (error) {
    console.error("[onboarding_finalisation] finalisation_rejected", {
      uid,
      reason: "auth_user_lookup_failed",
      errorCode: error instanceof Error ? error.name : "unknown",
    });
    throw new HttpsError("internal", "Profile setup could not be finalized.");
  }

  const result = authUser.emailVerified ?
    await dependencies.finalizeStoredProfile(uid, true) :
    {
      finalized: false,
      alreadyFinalized: false,
      missingRequirements: ["email_not_verified" as const],
    };

  if (!result.finalized) {
    console.log("[onboarding_finalisation] finalisation_rejected", {
      uid,
      missingRequirements: result.missingRequirements,
    });
  } else if (result.v2MarkerOutcome === "preserved") {
    console.log("[onboarding_finalisation] v2_completion_marker_preserved", {uid});
  } else {
    console.log("[onboarding_finalisation] v2_completion_marker_written", {uid});
  }

  return {
    finalized: result.finalized,
    alreadyFinalized: result.alreadyFinalized,
    missingRequirements: result.missingRequirements,
  };
}

export const finalizeOnboardingProfile = onCall(
  {region: "australia-southeast2"},
  (request) => handleFinalizeOnboardingProfile(request)
);
