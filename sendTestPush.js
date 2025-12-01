// sendTestPush.js
const { GoogleAuth } = require("google-auth-library");
const fetch = require("node-fetch");

// 👇 your Firebase project ID
const projectId = "tennismate-d8acb";

// 👇 paste the *current* fcmToken from Firestore (users/{uid}/devices/*)
const fcmToken = "dViRpHt02U4NnfCcs6xN_l:APA91bF6QT4SydoVO9tHEpiNkUmLvz-FSDCjr80FbKHfdd_3wy2aDHEhwu0i9P78VshCKrzBeMITYRwcsF8Y9zU2Svu4haltgyf1pCdbfO4RlsKv6GWI-Dw";

async function main() {
  // 1) Auth using your service account JSON
  const auth = new GoogleAuth({
    keyFile: "../fcm-service-account.json", // adjust path if needed
    scopes: ["https://www.googleapis.com/auth/firebase.messaging"],
  });

  const client = await auth.getClient();
  const accessTokenObj = await client.getAccessToken();
  const accessToken = accessTokenObj.token || accessTokenObj;

  console.log("[FCM] Using access token (truncated):", String(accessToken).slice(0, 20), "...");

  // 2) Build the message
  const body = {
    message: {
      token: fcmToken,
      notification: {
        title: "TennisMate direct test",
        body: "If you see this, FCM → APNs → iPad is working 🎾",
      },
      apns: {
        headers: {
          "apns-priority": "10",
        },
        payload: {
          aps: {
            sound: "default",
          },
        },
      },
    },
  };

  // 3) Call FCM HTTP v1
  const url = `https://fcm.googleapis.com/v1/projects/${projectId}/messages:send`;

  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json; charset=utf-8",
    },
    body: JSON.stringify(body),
  });

  const text = await res.text();
  console.log("[FCM] HTTP status:", res.status);
  console.log("[FCM] Response body:", text);
}

main().catch((err) => {
  console.error("[FCM] Error running test:", err);
});
