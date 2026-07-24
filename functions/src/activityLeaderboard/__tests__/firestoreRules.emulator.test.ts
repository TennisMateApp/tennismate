/* eslint-disable max-len, brace-style, block-spacing */
import assert from "node:assert/strict";
import {after, before, beforeEach, test} from "node:test";
import {readFileSync} from "node:fs";
import {assertFails, assertSucceeds, initializeTestEnvironment, RulesTestEnvironment} from "@firebase/rules-unit-testing";
import {doc, getDoc, setDoc} from "firebase/firestore";

const host = process.env.FIRESTORE_EMULATOR_HOST;
let environment: RulesTestEnvironment;

before(async () => {
  if (!host) return;
  const [hostname, port] = host.split(":");
  environment = await initializeTestEnvironment({projectId: "demo-tennismate", firestore: {host: hostname, port: Number(port), rules: readFileSync(`${process.cwd()}/../firestore.rules`, "utf8")}});
});
beforeEach(async () => { if (environment) await environment.clearFirestore(); });
after(async () => { if (environment) await environment.cleanup(); });

for (const authenticated of [false, true]) {
  test(`generated collections deny reads and writes (${authenticated ? "authenticated" : "unauthenticated"})`, {skip: !host}, async () => {
    const context = authenticated ? environment.authenticatedContext("test-user") : environment.unauthenticatedContext();
    const db = context.firestore();
    const paths = ["activity_match_events/event", "activity_recalculation_requests/2026-07", "activity_duplicate_reviews/group", "activity_duplicate_resolutions/group", "activity_backfill_runs/run", "activity_phase2_runs/run", "activity_months/2026-07", "activity_months/2026-07/players/user", "activity_leaderboards/board", "activity_leaderboards/board/rankings/user"];
    await environment.withSecurityRulesDisabled(async (adminContext) => {
      await Promise.all(paths.map((path) => setDoc(doc(adminContext.firestore(), path), {seeded: true})));
    });
    for (const path of paths) {
      await assertFails(getDoc(doc(db, path)));
      await assertFails(setDoc(doc(db, path), {clientWrite: true}));
    }
    assert.ok(true);
  });
}

test("only the signed-in current published ranking generation is readable", {skip: !host}, async () => {
  const month = "2026-07";
  await environment.withSecurityRulesDisabled(async (adminContext) => {
    const adminDb = adminContext.firestore();
    await setDoc(doc(adminDb, `activity_leaderboards/${month}`), {status: "published", publishedGenerationId: "current", visibility: "signed_in"});
    await setDoc(doc(adminDb, `activity_leaderboards/${month}/generations/current`), {status: "published", generationId: "current"});
    await setDoc(doc(adminDb, `activity_leaderboards/${month}/generations/current/rankings/player`), {playerId: "player", rank: 1, points: 15});
    await setDoc(doc(adminDb, `activity_leaderboards/${month}/generations/retired`), {status: "published", generationId: "retired"});
    await setDoc(doc(adminDb, `activity_leaderboards/${month}/generations/retired/rankings/player`), {playerId: "player", rank: 1, points: 15});
  });
  const signedIn = environment.authenticatedContext("test-user").firestore();
  const signedOut = environment.unauthenticatedContext().firestore();
  const currentGeneration = doc(signedIn, `activity_leaderboards/${month}/generations/current`);
  const currentRanking = doc(signedIn, `activity_leaderboards/${month}/generations/current/rankings/player`);
  await assertSucceeds(getDoc(doc(signedIn, `activity_leaderboards/${month}`)));
  await assertSucceeds(getDoc(currentGeneration));
  await assertSucceeds(getDoc(currentRanking));
  await assertFails(getDoc(doc(signedOut, `activity_leaderboards/${month}`)));
  await assertFails(getDoc(doc(signedOut, `activity_leaderboards/${month}/generations/current/rankings/player`)));
  await assertFails(getDoc(doc(signedIn, `activity_leaderboards/${month}/generations/retired`)));
  await assertFails(getDoc(doc(signedIn, `activity_leaderboards/${month}/generations/retired/rankings/player`)));
  await assertFails(setDoc(currentGeneration, {status: "published"}));
  await assertFails(setDoc(currentRanking, {rank: 2}));
});
