// public/firebase-messaging-sw.js

importScripts("https://www.gstatic.com/firebasejs/10.12.1/firebase-app-compat.js");
importScripts("https://www.gstatic.com/firebasejs/10.12.1/firebase-messaging-compat.js");

firebase.initializeApp({
  apiKey: "AIzaSyCeLsM5EKnH8_PgzZT1_dWJhFMD653fQOI",
  authDomain: "tennismate-d8acb.firebaseapp.com",
  projectId: "tennismate-d8acb",
  storageBucket: "tennismate-d8acb.appspot.com",
  messagingSenderId: "16871894453",
  appId: "1:16871894453:web:32b39ae341acf34cdebdfc",
});

const messaging = firebase.messaging();

messaging.onBackgroundMessage(function (payload) {
  console.log("🌙 Background message received:", payload);

  // ✅ Only use `payload.data`, NOT `payload.notification`
  const title = payload.data?.title || "🎾 TennisMate";
  const body = payload.data?.body || "You have a new message!";
  const url = payload.data?.url || "https://tennismate.vercel.app/messages";
  const fallbackIcon = "/logo.png";

  const notificationOptions = {
    body,
    icon: fallbackIcon,
    badge: fallbackIcon,
    data: { url },
  };

self.addEventListener("notificationclick", function (event) {
  event.notification.close();

  const destination = event.notification.data?.url || "https://tennismate.vercel.app";

  event.waitUntil(
    clients.matchAll({ type: "window", includeUncontrolled: true }).then((clientList) => {
      // 🔁 Always open a new tab if destination not matched
      for (const client of clientList) {
        if (client.url.includes(destination) && "focus" in client) {
          return client.focus();
        }
      }
      if (clients.openWindow) {
        return clients.openWindow(destination);
      }
    })
  );
});
