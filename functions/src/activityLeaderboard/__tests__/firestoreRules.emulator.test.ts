/* eslint-disable max-len, brace-style, block-spacing */
import assert from "node:assert/strict";
import {after, before, beforeEach, test} from "node:test";
import {readFileSync} from "node:fs";
import {assertFails, assertSucceeds, initializeTestEnvironment, RulesTestEnvironment} from "@firebase/rules-unit-testing";
import {doc, getDoc, setDoc, updateDoc} from "firebase/firestore";

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

test("match history is trusted-write-only and post-creation updates are narrow", {skip: !host}, async () => {
  const trustedPayload = {players: ["player-a", "player-b"], fromUserId: "player-a", toUserId: "player-b", completed: true, status: "completed", outcome: "played", completedFrom: "invite", matchRequestId: "request", playedDate: "2026-07-20", score: "6-4", sets: [{A: 6, B: 4}], winnerId: "player-a"};
  await environment.withSecurityRulesDisabled(async (adminContext) => setDoc(doc(adminContext.firestore(), "match_history/history"), trustedPayload));
  const participant = environment.authenticatedContext("player-a").firestore();
  const outsider = environment.authenticatedContext("outsider").firestore();
  await assertFails(setDoc(doc(participant, "match_history/forged"), trustedPayload));
  await assertFails(setDoc(doc(participant, "match_history/not-played"), {...trustedPayload, completed: false, status: "not_played", outcome: "not_played"}));
  await assertSucceeds(getDoc(doc(participant, "match_history/history")));
  await assertSucceeds(updateDoc(doc(participant, "match_history/history"), {archivedBy: ["player-a"]}));
  await assertFails(updateDoc(doc(participant, "match_history/history"), {players: ["player-a", "outsider"]}));
  await assertFails(updateDoc(doc(participant, "match_history/history"), {matchRequestId: "other"}));
  await assertFails(updateDoc(doc(participant, "match_history/history"), {status: "not_played", completed: false}));
  await assertFails(updateDoc(doc(participant, "match_history/history"), {score: "6-0"}));
  await assertFails(updateDoc(doc(outsider, "match_history/history"), {archivedBy: ["outsider"]}));
});

test("only the recipient can establish accepted request and invite evidence", {skip: !host}, async () => {
  const sender = environment.authenticatedContext("sender").firestore();
  const recipient = environment.authenticatedContext("recipient").firestore();
  const requestRef = doc(sender, "match_requests/request");
  const inviteRef = doc(sender, "match_invites/invite");
  await assertFails(setDoc(requestRef, {fromUserId: "sender", toUserId: "recipient", status: "accepted"}));
  await assertSucceeds(setDoc(requestRef, {fromUserId: "sender", toUserId: "recipient", status: "pending"}));
  await assertFails(updateDoc(requestRef, {status: "accepted"}));
  await assertSucceeds(updateDoc(doc(recipient, "match_requests/request"), {status: "accepted"}));
  await assertFails(updateDoc(doc(recipient, "match_requests/request"), {status: "completed"}));
  await assertFails(setDoc(inviteRef, {fromUserId: "sender", toUserId: "recipient", participants: ["sender", "recipient"], inviteStatus: "accepted"}));
  await assertSucceeds(setDoc(inviteRef, {fromUserId: "sender", toUserId: "recipient", participants: ["sender", "recipient"], inviteStatus: "pending"}));
  await assertFails(updateDoc(inviteRef, {inviteStatus: "accepted"}));
  await assertSucceeds(updateDoc(doc(recipient, "match_invites/invite"), {inviteStatus: "accepted"}));
  await assertFails(updateDoc(doc(recipient, "match_invites/invite"), {inviteStatus: "completed"}));
});
