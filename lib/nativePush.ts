// lib/nativePush.ts

let setupDone = false;
let lastFcmToken: string | null = null;

export async function initNativePush() {
  if (typeof window === "undefined") return;

  const { Capacitor } = await import("@capacitor/core");
  const platform = Capacitor.getPlatform ? Capacitor.getPlatform() : "unknown";

  // Only run inside a native Capacitor shell (iOS / Android app)
  if (!Capacitor.isNativePlatform?.()) {
    console.log("[Push] initNativePush: skip, non-native platform:", platform);
    return;
  }

  console.log("[Push] initNativePush on native platform:", platform);
  console.log("[Push] window.Capacitor present:", !!(window as any).Capacitor);

  // Capacitor plugins
  const { PushNotifications } = await import("@capacitor/push-notifications");
  const { FirebaseMessaging } = await import("@capacitor-firebase/messaging");

  // Firebase
  const { auth, db } = await import("@/lib/firebaseConfig");
  const { doc, setDoc, serverTimestamp } = await import("firebase/firestore");

  // ---- Attach listeners once ----
  if (!setupDone) {
    setupDone = true;

    // Registration from Capacitor (APNs token on iOS, FCM on Android) – we just log it
    PushNotifications.addListener("registration", (info: any) => {
      console.log("[Push] native registration value (APNs/FCM):", info?.value);
      // NOTE: We do NOT treat this as the FCM token on iOS.
      // Real FCM token comes from FirebaseMessaging.getToken().
    });

    PushNotifications.addListener("registrationError", (err: any) => {
      console.error("[Push] registrationError:", err);
    });

    PushNotifications.addListener("pushNotificationReceived", (n: any) => {
      console.log("[Push] foreground notification:", n);
    });

    PushNotifications.addListener(
      "pushNotificationActionPerformed",
      (a: any) => {
        const route = (a.notification?.data as any)?.route as
          | string
          | undefined;
        if (route) window.location.href = route;
      }
    );
  }

  try {
    // Android: create channel (iOS ignores)
    if (platform === "android") {
      try {
        await PushNotifications.createChannel({
          id: "messages",
          name: "Messages",
          description: "New messages and match updates",
          importance: 5, // IMPORTANCE_HIGH
          sound: "tennis_ball_hit", // must exist in res/raw on Android
          vibration: true,
          lights: true,
        });
      } catch (e) {
        console.warn("[Push] createChannel failed (Android only)", e);
      }
    }

    // 1) Permission
    const perm = await PushNotifications.checkPermissions();
    console.log("[Push] checkPermissions:", perm);

    if (perm.receive !== "granted") {
      const req = await PushNotifications.requestPermissions();
      console.log("[Push] requestPermissions:", req);
      if (req.receive !== "granted") {
        console.log("[Push] permission not granted, aborting");
        return;
      }
    } else {
      console.log("[Push] permission already granted");
    }

    // 2) Register with APNs / FCM at native level
    await PushNotifications.register();
    console.log("[Push] register() called");

    // 3) Ask Firebase Messaging for an FCM token (the one we actually use)
    const tokenResult: any = await FirebaseMessaging.getToken();
    const token: string | undefined = tokenResult?.token;

    if (!token) {
      console.warn("[Push] FirebaseMessaging.getToken() returned no token");
      return;
    }

    console.log("[Push] FCM token:", token, "platform:", platform);
    lastFcmToken = token;

    try {
      localStorage.setItem("tm_fcm_token", token);
    } catch {
      // ignore storage errors
    }

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
        console.log("[Push] FCM token saved to users/*/devices/*");
      } catch (e) {
        console.error(
          "[Push] error saving FCM token under users/*/devices/*",
          e
        );
      }
    } else {
      console.log("[Push] user not ready; will bind token after login");
    }
  } catch (e) {
    console.error("[Push] error during initNativePush:", e);
  }
}

/**
 * Call this after the user logs in (or auth state changes) to ensure
 * any already-received FCM token is written under users/{uid}/devices/{token}.
 */
export async function bindTokenToUserIfAvailable() {
  if (typeof window === "undefined") return;

  const { Capacitor } = await import("@capacitor/core");
  const platform = Capacitor.getPlatform ? Capacitor.getPlatform() : "unknown";

  if (!Capacitor.isNativePlatform?.()) {
    console.log("[Push] (bind) skip, non-native platform:", platform);
    return;
  }

  const { auth, db } = await import("@/lib/firebaseConfig");
  const { doc, setDoc, serverTimestamp } = await import("firebase/firestore");

  const user = auth.currentUser;
  if (!user) {
    console.log("[Push] (bind) no user, skipping");
    return;
  }

  const token = lastFcmToken || localStorage.getItem("tm_fcm_token");
  if (!token) {
    console.log("[Push] (bind) no FCM token available to bind");
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
    console.log("[Push] (bind) FCM token saved to users/*/devices/*");
  } catch (e) {
    console.error("[Push] (bind) error saving FCM token", e);
  }
}
