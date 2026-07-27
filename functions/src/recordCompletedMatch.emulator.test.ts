/* eslint-disable max-len */
import assert from "node:assert/strict";
import {after, beforeEach, test} from "node:test";
import * as admin from "firebase-admin";
import {HttpsError} from "firebase-functions/v2/https";
import {recordCompletedMatchForUser, recordCompletedMatchHandler} from "./recordCompletedMatch";
import {normalizeMatchHistory} from "./activityLeaderboard/normalization";

if (!process.env.FIRESTORE_EMULATOR_HOST) throw new Error("FIRESTORE_EMULATOR_HOST is required; production fallback is forbidden");
const app = admin.initializeApp({projectId: "demo-tennismate-record-match"}, `record-match-${Date.now()}`);
const db = app.firestore();
async function clear() { for (const collection of await db.listCollections()) await db.recursiveDelete(collection); }
async function seedPlayers() { await Promise.all([db.doc("players/a").set({name: "Alex"}), db.doc("players/b").set({name: "Blair"})]); }
async function seedRequest(id: string, status = "accepted") { await seedPlayers(); await db.doc(`match_requests/${id}`).set({fromUserId: "a", toUserId: "b", status}); }
async function seedChat(id: string) { await seedPlayers(); await db.doc(`conversations/${id}`).set({participants: ["a", "b"], matchIntentAt: admin.firestore.Timestamp.now(), matchCheckInResolved: false, matchCheckInSuppressed: false}); await db.doc(`conversations/${id}/messages/a`).set({senderId: "a", type: "text", timestamp: admin.firestore.Timestamp.now()}); await db.doc(`conversations/${id}/messages/b`).set({senderId: "b", type: "text", timestamp: admin.firestore.Timestamp.now()}); }
beforeEach(clear);
after(async () => {await clear(); await app.delete();});

test("invalid input and unauthorised invite completion fail safely", async () => {
  await assert.rejects(() => recordCompletedMatchHandler({data: {}, auth: undefined} as never), (error: unknown) => error instanceof HttpsError && error.code === "unauthenticated");
  await assert.rejects(() => recordCompletedMatchForUser(db, "a", {mode: "unknown"}), (error: unknown) => error instanceof HttpsError && error.code === "invalid-argument");
  await seedRequest("accepted");
  await assert.rejects(() => recordCompletedMatchForUser(db, "outsider", {mode: "invite", sourceType: "match_request", sourceId: "accepted", result: {outcome: "played"}}), (error: unknown) => error instanceof HttpsError && error.code === "permission-denied");
  await seedRequest("pending", "pending");
  await assert.rejects(() => recordCompletedMatchForUser(db, "a", {mode: "invite", sourceType: "match_request", sourceId: "pending", result: {outcome: "played"}}), (error: unknown) => error instanceof HttpsError && error.code === "failed-precondition");
});

test("accepted invite derives participants, accepts an optional score and is idempotent", async () => {
  await seedRequest("request");
  const input = {mode: "invite" as const, sourceType: "match_request" as const, sourceId: "request", result: {outcome: "played" as const, score: "6-4", sets: [{A: 6, B: 4}], winnerId: "a"}};
  const [first, second] = await Promise.all([recordCompletedMatchForUser(db, "a", input), recordCompletedMatchForUser(db, "b", input)]);
  assert.equal([first, second].filter((result) => result.recorded).length, 1);
  assert.equal((await db.collection("match_history").get()).size, 1);
  const history = (await db.doc("match_history/request").get()).data();
  assert.deepEqual(history?.players, ["a", "b"]); assert.equal(history?.completed, true); assert.equal(history?.score, "6-4");
  const normalized = normalizeMatchHistory("request", history || {});
  assert.equal(normalized.eligibleForScoring, true); assert.deepEqual(normalized.participantIds, ["a", "b"]);
  await assert.rejects(() => recordCompletedMatchForUser(db, "a", {...input, sourceId: "request", result: {...input.result, winnerId: "outsider"}}), (error: unknown) => error instanceof HttpsError && error.code === "invalid-argument");
});

test("accepted match_invite preserves authoritative invite provenance", async () => {
  await seedPlayers();
  await db.doc("match_invites/invite-source").set({fromUserId: "a", toUserId: "b", participants: ["a", "b"], inviteStatus: "accepted", conversationId: "conversation", invite: {startISO: "2026-07-20T01:00:00.000Z", location: "Community Courts", court: {id: "court-1", name: "Community Courts"}}});
  const recorded = await recordCompletedMatchForUser(db, "b", {mode: "invite", sourceType: "match_invite", sourceId: "invite-source", result: {outcome: "played"}});
  const history = (await db.doc(`match_history/${recorded.historyId}`).get()).data();
  assert.equal(history?.inviteId, "invite-source"); assert.equal(history?.conversationId, "conversation"); assert.equal(history?.playedDate, "2026-07-20"); assert.equal(history?.court?.id, "court-1");
  assert.equal((await db.doc("match_invites/invite-source").get()).data()?.inviteStatus, "completed");
});

test("chat check-in derives the opponent and records played or not-played once", async () => {
  await seedChat("played");
  const played = await recordCompletedMatchForUser(db, "a", {mode: "chat_check_in", conversationId: "played", result: {outcome: "played", playedDate: "2026-07-20"}});
  const history = (await db.doc(`match_history/${played.historyId}`).get()).data();
  assert.deepEqual(history?.players, ["a", "b"]); assert.equal(history?.completed, true); assert.equal(history?.score, "");
  await seedChat("not-played");
  const notPlayed = await recordCompletedMatchForUser(db, "b", {mode: "chat_check_in", conversationId: "not-played", result: {outcome: "not_played"}});
  const notPlayedHistory = (await db.doc(`match_history/${notPlayed.historyId}`).get()).data();
  assert.equal(notPlayedHistory?.status, "not_played");
  assert.equal(normalizeMatchHistory(notPlayed.historyId, notPlayedHistory || {}).eligibleForScoring, false);
});

test("chat exclusions reject outsiders, accepted invites, suppression and existing history", async () => {
  await seedChat("outsider");
  await assert.rejects(() => recordCompletedMatchForUser(db, "outsider", {mode: "chat_check_in", conversationId: "outsider", result: {outcome: "not_played"}}), (error: unknown) => error instanceof HttpsError && error.code === "permission-denied");
  await seedChat("invite"); await db.doc("match_invites/invite").set({conversationId: "invite", inviteStatus: "accepted", participants: ["a", "b"]});
  await assert.rejects(() => recordCompletedMatchForUser(db, "a", {mode: "chat_check_in", conversationId: "invite", result: {outcome: "not_played"}}), (error: unknown) => error instanceof HttpsError && error.code === "failed-precondition");
  await seedChat("suppressed"); await db.doc("conversations/suppressed").update({matchCheckInSuppressed: true});
  await assert.rejects(() => recordCompletedMatchForUser(db, "a", {mode: "chat_check_in", conversationId: "suppressed", result: {outcome: "not_played"}}));
  await seedChat("existing"); await db.doc("match_history/legacy").set({conversationId: "existing", players: ["a", "b"], outcome: "played"});
  await assert.rejects(() => recordCompletedMatchForUser(db, "a", {mode: "chat_check_in", conversationId: "existing", result: {outcome: "not_played"}}), (error: unknown) => error instanceof HttpsError && error.code === "already-exists");
});
