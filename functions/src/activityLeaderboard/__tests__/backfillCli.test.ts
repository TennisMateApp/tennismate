/* eslint-disable max-len, brace-style, block-spacing */
import assert from "node:assert/strict";
import test from "node:test";
import {assertFreshChecksum, assertWriteSafeguards, parseActivityBackfillOptions, PRODUCTION_PROJECT_ID} from "../../../../scripts/activityLeaderboardBackfillCli";

test("preview is default and equals/spaced options are supported", () => {
  assert.equal(parseActivityBackfillOptions([]).write, false);
  assert.deepEqual(parseActivityBackfillOptions(["--month=2026-07", "--limit", "5", "--batch-size=10", "--resume-from", "cursor", "--output=x.json"]), {month: "2026-07", limit: 5, output: "x.json", resumeFrom: "cursor", batchSize: 10, write: false, reconcile: false, confirmProject: null, confirmChecksum: null});
});
test("PowerShell npm fallback only recovers value options", () => {
  const options = parseActivityBackfillOptions([], {npm_config_month: "2026-07", npm_config_batch_size: "9", npm_config_write: "true"}); assert.equal(options.month, "2026-07"); assert.equal(options.batchSize, 9); assert.equal(options.write, false);
  const stripped = parseActivityBackfillOptions(["2026-07", "report.json"], {npm_config_month: "true", npm_config_output: "true", npm_config_write: "true"}); assert.equal(stripped.month, "2026-07"); assert.equal(stripped.output, "report.json"); assert.equal(stripped.write, false);
});
test("write requires production project and checksum", () => {
  const base = parseActivityBackfillOptions(["--write"]); assert.throws(() => assertWriteSafeguards(base, PRODUCTION_PROJECT_ID), /confirm-project/);
  const project = parseActivityBackfillOptions(["--write", `--confirm-project=${PRODUCTION_PROJECT_ID}`]); assert.throws(() => assertWriteSafeguards(project, PRODUCTION_PROJECT_ID), /confirm-checksum/);
  const complete = parseActivityBackfillOptions(["--write", `--confirm-project=${PRODUCTION_PROJECT_ID}`, `--confirm-checksum=${"a".repeat(64)}`]); assert.throws(() => assertWriteSafeguards(complete, "wrong-project"), /Unsupported/); assert.throws(() => assertWriteSafeguards(complete, PRODUCTION_PROJECT_ID, {FIRESTORE_EMULATOR_HOST: "127.0.0.1:8080"}), /emulator/); assert.doesNotThrow(() => assertWriteSafeguards(complete, PRODUCTION_PROJECT_ID, {}));
});
test("unknown and ambiguous arguments fail closed", () => { assert.throws(() => parseActivityBackfillOptions(["write"]), /ambiguous/i); assert.throws(() => parseActivityBackfillOptions(["--non-interactive"]), /Unknown/); });
test("freshness checksum must match exactly", () => { assert.doesNotThrow(() => assertFreshChecksum("a".repeat(64), "a".repeat(64))); assert.throws(() => assertFreshChecksum("a".repeat(64), "b".repeat(64)), /freshness/); });
