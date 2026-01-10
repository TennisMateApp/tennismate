// lib/firebaseConfig.ts
import { initializeApp, getApps, getApp } from "firebase/app";
import { getFirestore } from "firebase/firestore";
import { getAuth } from "firebase/auth";
import { getStorage } from "firebase/storage";
import { getMessaging, isSupported as isMessagingSupported } from "firebase/messaging";
import { getAnalytics, isSupported as isAnalyticsSupported, type Analytics } from "firebase/analytics";

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
export const app = getApps().length ? getApp() : initializeApp(firebaseConfig);

export const auth = getAuth(app);
export const db = getFirestore(app);
export const storage = getStorage(app);

// ✅ Messaging (async support check)
export let messaging: ReturnType<typeof getMessaging> | null = null;

if (typeof window !== "undefined") {
  isMessagingSupported()
    .then((supported) => {
      if (supported) messaging = getMessaging(app);
    })
    .catch(() => {
      messaging = null;
    });
}

// ✅ Analytics (async safe getter + cache)
let analyticsCache: Analytics | null = null;
let analyticsInitPromise: Promise<Analytics | null> | null = null;

export function getAnalyticsSafe(): Promise<Analytics | null> {
  if (typeof window === "undefined") return Promise.resolve(null);
  if (analyticsCache) return Promise.resolve(analyticsCache);

  // If multiple calls happen at once, reuse the same init
  if (analyticsInitPromise) return analyticsInitPromise;

  analyticsInitPromise = (async () => {
    try {
      const supported = await isAnalyticsSupported();
      if (!supported) return null;

      analyticsCache = getAnalytics(app);

      // ✅ temporary sanity log (remove later)
      console.log("✅ GA analytics initialised", firebaseConfig.measurementId);

      return analyticsCache;
    } catch {
      return null;
    } finally {
      // allow re-init attempts if it failed
      analyticsInitPromise = null;
    }
  })();

  return analyticsInitPromise;
}
