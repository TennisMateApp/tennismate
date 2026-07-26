import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import path from "node:path";
import {fileURLToPath} from "node:url";
import test from "node:test";
import {Timestamp} from "firebase-admin/firestore";
import {HttpsError} from "firebase-functions/v2/https";

import {
  buildOnboardingV2CompletionUpdate,
  evaluateOnboardingFinalization,
  handleFinalizeOnboardingProfile,
  type StoredOnboardingState,
} from "../../onboardingFinalization";

const completePlayer = {
  name: "Alex Player",
  postcode: "3068",
  skillBand: "intermediate",
  availability: ["Weekends AM"],
  photoURL: "https://example.test/avatar_full.jpg",
  photoThumbURL: "https://example.test/avatar_thumb.jpg",
  profileComplete: false,
  isMatchable: false,
  clubId: "court-1",
  clubName: "Clifton Hill Tennis Club",
  clubStatus: "member",
};

const completePrivatePlayer = {
  birthYear: 1990,
  lat: -37.8,
  lng: 145,
  geohash: "r1r0",
};

function state(overrides: Partial<StoredOnboardingState> = {}): StoredOnboardingState {
  return {
    emailVerified: true,
    user: {
      exists: true,
      data: {
        accountInitialization: {status: "initialized"},
        onboarding: {v2StartedAt: Timestamp.fromMillis(1)},
      },
    },
    player: {exists: true, data: {...completePlayer}},
    privatePlayer: {exists: true, data: {...completePrivatePlayer}},
    postcode: {exists: true, data: {lat: -37.8, lng: 145}},
    ...overrides,
  };
}

test("unauthenticated request is rejected", async () => {
  await assert.rejects(
    () => handleFinalizeOnboardingProfile(
      {auth: undefined, data: {}},
      {
        getAuthUser: async () => ({emailVerified: true}),
        finalizeStoredProfile: async () => ({
          finalized: true, alreadyFinalized: false, missingRequirements: [],
        }),
      }
    ),
    (error: unknown) => error instanceof HttpsError && error.code === "unauthenticated"
  );
});

test("unverified Auth account is rejected before stored finalization", async () => {
  let finalized = false;
  const result = await handleFinalizeOnboardingProfile(
    {auth: {uid: "player-1", token: {} as never}, data: {}},
    {
      getAuthUser: async () => ({emailVerified: false}),
      finalizeStoredProfile: async () => {
        finalized = true;
        return {finalized: true, alreadyFinalized: false, missingRequirements: []};
      },
    }
  );
  assert.equal(finalized, false);
  assert.deepEqual(result, {
    finalized: false,
    alreadyFinalized: false,
    missingRequirements: ["email_not_verified"],
  });
});

test("missing shell document is rejected", () => {
  const result = evaluateOnboardingFinalization(state({
    player: {exists: false, data: {}},
  }));
  assert.deepEqual(result.missingRequirements, ["account_not_initialized"]);
});

test("waitlisted account is rejected", () => {
  const result = evaluateOnboardingFinalization(state({
    user: {exists: true, data: {accountStatus: "waitlisted"}},
  }));
  assert.deepEqual(result.missingRequirements, ["waitlisted"]);
});

test("missing canonical skill is rejected", () => {
  const result = evaluateOnboardingFinalization(state({
    player: {exists: true, data: {...completePlayer, skillBand: "Expert"}},
  }));
  assert.ok(result.missingRequirements.includes("missing_skill"));
});

test("missing canonical availability is rejected", () => {
  const result = evaluateOnboardingFinalization(state({
    player: {exists: true, data: {...completePlayer, availability: ["Sometimes"]}},
  }));
  assert.ok(result.missingRequirements.includes("missing_availability"));
});

test("both full photo and thumbnail are required", () => {
  const result = evaluateOnboardingFinalization(state({
    player: {exists: true, data: {...completePlayer, photoThumbURL: ""}},
  }));
  assert.ok(result.missingRequirements.includes("missing_photo"));
});

test("invalid adult birth year is rejected", () => {
  const result = evaluateOnboardingFinalization(state({
    privatePlayer: {exists: true, data: {...completePrivatePlayer, birthYear: 2015}},
  }), 2026);
  assert.ok(result.missingRequirements.includes("invalid_birth_year"));
});

test("missing coordinates are rejected", () => {
  const result = evaluateOnboardingFinalization(state({
    privatePlayer: {exists: true, data: {...completePrivatePlayer, lat: null}},
  }));
  assert.ok(result.missingRequirements.includes("missing_coordinates"));
});

test("missing geohash is rejected separately", () => {
  const result = evaluateOnboardingFinalization(state({
    privatePlayer: {exists: true, data: {...completePrivatePlayer, geohash: ""}},
  }));
  assert.ok(result.missingRequirements.includes("missing_geohash"));
});

test("unsupported or unknown postcode is rejected", () => {
  const unsupported = evaluateOnboardingFinalization(state({
    player: {exists: true, data: {...completePlayer, postcode: "4000"}},
  }));
  const unknown = evaluateOnboardingFinalization(state({
    postcode: {exists: false, data: {}},
  }));
  assert.ok(unsupported.missingRequirements.includes("invalid_postcode"));
  assert.ok(unknown.missingRequirements.includes("invalid_postcode"));
});

test("valid incomplete shell is finalized and made matchable", () => {
  const result = evaluateOnboardingFinalization(state());
  assert.equal(result.finalized, true);
  assert.equal(result.alreadyFinalized, false);
  assert.deepEqual(result.playerUpdate, {profileComplete: true, isMatchable: true});
});

test("V2 finalization requires the trusted start marker", () => {
  const result = evaluateOnboardingFinalization(state({
    user: {exists: true, data: {accountInitialization: {status: "initialized"}}},
  }));
  assert.deepEqual(result.missingRequirements, ["onboarding_v2_not_started"]);
  assert.equal(result.finalized, false);
});

test("eligible complete legacy profile cannot become V2-completed", () => {
  const result = evaluateOnboardingFinalization(state({
    user: {exists: true, data: {accountInitialization: {status: "initialized"}}},
    player: {
      exists: true,
      data: {...completePlayer, profileComplete: true, isMatchable: true},
    },
  }));
  assert.deepEqual(result.missingRequirements, ["onboarding_v2_not_started"]);
});

test("successful V2 completion initializes marker and missing guidance state", () => {
  const timestamp = Timestamp.fromMillis(2);
  const result = buildOnboardingV2CompletionUpdate({
    onboarding: {v2StartedAt: Timestamp.fromMillis(1)},
  }, timestamp);
  assert.equal(result.markerOutcome, "written");
  assert.deepEqual(result.patch, {
    "onboarding.version": 2,
    "onboarding.completedAt": timestamp,
    "onboarding.matchIntro": {status: "not_started", updatedAt: null},
    "onboarding.homeWelcome": {status: "not_seen", updatedAt: null},
  });
});

test("V2 finalization retry preserves terminal guidance and legacy state", () => {
  const completedAt = Timestamp.fromMillis(10);
  const user = {
    onboarding: {
      v2StartedAt: Timestamp.fromMillis(1),
      version: 2,
      completedAt,
      matchIntro: {status: "skipped", updatedAt: Timestamp.fromMillis(11)},
      homeWelcome: {status: "dismissed", updatedAt: Timestamp.fromMillis(12)},
      activationTour: {status: "completed"},
      checklist: {profileComplete: true},
    },
  };
  const result = buildOnboardingV2CompletionUpdate(user, Timestamp.fromMillis(20));
  assert.equal(result.markerOutcome, "preserved");
  assert.deepEqual(result.patch, {"onboarding.version": 2});
  assert.deepEqual(user.onboarding.activationTour, {status: "completed"});
  assert.deepEqual(user.onboarding.checklist, {profileComplete: true});
});

test("explicitly hidden completed profile remains hidden", () => {
  const result = evaluateOnboardingFinalization(state({
    player: {
      exists: true,
      data: {...completePlayer, profileComplete: true, isMatchable: false},
    },
  }));
  assert.equal(result.finalized, true);
  assert.equal(result.alreadyFinalized, true);
  assert.equal(result.playerUpdate, null);
});

test("retrying a valid finalized profile is idempotent", () => {
  const result = evaluateOnboardingFinalization(state({
    player: {
      exists: true,
      data: {...completePlayer, profileComplete: true, isMatchable: true},
    },
  }));
  assert.deepEqual(result, {
    finalized: true,
    alreadyFinalized: true,
    missingRequirements: [],
    playerUpdate: null,
  });
});

test("finalization patch preserves club membership and all profile data", () => {
  const original = {...completePlayer};
  const decision = evaluateOnboardingFinalization(state());
  const updated = {...original, ...decision.playerUpdate};
  assert.equal(updated.clubId, original.clubId);
  assert.equal(updated.clubName, original.clubName);
  assert.equal(updated.clubStatus, original.clubStatus);
  assert.equal(updated.name, original.name);
});

test("request payload cannot forge stored profile values", async () => {
  let receivedUid = "";
  const result = await handleFinalizeOnboardingProfile(
    {
      auth: {uid: "real-player", token: {} as never},
      data: {
        name: "Forged Name",
        profileComplete: true,
        isMatchable: true,
        birthYear: 1990,
      },
    },
    {
      getAuthUser: async () => ({emailVerified: true}),
      finalizeStoredProfile: async (uid) => {
        receivedUid = uid;
        return {
          finalized: false,
          alreadyFinalized: false,
          missingRequirements: ["missing_name"],
        };
      },
    }
  );
  assert.equal(receivedUid, "real-player");
  assert.deepEqual(result.missingRequirements, ["missing_name"]);
});

test("finalizer keeps its empty request and public response contract", async () => {
  const result = await handleFinalizeOnboardingProfile(
    {auth: {uid: "player-1", token: {} as never}, data: {}},
    {
      getAuthUser: async () => ({emailVerified: true}),
      finalizeStoredProfile: async () => ({
        finalized: true,
        alreadyFinalized: false,
        missingRequirements: [],
        v2MarkerOutcome: "written",
      }),
    }
  );
  assert.deepEqual(result, {
    finalized: true,
    alreadyFinalized: false,
    missingRequirements: [],
  });
});

test("legacy signup and client activation-field compatibility remain unchanged", () => {
  const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");
  const signup = readFileSync(path.join(repoRoot, "app/signup/page.tsx"), "utf8");
  const rules = readFileSync(path.join(repoRoot, "firestore.rules"), "utf8");
  assert.match(signup, /isMatchable:\s*true/);
  assert.match(signup, /profileComplete:\s*true/);
  assert.match(rules, /"isMatchable"/);
  assert.match(rules, /"profileComplete"/);
});

test("existing Phase 0 callable contracts remain present", () => {
  const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");
  const source = readFileSync(
    path.join(repoRoot, "functions/src/onboardingFoundation.ts"),
    "utf8"
  );
  assert.match(source, /initializeOnboardingAccount\s*=\s*onCall/);
  assert.match(source, /submitOnboardingWaitlist\s*=\s*onCall/);
});
