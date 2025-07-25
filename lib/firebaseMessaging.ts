// lib/firebaseMessaging.ts
import { getMessaging, getToken, onMessage, isSupported, Messaging } from "firebase/messaging";
import { initializeApp, FirebaseApp, getApps } from "firebase/app";
import { firebaseConfig, vapidKey } from "./firebaseConfig";

let messaging: Messaging | null = null;

export const getMessagingClient = async (): Promise<Messaging | null> => {
  if (typeof window === "undefined" || typeof navigator === "undefined") {
    return null; // SSR-safe
  }

  const supported = await isSupported();
  if (!supported) {
    console.warn("❌ Firebase messaging is not supported in this browser.");
    return null;
  }

  if (!messaging) {
    const app: FirebaseApp = getApps().length ? getApps()[0] : initializeApp(firebaseConfig);
    messaging = getMessaging(app);
  }

  return messaging;
};

export { getToken, onMessage, vapidKey };
