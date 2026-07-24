/* eslint-disable max-len, require-jsdoc, brace-style, block-spacing */
import assert from "node:assert/strict";
import {after, beforeEach, test} from "node:test";
import {admin, FieldValue, Timestamp} from "../adminSdk";
import {normalizeAndPersistMatchHistoryWrite} from "../persistence";

if (!process.env.FIRESTORE_EMULATOR_HOST) throw new Error("FIRESTORE_EMULATOR_HOST is required; production fallback is forbidden");
const app = admin.initializeApp({projectId: "demo-tennismate-backfill"}, `backfill-${Date.now()}`); const db = app.firestore();
async function clear(): Promise<void> { for (const collection of await db.listCollections()) await db.recursiveDelete(collection); }
beforeEach(clear); after(async () => { await clear(); await app.delete(); });
const source = (date: string) => ({players: ["player-a", "player-b"], completed: true, playedDate: date});

test("simulated checkpoint advances only after persistence and resume is idempotent", async () => {
  const run = db.doc("activity_backfill_runs/test-run"); await run.create({status: "RUNNING", processedCount: 0, lastProcessedCursor: null});
  const records = [{id: "a", data: source("2026-07-01")}, {id: "b", data: source("2026-07-02")}];
  await normalizeAndPersistMatchHistoryWrite(db, {sourceDocumentId: records[0].id, before: null, after: records[0].data}); await run.update({processedCount: 1, lastProcessedCursor: "a"});
  assert.equal((await run.get()).data()?.lastProcessedCursor, "a"); assert.equal((await db.collection("activity_match_events").get()).size, 1);
  const firstDirty = (await db.doc("activity_recalculation_requests/2026-07").get()).data(); assert.ok(firstDirty?.requestedAt instanceof Timestamp); assert.ok(firstDirty?.updatedAt instanceof Timestamp); const requestedAt = firstDirty?.requestedAt.toMillis();
  const cursor = (await run.get()).data()?.lastProcessedCursor as string; for (const record of records.filter((item) => item.id.localeCompare(cursor) > 0)) { await normalizeAndPersistMatchHistoryWrite(db, {sourceDocumentId: record.id, before: null, after: record.data}); await run.update({processedCount: FieldValue.increment(1), lastProcessedCursor: record.id}); }
  assert.equal((await db.collection("activity_match_events").get()).size, 2); assert.equal((await run.get()).data()?.processedCount, 2);
  await normalizeAndPersistMatchHistoryWrite(db, {sourceDocumentId: "b", before: null, after: records[1].data}); assert.equal((await db.collection("activity_match_events").get()).size, 2); assert.equal((await db.doc("activity_recalculation_requests/2026-07").get()).data()?.requestedAt.toMillis(), requestedAt);
});

test("failed persistence does not advance checkpoint", async () => {
  const run = db.doc("activity_backfill_runs/failed-run"); await run.create({status: "RUNNING", processedCount: 0, lastProcessedCursor: null});
  await assert.rejects(() => normalizeAndPersistMatchHistoryWrite({runTransaction: async () => { throw new Error("transaction failed"); }} as never, {sourceDocumentId: "a", before: null, after: source("2026-07-01")}));
  assert.equal((await run.get()).data()?.lastProcessedCursor, null); assert.equal((await run.get()).data()?.processedCount, 0);
});
