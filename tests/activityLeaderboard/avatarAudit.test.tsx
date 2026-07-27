import assert from "node:assert/strict";
import {test} from "node:test";
import {auditAvatarUrls, parseAvatarAuditOptions, probeAvatarUrl} from "../../scripts/activityLeaderboardAvatarAudit";

const response = (status: number) => async () => new Response(null, {status});

test("avatar audit distinguishes available, confirmed broken, and transient responses", async () => {
  assert.equal(await probeAvatarUrl("https://private.example/ok", response(200) as typeof fetch), "available");
  assert.equal(await probeAvatarUrl("https://private.example/missing", response(404) as typeof fetch), "broken");
  assert.equal(await probeAvatarUrl("https://private.example/gone", response(410) as typeof fetch), "broken");
  assert.equal(await probeAvatarUrl("https://private.example/error", response(503) as typeof fetch), "transient");
  assert.equal(await probeAvatarUrl("https://private.example/network", (async () => { throw new Error("network"); }) as typeof fetch), "transient");
});

test("avatar audit recommends regeneration only for confirmed broken avatars", async () => {
  const statuses = [200, 404, 503];
  let index = 0;
  const report = await auditAvatarUrls(
    {month: "2026-07", rowCount: 4, avatarUrls: ["secret-a", "secret-b", "secret-c"]},
    {concurrency: 2, fetcher: (async () => new Response(null, {status: statuses[index++]})) as typeof fetch},
  );
  assert.deepEqual(report, {month: "2026-07", rowsChecked: 4, nonEmptyAvatarsChecked: 3, brokenAvatars: 1, transientFailures: 1, regenerationRecommended: true});
  const serialized = JSON.stringify(report);
  assert.doesNotMatch(serialized, /secret-a|secret-b|secret-c|playerId|displayName|avatarUrl|token/i);
});

test("avatar audit is read-only by contract and validates month input", () => {
  assert.deepEqual(parseAvatarAuditOptions(["--month=2026-07", "--output", "report.json"]), {month: "2026-07", output: "report.json"});
  assert.deepEqual(parseAvatarAuditOptions([], {npm_config_month: "2026-07", npm_config_output: "report.json"}), {month: "2026-07", output: "report.json"});
  assert.throws(() => parseAvatarAuditOptions(["--month", "July"]), /YYYY-MM/);
  const source = require("node:fs").readFileSync("scripts/activityLeaderboardAvatarAudit.ts", "utf8");
  assert.doesNotMatch(source, /\.set\(|\.update\(|\.delete\(|writeBatch|runTransaction/);
});
