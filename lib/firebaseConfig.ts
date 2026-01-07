// lib/firebaseConfig.ts
import { initializeApp, getApps, getApp } from "firebase/app";
import { getFirestore } from "firebase/firestore";
import { getAuth } from "firebase/auth";
import { getStorage } from "firebase/storage";
import { getMessaging, isSupported } from "firebase/messaging";

// ✅ Firebase config
export const firebaseConfig = {
  apiKey: "AIzaSyCeLsM5EKnH8_PgzZT1_dWJhFMD653fQOI",
  authDomain: "tennismate-d8acb.firebaseapp.com",
  projectId: "tennismate-d8acb",
  storageBucket: "tennismate-d8acb.firebasestorage.app",
  messagingSenderId: "16871894453",
  appId: "1:16871894453:web:32b39ae341acf34cdebdfc",
  measurementId: "G-SB2RF5Y238",
};

export const vapidKey =
  "BA97nNeJC9ENFKBHLTuynQEo13Kotj-ZayG1lZbf79vHDYOZKnYRGRGNy3rKO2_RKn0BkPYjy1FtmX1Mcn1Sf88";

// ✅ Safe Firebase app init
const app = getApps().length ? getApp() : initializeApp(firebaseConfig);

const auth = getAuth(app);
const db = getFirestore(app);
const storage = getStorage(app);

// ✅ Safe client-only messaging init
let messaging: ReturnType<typeof getMessaging> | null = null;

if (typeof window !== "undefined") {
  isSupported().then((supported) => {
    if (supported) {
      messaging = getMessaging(app);
    }
  });
}

// ✅ Export everything
export { auth, db, storage, app, messaging };
