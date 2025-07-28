"use client";

import { useEffect } from "react";
import { vapidKey } from "@/lib/firebaseConfig";
import { getMessagingClient } from "@/lib/firebaseMessaging";

export default function PushPermissionPrompt() {
  useEffect(() => {
    async function setup() {
      try {
        if (typeof window === "undefined") return;

        if (!("Notification" in window)) {
          console.warn("🚫 Notifications not supported in this browser.");
          return;
        }

        if (!("serviceWorker" in navigator)) {
          console.warn("🚫 Service workers not supported.");
          return;
        }

        const permission = await Notification.requestPermission();
        if (permission !== "granted") {
          console.warn("🚫 Notification permission denied.");
          return;
        }

        const client = await getMessagingClient();
        if (!client) {
          console.warn("⚠️ Messaging client not available.");
          return;
        }

        const { messaging, getToken, onMessage } = client;

        const registration = await navigator.serviceWorker.register("/firebase-messaging-sw.js");

        const token = await getToken(messaging, {
          vapidKey,
          serviceWorkerRegistration: registration,
        });

        console.log("📲 Push token:", token);

        // Optional: You could save this token to Firestore or your backend

        onMessage(messaging, (payload) => {
          console.log("🔔 Foreground push:", payload);
          alert(payload.notification?.title || "📬 New notification received");
        });
      } catch (err) {
        console.error("❌ Push notification setup failed:", err);
      }
    }

    setup();
  }, []);

  return null;
}
