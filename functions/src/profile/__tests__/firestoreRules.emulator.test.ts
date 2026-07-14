/* eslint-disable max-len, brace-style, block-spacing */
import {after, before, beforeEach, test} from "node:test";
import {readFileSync} from "node:fs";
import {assertFails, assertSucceeds, initializeTestEnvironment, RulesTestEnvironment} from "@firebase/rules-unit-testing";
import {doc, getDoc, serverTimestamp, setDoc, updateDoc} from "firebase/firestore";
import {buildEditablePlayerProfileUpdate} from "../../../../lib/editablePlayerProfile.js";

const host = process.env.FIRESTORE_EMULATOR_HOST;
let environment: RulesTestEnvironment;

const exactProfilePayload = () => buildEditablePlayerProfileUpdate({
  name: "Current Player",
  postcode: "3000",
  bio: "Available for social tennis.",
  availability: ["Weekends AM"],
  gender: "female",
  isMatchable: true,
  skillBand: "intermediate",
  skillBandLabel: "Intermediate",
  skillRating: 5.5,
  skillLevel: "Intermediate",
  photoURL: "https://example.test/profile.jpg",
  photoThumbURL: "https://example.test/profile-thumb.jpg",
});

before(async () => {
  if (!host) return;
  const [hostname, port] = host.split(":");
  environment = await initializeTestEnvironment({
    projectId: "demo-tennismate",
    firestore: {
      host: hostname,
      port: Number(port),
      rules: readFileSync(`${process.cwd()}/../firestore.rules`, "utf8"),
    },
  });
});

beforeEach(async () => { if (environment) await environment.clearFirestore(); });
after(async () => { if (environment) await environment.cleanup(); });

async function seedPlayer(uid: string, data: Record<string, unknown>) {
  await environment.withSecurityRulesDisabled(async (context) => {
    await setDoc(doc(context.firestore(), "players", uid), data);
  });
}

test("profile owner can update approved fields even when a legacy sensitive field exists", {skip: !host}, async () => {
  await seedPlayer("owner", {name: "Old Name", email: "legacy@example.test", activityPoints: 20});
  const db = environment.authenticatedContext("owner").firestore();
  await assertSucceeds(setDoc(doc(db, "players", "owner"), {name: "New Name", bio: "Updated"}, {merge: true}));
});

test("user cannot update another player's profile", {skip: !host}, async () => {
  await seedPlayer("other", {name: "Other Player"});
  const db = environment.authenticatedContext("owner").firestore();
  await assertFails(setDoc(doc(db, "players", "other"), {bio: "Not allowed"}, {merge: true}));
});

test("profile owner cannot modify protected fields", {skip: !host}, async () => {
  await seedPlayer("owner", {name: "Owner", activityPoints: 20, createdAt: "original"});
  const db = environment.authenticatedContext("owner").firestore();
  await assertFails(updateDoc(doc(db, "players", "owner"), {activityPoints: 999}));
  await assertFails(updateDoc(doc(db, "players", "owner"), {createdAt: serverTimestamp()}));
  await assertFails(updateDoc(doc(db, "players", "owner"), {geohash: "protected"}));
});

test("exact shared ProfileContent payload is accepted for an existing profile", {skip: !host}, async () => {
  await seedPlayer("owner", {name: "Old Name", email: "legacy@example.test"});
  const db = environment.authenticatedContext("owner").firestore();
  await assertSucceeds(setDoc(doc(db, "players", "owner"), exactProfilePayload(), {merge: true}));
});

test("first-time profile creation accepts editable fields and rejects protected fields", {skip: !host}, async () => {
  const db = environment.authenticatedContext("new-player").firestore();
  const ref = doc(db, "players", "new-player");
  await assertSucceeds(setDoc(ref, exactProfilePayload(), {merge: true}));
  await assertSucceeds(getDoc(ref));

  const protectedDb = environment.authenticatedContext("protected-player").firestore();
  await assertFails(setDoc(doc(protectedDb, "players", "protected-player"), {
    ...exactProfilePayload(),
    activityPoints: 999,
  }, {merge: true}));
});
