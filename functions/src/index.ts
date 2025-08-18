import { setGlobalOptions } from "firebase-functions/v2";
import { onDocumentCreated, onDocumentUpdated } from "firebase-functions/v2/firestore";
import { onRequest } from "firebase-functions/v2/https";
import * as admin from "firebase-admin";
import { onSchedule } from "firebase-functions/v2/scheduler";
import { defineSecret } from "firebase-functions/params";
import { TransactionalEmailsApi, SendSmtpEmail } from "@getbrevo/brevo";


// ✅ Cloud Functions v2 supports australia-southeast1 (Sydney)
setGlobalOptions({ maxInstances: 10, region: "australia-southeast1" });

admin.initializeApp();
const db = admin.firestore();
const APP_BASE_URL = "https://tennismate-s7vk.vercel.app";
const URLS = {
  messages: `${APP_BASE_URL}/messages`,
  matches:  `${APP_BASE_URL}/matches`,
};

const ADMIN_BACKFILL_KEY = defineSecret("ADMIN_BACKFILL_KEY");

// === Referral helpers ===
function makeReferralCode(len = 7) {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no 0/O/1/I
  let s = "";
  for (let i = 0; i < len; i++) s += alphabet[Math.floor(Math.random() * alphabet.length)];
  return s;
}

async function getUniqueReferralCode(): Promise<string> {
  // Try a few random codes, then fall back to timestamp (ultra-rare)
  for (let i = 0; i < 10; i++) {
    const code = makeReferralCode();
    const snap = await db.collection("users").where("referralCode", "==", code).limit(1).get();
    if (snap.empty) return code;
  }
  return `TM${Date.now()}`;
}

/** Define what "qualified referral" means for your draw. */
function referralQualifies(data: FirebaseFirestore.DocumentData) {
  // You can loosen/tighten these as needed.
  const emailVerified = !!data.emailVerified;   // mirror this into user doc client-side or via a small callable
  const photoUploaded = !!data.photoUploaded;
  const firstMatchActionAt = data.firstMatchRequestAt || data.firstMatchAcceptedAt;
  return emailVerified && photoUploaded && !!firstMatchActionAt;
}


const BREVO_API_KEY = defineSecret("BREVO_API_KEY");
// Send the welcome only after verification; how long to wait between checks
const WELCOME_EMAIL_DELAY_MINUTES = Number(process.env.WELCOME_EMAIL_DELAY_MINUTES) || 15;


async function getPostcodeCoords(pc: string): Promise<{lat:number; lng:number} | null> {
  if (!pc) return null;
  const snap = await db.collection("postcodes").doc(String(pc)).get();
  const d = snap.data() as any;
  return d && typeof d.lat === "number" && typeof d.lng === "number" ? { lat: d.lat, lng: d.lng } : null;
}


const DEFAULT_AVATAR_URL = `${APP_BASE_URL}/images/default-avatar.jpg`;

// Send ONE email if a message stays unread for this long (minutes)
const UNREAD_EMAIL_DELAY_MINUTES =
  Number(process.env.UNREAD_EMAIL_DELAY_MINUTES) || 30;


interface Court {
  id: string;
  name: string;
  lat: number;
  lng: number;
}

type EmailPrefs = {
  matchRequest?: boolean;
  requestAccepted?: boolean;
  messageReceived?: boolean;
};



async function getUserProfile(uid: string) {
  const [userSnap, playerSnap] = await Promise.all([
    db.doc(`users/${uid}`).get(),
    db.doc(`players/${uid}`).get(),
  ]);

  const email = userSnap.get("email") as string | undefined;
  const prefs = (userSnap.get("emailPrefs") || {}) as EmailPrefs;
  const name =
    playerSnap.get("name") ||
    userSnap.get("name") ||
    userSnap.get("username") ||
    "a player";

  return { email, prefs, name };
}
// =========================
//  EMAIL: WELCOME + TOP 3 (Brevo)
// =========================
export const sendWelcomeEmailOnPlayerCreate = onDocumentCreated(
  {
    document: "players/{uid}",
    region: "australia-southeast1",
    timeoutSeconds: 30,
    memory: "256MiB",
    secrets: [BREVO_API_KEY],
  },
  async (event) => {
    console.log("🔥 players.create trigger fired", { uid: event.params.uid, exists: !!event.data });

    const uid = event.params.uid as string;
    const player = event.data?.data() || {};

    // prevent duplicates
    const markerRef = db.collection("users").doc(uid).collection("meta").doc("welcome");
    if ((await markerRef.get()).exists) { console.log("🔁 already sent"); return; }

    const userSkill = (player.skillLevel || player.skill || "").toString();
    const userPostcode = (player.postcode || "").toString();
    if (!userSkill || !userPostcode) { console.log("⛔ missing skill/postcode"); return; }

    // email + first name
    let email: string | undefined = player.email;
    let firstName: string = player.firstName || player.name || "there";
    if (!email) {
      const u = await db.doc(`users/${uid}`).get();
      email = (u.get("email") as string) || undefined;
    }
    if (!email) {
      try {
        const au = await admin.auth().getUser(uid);
        email = au.email || undefined;
        if (!firstName && au.displayName) firstName = au.displayName.split(" ")[0];
      } catch {}
    }
    if (!email) { console.log("⛔ no email anywhere"); return; }

const origin = await getPostcodeCoords(userPostcode);
if (!origin) {
  console.log("⚠️ no coords for postcode", userPostcode, "- sending welcome without matches");
}

// Wait until the user verifies their email before sending the welcome
let isVerified = false;
try {
  const au = await admin.auth().getUser(uid);
  isVerified = !!au.emailVerified;
} catch {}

if (!isVerified) {
  const qref = db.collection("welcome_queue").doc(uid);
  await qref.set({
    uid,
    scheduledAt: admin.firestore.Timestamp.fromDate(
      new Date(Date.now() + WELCOME_EMAIL_DELAY_MINUTES * 60 * 1000)
    ),
    tries: 0,
    sent: false,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
  }, { merge: true });

  console.log(`⏳ Queued welcome until email is verified (uid=${uid})`);
  return; // exit here; the scheduler below will send once verified
}


// candidates (distance-only, scans all players, keeps nearest 3)
type Cand = {
  uid: string;
  name: string;
  skillLevel: string;
  distance_km: number;
  avatar_url: string;
  request_url: string;
  _score: number; // distance in km
};

const pcCache = new Map<string, { lat: number; lng: number }>();
async function coordsFor(pc: string) {
  if (!pc) return null;
  if (pcCache.has(pc)) return pcCache.get(pc)!;
  const c = await getPostcodeCoords(pc);
  if (c) pcCache.set(pc, c);
  return c;
}

let top3: Cand[] = [];

if (origin) {
  let lastDoc: FirebaseFirestore.QueryDocumentSnapshot | null = null;
  const pageSize = 500;

  while (true) {
    let q = db.collection("players")
      .orderBy(admin.firestore.FieldPath.documentId())
      .limit(pageSize);
    if (lastDoc) q = q.startAfter(lastDoc);

    const page = await q.get();
    if (page.empty) break;

    for (const d of page.docs) {
      if (d.id === uid) continue;
      const p = d.data() || {};
      const pc = String(p.postcode || "");
      const coords = pc ? await coordsFor(pc) : null;
      if (!coords) continue;

      const distKm = calculateDistance(origin, coords);
      const cand: Cand = {
        uid: d.id,
        name: String(p.name || p.firstName || "Player"),
        skillLevel: String(p.skillLevel || p.skill || "Intermediate"),
        distance_km: Math.round(distKm * 10) / 10, // 1 decimal place
        avatar_url: String(p.avatar || p.photoURL || DEFAULT_AVATAR_URL),
        request_url: `${APP_BASE_URL}/match`, // all links -> match page
        _score: distKm,
      };

      // keep only the 3 closest
      if (top3.length < 3) {
        top3.push(cand);
        top3.sort((a, b) => a._score - b._score);
      } else if (cand._score < top3[2]._score) {
        top3[2] = cand;
        top3.sort((a, b) => a._score - b._score);
      }
    }

    lastDoc = page.docs[page.docs.length - 1];
  }
} else {
  console.log("⚠️ no coords for postcode", userPostcode, "- sending welcome without matches");
}

console.log("🧮 email top3", top3.map(x => ({ name: x.name, km: x.distance_km })));



    // send via Brevo
    const api = new TransactionalEmailsApi();
    (api as any).authentications.apiKey.apiKey = BREVO_API_KEY.value();

    const msg: SendSmtpEmail = {
      to: [{ email, name: firstName }],
      sender: { email: "hello@tennis-mate.com.au", name: "TennisMate" },
      templateId: 2,
      params: {
        first_name: firstName,
        cta_url: `${APP_BASE_URL}/match-me?utm_source=welcome&utm_medium=email&utm_campaign=welcome_v1`,
        explore_url: `${APP_BASE_URL}/directory?utm_source=welcome&utm_medium=email&utm_campaign=welcome_v1`,
        matches: top3.map(m => ({
          name: m.name,
          skill_level: m.skillLevel,
          distance_km: m.distance_km,
          avatar_url: m.avatar_url,
          request_url: m.request_url,
        })),
      },
      tags: ["welcome","top3"],
    };

try {
  await api.sendTransacEmail(msg);
  await markerRef.set({ sentAt: admin.firestore.FieldValue.serverTimestamp() });
  console.log(`✅ Welcome email sent to ${email} (uid=${uid})`);
} catch (e) {
  console.error("❌ Brevo send failed:", e);
  return; // don't set the marker on failure
}

  }
);

export const backfillReferralCodes = onRequest(
  {
    region: "australia-southeast1",
    timeoutSeconds: 540,
    memory: "512MiB",
    secrets: [ADMIN_BACKFILL_KEY],
  },
  async (req, res) => {
    const key =
      (req.query.key as string) ||
      (req.headers["x-admin-key"] as string) ||
      "";

    if (key !== ADMIN_BACKFILL_KEY.value()) {
      res.status(401).send("Unauthorized");
      return;
    }

    const pageSize = Math.min(Number(req.query.pageSize) || 200, 450);

    let scanned = 0;
    let setCode = 0;
    let setReferrer = 0;

    let last: FirebaseFirestore.QueryDocumentSnapshot | null = null;

    while (true) {
      let q = admin
        .firestore()
        .collection("users")
        .orderBy(admin.firestore.FieldPath.documentId())
        .limit(pageSize);
      if (last) q = q.startAfter(last);

      const snap = await q.get();
      if (snap.empty) break;

      let batch = admin.firestore().batch();
      let writes = 0;

      for (const d of snap.docs) {
        scanned++;
        const u = d.data() || {};

        // a) ensure referralCode
        if (!u.referralCode) {
          const code = await getUniqueReferralCode();
          batch.set(d.ref, { referralCode: code }, { merge: true });
          setCode++;
          writes++;
        }

        // b) late resolve referredBy from referredByCode (and create signup referral record)
        const codeStr = (u.referredByCode || "").toString().trim();
        if (codeStr && !u.referredBy) {
          const ref = await admin
            .firestore()
            .collection("users")
            .where("referralCode", "==", codeStr)
            .limit(1)
            .get();

          if (!ref.empty && ref.docs[0].id !== d.id) {
            const referrerId = ref.docs[0].id;

            batch.set(d.ref, { referredBy: referrerId }, { merge: true });
            writes++;

            // deterministic id to avoid dupes; makes it idempotent
            const signupRefId = `signup_${d.id}`;
            batch.set(
              admin.firestore().collection("referrals").doc(signupRefId),
              {
                stage: "signup",
                referredUid: d.id,
                referrerUid: referrerId,
                referrerCode: codeStr,
                ts: admin.firestore.FieldValue.serverTimestamp(),
                _source: "backfill_v1",
              },
              { merge: true }
            );
            writes++;
            setReferrer++;
          }
        }

        // guard against 500-writes batch limit
        if (writes >= 450) {
          await batch.commit();
          batch = admin.firestore().batch();
          writes = 0;
        }
      }

      if (writes > 0) await batch.commit();

      last = snap.docs[snap.docs.length - 1];
      // small yield to be nice to Firestore
      await new Promise((r) => setTimeout(r, 40));
    }

    res
      .status(200)
      .send(
        `✅ Backfill complete. scanned=${scanned}, setCode=${setCode}, setReferrer=${setReferrer}`
      );
  }
);

// =========================
//  REFERRALS: assign code on user create; resolve referredBy
// =========================
// =========================
//  REFERRALS: assign code on user create; resolve referredBy
// =========================
export const referralUsersOnCreate = onDocumentCreated(
  "users/{uid}",
  async (event) => {
    const uid = event.params.uid as string;
    const snap = event.data;
    if (!snap) return;
    const data = snap.data() || {};

    const updates: Record<string, any> = {};

    // a) ensure a unique referralCode
    if (!data.referralCode) {
      updates.referralCode = await getUniqueReferralCode();
    }

    // b) stamp referredBy if referredByCode present at create (block self-referrals)
    const code = (data.referredByCode || "").toString().trim();
    if (code) {
      const refSnap = await db.collection("users").where("referralCode", "==", code).limit(1).get();
      if (!refSnap.empty) {
        const referrer = refSnap.docs[0];
        if (referrer.id !== uid) {
          updates.referredBy = referrer.id;

          await db.collection("referrals").add({
            stage: "signup",
            referredUid: uid,
            referrerUid: referrer.id,
            referrerCode: code,
            ts: admin.firestore.FieldValue.serverTimestamp(),
          });
        }
      }
    }

    if (Object.keys(updates).length) {
      await snap.ref.set(updates, { merge: true });
    }
  }
);

// =========================
//  REFERRALS: react to user updates (late code add + qualification award)
// =========================
export const referralUsersOnUpdate = onDocumentUpdated(
  "users/{uid}",
  async (event) => {
    const afterSnap = event.data?.after;
    const beforeSnap = event.data?.before;
    if (!afterSnap || !beforeSnap) return;

    const uid = event.params.uid as string;
    const before = beforeSnap.data() || {};
    const after = afterSnap.data() || {};

    const batch = db.batch();
    let touched = false;

    // a) late referredByCode -> resolve to referredBy once (server-stamped)
    const hadReferrer = !!before.referredBy;
    const hasReferrer = !!after.referredBy;
    const codeBefore = (before.referredByCode || "").toString();
    const codeAfter  = (after.referredByCode  || "").toString();

    if (!hadReferrer && !hasReferrer && codeAfter && codeAfter !== codeBefore) {
      const refSnap = await db.collection("users").where("referralCode", "==", codeAfter).limit(1).get();
      if (!refSnap.empty) {
        const referrer = refSnap.docs[0];
        if (referrer.id !== uid) {
          batch.update(afterSnap.ref, { referredBy: referrer.id });
          batch.create(db.collection("referrals").doc(), {
            stage: "signup",
            referredUid: uid,
            referrerUid: referrer.id,
            referrerCode: codeAfter,
            ts: admin.firestore.FieldValue.serverTimestamp(),
          });
          touched = true;
        }
      }
    }

    // b) Qualification: first time reaching the bar → +1 entry for the referrer
    let nowQualified = referralQualifies(after);

    // Safety: if you don't mirror emailVerified on user doc, fall back to Auth once
    if (!nowQualified && after.referredBy) {
      try {
        const au = await admin.auth().getUser(uid);
        if (au.emailVerified) nowQualified = referralQualifies({ ...after, emailVerified: true });
      } catch {}
    }

    const wasQualified = !!before._qualified;
    if (!wasQualified && nowQualified && after.referredBy) {
      batch.update(afterSnap.ref, {
        _qualified: true,
        _qualifiedAt: admin.firestore.FieldValue.serverTimestamp(),
      });

      const statsRef = db.collection("referral_stats").doc(after.referredBy);
      batch.set(
        statsRef,
        {
          qualifiedCount: admin.firestore.FieldValue.increment(1),
          entries: admin.firestore.FieldValue.increment(1), // 1 entry per qualified referral
          lastUpdated: admin.firestore.FieldValue.serverTimestamp(),
        },
        { merge: true }
      );

      batch.create(db.collection("referrals").doc(), {
        stage: "qualified",
        referredUid: uid,
        referrerUid: after.referredBy,
        ts: admin.firestore.FieldValue.serverTimestamp(),
      });

      touched = true;
    }

    if (touched) await batch.commit();
  }
);

// =========================
//  CRON: deliver queued welcome emails after verification
// =========================
export const deliverQueuedWelcomeEmails = onSchedule(
  {
    schedule: "every 5 minutes",
    timeZone: "Australia/Melbourne",
    region: "australia-southeast1",
    secrets: [BREVO_API_KEY], 
  },
  async () => {
    const now = admin.firestore.Timestamp.now();
    const due = await db.collection("welcome_queue")
      .where("sent", "==", false)
      .where("scheduledAt", "<=", now)
      .limit(50)
      .get();

    if (due.empty) return;

    for (const doc of due.docs) {
      const { uid, tries = 0 } = doc.data() as { uid: string; tries?: number };

      // Already sent elsewhere? (safety)
      const markerRef = db.collection("users").doc(uid).collection("meta").doc("welcome");
      if ((await markerRef.get()).exists) {
        await doc.ref.update({ sent: true, sentAt: admin.firestore.FieldValue.serverTimestamp() });
        continue;
      }

      // Only send after verification
      let verified = false;
      try {
        const au = await admin.auth().getUser(uid);
        verified = !!au.emailVerified;
      } catch {}

      if (!verified) {
        // re-schedule, give up after ~24h (96 tries @ 15m)
        const next = admin.firestore.Timestamp.fromDate(
          new Date(Date.now() + WELCOME_EMAIL_DELAY_MINUTES * 60 * 1000)
        );
        if (tries >= 96) {
          console.log(`🛑 Dropping welcome for uid=${uid} (not verified after ${tries} tries)`);
          await doc.ref.update({ abandoned: true, sent: false, tries: tries + 1, scheduledAt: next });
        } else {
          await doc.ref.update({ tries: tries + 1, scheduledAt: next });
        }
        continue;
      }

      // Build email inputs (pull player + postcode)
      const playerSnap = await db.doc(`players/${uid}`).get();
      const player = playerSnap.data() || {};
      const firstName: string = player.firstName || player.name || "there";

      // Pick an email (players.email -> users.email -> Auth email)
      let email: string | undefined = player.email;
      if (!email) {
        const u = await db.doc(`users/${uid}`).get();
        email = (u.get("email") as string) || undefined;
      }
      if (!email) {
        try {
          const au = await admin.auth().getUser(uid);
          email = au.email || undefined;
        } catch {}
      }
      if (!email) {
        console.log(`⚠️ No email found for uid=${uid}; rescheduling`);
        await doc.ref.update({
          tries: tries + 1,
          scheduledAt: admin.firestore.Timestamp.fromDate(
            new Date(Date.now() + WELCOME_EMAIL_DELAY_MINUTES * 60 * 1000)
          ),
        });
        continue;
      }

      const userPostcode = String(player.postcode || "");
      const origin = userPostcode ? await getPostcodeCoords(userPostcode) : null;
      if (!origin) console.log("⚠️ No coords for postcode", userPostcode, "— sending without matches");

      // Reuse your distance-only top3 (same code you added earlier)
      type Cand = {
        uid: string; name: string; skillLevel: string;
        distance_km: number; avatar_url: string; request_url: string; _score: number;
      };
      let top3: Cand[] = [];
      if (origin) {
        let last: FirebaseFirestore.QueryDocumentSnapshot | null = null;
        const pageSize = 500;
        while (true) {
          let q = db.collection("players")
            .orderBy(admin.firestore.FieldPath.documentId())
            .limit(pageSize);
          if (last) q = q.startAfter(last);
          const page = await q.get();
          if (page.empty) break;

          for (const d of page.docs) {
            if (d.id === uid) continue;
            const p = d.data() || {};
            const pc = String(p.postcode || "");
            const coords = pc ? await getPostcodeCoords(pc) : null;
            if (!coords) continue;

            const distKm = calculateDistance(origin, coords);
            const cand: Cand = {
              uid: d.id,
              name: String(p.name || p.firstName || "Player"),
              skillLevel: String(p.skillLevel || p.skill || "Intermediate"),
              distance_km: Math.round(distKm * 10) / 10,
              avatar_url: String(p.avatar || p.photoURL || DEFAULT_AVATAR_URL),
              request_url: `${APP_BASE_URL}/match`,
              _score: distKm,
            };
            if (top3.length < 3) {
              top3.push(cand);
              top3.sort((a, b) => a._score - b._score);
            } else if (cand._score < top3[2]._score) {
              top3[2] = cand;
              top3.sort((a, b) => a._score - b._score);
            }
          }
          last = page.docs[page.docs.length - 1];
        }
      }

      // Send via Brevo
      const api = new TransactionalEmailsApi();
      (api as any).authentications.apiKey.apiKey = BREVO_API_KEY.value();
      const msg: SendSmtpEmail = {
        to: [{ email, name: firstName }],
        sender: { email: "hello@tennis-mate.com.au", name: "TennisMate" },
        templateId: 2,
        params: {
          first_name: firstName,
          cta_url: `${APP_BASE_URL}/match`,
          explore_url: `${APP_BASE_URL}/match`,
          matches: top3.map(m => ({
            name: m.name,
            skill_level: m.skillLevel,
            distance_km: m.distance_km,
            avatar_url: m.avatar_url,
            request_url: m.request_url,
          })),
        },
        tags: ["welcome","verified"],
      };

      try {
        await api.sendTransacEmail(msg);
        await markerRef.set({ sentAt: admin.firestore.FieldValue.serverTimestamp() });
        await doc.ref.update({ sent: true, sentAt: admin.firestore.FieldValue.serverTimestamp() });
        console.log(`✅ Welcome (post-verify) sent to ${email} (uid=${uid})`);
      } catch (e) {
        console.error("❌ Brevo send (queue) failed:", e);
        // reschedule on API failure
        await doc.ref.update({
          tries: tries + 1,
          scheduledAt: admin.firestore.Timestamp.fromDate(
            new Date(Date.now() + WELCOME_EMAIL_DELAY_MINUTES * 60 * 1000)
          ),
        });
      }
    }
  }
);


export const queueTestEmail = onRequest({ region: "australia-southeast1" }, async (_req, res) => {
  await db.collection("mail").add({
    to: ["william.ray.bourke@gmail.com"], // change to your inbox for the test
    message: {
      subject: "TennisMate test (server)",
      text: "Hello from TennisMate via Trigger Email"
    }
  });
  res.send("Queued test email to /mail.");
});

async function queueEmail(to: string[], subject: string, html: string, text?: string) {
  await db.collection("mail").add({
    to,
    message: {
      subject,
      html,
      text: text || html.replace(/<[^>]+>/g, " "),
    },
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
  });
}

function calculateDistance(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const R = 6371;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const lat1 = (a.lat * Math.PI) / 180;
  const lat2 = (b.lat * Math.PI) / 180;

  const hav =
    Math.sin(dLat / 2) ** 2 +
    Math.sin(dLng / 2) ** 2 * Math.cos(lat1) * Math.cos(lat2);
  const c = 2 * Math.atan2(Math.sqrt(hav), Math.sqrt(1 - hav));

  return R * c;
}

/* =========================
 *  COURT SUGGESTION (OK)
 * ========================= */
export const suggestCourtOnMatch = onDocumentUpdated("match_requests/{matchId}", async (event) => {
  const before = event.data?.before?.data();
  const after = event.data?.after?.data();
  const context = event.params;

  console.log("📌 Trigger fired for match:", context.matchId);

  if (!before || !after) return;
  if (before.status === "accepted") return;
  if (after.status !== "accepted") return;
  if (after.suggestedCourtId) return;

  console.log("✅ Valid update — finding suggested court...");

  const [fromUserId, toUserId] = [after.fromUserId, after.toUserId];
  const [fromSnap, toSnap] = await Promise.all([
    db.collection("players").doc(fromUserId).get(),
    db.collection("players").doc(toUserId).get(),
  ]);
  if (!fromSnap.exists || !toSnap.exists) return;

  const fromPostcode = fromSnap.data()?.postcode;
  const toPostcode = toSnap.data()?.postcode;

  const [fromCoordSnap, toCoordSnap] = await Promise.all([
    db.collection("postcodes").doc(fromPostcode).get(),
    db.collection("postcodes").doc(toPostcode).get(),
  ]);
  if (!fromCoordSnap.exists || !toCoordSnap.exists) return;

  const fromCoords = fromCoordSnap.data();
  const toCoords = toCoordSnap.data();
  if (!fromCoords || !toCoords) return;

  const midpoint = {
    lat: (fromCoords.lat + toCoords.lat) / 2,
    lng: (fromCoords.lng + toCoords.lng) / 2,
  };

  const courtsSnap = await db.collection("courts").get();
  let nearestCourt: Court | null = null;
  let minDistance = Infinity;

  for (const doc of courtsSnap.docs) {
    const court = doc.data();
    const rawLat = court.lat;
    const rawLng = court.lng;
    const courtLat = typeof rawLat === "string" ? parseFloat(rawLat) : rawLat;
    const courtLng = typeof rawLng === "string" ? parseFloat(rawLng) : rawLng;

    if (
      typeof courtLat !== "number" ||
      typeof courtLng !== "number" ||
      isNaN(courtLat) ||
      isNaN(courtLng)
    ) {
      continue;
    }

    const distance = calculateDistance(midpoint, { lat: courtLat, lng: courtLng });
    if (distance < minDistance) {
      minDistance = distance;
      nearestCourt = { id: doc.id, name: court.name, lat: courtLat, lng: courtLng };
    }
  }

  if (!nearestCourt) return;

  await db.collection("match_requests").doc(context.matchId).update({
    suggestedCourtId: nearestCourt.id,
    suggestedCourtName: nearestCourt.name,
    suggestedCourtLat: nearestCourt.lat,
    suggestedCourtLng: nearestCourt.lng,
  });

  console.log(`🎯 Suggested court: ${nearestCourt.name} (${minDistance.toFixed(2)} km)`);
});

/* =========================
 *  SIMPLE HTTP TEST (fix region)
 * ========================= */
export const testFirestore = onRequest({ region: "australia-southeast1" }, async (_req, res) => {
  try {
    const snap = await db.collection("players").limit(1).get();
    res.send(`✅ Accessed players. Count: ${snap.size}`);
  } catch (err) {
    console.error("❌ Firestore read failed:", err);
    res.status(500).send("Firestore access failed");
  }
});

// Set default avatar when a new player doc is created (if missing)
export const setDefaultAvatarOnPlayerCreate = onDocumentCreated(
  "players/{uid}",
  async (event) => {
    const snap = event.data;
    if (!snap) return;
    const data = snap.data() || {};
    const photoURL = (data.photoURL ?? "").toString().trim();
    if (!photoURL) {
      await snap.ref.set({ photoURL: DEFAULT_AVATAR_URL }, { merge: true });
      console.log(`🖼️ set default avatar on players/${event.params.uid}`);
    }
  }
);

// Set default avatar when a new user doc is created (if missing)
export const setDefaultAvatarOnUserCreate = onDocumentCreated(
  "users/{uid}",
  async (event) => {
    const snap = event.data;
    if (!snap) return;
    const data = snap.data() || {};
    const photoURL = (data.photoURL ?? "").toString().trim();
    if (!photoURL) {
      await snap.ref.set({ photoURL: DEFAULT_AVATAR_URL }, { merge: true });
      console.log(`🖼️ set default avatar on users/${event.params.uid}`);
    }
  }
);

export const backfillDefaultAvatars = onRequest(
  { region: "australia-southeast1", timeoutSeconds: 540 },
  async (_req, res) => {
    let updatedPlayers = 0;
    let scannedPlayers = 0;
    let updatedUsers = 0;
    let scannedUsers = 0;

    // helper to scan a collection in pages and set default where missing/blank
    async function backfillCollection(colName: "players" | "users") {
      let updated = 0;
      let scanned = 0;
      const pageSize = 400;

      let lastDoc: FirebaseFirestore.QueryDocumentSnapshot | null = null;

      while (true) {
        let q = db.collection(colName)
          .orderBy(admin.firestore.FieldPath.documentId())
          .limit(pageSize);
        if (lastDoc) q = q.startAfter(lastDoc);

        const snap = await q.get();
        if (snap.empty) break;

        const batch = db.batch();
        let writes = 0;

        for (const docSnap of snap.docs) {
          scanned++;
          const data = docSnap.data() || {};
          const url = (data.photoURL ?? "").toString().trim();
          if (!url) {
            batch.set(docSnap.ref, { photoURL: DEFAULT_AVATAR_URL }, { merge: true });
            updated++;
            writes++;
          }
        }

        if (writes > 0) await batch.commit();
        lastDoc = snap.docs[snap.docs.length - 1];

        // simple yield
        await new Promise((r) => setTimeout(r, 50));
      }

      return { updated, scanned };
    }

    try {
      const p = await backfillCollection("players");
      updatedPlayers = p.updated;
      scannedPlayers = p.scanned;

      const u = await backfillCollection("users");
      updatedUsers = u.updated;
      scannedUsers = u.scanned;

      res.status(200).send(
        `✅ Backfill done.
Players: scanned=${scannedPlayers}, updated=${updatedPlayers}
Users:   scanned=${scannedUsers}, updated=${updatedUsers}
Default URL: ${DEFAULT_AVATAR_URL}`
      );
    } catch (e) {
      console.error("Backfill error:", e);
      res.status(500).send("Backfill failed. See logs.");
    }
  }
);


/* =========================
 *  MATCH COMPLETED (OK)
 * ========================= */
export const processCompletedMatch = onDocumentCreated(
  "completed_matches/{matchId}",
  async (event) => {
    const data = event.data?.data();
    if (!data) return;

    const { winnerId, fromUserId, toUserId, matchId } = data;
    const loserId = winnerId === fromUserId ? toUserId : fromUserId;

    const winnerRef = db.collection("players").doc(winnerId);
    const loserRef = db.collection("players").doc(loserId);

    const [winnerSnap, loserSnap] = await Promise.all([winnerRef.get(), loserRef.get()]);
    const winnerData = winnerSnap.data() || {};
    const loserData = loserSnap.data() || {};

    await Promise.all([
      winnerRef.update({
        matchesPlayed: (winnerData.matchesPlayed || 0) + 1,
        matchesWon: (winnerData.matchesWon || 0) + 1,
      }),
      loserRef.update({
        matchesPlayed: (loserData.matchesPlayed || 0) + 1,
      }),
    ]);

    const badgeUpdates = [fromUserId, toUserId].map((uid) =>
      db.collection("players").doc(uid).set(
        { badges: admin.firestore.FieldValue.arrayUnion("firstMatchComplete") },
        { merge: true }
      )
    );
    badgeUpdates.push(
      db.collection("players").doc(winnerId).set(
        { badges: admin.firestore.FieldValue.arrayUnion("firstWin") },
        { merge: true }
      )
    );

    await Promise.all(badgeUpdates);
    console.log(`✅ Processed completed match: ${matchId}`);
  }
);

/* =========================
 *  PUSH: GENERAL NOTIFICATION
 * ========================= */
export const sendPushNotification = onDocumentCreated(
  "notifications/{notifId}",
  async (event) => {
    const notifData = event.data?.data();
    if (!notifData) {
      console.log("❌ Notification data missing");
      return;
    }

    const recipientId = notifData.recipientId as string | undefined;
    if (!recipientId) {
      console.log("❌ Missing recipientId");
      return;
    }

    // Using query by uid to match other places
    const tokenSnap = await db.collection("device_tokens")
      .where("uid", "==", recipientId)
      .limit(1)
      .get();

    const fcmToken = tokenSnap.empty ? null : tokenSnap.docs[0].get("token");
    if (!fcmToken) {
      console.log(`❌ No FCM token found for user: ${recipientId}`);
      return;
    }

    const payload = {
      token: fcmToken,
      data: {
        title: (notifData.message as string) || "🎾 TennisMate Notification",
        body: "You have a new notification",
        type: (notifData.type as string) || "general",
        fromUserId: (notifData.fromUserId as string) || "",
        url: (notifData.url as string) || "https://tennismate-s7vk.vercel.app/",
      },
    };

    try {
      console.log("📲 Sending push to token:", fcmToken);
      await admin.messaging().send(payload);
      console.log(`✅ Notification sent to ${recipientId}`);
    } catch (error: any) {
      console.error("❌ Failed to send push notification:", error);
      if (
        error.code === "messaging/invalid-registration-token" ||
        error.code === "messaging/registration-token-not-registered"
      ) {
        // Clean up bad token docs (adjust to your schema)
        const bad = tokenSnap.docs[0].ref;
        await bad.delete();
        console.log(`🧹 Deleted invalid FCM token for ${recipientId}`);
      }
    }
  }
);

/* =========================
 *  PUSH: NEW MESSAGE
 * ========================= */
export const notifyOnNewMessage = onDocumentCreated(
  "conversations/{conversationId}/messages/{messageId}",
  async (event) => {
    const message = event.data?.data();
    const { conversationId } = event.params;
    if (!message) return;

    const senderId = message.senderId as string;
    const recipientId = message.recipientId as string;
    const text = message.text as string;
    const read = message.read as boolean;

    if (!recipientId || !text || read === true) return;

    const tokenQuery = await db
      .collection("device_tokens")
      .where("uid", "==", recipientId)
      .limit(1)
      .get();

    const fcmToken = tokenQuery.empty ? null : tokenQuery.docs[0].get("token");
    console.log(`📲 Retrieved token: ${fcmToken}`);
    if (!fcmToken) return;

    const userSnap = await db.collection("users").doc(recipientId).get();
    const activeConversationId = userSnap.get("activeConversationId");
    if (activeConversationId === conversationId) {
      console.log(`👀 User is viewing this conversation. No push sent.`);
      return;
    }

    const senderDoc = await db.collection("players").doc(senderId).get();
    const senderName = senderDoc.get("name") || "A player";

    try {
      await admin.messaging().send({
        token: fcmToken,
        data: {
          title: `New message from ${senderName}`,
          body: text.length > 60 ? text.slice(0, 60) + "…" : text,
          url: "https://tennismate-s7vk.vercel.app/messages",
          type: "new_message",
          conversationId,
          fromUserId: senderId,
        },
      });
      console.log(`✅ Push sent to ${recipientId}`);
    } catch (error) {
      console.error("❌ Failed to send push notification:", error);
    }
  }
);

/* =========================
 *  PUSH: NEW MATCH REQUEST
 * ========================= */
export const sendMatchRequestNotification = onDocumentCreated(
  "match_requests/{matchId}",
  async (event) => {
    const data = event.data?.data();
    if (!data) return;

    const { toUserId, fromUserId } = data;

    const tokenSnap = await db
      .collection("device_tokens")
      .where("uid", "==", toUserId)
      .limit(1)
      .get();

    const fcmToken = tokenSnap.empty ? null : tokenSnap.docs[0].get("token");
    if (!fcmToken) {
      console.log(`❌ No FCM token found for user ${toUserId}`);
      return;
    }

    const senderDoc = await db.collection("players").doc(fromUserId).get();
    const senderName = senderDoc.exists ? senderDoc.get("name") : "A player";

    try {
      await admin.messaging().send({
        token: fcmToken,
        data: {
          title: "New match request!",
          body: `${senderName} has challenged you to a match.`,
          url: "https://tennismate-s7vk.vercel.app/matches",
          type: "match_request",
          matchId: event.params.matchId,
          fromUserId,
        },
      });
      console.log(`✅ Match request notification sent to ${toUserId}`);
    } catch (error) {
      console.error("❌ Failed to send match request push notification:", error);
    }
  }
);

/* =========================
 *  EMAIL: NEW MATCH REQUEST
 * ========================= */
export const emailOnMatchRequestCreated = onDocumentCreated(
  "match_requests/{matchId}",
  async (event) => {
    const data = event.data?.data();
    if (!data) return;

    const { toUserId, fromUserId } = data;
    if (!toUserId || !fromUserId) return;

    const [to, from] = await Promise.all([
      getUserProfile(toUserId),
      getUserProfile(fromUserId),
    ]);
    if (!to.email || to.prefs.matchRequest === false) return;

const matchRef = db.doc(`match_requests/${event.params.matchId}`);
const matchSnap = await matchRef.get();
if (matchSnap.get("emailFlags.requestCreated")) return; // <-- do

const subject = `🎾 New match request from ${from.name}`;
const url = URLS.matches;
const html = `
  <p>Hi ${to.name},</p>
  <p><b>${from.name}</b> sent you a match request on TennisMate.</p>
  <p><a href="${url}">Open matches</a></p>
  <p>— TennisMate</p>
`;
const text = `Hi ${to.name}, ${from.name} sent you a match request on TennisMate. Open matches: ${url} — TennisMate`;

console.log("✉️ emailOnMatchRequestCreated link:", url);
await queueEmail([to.email], subject, html, text);

    await matchRef.set({ emailFlags: { requestCreated: true } }, { merge: true });
  }
);

/* =========================
 *  EMAIL: MATCH ACCEPTED
 * ========================= */
export const emailOnMatchAccepted = onDocumentUpdated(
  "match_requests/{matchId}",
  async (event) => {
    const before = event.data?.before?.data();
    const after = event.data?.after?.data();
    if (!before || !after) return;

    if (before.status === "accepted" || after.status !== "accepted") return;

    const requesterId = after.fromUserId;
    const accepterId = after.toUserId;
    if (!requesterId || !accepterId) return;

    const [requester, accepter] = await Promise.all([
      getUserProfile(requesterId),
      getUserProfile(accepterId),
    ]);
    if (!requester.email || requester.prefs.requestAccepted === false) return;

const matchRef = db.doc(`match_requests/${event.params.matchId}`);
const matchSnap = await matchRef.get();
if (matchSnap.get("emailFlags.requestAccepted")) return; // <-- dot notation

const subject = `✅ ${accepter.name} accepted your match request`;
const url = URLS.matches;
const html = `
  <p>Hi ${requester.name},</p>
  <p><b>${accepter.name}</b> accepted your match request. Time to organise the details!</p>
  <p><a href="${url}">Open matches</a></p>
  <p>— TennisMate</p>
`;
const text = `Hi ${requester.name}, ${accepter.name} accepted your match request. Open matches: ${url} — TennisMate`;

console.log("✉️ emailOnMatchAccepted link:", url);
await queueEmail([requester.email], subject, html, text);

    await matchRef.set({ emailFlags: { requestAccepted: true } }, { merge: true });
  }
);

/* =========================
 *  EMAIL: NEW MESSAGE (10-min throttle)
 * ========================= */
/* =========================
 *  EMAIL: NEW MESSAGE (schedule single unread reminder)
 * ========================= */
export const emailOnNewMessage = onDocumentCreated(
  "conversations/{conversationId}/messages/{messageId}",
  async (event) => {
    const msg = event.data?.data();
    if (!msg) return;

    const { conversationId } = event.params;
    const senderId = msg.senderId as string;
    const text = (msg.text || "").toString();

    const convRef = db.doc(`conversations/${conversationId}`);
    const convSnap = await convRef.get();
    const participants: string[] = convSnap.get("participants") || [];

    const targets = participants.filter((u) => u !== senderId);

    // Resolve sender name (for subject/snippet)
    const senderName =
      (await db.doc(`players/${senderId}`).get()).get("name") || "a player";
    const preview = text.slice(0, 120);

    // For each recipient, anchor ONE reminder at first unread
    await Promise.all(
      targets.map(async (uid) => {
        // If user is actively viewing this conversation, skip & clear any pending reminder
        const userSnap = await db.doc(`users/${uid}`).get();
        const active = userSnap.get("activeConversationId");
        if (active === conversationId) {
          // best-effort cleanup + mark read
          await db
            .doc(`email_reminders/${uid}_${conversationId}`)
            .delete()
            .catch(() => {});

          return;
        }

        // Record first unread time for this user if not set
        if (!convSnap.exists || !convSnap.get(`firstUnreadAt.${uid}`)) {
        }

        // Create a reminder doc ONLY if not already scheduled
        const reminderRef = db.doc(`email_reminders/${uid}_${conversationId}`);
        await db.runTransaction(async (t) => {
          const r = await t.get(reminderRef);
          if (r.exists && r.get("sent") === false) return; // already scheduled

          const scheduledAt = admin.firestore.Timestamp.fromDate(
            new Date(Date.now() + UNREAD_EMAIL_DELAY_MINUTES * 60 * 1000)
          );

          t.set(reminderRef, {
            uid,
            conversationId,
            scheduledAt,
            createdAt: admin.firestore.FieldValue.serverTimestamp(),
            sent: false,
            // helpful context for the email
            lastMessageSnippet: preview,
            senderName,
          });
        });
      })
    );
  }
);

/* =========================
 *  CRON: deliver unread-message emails
 * ========================= */
export const deliverUnreadMessageEmails = onSchedule(
  {
    schedule: "every 5 minutes",
    timeZone: "Australia/Melbourne",
    region: "australia-southeast1",
  },
  async () => {
    const now = admin.firestore.Timestamp.now();

    // Due, unsent reminders
    const q = await db
      .collection("email_reminders")
      .where("sent", "==", false)
      .where("scheduledAt", "<=", now)
      .limit(50)
      .get();

    if (q.empty) return;

    for (const r of q.docs) {
      const { uid, conversationId, senderName, lastMessageSnippet } = r.data() as {
        uid: string;
        conversationId: string;
        senderName?: string;
        lastMessageSnippet?: string;
      };

      // Verify the conversation is still unread for this user
      const conv = await db.doc(`conversations/${conversationId}`).get();
      const lastMessageAt = conv.get("lastMessageAt");
      const lastReadAt = conv.get(`lastRead.${uid}`);

      const isRead =
        lastReadAt && lastMessageAt &&
        lastReadAt.toMillis() >= lastMessageAt.toMillis();

      if (isRead) {
        await r.ref.delete(); // cleanup: no email needed
        continue;
      }

      // Load recipient profile & prefs
      const { email, prefs, name } = await getUserProfile(uid);
      if (!email || prefs.messageReceived === false) {
        await r.ref.delete(); // don't retry forever if we can't/shouldn't email
        continue;
      }

      // Build and queue email (uses your Trigger Email /mail collection)
      const subject = `💬 New message from ${senderName || "a player"}`;
      const url = URLS.messages; // or `${URLS.messages}/${conversationId}` if you want deep-link
      const html = `
        <p>Hi ${name},</p>
        <p>You have an unread message.</p>
        ${lastMessageSnippet ? `<blockquote>${lastMessageSnippet}</blockquote>` : ""}
        <p><a href="${url}">Open messages</a></p>
        <p>— TennisMate</p>
      `;
      const text = `Hi ${name}, you have an unread message. Open messages: ${url} — TennisMate`;

      await queueEmail([email], subject, html, text);

      await r.ref.update({
        sent: true,
        sentAt: admin.firestore.FieldValue.serverTimestamp(),
      });
    }
  }
);


