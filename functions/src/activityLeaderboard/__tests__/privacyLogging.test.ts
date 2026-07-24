/* eslint-disable max-len */
import assert from "node:assert/strict";
import test from "node:test";
import {activityPersistenceLog, privacySafeRefHash} from "../privacyLogging";

test("privacy hashes are deterministic, truncated, and one-way in logs", () => {
  const rawSource = "raw-source-id"; const rawEvent = "raw-event-id"; assert.equal(privacySafeRefHash(rawSource), privacySafeRefHash(rawSource)); assert.equal(privacySafeRefHash(rawSource)?.length, 16); assert.notEqual(privacySafeRefHash(rawSource), rawSource);
  const payload = activityPersistenceLog({operation: "create", sourceDocumentId: rawSource, canonicalEventId: rawEvent, duplicateGroupKey: "group", resolutionSource: "none", oldMonthKey: null, newMonthKey: "2026-07", collision: false, dirtyMonthCount: 1}); const serialized = JSON.stringify(payload);
  assert.equal(serialized.includes(rawSource), false); assert.equal(serialized.includes(rawEvent), false); assert.deepEqual(Object.keys(payload).sort(), ["collision", "dirtyMonthCount", "duplicateGroupRefHash", "eventRefHash", "newMonthKey", "oldMonthKey", "operation", "resolutionSource", "sourceRefHash"]);
});
