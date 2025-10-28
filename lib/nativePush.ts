// lib/nativePush.ts
export async function initNativePush() {
  // Guard SSR
  if (typeof window === 'undefined') return;

  // Lazy import Capacitor & bail on web
  const { Capacitor } = await import('@capacitor/core');
  if (!Capacitor.isNativePlatform()) {
    console.log('[Push] skip: web platform');
    return;
  }

  // Lazy imports to keep web bundle slim
  const { PushNotifications } = await import('@capacitor/push-notifications');
  const { auth, db } = await import('@/lib/firebaseConfig'); // adjust if your exports live elsewhere
  const { doc, setDoc, serverTimestamp } = await import('firebase/firestore');

  try {
    // Create channel first (Android 8+)
    await PushNotifications.createChannel({
      id: 'messages',
      name: 'Messages',
      description: 'New messages and match updates',
      importance: 5, // HIGH
    });

    // --- LISTENERS FIRST (so we don't miss early events) ---
    PushNotifications.addListener('registration', async ({ value }) => {
      const token = value;
      console.log('[Push] registration token:', token);

      // Debug write (token regardless of auth state)
      try {
        await setDoc(
          doc(db, 'device_tokens', token),
          { fcmToken: token, platform: 'android', seenAt: serverTimestamp() },
          { merge: true }
        );
        console.log('[Push] token saved to /device_tokens (debug)');
      } catch (e) {
        console.error('[Push] debug write failed', e);
      }

      // Per-user write (requires logged-in user)
      const user = auth.currentUser;
      if (!user) {
        console.log('[Push] user not ready; will save under users/* when available');
        return;
      }
      try {
        await setDoc(
          doc(db, 'users', user.uid, 'devices', token),
          { fcmToken: token, platform: 'android', lastSeen: serverTimestamp(), prefersNativePush: true },
          { merge: true }
        );
        console.log('[Push] token saved to users/*/devices/*');
      } catch (e) {
        console.error('[Push] user devices write failed', e);
      }
    });

    PushNotifications.addListener('registrationError', (err) => {
      console.error('[Push] registrationError:', err);
    });

    PushNotifications.addListener('pushNotificationReceived', (n) => {
      console.log('[Push] foreground notification:', n);
    });

    PushNotifications.addListener('pushNotificationActionPerformed', (a) => {
      const route = (a.notification?.data as any)?.route as string | undefined;
      if (route) window.location.href = route;
    });

    // --- THEN permissions + register ---
    const perm = await PushNotifications.checkPermissions();
    console.log('[Push] checkPermissions:', perm);
    if (perm.receive !== 'granted') {
      const req = await PushNotifications.requestPermissions();
      console.log('[Push] requestPermissions:', req);
    }

    await PushNotifications.register();
    console.log('[Push] register() called');
  } catch (e) {
    console.error('[Push] init error:', e);
  }
}
