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

// ✅ Handle background push messages
messaging.onBackgroundMessage(function (payload) {
  console.log("🌙 Background message received:", payload);

  const notificationTitle = payload?.notification?.title || "TennisMate";
  const notificationOptions = {
    body: payload?.notification?.body || "You have a new message!",
    icon: "/logo.png",
    badge: "/logo.png",
    data: {
      url: "/directory", // Customize if needed per payload
    },
  };

  self.registration.showNotification(notificationTitle, notificationOptions);
});

// ✅ Handle notification click (opens PWA)
self.addEventListener("notificationclick", function (event) {
  event.notification.close();

  const destination = event.notification.data?.url || "/";
  event.waitUntil(
    clients.matchAll({ type: "window", includeUncontrolled: true }).then((clientList) => {
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
