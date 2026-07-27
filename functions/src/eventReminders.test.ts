/* eslint-disable require-jsdoc, max-len */
import assert from "node:assert/strict";
import test from "node:test";
import {
  EVENT_REMINDER_TIME_ZONE,
  activeEventParticipantIds,
  buildEventReminderContent,
  buildEventReminderNotification,
  dueEventReminderTypes,
  eventReminderDeliveryKey,
  isEventActive,
  isEventReminderStillValid,
  resolveEventTimeZone,
} from "./eventReminders";
import type {EventReminderSource} from "./eventReminders";

const START = Date.parse("2026-10-04T01:30:00.000Z");

test("24-hour and one-hour reminders become due at their exact boundaries", () => {
  assert.deepEqual(dueEventReminderTypes(START, START - 24 * 60 * 60 * 1000), ["24h"]);
  assert.deepEqual(dueEventReminderTypes(START, START - 60 * 60 * 1000), ["1h"]);
  assert.deepEqual(dueEventReminderTypes(START, START - 30 * 60 * 1000), ["1h"]);
  assert.deepEqual(dueEventReminderTypes(START, START - 24 * 60 * 60 * 1000 - 1), []);
});

test("24-hour reminders recover after scheduler delays", () => {
  const dueAt = START - 24 * 60 * 60 * 1000;
  assert.deepEqual(dueEventReminderTypes(START, dueAt + 2 * 60 * 1000), ["24h"]);
  assert.deepEqual(dueEventReminderTypes(START, dueAt + 10 * 60 * 1000), ["24h"]);
  assert.deepEqual(dueEventReminderTypes(START, dueAt + 30 * 60 * 1000), ["24h"]);
  assert.deepEqual(dueEventReminderTypes(START, dueAt + 2 * 60 * 60 * 1000), ["24h"]);
});

test("1-hour reminders recover until the event begins", () => {
  const dueAt = START - 60 * 60 * 1000;
  assert.deepEqual(dueEventReminderTypes(START, dueAt + 2 * 60 * 1000), ["1h"]);
  assert.deepEqual(dueEventReminderTypes(START, dueAt + 10 * 60 * 1000), ["1h"]);
  assert.deepEqual(dueEventReminderTypes(START, dueAt + 30 * 60 * 1000), ["1h"]);
  assert.deepEqual(dueEventReminderTypes(START, dueAt + 61 * 60 * 1000), []);
});

test("outdated reminders are not sent or combined after a long outage", () => {
  const dueAt = START - 24 * 60 * 60 * 1000;
  assert.deepEqual(dueEventReminderTypes(START, dueAt + 6 * 60 * 60 * 1000), []);
  assert.deepEqual(dueEventReminderTypes(START, START - 30 * 60 * 1000), ["1h"]);
  assert.deepEqual(dueEventReminderTypes(START, START + 1), []);
  assert.deepEqual(dueEventReminderTypes(START, START), []);
});

test("only unique explicit participants are recipients", () => {
  assert.deepEqual(
    activeEventParticipantIds({participants: ["member", "host", "member", null]}),
    ["member", "host"]
  );
  assert.deepEqual(activeEventParticipantIds({participants: []}), []);
});

test("join-request states do not override the canonical participant array", () => {
  const event: EventReminderSource & {
    hostId: string;
    invited: string[];
    joinRequests: Array<{userId: string; status: string}>;
  } = {
    hostId: "host",
    participants: ["accepted"],
    invited: ["invited"],
    joinRequests: [
      {userId: "pending", status: "pending"},
      {userId: "declined", status: "declined"},
      {userId: "left", status: "left"},
      {userId: "accepted", status: "accepted"},
    ],
  };
  assert.deepEqual(activeEventParticipantIds(event), ["accepted"]);
  assert.equal(activeEventParticipantIds(event).includes("host"), false);
  assert.deepEqual(activeEventParticipantIds({...event, participants: ["accepted", "host"]}), ["accepted", "host"]);
});

test("cancelled and completed events are not eligible", () => {
  assert.equal(isEventActive({status: "open"}), true);
  assert.equal(isEventActive({status: "cancelled"}), false);
  assert.equal(isEventActive({status: "completed"}), false);
});

test("push revalidation preserves valid in-app reminders independently of push state", () => {
  const start = new Date(START).toISOString();
  const validEvent = {status: "open", start, participants: ["member"]};
  assert.equal(isEventReminderStillValid(validEvent, "member", start), true);
  assert.equal(isEventReminderStillValid(validEvent, "missing", start), false);
  assert.equal(isEventReminderStillValid({...validEvent, participants: []}, "member", start), false);
  assert.equal(isEventReminderStillValid({...validEvent, status: "cancelled"}, "member", start), false);
  assert.equal(isEventReminderStillValid({...validEvent, start: "changed"}, "member", start), false);
  assert.equal(isEventReminderStillValid(null, "member", start), false);
});

test("delivery keys are deterministic per schedule, participant and reminder type", () => {
  const key = eventReminderDeliveryKey("event", "player", "24h", START);
  assert.equal(key, eventReminderDeliveryKey("event", "player", "24h", START));
  assert.equal(key.includes("player"), false);
  assert.notEqual(
    eventReminderDeliveryKey("event", "player", "24h", START),
    eventReminderDeliveryKey("event", "player", "1h", START)
  );
  assert.notEqual(
    eventReminderDeliveryKey("event", "player", "24h", START),
    eventReminderDeliveryKey("event", "player", "24h", START + 60_000)
  );
});

test("content uses the stored Melbourne timezone across a daylight-saving boundary", () => {
  const content = buildEventReminderContent(
    "24h",
    "Sunday Social",
    START,
    "Australia/Melbourne"
  );
  assert.equal(content.title, "Tennis event tomorrow");
  assert.match(content.body, /“Sunday Social” starts tomorrow at 12:30 pm\./);
  assert.equal(
    buildEventReminderContent("1h", "Sunday Social", START, "Australia/Melbourne").body,
    "“Sunday Social” starts in 1 hour. Tap to view the event."
  );
});

test("in-app notification payload uses the event deep link and reminder content", () => {
  const content = buildEventReminderContent("1h", "Club night", START, EVENT_REMINDER_TIME_ZONE);
  const notification = buildEventReminderNotification(
    "event-123",
    "player-123",
    "1h",
    new Date(START).toISOString(),
    content,
    EVENT_REMINDER_TIME_ZONE
  );
  assert.equal(notification.route, "/events/event-123");
  assert.equal(notification.type, "event_reminder");
  assert.equal(notification.read, false);
  assert.equal(notification.body, content.body);
});

test("invalid or missing timezone data falls back to Australia/Melbourne", () => {
  assert.equal(resolveEventTimeZone({}), EVENT_REMINDER_TIME_ZONE);
  assert.equal(resolveEventTimeZone({timeZone: "not/a-zone"}), EVENT_REMINDER_TIME_ZONE);
  assert.equal(resolveEventTimeZone({timeZone: "Australia/Perth"}), "Australia/Perth");
});
