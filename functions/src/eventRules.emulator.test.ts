/* eslint-disable max-len */
import {after, before, beforeEach, test} from "node:test";
import {readFileSync} from "node:fs";
import assert from "node:assert/strict";
import {
  RulesTestEnvironment,
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
} from "@firebase/rules-unit-testing";
import {doc, setDoc, updateDoc} from "firebase/firestore";

const host = process.env.FIRESTORE_EMULATOR_HOST;
let environment: RulesTestEnvironment;

before(async () => {
  if (!host) return;
  const [hostname, port] = host.split(":");
  environment = await initializeTestEnvironment({
    projectId: "demo-tennismate-event-duration",
    firestore: {
      host: hostname,
      port: Number(port),
      rules: readFileSync(`${process.cwd()}/../firestore.rules`, "utf8"),
    },
  });
});

beforeEach(async () => {
  if (environment) await environment.clearFirestore();
});

after(async () => {
  if (environment) await environment.cleanup();
});

const event = (durationMinutes: number, durationMins = durationMinutes) => ({
  hostId: "host",
  title: "Rules test event",
  start: "2026-08-01T00:00:00.000Z",
  end: "2026-08-01T01:30:00.000Z",
  durationMinutes,
  durationMins,
  participants: [],
  status: "open",
});

test("event creation accepts only supported canonical durations", {skip: !host}, async () => {
  const db = environment.authenticatedContext("host").firestore();
  await assertSucceeds(setDoc(doc(db, "events", "valid"), event(90)));
  await assertFails(setDoc(doc(db, "events", "unsupported"), event(45)));
  await assertFails(setDoc(doc(db, "events", "mismatch"), event(90, 60)));
});

test("legacy events remain updatable without silently changing duration", {skip: !host}, async () => {
  await environment.withSecurityRulesDisabled(async (context) => {
    await setDoc(doc(context.firestore(), "events", "legacy"), {
      hostId: "host",
      durationMins: 90,
      status: "open",
    });
  });
  const hostDb = environment.authenticatedContext("host").firestore();
  await assertSucceeds(updateDoc(doc(hostDb, "events", "legacy"), {status: "cancelled"}));
  await assertFails(updateDoc(doc(hostDb, "events", "legacy"), {durationMins: 45}));
});

test("duration validation does not broaden event editing permissions", {skip: !host}, async () => {
  await environment.withSecurityRulesDisabled(async (context) => {
    await setDoc(doc(context.firestore(), "events", "host-only"), event(90));
  });
  const outsiderDb = environment.authenticatedContext("outsider").firestore();
  await assertFails(updateDoc(doc(outsiderDb, "events", "host-only"), {
    durationMinutes: 60,
    durationMins: 60,
  }));
  assert.ok(true);
});
