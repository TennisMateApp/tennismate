// lib/nativePush.ts

let setupDone = false;

/**
 * Our "best known" push token.
 * - On iOS: initially the APNs/native token from PushNotifications.register()
 * - If FirebaseMessaging works: upgraded to the FCM token.
 */
let lastKnownToken: string | null = null;

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

  // Try to load FirebaseMessaging, but treat it as OPTIONAL.
  // If it's not implemented on iOS yet, we just log and continue with APNs-only.
  let FirebaseMessaging: any | null = null;
  try {
    const msgMod = await import("@capacitor-firebase/messaging");
    FirebaseMessaging =
      (msgMod as any).FirebaseMessaging ??
      (msgMod as any).default ??
      null;

    if (FirebaseMessaging) {
      console.log("[Push] FirebaseMessaging plugin available in JS");
    } else {
      console.log(
        "[Push] FirebaseMessaging JS module loaded but plugin object missing – continuing without FCM upgrade"
      );
    }
  } catch (e) {
    console.log(
      "[Push] FirebaseMessaging plugin not available in JS (OK – APNs-only for now):",
      e
    );
  }

  // Firebase
  const { auth, db } = await import("@/lib/firebaseConfig");
  const { doc, setDoc, serverTimestamp } = await import("firebase/firestore");

  // ---- Attach listeners once ----
  if (!setupDone) {
    setupDone = true;

    // 1) Native registration (APNs on iOS, FCM on Android)
    PushNotifications.addListener("registration", async (info: any) => {
      const nativeToken: string | undefined = info?.value;
      console.log("[Push] native registration value (APNs/FCM):", nativeToken);

      if (!nativeToken) {
        console.warn("[Push] registration returned no token");
        return;
      }

      // This is our current best token
      lastKnownToken = nativeToken;
      try {
        localStorage.setItem("tm_push_native_token", nativeToken);
      } catch {
        /* ignore */
      }

      // Debug doc so you can see tokens even before login
      try {
        await setDoc(
          doc(db, "device_tokens", nativeToken),
          {
            platform,
            apnsOrNativeToken: nativeToken,
            fcmToken: null,
            seenAt: serverTimestamp(),
          },
          { merge: true }
        );
        console.log("[Push] debug doc written for native token");
      } catch (e) {
        console.warn(
          "[Push] debug write (native token) failed – likely Firestore rules:",
          e
        );
      }

      const user = auth.currentUser;
      if (user) {
        try {
          await setDoc(
            doc(db, "users", user.uid, "devices", nativeToken),
            {
              platform,
              apnsOrNativeToken: nativeToken,
              fcmToken: null,
              lastSeen: serverTimestamp(),
              prefersNativePush: true,
            },
            { merge: true }
          );
          console.log("[Push] user devices doc written for native token");
        } catch (e) {
          console.warn(
            "[Push] user devices write (native token) failed:",
            e
          );
        }
      } else {
        console.log("[Push] user not ready; will bind token after login");
      }

      // 2) OPTIONAL: try to upgrade to FCM token if FirebaseMessaging works
      if (FirebaseMessaging) {
        try {
          const res = await FirebaseMessaging.getToken();
          const fcmToken: string | undefined = res?.token;
          console.log("[Push] FirebaseMessaging.getToken() result:", res);

          if (fcmToken) {
            lastKnownToken = fcmToken;
            try {
              localStorage.setItem("tm_fcm_token", fcmToken);
            } catch {
              /* ignore */
            }

            try {
              await setDoc(
                doc(db, "device_tokens", fcmToken),
                {
                  platform,
                  apnsOrNativeToken: nativeToken,
                  fcmToken,
                  seenAt: serverTimestamp(),
                },
                { merge: true }
              );
              console.log("[Push] debug doc written for FCM token");
            } catch (e) {
              console.warn("[Push] debug write (FCM token) failed:", e);
            }

            if (user) {
              try {
                await setDoc(
                  doc(db, "users", user.uid, "devices", fcmToken),
                  {
                    platform,
                    apnsOrNativeToken: nativeToken,
                    fcmToken,
                    lastSeen: serverTimestamp(),
                    prefersNativePush: true,
                  },
                  { merge: true }
                );
                console.log("[Push] user devices doc written for FCM token");
              } catch (e) {
                console.warn(
                  "[Push] user devices write (FCM token) failed:",
                  e
                );
              }
            }
          } else {
            console.log(
              "[Push] FirebaseMessaging.getToken() returned no token – staying on native token only"
            );
          }
        } catch (e) {
          // This is where "FirebaseMessaging plugin is not implemented on ios" will land
          console.warn(
            "[Push] FirebaseMessaging.getToken() failed (plugin not wired on iOS yet?):",
            e
          );
        }
      } else {
        console.log("[Push] FirebaseMessaging not available – APNs-only for now");
      }
    });

    // 2) Registration error
    PushNotifications.addListener("registrationError", (err: any) => {
      console.error("[Push] registrationError:", err);
    });

    // 3) Foreground handler
    PushNotifications.addListener("pushNotificationReceived", (n: any) => {
      console.log("[Push] foreground notification:", n);
    });

    // 4) Tap handler
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
    // Android: create channel (iOS ignores internally)
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
  } catch (e) {
    console.error("[Push] error during initNativePush:", e);
  }
}

/**
 * Call this after the user logs in (or auth state changes) to ensure
 * whatever token we know (FCM if available, otherwise native) is written
 * under users/{uid}/devices/{token}.
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

  // Prefer in-memory, then FCM from storage, then native from storage
  const token =
    lastKnownToken ||
    localStorage.getItem("tm_fcm_token") ||
    localStorage.getItem("tm_push_native_token");

  if (!token) {
    console.log("[Push] (bind) no token available to bind");
    return;
  }

  try {
    await setDoc(
      doc(db, "users", user.uid, "devices", token),
      {
        platform,
        fcmToken: localStorage.getItem("tm_fcm_token") || null,
        apnsOrNativeToken: localStorage.getItem("tm_push_native_token") || null,
        lastSeen: serverTimestamp(),
        prefersNativePush: true,
      },
      { merge: true }
    );
    console.log("[Push] (bind) token saved to users/*/devices/*");
  } catch (e) {
    console.error("[Push] (bind) error saving token", e);
  }
}
