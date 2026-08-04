import {after, before, beforeEach, test} from "node:test";
import {readFileSync} from "node:fs";
import {assertFails, assertSucceeds, initializeTestEnvironment, type RulesTestEnvironment} from "@firebase/rules-unit-testing";
import {collection, deleteDoc, doc, getDoc, getDocs, serverTimestamp, setDoc, updateDoc} from "firebase/firestore";

const host = process.env.FIRESTORE_EMULATOR_HOST;
const rulesFile = process.env.FIRESTORE_RULES_FILE || `${process.cwd()}/../firestore.rules`;
let environment: RulesTestEnvironment;

const responseId = "product-survey-2026-08_owner";
const validPayload = () => ({
  surveyId: "product-survey-2026-08", userId: "owner", userName: "Current Player", submittedAt: serverTimestamp(),
  playFrequency: "2_3_per_week", reasons: ["new_people"], reasonsOther: "",
  playedThroughTennisMate: "yes_once", matchBarriers: ["no_difficulty"], matchBarriersOther: "",
  favouriteFeature: "match_me", favouriteFeatureOther: "", desiredFeatures: ["player_stats"],
  desiredFeaturesOther: "", eventInterest: "yes", premiumPrice: "3_5_aud",
  premiumFeatures: ["advanced_stats"], premiumFeaturesOther: "", oneThingChange: "Scheduling",
  oneThingWell: "Player discovery",
});

before(async () => {
  if (!host) return;
  const [hostname, port] = host.split(":");
  environment = await initializeTestEnvironment({
    projectId: "demo-tennismate-survey",
    firestore: {host: hostname, port: Number(port), rules: readFileSync(rulesFile, "utf8")},
  });
});
beforeEach(async () => { if (environment) await environment.clearFirestore(); });
after(async () => { if (environment) await environment.cleanup(); });

test("authenticated owner can create and get an existing valid response", {skip: !host}, async () => {
  const db = environment.authenticatedContext("owner").firestore();
  const ref = doc(db, "surveyResponses", responseId);
  await assertSucceeds(setDoc(ref, validPayload()));
  const snapshot = await assertSucceeds(getDoc(ref));
  if (!snapshot.exists()) throw new Error("Expected the owner's survey response to exist");
});

test("authenticated owner can get their non-existent deterministic response", {skip: !host}, async () => {
  const db = environment.authenticatedContext("owner").firestore();
  const snapshot = await assertSucceeds(getDoc(doc(db, "surveyResponses", responseId)));
  if (snapshot.exists()) throw new Error("Expected a normal non-existing document snapshot");
});

test("user cannot get another user's response", {skip: !host}, async () => {
  const ownerDb = environment.authenticatedContext("owner").firestore();
  await assertSucceeds(setDoc(doc(ownerDb, "surveyResponses", responseId), validPayload()));
  const otherDb = environment.authenticatedContext("other").firestore();
  await assertFails(getDoc(doc(otherDb, "surveyResponses", responseId)));
});

test("users cannot list or query survey responses", {skip: !host}, async () => {
  const ownerDb = environment.authenticatedContext("owner").firestore();
  await assertFails(getDocs(collection(ownerDb, "surveyResponses")));
});

test("valid create still succeeds", {skip: !host}, async () => {
  const ownerDb = environment.authenticatedContext("owner").firestore();
  await assertSucceeds(setDoc(doc(ownerDb, "surveyResponses", responseId), validPayload()));
});

test("unauthenticated, spoofed, and invalid creates are rejected", {skip: !host}, async () => {
  const guestDb = environment.unauthenticatedContext().firestore();
  await assertFails(setDoc(doc(guestDb, "surveyResponses", responseId), validPayload()));
  const ownerDb = environment.authenticatedContext("owner").firestore();
  const otherDb = environment.authenticatedContext("other").firestore();
  await assertFails(setDoc(doc(otherDb, "surveyResponses", "product-survey-2026-08_other"), validPayload()));
  await assertFails(setDoc(doc(ownerDb, "surveyResponses", "product-survey-2026-08_other"), validPayload()));
  await assertFails(setDoc(doc(ownerDb, "surveyResponses", responseId), {...validPayload(), desiredFeatures: ["player_stats", "match_history", "achievements", "club_features"]}));
  await assertFails(setDoc(doc(ownerDb, "surveyResponses", responseId), {...validPayload(), matchBarriers: ["no_difficulty", "no_response"]}));
  await assertFails(setDoc(doc(ownerDb, "surveyResponses", responseId), {...validPayload(), premiumFeatures: ["none", "advanced_stats"]}));
});

test("updates remain denied", {skip: !host}, async () => {
  const ownerDb = environment.authenticatedContext("owner").firestore();
  const ref = doc(ownerDb, "surveyResponses", responseId);
  await assertSucceeds(setDoc(ref, validPayload()));
  await assertFails(updateDoc(ref, {oneThingWell: "Changed"}));
  await assertFails(setDoc(ref, validPayload()));
});

test("deletes remain denied", {skip: !host}, async () => {
  const ownerDb = environment.authenticatedContext("owner").firestore();
  const ref = doc(ownerDb, "surveyResponses", responseId);
  await assertSucceeds(setDoc(ref, validPayload()));
  await assertFails(deleteDoc(ref));
});

test("userName must be a bounded string", {skip: !host}, async () => {
  const db = environment.authenticatedContext("owner").firestore();
  await assertFails(setDoc(doc(db, "surveyResponses", responseId), {...validPayload(), userName: 42}));
  await assertFails(setDoc(doc(db, "surveyResponses", responseId), {...validPayload(), userName: "x".repeat(101)}));
  await assertSucceeds(setDoc(doc(db, "surveyResponses", responseId), {...validPayload(), userName: ""}));
});
