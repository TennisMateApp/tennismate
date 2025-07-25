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
messaging.onBackgroundMessage(function(payload) {
  console.log("🌙 Background message received:", payload);

  const notificationTitle = payload?.notification?.title || "TennisMate";
  const notificationOptions = {
    body: payload?.notification?.body || "You have a new message!",
    icon: "/logo.png", // optional
    badge: "/logo.png", // optional
  };

  self.registration.showNotification(notificationTitle, notificationOptions);
});
