import assert from "node:assert/strict";
import test from "node:test";
import {
  DEFAULT_EVENT_DURATION_MINUTES,
  calculateEventEnd,
  resolveEventDisplayDurationMinutes,
  resolveEventDurationMinutes,
  resolveEventEnd,
} from "../../lib/eventDuration";

test("new events default to 90 minutes", () => {
  assert.equal(resolveEventDurationMinutes({}), DEFAULT_EVENT_DURATION_MINUTES);
});

test("canonical duration is preferred over legacy timing fields", () => {
  assert.equal(
    resolveEventDurationMinutes({
      durationMinutes: 60,
      durationMins: 120,
      start: "2026-07-27T00:00:00.000Z",
      end: "2026-07-27T01:30:00.000Z",
    }),
    60
  );
});

test("legacy duration and stored start/end remain readable", () => {
  assert.equal(resolveEventDurationMinutes({ durationMins: 30 }), 30);
  assert.equal(
    resolveEventDurationMinutes({
      start: "2026-07-27T00:00:00.000Z",
      end: "2026-07-27T02:00:00.000Z",
    }),
    120
  );
});

test("legacy non-standard ranges remain accurate when displayed", () => {
  const legacy = {
    start: "2026-07-27T00:00:00.000Z",
    end: "2026-07-27T01:15:00.000Z",
  };
  assert.equal(resolveEventDisplayDurationMinutes(legacy), 75);
  assert.equal(resolveEventEnd(legacy)?.toISOString(), legacy.end);
});

test("unsupported or malformed legacy values fall back safely", () => {
  assert.equal(resolveEventDurationMinutes({ durationMinutes: 75 }), 90);
  assert.equal(
    resolveEventDurationMinutes({ start: "invalid", end: "also-invalid" }),
    90
  );
});

test("end time is calculated from start plus selected duration", () => {
  const start = new Date("2026-07-27T00:00:00.000Z");
  assert.equal(
    calculateEventEnd(start, 120).toISOString(),
    "2026-07-27T02:00:00.000Z"
  );
  assert.equal(
    resolveEventEnd({ start: start.toISOString(), durationMinutes: 30 })?.toISOString(),
    "2026-07-27T00:30:00.000Z"
  );
});
