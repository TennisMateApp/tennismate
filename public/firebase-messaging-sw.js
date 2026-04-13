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

  const title = payload.data?.title || "🎾 TennisMate";
  const body = payload.data?.body || "You have a new notification!";
  const route = payload.data?.route || null;
  const url = payload.data?.url || "https://tennismate.vercel.app/messages";
  const fallbackIcon = "/logo.png";

  const notificationOptions = {
    body,
    icon: fallbackIcon,
    badge: fallbackIcon,
    data: {
      route,
      url,
    },
  };

  return self.registration.showNotification(title, notificationOptions);
});

self.addEventListener("notificationclick", function (event) {
  event.notification.close();

  const route = event.notification?.data?.route || null;
  const url =
    event.notification?.data?.url ||
    "https://tennismate.vercel.app/messages";

  const destination = route
    ? `https://tennismate.vercel.app${route}`
    : url;

  event.waitUntil(
    clients.matchAll({ type: "window", includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        try {
          const clientUrl = new URL(client.url);
          const destUrl = new URL(destination);

          const sameOrigin = clientUrl.origin === destUrl.origin;

          if (sameOrigin && "focus" in client) {
            if ("navigate" in client) {
              return client.navigate(destination).then(() => client.focus());
            }
            return client.focus();
          }
        } catch (e) {
          console.warn("notificationclick URL handling failed", e);
        }
      }

      if (clients.openWindow) {
        return clients.openWindow(destination);
      }
    })
  );
});