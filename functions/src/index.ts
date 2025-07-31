import { setGlobalOptions } from "firebase-functions/v2";
import { onDocumentUpdated } from "firebase-functions/v2/firestore";
import { onRequest } from "firebase-functions/v2/https";
import * as admin from "firebase-admin";
import { onDocumentCreated } from "firebase-functions/v2/firestore";


// ✅ Set correct region for Firestore: australia-southeast2
setGlobalOptions({ maxInstances: 10, region: "australia-southeast2" });

admin.initializeApp();
const db = admin.firestore();

interface Court {
  id: string;
  name: string;
  lat: number;
  lng: number;
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

export const suggestCourtOnMatch = onDocumentUpdated("match_requests/{matchId}", async (event: any) => {
  const before = event.data?.before?.data();
  const after = event.data?.after?.data();
  const context = event.params;

  console.log("📌 Trigger fired for match:", context.matchId);

  if (!before || !after) {
    console.log("❌ Missing before or after data.");
    return;
  }

  if (before.status === "accepted") {
    console.log("❌ Match was already accepted before.");
    return;
  }

  if (after.status !== "accepted") {
    console.log("❌ Status is not 'accepted'. Current:", after.status);
    return;
  }

  if (after.suggestedCourtId) {
    console.log("❌ Court already suggested:", after.suggestedCourtId);
    return;
  }

  console.log("✅ Valid update — finding suggested court...");

  const [fromUserId, toUserId] = [after.fromUserId, after.toUserId];
  const [fromSnap, toSnap] = await Promise.all([
    db.collection("players").doc(fromUserId).get(),
    db.collection("players").doc(toUserId).get(),
  ]);

  if (!fromSnap.exists || !toSnap.exists) {
    console.log("❌ One or both player documents not found.");
    return;
  }

  const fromPostcode = fromSnap.data()?.postcode;
  const toPostcode = toSnap.data()?.postcode;

  const [fromCoordSnap, toCoordSnap] = await Promise.all([
    db.collection("postcodes").doc(fromPostcode).get(),
    db.collection("postcodes").doc(toPostcode).get(),
  ]);

  if (!fromCoordSnap.exists || !toCoordSnap.exists) {
    console.log("❌ One or both postcode documents not found.");
    return;
  }

  const fromCoords = fromCoordSnap.data();
  const toCoords = toCoordSnap.data();

  if (!fromCoords || !toCoords) {
    console.log("❌ Missing lat/lng in postcode data.");
    return;
  }

  const midpoint = {
    lat: (fromCoords.lat + toCoords.lat) / 2,
    lng: (fromCoords.lng + toCoords.lng) / 2,
  };

  console.log(`🧭 Midpoint: (${midpoint.lat}, ${midpoint.lng})`);

  const courtsSnap = await db.collection("courts").get();
  console.log(`🔎 Starting court loop. Total courts: ${courtsSnap.size}`);
  let nearestCourt: Court | null = null;
  let minDistance = Infinity;

  for (const doc of courtsSnap.docs) {
    const court = doc.data();
    const rawLat = court.lat;
    const rawLng = court.lng;
    const courtLat = typeof rawLat === "string" ? parseFloat(rawLat) : rawLat;
    const courtLng = typeof rawLng === "string" ? parseFloat(rawLng) : rawLng;

    console.log(`➡️ Evaluating court: ${court.name} (${doc.id})`);
    console.log(`   Raw lat/lng: lat=${rawLat}, lng=${rawLng} → Parsed lat=${courtLat}, lng=${courtLng}`);

    if (
      typeof courtLat !== "number" ||
      typeof courtLng !== "number" ||
      isNaN(courtLat) ||
      isNaN(courtLng)
    ) {
      console.log(`⚠️ Skipping court due to invalid coordinates`);
      continue;
    }

    const distance = calculateDistance(midpoint, { lat: courtLat, lng: courtLng });
    console.log(`📍 ${court.name} is ${distance.toFixed(2)} km from midpoint`);

    if (distance < minDistance) {
      console.log(`🎯 This is the new closest court so far`);
      minDistance = distance;
      nearestCourt = {
        id: doc.id,
        name: court.name,
        lat: courtLat,
        lng: courtLng,
      };
    }
  }

  if (!nearestCourt) {
    console.log("❌ No courts found or all are too far.");
    return;
  }

  console.log(`✅ Nearest court: ${nearestCourt.name} (${minDistance.toFixed(2)} km)`);

  await db.collection("match_requests").doc(context.matchId).update({
    suggestedCourtId: nearestCourt.id,
    suggestedCourtName: nearestCourt.name,
    suggestedCourtLat: nearestCourt.lat,
    suggestedCourtLng: nearestCourt.lng,
  });

  console.log(`🎯 Suggested court: ${nearestCourt.name}`);
});

export const testFirestore = onRequest({ region: "australia-southeast2" }, async (req: any, res: any) => {
  try {
    const snap = await db.collection("players").limit(1).get();
    res.send(`✅ Accessed players. Count: ${snap.size}`);
  } catch (err) {
    console.error("❌ Firestore read failed:", err);
    res.status(500).send("Firestore access failed");
  }
});
export const processCompletedMatch = onDocumentCreated(
  "completed_matches/{matchId}",
  async (event) => {
    const data = event.data?.data();
    if (!data) {
      console.log("❌ No match data found in event.");
      return;
    }

    const { winnerId, fromUserId, toUserId, matchId } = data;
    const loserId = winnerId === fromUserId ? toUserId : fromUserId;

    const winnerRef = db.collection("players").doc(winnerId);
    const loserRef = db.collection("players").doc(loserId);

    const [winnerSnap, loserSnap] = await Promise.all([
      winnerRef.get(),
      loserRef.get(),
    ]);

    const winnerData = winnerSnap.data() || {};
    const loserData = loserSnap.data() || {};

    // Update stats
    await Promise.all([
      winnerRef.update({
        matchesPlayed: (winnerData.matchesPlayed || 0) + 1,
        matchesWon: (winnerData.matchesWon || 0) + 1,
      }),
      loserRef.update({
        matchesPlayed: (loserData.matchesPlayed || 0) + 1,
      }),
    ]);

    // Award badges
    const badgeUpdates = [
      fromUserId,
      toUserId,
    ].map((uid) =>
      db.collection("players").doc(uid).set(
        {
          badges: admin.firestore.FieldValue.arrayUnion("firstMatchComplete"),
        },
        { merge: true }
      )
    );

    badgeUpdates.push(
      db
        .collection("players")
        .doc(winnerId)
        .set(
          {
            badges: admin.firestore.FieldValue.arrayUnion("firstWin"),
          },
          { merge: true }
        )
    );

    await Promise.all(badgeUpdates);

    console.log(`✅ Processed completed match: ${matchId}`);
  }
);
export const sendPushNotification = onDocumentCreated(
  "notifications/{notifId}",
  async (event) => {
    const notifData = event.data?.data();
    if (!notifData) {
      console.log("❌ Notification data missing");
      return;
    }

    const recipientId = notifData.recipientId;
    const tokenDoc = await db.collection("device_tokens").doc(recipientId).get();

    if (!tokenDoc.exists) {
      console.log(`❌ No device token found for user: ${recipientId}`);
      return;
    }

    const token = tokenDoc.data()?.token;
    if (!token) {
      console.log(`❌ Token field missing for user: ${recipientId}`);
      return;
    }

    const payload = {
      notification: {
        title: notifData.message || "🎾 TennisMate Notification",
        body: "You have a new notification",
      },
      data: {
        type: notifData.type || "general",
        fromUserId: notifData.fromUserId || "",
        url: notifData.url || "https://tennis-match.com.au",
      },
    };

    try {
      console.log("📲 Sending push to token:", token);
      await admin.messaging().send({ token, ...payload });
      console.log(`✅ Notification sent to ${recipientId}`);
    } catch (error: any) {
      console.error("❌ Failed to send push notification:", error);

      if (
        error.code === "messaging/invalid-registration-token" ||
        error.code === "messaging/registration-token-not-registered"
      ) {
        await db.collection("device_tokens").doc(recipientId).delete();
        console.log(`🧹 Deleted invalid FCM token for ${recipientId}`);
      }
    }
  }
);
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

    // ✅ Get token from device_tokens
  const tokenQuery = await db
  .collection("device_tokens")
  .where("uid", "==", recipientId)
  .limit(1)
  .get();

  

const fcmToken = tokenQuery.empty ? null : tokenQuery.docs[0].get("token");
console.log(`📲 Retrieved token: ${fcmToken}`);
    if (!fcmToken) {
      console.log(`❌ No FCM token found for ${recipientId}`);
      return;
    }

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
      url: "https://tennismate.vercel.app/messages",
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


export const sendMatchRequestNotification = onDocumentCreated(
  "match_requests/{matchId}",
  async (event) => {
    const data = event.data?.data();
    if (!data) return;

    const { toUserId, fromUserId } = data;

    // Get recipient's FCM token
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

    // Get sender name
    const senderDoc = await db.collection("players").doc(fromUserId).get();
    const senderName = senderDoc.exists ? senderDoc.get("name") : "A player";

    try {
      // Send push notification
      await admin.messaging().send({
        token: fcmToken,
        data: {
          title: "New match request!",
          body: `${senderName} has challenged you to a match.`,
          url: "https://tennismate.vercel.app/matches",
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








