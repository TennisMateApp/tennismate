/* eslint-disable require-jsdoc, max-len */
import * as admin from "firebase-admin";
import {createHash} from "node:crypto";
import {onSchedule} from "firebase-functions/v2/scheduler";

if (admin.apps.length === 0) {
  admin.initializeApp();
}

const db = admin.firestore();

export const EVENT_REMINDER_TIME_ZONE = "Australia/Melbourne";

const ONE_HOUR_MS = 60 * 60 * 1000;
const ONE_DAY_MS = 24 * ONE_HOUR_MS;
export const EVENT_REMINDER_24H_CATCH_UP_MS = 6 * ONE_HOUR_MS;

export type EventReminderType = "24h" | "1h";

export type EventReminderSource = {
  title?: unknown;
  start?: unknown;
  timeZone?: unknown;
  timezone?: unknown;
  status?: unknown;
  participants?: unknown;
};

export type EventReminderContent = {
  title: string;
  body: string;
};

export function buildEventReminderNotification(
  eventId: string,
  participantId: string,
  type: EventReminderType,
  expectedStart: string,
  content: EventReminderContent,
  timeZone: string
) {
  return {
    recipientId: participantId,
    type: "event_reminder",
    reminderType: type,
    eventId,
    title: content.title,
    body: content.body,
    message: content.body,
    route: `/events/${eventId}`,
    read: false,
    source: "event_reminder_scheduler",
    scheduledStart: expectedStart,
    timeZone,
  };
}

function validTimeZone(value: unknown): value is string {
  if (typeof value !== "string" || !value.trim()) return false;
  try {
    new Intl.DateTimeFormat("en-AU", {timeZone: value}).format(new Date());
    return true;
  } catch {
    return false;
  }
}

export function resolveEventTimeZone(event: EventReminderSource): string {
  if (validTimeZone(event.timeZone)) return event.timeZone;
  if (validTimeZone(event.timezone)) return event.timezone;
  return EVENT_REMINDER_TIME_ZONE;
}

export function activeEventParticipantIds(event: EventReminderSource): string[] {
  // `events.participants` is the application's canonical accepted/current set.
  // Pending/declined/left workflow state lives in join_requests and a user is
  // removed from this array before a leave is recorded there.
  if (!Array.isArray(event.participants)) return [];
  return Array.from(new Set(event.participants.filter(
    (value): value is string => typeof value === "string" && value.length > 0
  )));
}

export function dueEventReminderTypes(
  startMs: number,
  nowMs: number
): EventReminderType[] {
  if (!Number.isFinite(startMs) || !Number.isFinite(nowMs)) return [];
  if (nowMs >= startMs) return [];

  const oneHourDueAt = startMs - ONE_HOUR_MS;
  if (nowMs >= oneHourDueAt) return ["1h"];

  const oneDayDueAt = startMs - ONE_DAY_MS;
  if (
    nowMs >= oneDayDueAt &&
    nowMs < oneDayDueAt + EVENT_REMINDER_24H_CATCH_UP_MS
  ) return ["24h"];

  return [];
}

function formatStartTime(startMs: number, timeZone: string): string {
  return new Intl.DateTimeFormat("en-AU", {
    timeZone,
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(startMs));
}

export function buildEventReminderContent(
  type: EventReminderType,
  eventName: string,
  startMs: number,
  timeZone: string
): EventReminderContent {
  const safeName = eventName.trim() || "Tennis Event";
  if (type === "24h") {
    return {
      title: "Tennis event tomorrow",
      body: `“${safeName}” starts tomorrow at ${formatStartTime(startMs, timeZone)}. Tap to view the event.`,
    };
  }
  return {
    title: "Tennis event starting soon",
    body: `“${safeName}” starts in 1 hour. Tap to view the event.`,
  };
}

export function eventReminderDeliveryKey(
  eventId: string,
  participantId: string,
  type: EventReminderType,
  startMs: number
): string {
  const identityHash = createHash("sha256")
    .update(`${eventId}\u0000${participantId}\u0000${type}\u0000${startMs}`)
    .digest("hex")
    .slice(0, 32);
  return `${eventId}_${type}_${startMs}_${identityHash}`;
}

export function isEventActive(event: EventReminderSource): boolean {
  return event.status !== "cancelled" && event.status !== "completed";
}

export function isEventReminderStillValid(
  event: EventReminderSource | null | undefined,
  participantId: string,
  expectedStart: string
): boolean {
  return Boolean(
    event &&
    isEventActive(event) &&
    event.start === expectedStart &&
    activeEventParticipantIds(event).includes(participantId)
  );
}

async function queueReminder(
  eventId: string,
  participantId: string,
  type: EventReminderType,
  expectedStart: string,
  startMs: number,
  content: EventReminderContent,
  timeZone: string
): Promise<boolean> {
  const deliveryKey = eventReminderDeliveryKey(eventId, participantId, type, startMs);
  const deliveryRef = db.collection("event_reminder_deliveries").doc(deliveryKey);
  const notificationRef = db.collection("notifications").doc(`event_reminder_${deliveryKey}`);
  const eventRef = db.collection("events").doc(eventId);

  // Most catch-up scans encounter an already queued delivery. Avoid opening a
  // three-read transaction in that common case; the transaction remains the
  // authority for races between overlapping scheduler executions.
  if ((await deliveryRef.get()).exists) return false;

  return db.runTransaction(async (transaction) => {
    const [currentEventSnap, deliverySnap, notificationSnap] = await Promise.all([
      transaction.get(eventRef),
      transaction.get(deliveryRef),
      transaction.get(notificationRef),
    ]);

    if (!currentEventSnap.exists || deliverySnap.exists || notificationSnap.exists) {
      return false;
    }

    const currentEvent = currentEventSnap.data() as EventReminderSource;
    if (!isEventReminderStillValid(currentEvent, participantId, expectedStart)) {
      return false;
    }

    const timestamp = admin.firestore.FieldValue.serverTimestamp();
    transaction.create(deliveryRef, {
      eventId,
      participantId,
      reminderType: type,
      scheduledStart: expectedStart,
      dueAt: admin.firestore.Timestamp.fromMillis(
        startMs - (type === "24h" ? ONE_DAY_MS : ONE_HOUR_MS)
      ),
      status: "queued",
      createdAt: timestamp,
    });
    transaction.create(notificationRef, {
      ...buildEventReminderNotification(
        eventId,
        participantId,
        type,
        expectedStart,
        content,
        timeZone
      ),
      timestamp,
      createdAt: timestamp,
    });
    return true;
  });
}

/**
 * Runs every minute. A 24-hour reminder may catch up for six hours after its
 * due time. The 1-hour reminder may catch up until (but never at/after) event
 * start. These non-overlapping windows prevent both reminders being queued by
 * one delayed run. Deterministic transactions handle retries and overlap.
 */
export const sendEventRemindersV2 = onSchedule(
  {
    schedule: "every 1 minutes",
    timeZone: EVENT_REMINDER_TIME_ZONE,
    region: "australia-southeast1",
    memory: "256MiB",
  },
  async () => {
    const nowMs = Date.now();
    const dueSnapshots = await Promise.all([
      db.collection("events")
        .where(
          "start",
          ">=",
          new Date(nowMs + ONE_DAY_MS - EVENT_REMINDER_24H_CATCH_UP_MS).toISOString()
        )
        .where("start", "<", new Date(nowMs + ONE_DAY_MS + 1000).toISOString())
        .get(),
      db.collection("events")
        .where("start", ">", new Date(nowMs).toISOString())
        .where("start", "<", new Date(nowMs + ONE_HOUR_MS + 1000).toISOString())
        .get(),
    ]);
    const eventDocs = Array.from(new Map(
      dueSnapshots.flatMap((snapshot) => snapshot.docs)
        .map((eventDoc) => [eventDoc.id, eventDoc])
    ).values());

    let queued = 0;
    let eligible = 0;
    let skipped = 0;

    for (const eventSnap of eventDocs) {
      const event = eventSnap.data() as EventReminderSource;
      if (!isEventActive(event) || typeof event.start !== "string") continue;

      const startMs = Date.parse(event.start);
      if (!Number.isFinite(startMs)) continue;
      const reminderTypes = dueEventReminderTypes(startMs, nowMs);
      if (!reminderTypes.length) continue;

      const participants = activeEventParticipantIds(event);
      const timeZone = resolveEventTimeZone(event);
      const eventName = typeof event.title === "string" ? event.title : "Tennis Event";

      for (const type of reminderTypes) {
        const content = buildEventReminderContent(type, eventName, startMs, timeZone);
        for (const participantId of participants) {
          eligible += 1;
          try {
            if (await queueReminder(
              eventSnap.id,
              participantId,
              type,
              event.start,
              startMs,
              content,
              timeZone
            )) {
              queued += 1;
            } else {
              skipped += 1;
            }
          } catch (error) {
            console.error("[EventReminder] queue failed", {
              eventId: eventSnap.id,
              reminderType: type,
              error: error instanceof Error ? error.message : "unknown_error",
            });
          }
        }
      }
    }

    console.log("[EventReminder] run complete", {
      scannedEvents: eventDocs.length,
      eligibleDeliveries: eligible,
      queuedDeliveries: queued,
      skippedDeliveries: skipped,
    });
  }
);
