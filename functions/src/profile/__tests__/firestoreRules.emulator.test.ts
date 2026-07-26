/* eslint-disable max-len, brace-style, block-spacing */
import {after, before, beforeEach, test} from "node:test";
import {readFileSync} from "node:fs";
import {assertFails, assertSucceeds, initializeTestEnvironment, RulesTestEnvironment} from "@firebase/rules-unit-testing";
import {doc, getDoc, serverTimestamp, setDoc, updateDoc} from "firebase/firestore";
import {buildEditablePlayerProfileUpdate} from "../../../../lib/editablePlayerProfile.js";

const host = process.env.FIRESTORE_EMULATOR_HOST;
let environment: RulesTestEnvironment;
const PRODUCTION_COURT_ID = "clifton-hill-tennis-club-3068";
const PRODUCTION_COURT_NAME = "Clifton Hill Tennis Club";
type ClubFields = {
  clubId: string | null;
  clubName: string | null;
  clubStatus: "member" | "none" | null;
};

const exactProfilePayload = (club: ClubFields = {clubId: null, clubName: null, clubStatus: null}) => buildEditablePlayerProfileUpdate({
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
  ...club,
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

async function seedCourt(id: string, data: Record<string, unknown>) {
  await environment.withSecurityRulesDisabled(async (context) => {
    await setDoc(doc(context.firestore(), "courts", id), data);
  });
}

test("normal profile update succeeds when a legacy profile has no club fields", {skip: !host}, async () => {
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

test("owner can save a valid production-shaped court membership", {skip: !host}, async () => {
  await seedPlayer("owner", {name: "Owner", clubId: null, clubName: null, clubStatus: "none"});
  await seedCourt(PRODUCTION_COURT_ID, {
    name: PRODUCTION_COURT_NAME,
    suburb: "Clifton Hill",
    postcode: "3068",
  });
  const db = environment.authenticatedContext("owner").firestore();
  await assertSucceeds(setDoc(doc(db, "players", "owner"), exactProfilePayload({
    clubId: PRODUCTION_COURT_ID,
    clubName: PRODUCTION_COURT_NAME,
    clubStatus: "member",
  }), {merge: true}));
});

test("valid membership save succeeds on a legacy player without club fields", {skip: !host}, async () => {
  await seedPlayer("owner", {name: "Legacy Owner", email: "legacy@example.test"});
  await seedCourt(PRODUCTION_COURT_ID, {name: PRODUCTION_COURT_NAME, suburb: "Clifton Hill", postcode: "3068"});
  const db = environment.authenticatedContext("owner").firestore();
  await assertSucceeds(setDoc(doc(db, "players", "owner"), exactProfilePayload({
    clubId: PRODUCTION_COURT_ID,
    clubName: PRODUCTION_COURT_NAME,
    clubStatus: "member",
  }), {merge: true}));
});

test("nonexistent court ID is rejected", {skip: !host}, async () => {
  await seedPlayer("owner", {name: "Owner"});
  const db = environment.authenticatedContext("owner").firestore();
  await assertFails(updateDoc(doc(db, "players", "owner"), {
    clubId: "missing-court",
    clubName: "Invented Club",
    clubStatus: "member",
  }));
});

test("valid court ID with an altered canonical name is rejected", {skip: !host}, async () => {
  await seedPlayer("owner", {name: "Owner"});
  await seedCourt(PRODUCTION_COURT_ID, {name: PRODUCTION_COURT_NAME, suburb: "Clifton Hill", postcode: "3068"});
  const db = environment.authenticatedContext("owner").firestore();
  await assertFails(updateDoc(doc(db, "players", "owner"), {
    clubId: PRODUCTION_COURT_ID,
    clubName: `${PRODUCTION_COURT_NAME} `,
    clubStatus: "member",
  }));
});

test("none with null club fields succeeds", {skip: !host}, async () => {
  await seedPlayer("owner", {name: "Owner"});
  const db = environment.authenticatedContext("owner").firestore();
  await assertSucceeds(updateDoc(doc(db, "players", "owner"), {
    clubId: null,
    clubName: null,
    clubStatus: "none",
  }));
});

test("another user cannot update club membership", {skip: !host}, async () => {
  await seedPlayer("other", {name: "Other Player"});
  await seedCourt(PRODUCTION_COURT_ID, {name: PRODUCTION_COURT_NAME, suburb: "Clifton Hill", postcode: "3068"});
  const db = environment.authenticatedContext("owner").firestore();
  await assertFails(updateDoc(doc(db, "players", "other"), {
    clubId: PRODUCTION_COURT_ID,
    clubName: PRODUCTION_COURT_NAME,
    clubStatus: "member",
  }));
});

test("normal profile update preserving valid membership succeeds", {skip: !host}, async () => {
  await seedCourt(PRODUCTION_COURT_ID, {name: PRODUCTION_COURT_NAME, suburb: "Clifton Hill", postcode: "3068"});
  await seedPlayer("owner", {
    name: "Owner",
    clubId: PRODUCTION_COURT_ID,
    clubName: PRODUCTION_COURT_NAME,
    clubStatus: "member",
  });
  const db = environment.authenticatedContext("owner").firestore();
  await assertSucceeds(updateDoc(doc(db, "players", "owner"), {bio: "Updated bio"}));
});

test("club requests are authenticated create-only and bound to the submitter", {skip: !host}, async () => {
  const ownerDb = environment.authenticatedContext("owner").firestore();
  const otherDb = environment.authenticatedContext("other").firestore();
  const requestRef = doc(ownerDb, "clubRequests", "request-one");

  await assertSucceeds(setDoc(requestRef, {
    clubName: "Example Tennis Club",
    suburb: "Example",
    submittedBy: "owner",
    submittedAt: serverTimestamp(),
    status: "pending",
  }));
  await assertFails(updateDoc(requestRef, {status: "approved"}));
  await assertFails(setDoc(doc(otherDb, "clubRequests", "request-two"), {
    clubName: "Example Tennis Club",
    suburb: "Example",
    submittedBy: "owner",
    submittedAt: serverTimestamp(),
    status: "pending",
  }));
});
