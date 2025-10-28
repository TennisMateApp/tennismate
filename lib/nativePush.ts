// lib/nativePush.ts
import { Capacitor } from '@capacitor/core';
import { PushNotifications } from '@capacitor/push-notifications';
import { auth } from '@/lib/firebase';  // or '@/lib/firebaseConfig' if that's your export
import { db } from '@/lib/firebase';
import { doc, setDoc, serverTimestamp } from 'firebase/firestore';

export async function initNativePush() {
  if (!Capacitor.isNativePlatform()) {
    console.log('[Push] skip: web platform');
    return;
  }
  try {
    // Create channel before registering (Android 8+)
    await PushNotifications.createChannel({
      id: 'messages',
      name: 'Messages',
      description: 'New messages and match updates',
      importance: 5, // IMPORTANCE_HIGH
    });

    // Android 13+ runtime permission
    const perm = await PushNotifications.checkPermissions();
    console.log('[Push] checkPermissions:', perm);
    if (perm.receive !== 'granted') {
      const req = await PushNotifications.requestPermissions();
      console.log('[Push] requestPermissions:', req);
    }

    // Register for push
    await PushNotifications.register();
    console.log('[Push] register() called');

    // Token success
    PushNotifications.addListener('registration', async ({ value }) => {
      const token = value;
      console.log('[Push] registration token:', token);
      const user = auth.currentUser;
      if (!user || !token) return;

      await setDoc(
        doc(db, 'users', user.uid, 'devices', token),
        { fcmToken: token, platform: 'android', lastSeen: serverTimestamp(), prefersNativePush: true },
        { merge: true }
      );
      console.log('[Push] token saved to Firestore');
    });

    // Token error
    PushNotifications.addListener('registrationError', (err) => {
      console.error('[Push] registrationError:', err);
    });

    // Foreground receipt (optional)
    PushNotifications.addListener('pushNotificationReceived', (n) => {
      console.log('[Push] foreground notification:', n);
    });

    // Tap handler with deep link
    PushNotifications.addListener('pushNotificationActionPerformed', (a) => {
      const route = (a.notification?.data as any)?.route as string | undefined;
      if (route) window.location.href = route;
    });
  } catch (e) {
    console.error('[Push] init error:', e);
  }
}
