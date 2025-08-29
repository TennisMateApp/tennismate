// lib/firebaseConfig.ts
import { initializeApp, getApps, getApp } from "firebase/app";
import { getFirestore } from "firebase/firestore";
import { getAuth } from "firebase/auth";
import { getStorage } from "firebase/storage";
import { getMessaging, isSupported as messagingIsSupported, Messaging } from "firebase/messaging";
import {
  getAnalytics,
  isSupported as analyticsIsSupported,
  logEvent,
  type Analytics,
} from "firebase/analytics";

// ✅ Firebase config (note: storageBucket should be *.appspot.com)
export const firebaseConfig = {
  apiKey: "AIzaSyCeLsM5EKnH8_PgzZT1_dWJhFMD653fQOI",
  authDomain: "tennismate-d8acb.firebaseapp.com",
  projectId: "tennismate-d8acb",
  storageBucket: "tennismate-d8acb.appspot.com", // ✅
  messagingSenderId: "16871894453",
  appId: "1:16871894453:web:32b39ae341acf34cdebdfc",
  measurementId: "G-SB2RF5Y238",
};

// ✅ VAPID key for push notifications
export const vapidKey =
  "BA97nNeJC9ENFKBHLTuynQEo13Kotj-ZayG1lZbf79vHDYOZKnYRGRGNy3rKO2_RKn0BkPYjy1FtmX1Mcn1Sf88";

// ---- Core app (singleton) ----
export const app = getApps().length ? getApp() : initializeApp(firebaseConfig);

// ---- Core services ----
export const auth = getAuth(app);
export const db = getFirestore(app);
export const storage = getStorage(app);

// ---- Messaging: client-only, gracefully optional ----
let _messaging: Messaging | null = null;
if (typeof window !== "undefined") {
  // Don’t await; keep non-blocking
  messagingIsSupported()
    .then((ok) => {
      if (ok) _messaging = getMessaging(app);
    })
    .catch(() => {});
}
export const messaging = _messaging;

// ---- Analytics (GA4): client-only, only if supported & measurementId present ----
let _analytics: Analytics | null = null;
if (typeof window !== "undefined" && firebaseConfig.measurementId) {
  analyticsIsSupported()
    .then((ok) => {
      if (ok) {
        _analytics = getAnalytics(app);
        // Optional: send a smoke-test event so DebugView lights up immediately
        try {
          logEvent(_analytics!, "tm_boot");
        } catch {}
      }
    })
    .catch(() => {});
}
export const analytics = _analytics;

// ---- Tiny helper so you can log events safely anywhere ----
export function logAnalyticsEvent(eventName: string, params?: Record<string, any>) {
  try {
    if (_analytics) logEvent(_analytics, eventName, params);
  } catch {}
}
