// lib/nativePush.ts

let setupDone = false;
let lastFcmToken: string | null = null;

export async function initNativePush() {
  if (typeof window === 'undefined') return;

  const { Capacitor } = await import('@capacitor/core');
  if (!Capacitor.isNativePlatform()) {
    console.log('[Push] skip: web platform');
    return;
  }

  const platform = Capacitor.getPlatform(); // <- detect 'ios' or 'android'
  console.log('[Push] initNativePush on platform:', platform); // 👈 ADD THIS LINE

  const { PushNotifications } = await import('@capacitor/push-notifications');
  const { auth, db } = await import('@/lib/firebaseConfig');
  const { doc, setDoc, serverTimestamp } = await import('firebase/firestore');


  // --- Attach listeners ONCE, immediately (before any register happens) ---
  if (!setupDone) {
    setupDone = true;

    // 1) Registration success (token). Cache it and try to write.
    PushNotifications.addListener('registration', async ({ value }) => {
      const token = value;
      lastFcmToken = token;
      try {
        localStorage.setItem('tm_fcm_token', token);
      } catch {}

      console.log('[Push] registration token:', token, 'platform:', platform);

      // Write to a flat debug collection so we can verify E2E even if user isn't ready
      try {
        await setDoc(
          doc(db, 'device_tokens', token),
          {
            fcmToken: token,
            platform, // <- CHANGED: use actual platform
            seenAt: serverTimestamp(),
          },
          { merge: true }
        );
        console.log('[Push] token saved to /device_tokens (debug)');
      } catch (e) {
        console.error('[Push] debug write failed', e);
      }

      // If user is available now, also write under users/*/devices/*
      const user = auth.currentUser;
      if (user) {
        try {
          await setDoc(
            doc(db, 'users', user.uid, 'devices', token),
            {
              fcmToken: token,
              platform, // <- CHANGED: use actual platform
              lastSeen: serverTimestamp(),
              prefersNativePush: true,
            },
            { merge: true }
          );
          console.log('[Push] token saved to users/*/devices/*');
        } catch (e) {
          console.error('[Push] user devices write failed', e);
        }
      } else {
        console.log('[Push] user not ready; will write under users/* after login');
      }
    });

    // 2) Registration error
    PushNotifications.addListener('registrationError', (err) => {
      console.error('[Push] registrationError:', err);
    });

    // 3) Foreground handler (optional)
    PushNotifications.addListener('pushNotificationReceived', (n) => {
      console.log('[Push] foreground notification:', n);
    });

    // 4) Tap handler (optional deep link)
    PushNotifications.addListener('pushNotificationActionPerformed', (a) => {
      const route = (a.notification?.data as any)?.route as string | undefined;
      if (route) window.location.href = route;
    });
  }

  // Create channel (Android only; iOS ignores channels)
  if (platform === 'android') {
    try {
      await PushNotifications.createChannel({
        id: 'messages',
        name: 'Messages',
        description: 'New messages and match updates',
        importance: 5,              // IMPORTANCE_HIGH
        sound: 'tennis_ball_hit',   // Android custom sound (must exist in res/raw)
        vibration: true,
        lights: true,
      });
    } catch (e) {
      console.warn('[Push] createChannel failed (Android only)', e);
    }
  }

  // Check/request permission, then register
  const perm = await PushNotifications.checkPermissions();
  console.log('[Push] checkPermissions:', perm);
  if (perm.receive !== 'granted') {
    const req = await PushNotifications.requestPermissions();
    console.log('[Push] requestPermissions:', req);
    if (req.receive !== 'granted') {
      console.log('[Push] permission not granted, aborting register()');
      return;
    }
  }

  await PushNotifications.register();
  console.log('[Push] register() called');
}

/**
 * Call this after the user logs in (or auth state changes) to ensure
 * any already-received token is written under users/{uid}/devices/{token}.
 */
export async function bindTokenToUserIfAvailable() {
  if (typeof window === 'undefined') return;

  const { Capacitor } = await import('@capacitor/core');
  if (!Capacitor.isNativePlatform()) return;

  const platform = Capacitor.getPlatform(); // <- NEW for consistency
  const { auth, db } = await import('@/lib/firebaseConfig');
  const { doc, setDoc, serverTimestamp } = await import('firebase/firestore');

  const user = auth.currentUser;
  if (!user) return;

  // prefer in-memory, fallback to localStorage
  const token = lastFcmToken || localStorage.getItem('tm_fcm_token');
  if (!token) return;

  try {
    await setDoc(
      doc(db, 'users', user.uid, 'devices', token),
      {
        fcmToken: token,
        platform, // <- CHANGED: 'ios' or 'android'
        lastSeen: serverTimestamp(),
        prefersNativePush: true,
      },
      { merge: true }
    );
    console.log('[Push] (bind) token saved to users/*/devices/*');
  } catch (e) {
    console.error('[Push] (bind) write failed', e);
  }
}
