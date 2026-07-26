/* eslint-disable max-len */
import {after, before, beforeEach, test} from "node:test";
import {readFileSync} from "node:fs";
import {assertFails, assertSucceeds, initializeTestEnvironment, RulesTestEnvironment} from "@firebase/rules-unit-testing";
import {doc, getDoc, serverTimestamp, setDoc, updateDoc} from "firebase/firestore";

const host = process.env.FIRESTORE_EMULATOR_HOST;
let environment: RulesTestEnvironment;

before(async () => {
  if (!host) return;
  const [hostname, port] = host.split(":");
  environment = await initializeTestEnvironment({
    projectId: "demo-tennismate-onboarding-foundation",
    firestore: {
      host: hostname,
      port: Number(port),
      rules: readFileSync(`${process.cwd()}/../firestore.rules`, "utf8"),
    },
  });
});

beforeEach(async () => { if (environment) await environment.clearFirestore(); });
after(async () => { if (environment) await environment.cleanup(); });

async function seed(path: string, data: Record<string, unknown>) {
  await environment.withSecurityRulesDisabled(async (context) => {
    await setDoc(doc(context.firestore(), path), data);
  });
}

test("clients cannot forge trusted account lifecycle or referral attribution", {skip: !host}, async () => {
  const db = environment.authenticatedContext("player-1", {email: "player@example.com"}).firestore();
  await assertSucceeds(setDoc(doc(db, "users/player-1"), {name: "Player"}));
  await assertFails(updateDoc(doc(db, "users/player-1"), {
    referralAttribution: {referrerUid: "other", code: "CODE"},
  }));
  await assertFails(updateDoc(doc(db, "users/player-1"), {
    accountStatus: "waitlisted",
  }));
});

test("waitlist documents are owner-readable and server-writable only", {skip: !host}, async () => {
  await seed("waitlist_users/player-1", {status: "waitlisted", submittedBy: "player-1"});
  const ownerDb = environment.authenticatedContext("player-1").firestore();
  const otherDb = environment.authenticatedContext("player-2").firestore();
  await assertSucceeds(getDoc(doc(ownerDb, "waitlist_users/player-1")));
  await assertFails(getDoc(doc(otherDb, "waitlist_users/player-1")));
  await assertFails(updateDoc(doc(ownerDb, "waitlist_users/player-1"), {status: "active"}));
});

test("a player cannot place private location fields in the public player document", {skip: !host}, async () => {
  const db = environment.authenticatedContext("player-1", {email: "player@example.com"}).firestore();
  await assertFails(setDoc(doc(db, "players/player-1"), {
    name: "Player",
    profileComplete: false,
    lat: -37.8,
  }));
});

async function seedV2Guidance() {
  await seed("users/player-1", {
    name: "Player One",
    onboarding: {
      v2StartedAt: new Date("2026-01-01T00:00:00Z"),
      version: 2,
      completedAt: new Date("2026-01-02T00:00:00Z"),
      matchIntro: {status: "not_started", updatedAt: null},
      homeWelcome: {status: "not_seen", updatedAt: null},
      activationTour: {status: "not_started", currentStep: "welcome"},
      checklist: {profileComplete: true},
    },
  });
}

test("clients cannot forge trusted V2 journey or completion fields", {skip: !host}, async () => {
  await seed("users/player-1", {name: "Player One"});
  const db = environment.authenticatedContext("player-1").firestore();
  await assertFails(updateDoc(doc(db, "users/player-1"), {
    "onboarding.v2StartedAt": serverTimestamp(),
  }));
  await assertFails(updateDoc(doc(db, "users/player-1"), {"onboarding.version": 2}));
  await assertFails(updateDoc(doc(db, "users/player-1"), {
    "onboarding.completedAt": serverTimestamp(),
  }));
  const newPlayerDb = environment.authenticatedContext("new-player").firestore();
  await assertFails(setDoc(doc(newPlayerDb, "users/new-player"), {
    onboarding: {v2StartedAt: serverTimestamp(), version: 2},
  }));
});

test("owner can complete or skip Match intro but cannot reset or switch terminal state", {skip: !host}, async () => {
  await seedV2Guidance();
  const db = environment.authenticatedContext("player-1").firestore();
  const ref = doc(db, "users/player-1");
  await assertSucceeds(updateDoc(ref, {
    "onboarding.matchIntro": {status: "completed", updatedAt: serverTimestamp()},
  }));
  await assertSucceeds(updateDoc(ref, {
    "onboarding.matchIntro": {status: "completed", updatedAt: serverTimestamp()},
  }));
  await assertFails(updateDoc(ref, {
    "onboarding.matchIntro": {status: "not_started", updatedAt: serverTimestamp()},
  }));
  await assertFails(updateDoc(ref, {
    "onboarding.matchIntro": {status: "skipped", updatedAt: serverTimestamp()},
  }));

  await seedV2Guidance();
  await assertSucceeds(updateDoc(ref, {
    "onboarding.matchIntro": {status: "skipped", updatedAt: serverTimestamp()},
  }));
});

test("owner can resolve Home welcome but cannot reset it", {skip: !host}, async () => {
  await seedV2Guidance();
  const db = environment.authenticatedContext("player-1").firestore();
  const ref = doc(db, "users/player-1");
  await assertSucceeds(updateDoc(ref, {
    "onboarding.homeWelcome": {status: "dismissed", updatedAt: serverTimestamp()},
  }));
  await assertFails(updateDoc(ref, {
    "onboarding.homeWelcome": {status: "not_seen", updatedAt: serverTimestamp()},
  }));

  await seedV2Guidance();
  await assertSucceeds(updateDoc(ref, {
    "onboarding.homeWelcome": {status: "used_find_players", updatedAt: serverTimestamp()},
  }));
});

test("another user cannot update V2 guidance", {skip: !host}, async () => {
  await seedV2Guidance();
  const db = environment.authenticatedContext("player-2").firestore();
  await assertFails(updateDoc(doc(db, "users/player-1"), {
    "onboarding.matchIntro": {status: "completed", updatedAt: serverTimestamp()},
  }));
});

test("legacy activation-tour writes remain compatible and cannot mix with guidance", {skip: !host}, async () => {
  await seed("users/player-1", {
    onboarding: {
      activationTour: {status: "not_started", currentStep: "welcome"},
      checklist: {profileComplete: true},
    },
  });
  const db = environment.authenticatedContext("player-1").firestore();
  await assertSucceeds(updateDoc(doc(db, "users/player-1"), {
    "onboarding.activationTour": {status: "in_progress", currentStep: "profile"},
  }));

  await seedV2Guidance();
  await assertFails(updateDoc(doc(db, "users/player-1"), {
    "onboarding.activationTour": {status: "completed", currentStep: "completed"},
    "onboarding.matchIntro": {status: "completed", updatedAt: serverTimestamp()},
  }));
});
