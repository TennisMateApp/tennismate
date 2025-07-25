// components/PushPermissionPrompt.tsx
"use client";

import { useEffect } from "react";
import { vapidKey } from "@/lib/firebaseConfig";
import { getMessagingClient } from "@/lib/firebaseMessaging";

export default function PushPermissionPrompt() {
  useEffect(() => {
    async function setup() {
      const client = await getMessagingClient();
      if (!client) return;

      const { messaging, getToken, onMessage } = client;

      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        console.warn("🚫 Notification permission denied.");
        return;
      }

      const token = await getToken(messaging, { vapidKey });
      console.log("📲 Push token:", token);

      onMessage(messaging, (payload) => {
        console.log("🔔 Foreground push:", payload);
        alert(payload.notification?.title || "📬 New notification received");
      });
    }

    setup();
  }, []);

  return null;
}
