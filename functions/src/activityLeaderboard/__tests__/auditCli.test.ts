import assert from "node:assert/strict";
import test from "node:test";
import {
  expectedAuditArgumentsWereLost,
  parseActivityAuditOptions,
} from "../../../../scripts/activityLeaderboardAuditCli";

test("parses equals-form audit options", () => {
  assert.deepEqual(
    parseActivityAuditOptions([
      "--month=2026-07",
      "--limit=100",
      "--output=report.json",
    ]),
    {month: "2026-07", limit: 100, output: "report.json"}
  );
});

test("parses spaced audit options", () => {
  assert.deepEqual(
    parseActivityAuditOptions([
      "--month", "2026-07",
      "--limit", "100",
      "--output", "report.json",
    ]),
    {month: "2026-07", limit: 100, output: "report.json"}
  );
});

test("recovers options exposed by the PowerShell npm shim", () => {
  assert.deepEqual(
    parseActivityAuditOptions([], {
      npm_config_month: "2026-07",
      npm_config_limit: "100",
      npm_config_output: "report.json",
    }),
    {month: "2026-07", limit: 100, output: "report.json"}
  );
});

test("explicit argv takes precedence over npm config values", () => {
  assert.deepEqual(
    parseActivityAuditOptions(["--month=2026-08"], {
      npm_config_month: "2026-07",
    }),
    {month: "2026-08", limit: null, output: null}
  );
});

test("rejects missing and invalid values", () => {
  assert.throws(
    () => parseActivityAuditOptions(["--month"]),
    /requires a value/
  );
  assert.throws(() => parseActivityAuditOptions(["--month=July"]), /YYYY-MM/);
  assert.throws(
    () => parseActivityAuditOptions(["--limit", "0"]),
    /positive integer/
  );
});

test("detects expected npm arguments lost before process argv", () => {
  assert.equal(
    expectedAuditArgumentsWereLost([], {
      npm_config_argv: "npm run audit -- --month=2026-07",
    }, {month: null, limit: null, output: null}),
    true
  );
  assert.equal(
    expectedAuditArgumentsWereLost(["--month=2026-07"], {
      npm_config_argv: "npm run audit -- --month=2026-07",
    }, {month: "2026-07", limit: null, output: null}),
    false
  );
  assert.equal(
    expectedAuditArgumentsWereLost(["2026-07"], {
      npm_config_month: "true",
    }, {month: null, limit: null, output: null}),
    true
  );
});
