// lib/nativePush.ts

let setupDone = false;
let lastFcmToken: string | null = null;

export async function initNativePush() {
  if (typeof window === "undefined") return;

  const { Capacitor } = await import("@capacitor/core");
  const platform = Capacitor.getPlatform ? Capacitor.getPlatform() : "unknown";

  console.log("[Push] initNativePush detected platform:", platform);
  console.log("[Push] window.Capacitor present:", !!(window as any).Capacitor);

  // 🔍 Try to load the plugin no matter what platform says, but bail if it truly doesn't exist
  let PushNotifications: any;
  try {
    const mod = await import("@capacitor/push-notifications");
    PushNotifications = mod.PushNotifications;
    if (!PushNotifications) {
      console.log("[Push] PushNotifications plugin missing, aborting.");
      return;
    }
  } catch (e) {
    console.log("[Push] Failed to import @capacitor/push-notifications, aborting.", e);
    return;
  }

  const { auth, db } = await import("@/lib/firebaseConfig");
  const { doc, setDoc, serverTimestamp } = await import("firebase/firestore");

  // --- Attach listeners ONCE, immediately (before any register happens) ---
  if (!setupDone) {
    setupDone = true;

    // 1) Registration success (token). Cache it and try to write.
    PushNotifications.addListener("registration", async ({ value }: { value: string }) => {
      const token = value;
      lastFcmToken = token;
      try {
        localStorage.setItem("tm_fcm_token", token);
      } catch {}

      console.log("[Push] registration token:", token, "platform:", platform);

      // Write to a flat debug collection so we can verify E2E even if user isn't ready
      try {
        await setDoc(
          doc(db, "device_tokens", token),
          {
            fcmToken: token,
            platform,
            seenAt: serverTimestamp(),
          },
          { merge: true }
        );
        console.log("[Push] token saved to /device_tokens (debug)");
      } catch (e) {
        console.error("[Push] debug write failed", e);
      }

      // If user is available now, also write under users/*/devices/*
      const user = auth.currentUser;
      if (user) {
        try {
          await setDoc(
            doc(db, "users", user.uid, "devices", token),
            {
              fcmToken: token,
              platform,
              lastSeen: serverTimestamp(),
              prefersNativePush: true,
            },
            { merge: true }
          );
          console.log("[Push] token saved to users/*/devices/*");
        } catch (e) {
          console.error("[Push] user devices write failed", e);
        }
      } else {
        console.log("[Push] user not ready; will write under users/* after login");
      }
    });

    // 2) Registration error
    PushNotifications.addListener("registrationError", (err: any) => {
      console.error("[Push] registrationError:", err);
    });

    // 3) Foreground handler (optional)
    PushNotifications.addListener("pushNotificationReceived", (n: any) => {
      console.log("[Push] foreground notification:", n);
    });

    // 4) Tap handler (optional deep link)
    PushNotifications.addListener("pushNotificationActionPerformed", (a: any) => {
      const route = (a.notification?.data as any)?.route as string | undefined;
      if (route) window.location.href = route;
    });
  }

  // Android channel (safe to keep; iOS just ignores it internally if not supported)
  if (platform === "android") {
    try {
      await PushNotifications.createChannel({
        id: "messages",
        name: "Messages",
        description: "New messages and match updates",
        importance: 5, // IMPORTANCE_HIGH
        sound: "tennis_ball_hit", // Android custom sound (must exist in res/raw)
        vibration: true,
        lights: true,
      });
    } catch (e) {
      console.warn("[Push] createChannel failed (Android only)", e);
    }
  }

  // Check/request permission, then register — all behind try/catch so web can't explode
  try {
    const perm = await PushNotifications.checkPermissions();
    console.log("[Push] checkPermissions result:", JSON.stringify(perm));

    if (perm.receive !== "granted") {
      const req = await PushNotifications.requestPermissions();
      console.log("[Push] requestPermissions result:", JSON.stringify(req));
      if (req.receive !== "granted") {
        console.log("[Push] permission not granted, aborting register()");
        return;
      }
    } else {
      console.log("[Push] permission already granted, calling register()");
    }

    await PushNotifications.register();
    console.log("[Push] register() called");
  } catch (e) {
    console.error("[Push] error during checkPermissions/register:", e);
  }
}

/**
 * Call this after the user logs in (or auth state changes) to ensure
 * any already-received token is written under users/{uid}/devices/{token}.
 */
export async function bindTokenToUserIfAvailable() {
  if (typeof window === "undefined") return;

  const { Capacitor } = await import("@capacitor/core");
  const platform = Capacitor.getPlatform ? Capacitor.getPlatform() : "unknown";
  console.log("[Push] (bind) detected platform:", platform);

  const { auth, db } = await import("@/lib/firebaseConfig");
  const { doc, setDoc, serverTimestamp } = await import("firebase/firestore");

  const user = auth.currentUser;
  if (!user) return;

  // prefer in-memory, fallback to localStorage
  const token = lastFcmToken || localStorage.getItem("tm_fcm_token");
  if (!token) {
    console.log("[Push] (bind) no token available to bind");
    return;
  }

  try {
    await setDoc(
      doc(db, "users", user.uid, "devices", token),
      {
        fcmToken: token,
        platform,
        lastSeen: serverTimestamp(),
        prefersNativePush: true,
      },
      { merge: true }
    );
    console.log("[Push] (bind) token saved to users/*/devices/*");
  } catch (e) {
    console.error("[Push] (bind) write failed", e);
  }
}
