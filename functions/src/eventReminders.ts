// functions/src/eventReminders.ts
import * as admin from "firebase-admin";
import { onSchedule } from "firebase-functions/v2/scheduler";

// ✅ Ensure Admin is initialized using the SAME namespace
if (admin.apps.length === 0) {
  admin.initializeApp();
}

const db = admin.firestore();
const MAIL_COLLECTION = "mail";

// --- helpers ---
async function enqueueEmail(to: string, subject: string, html: string, text?: string) {
  await db.collection(MAIL_COLLECTION).add({
    to,
    message: {
      subject,
      html,
      text: text ?? html.replace(/<[^>]+>/g, " "),
    },
  });
}

async function getUserEmail(uid: string): Promise<string | null> {
  try {
    const u = await db.collection("users").doc(uid).get();
    const email = u.exists ? (u.get("email") as string | undefined) : undefined;
    if (email) return email;
  } catch {}
  try {
    const rec = await admin.auth().getUser(uid);
    return rec.email ?? null;
  } catch {
    return null;
  }
}

async function getPlayerName(uid: string): Promise<string> {
  try {
    const s = await db.collection("players").doc(uid).get();
    const n = s.exists ? (s.get("name") as string | undefined) : undefined;
    return n || "Player";
  } catch {
    return "Player";
  }
}

function fmt(dt: Date) {
  return dt.toLocaleString();
}

function withinWindow(targetMs: number, nowMs: number, windowMin: number, windowMax: number) {
  const delta = targetMs - nowMs;
  return delta >= windowMin && delta < windowMax;
}

/**
 * Runs hourly in australia-southeast1.
 * Sends event reminders 24h and 1h before start.
 * De-dupes via event_reminder_sends/{eventId}_{type}.
 */
export const sendEventRemindersV2 = onSchedule(
  {
    schedule: "every 60 minutes",
    timeZone: "Australia/Sydney",
    region: "australia-southeast1",
    memory: "256MiB",
  },
  async () => {
    const now = Date.now();
    console.log("⏰ Running sendEventReminders at", new Date(now).toISOString());

    const ONE_HOUR = 60 * 60 * 1000;
    const ONE_DAY = 24 * ONE_HOUR;
    const windowMin = 0;
    const windowMax = 70 * 60 * 1000;

    const upperBound = new Date(now + ONE_DAY + windowMax).toISOString();

    const q = await db
      .collection("events")
      .where("start", ">=", new Date(now).toISOString())
      .where("start", "<", upperBound)
      .get();

    if (q.empty) {
      console.log("No upcoming events in scan window.");
      return;
    }

    for (const docSnap of q.docs) {
      const eventId = docSnap.id;
      const d = docSnap.data() || {};
      const startISO = typeof d.start === "string" ? d.start : null;
      if (!startISO) continue;

      const title: string = d.title || "Tennis Event";
      const location: string | null = d.location || null;
      const hostId: string | null = d.hostId || null;
      const participants: string[] = Array.isArray(d.participants)
        ? d.participants.filter(Boolean)
        : [];

      const startMs = Date.parse(startISO);
      if (Number.isNaN(startMs)) continue;

      const is24h = withinWindow(startMs, now, ONE_DAY + windowMin, ONE_DAY + windowMax);
      const is1h = withinWindow(startMs, now, ONE_HOUR + windowMin, ONE_HOUR + windowMax);
      if (!is24h && !is1h) continue;

      const type = is24h ? "24h" : "1h";
      const logId = `${eventId}_${type}`;

      const logRef = db.collection("event_reminder_sends").doc(logId);
      const log = await logRef.get();
      if (log.exists) {
        console.log(`Skip duplicate ${type} reminder for event ${eventId}`);
        continue;
      }

      const recipientIds = new Set<string>();
      if (hostId) recipientIds.add(hostId);
      for (const uid of participants) recipientIds.add(uid);

      const when = fmt(new Date(startMs));
      const subject =
        type === "24h"
          ? `Reminder: ${title} is tomorrow`
          : `Reminder: ${title} starts in about an hour`;

      for (const uid of recipientIds) {
        const email = await getUserEmail(uid);
        if (!email) continue;

        const name = await getPlayerName(uid);
        const html = `
          <p>Hi ${name},</p>
          <p>This is a friendly reminder for <strong>${title}</strong>.</p>
          <p>${when}${location ? `<br/>📍 ${location}` : ""}</p>
          <p><a href="https://tennismate.vercel.app/events/${eventId}">Open event</a></p>
        `;

        await enqueueEmail(email, subject, html);
        console.log(`📧 Queued ${type} reminder → ${email}`);
      }

      await logRef.set({
        eventId,
        type,
        sentAt: admin.firestore.FieldValue.serverTimestamp(),
      });
    }

    console.log("✅ Event reminder check complete.");
  }
);
