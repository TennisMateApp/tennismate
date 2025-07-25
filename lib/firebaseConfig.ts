import { initializeApp, getApps, getApp } from "firebase/app";
import { getFirestore } from "firebase/firestore";
import { getAuth } from "firebase/auth";
import { getStorage } from "firebase/storage";
import { getMessaging } from "firebase/messaging";

// ✅ Your existing Firebase config
const firebaseConfig = {
  apiKey: "AIzaSyCeLsM5EKnH8_PgzZT1_dWJhFMD653fQOI",
  authDomain: "tennismate-d8acb.firebaseapp.com",
  projectId: "tennismate-d8acb",
  storageBucket: "tennismate-d8acb.firebasestorage.app",
  messagingSenderId: "16871894453",
  appId: "1:16871894453:web:32b39ae341acf34cdebdfc",
};

// ✅ Your VAPID key (safe to expose publicly for messaging)
const vapidKey = "BA97nNeJC9ENFKBHLTuynQEo13Kotj-ZayG1lZbf79vHDYOZKnYRGRGNy3rKO2_RKn0BkPYjy1FtmX1Mcn1Sf88";

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const storage = getStorage(app);
const messaging = getMessaging(app);

export {
  auth,
  db,
  storage,
  messaging,
  firebaseConfig, // ✅ Needed in firebaseMessaging.ts
  vapidKey        // ✅ Needed in firebaseMessaging.ts
};
