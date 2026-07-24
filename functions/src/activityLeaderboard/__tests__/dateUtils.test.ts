/* eslint-disable max-len */
import assert from "node:assert/strict";
import test from "node:test";
import * as admin from "firebase-admin";
import {
  activityDateMonthDisagreement,
  monthKeyFor,
  parseActivityDate,
  weekKeyFor,
} from "../dateUtils";

test("parses Firestore Timestamp", () => {
  const timestamp = admin.firestore.Timestamp.fromDate(new Date("2026-07-01T00:00:00Z"));
  assert.equal(parseActivityDate(timestamp)?.toISOString(), "2026-07-01T00:00:00.000Z");
});

test("parses ISO datetime and rejects invalid input", () => {
  assert.equal(parseActivityDate("2026-07-01T12:30:00+10:00")?.toISOString(), "2026-07-01T02:30:00.000Z");
  assert.equal(parseActivityDate("not-a-date"), null);
});

test("interprets date-only values at Melbourne midnight", () => {
  assert.equal(parseActivityDate("2026-07-12", true)?.toISOString(), "2026-07-11T14:00:00.000Z");
});

test("derives month keys across month and year transitions", () => {
  assert.equal(monthKeyFor(new Date("2026-06-30T14:00:00Z")), "2026-07");
  assert.equal(monthKeyFor(new Date("2026-12-31T13:00:00Z")), "2027-01");
});

test("uses ISO Monday-to-Sunday week boundaries", () => {
  const monday = parseActivityDate("2026-07-13", true) as Date;
  const sunday = parseActivityDate("2026-07-19", true) as Date;
  const nextMonday = parseActivityDate("2026-07-20", true) as Date;
  assert.equal(weekKeyFor(monday), weekKeyFor(sunday));
  assert.notEqual(weekKeyFor(sunday), weekKeyFor(nextMonday));
});

test("uses ISO week-based year", () => {
  assert.equal(weekKeyFor(parseActivityDate("2021-01-01", true) as Date), "2020-W53");
});

test("handles Melbourne daylight-saving boundaries deterministically", () => {
  assert.equal(parseActivityDate("2026-04-05", true)?.toISOString(), "2026-04-04T13:00:00.000Z");
  assert.equal(parseActivityDate("2026-04-06", true)?.toISOString(), "2026-04-05T14:00:00.000Z");
  assert.equal(parseActivityDate("2026-10-04", true)?.toISOString(), "2026-10-03T14:00:00.000Z");
  assert.equal(parseActivityDate("2026-10-05", true)?.toISOString(), "2026-10-04T13:00:00.000Z");
});

test("detects played-date and completion-date month disagreement", () => {
  assert.deepEqual(
    activityDateMonthDisagreement(
      "2026-06-30",
      new Date("2026-07-01T02:00:00Z")
    ),
    {playedDateMonth: "2026-06", completedAtMonth: "2026-07"}
  );
  assert.equal(
    activityDateMonthDisagreement(
      "2026-07-01",
      new Date("2026-07-20T02:00:00Z")
    ),
    null
  );
});
