"use client";

import { doc, setDoc } from "firebase/firestore";
import { auth, db, vapidKey } from "@/lib/firebaseConfig";
import { getMessagingClient } from "@/lib/firebaseMessaging";
import { bindTokenToUserIfAvailable, initNativePush } from "@/lib/nativePush";

export async function registerTennisMateNotifications() {
  if (typeof window === "undefined") return false;

  const { Capacitor } = await import("@capacitor/core");

  if (Capacitor.isNativePlatform?.()) {
    await initNativePush();
    await bindTokenToUserIfAvailable();
    return true;
  }

  if (!("Notification" in window) || !("serviceWorker" in navigator)) {
    return false;
  }

  if (Notification.permission !== "granted") {
    const permission = await Notification.requestPermission();
    if (permission !== "granted") return false;
  }

  const client = await getMessagingClient();
  if (!client) return false;

  const registration = await navigator.serviceWorker.register("/firebase-messaging-sw.js", {
    scope: "/firebase-cloud-messaging-push-scope",
  });

  const token = await client.getToken(client.messaging, {
    vapidKey,
    serviceWorkerRegistration: registration,
  });

  const user = auth.currentUser;
  if (token) {
    window.localStorage.setItem("tm_fcm_token", token);
  }

  if (user && token) {
    await setDoc(doc(db, "device_tokens", user.uid), {
      uid: user.uid,
      token,
      createdAt: new Date(),
    });
  }

  return Boolean(token);
}
