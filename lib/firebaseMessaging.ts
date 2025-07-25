// lib/firebaseMessaging.ts
import { getMessaging, getToken, onMessage, isSupported, Messaging } from "firebase/messaging";
import { initializeApp, FirebaseApp, getApps } from "firebase/app";
import { firebaseConfig, vapidKey } from "./firebaseConfig";

let messagingInstance: Messaging | null = null;

export const getMessagingClient = async (): Promise<{
  messaging: Messaging;
  getToken: typeof getToken;
  onMessage: typeof onMessage;
} | null> => {
  if (typeof window === "undefined" || typeof navigator === "undefined") {
    return null; // SSR-safe
  }

  const supported = await isSupported();
  if (!supported) {
    console.warn("❌ Firebase messaging is not supported in this browser.");
    return null;
  }

  if (!messagingInstance) {
    const app: FirebaseApp = getApps().length ? getApps()[0] : initializeApp(firebaseConfig);
    messagingInstance = getMessaging(app);
  }

  return {
    messaging: messagingInstance,
    getToken,
    onMessage
  };
};

export { vapidKey };
