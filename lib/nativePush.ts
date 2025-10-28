// lib/nativePush.ts
export async function initNativePush() {
  // SSR / web guard
  if (typeof window === 'undefined') return;

  // Import @capacitor/core lazily (keeps it out of initial web bundle)
  const { Capacitor } = await import('@capacitor/core');
  if (!Capacitor.isNativePlatform()) {
    console.log('[Push] skip: web platform');
    return;
  }

  const { PushNotifications } = await import('@capacitor/push-notifications');

  try {
    await PushNotifications.createChannel({
      id: 'messages',
      name: 'Messages',
      description: 'New messages and match updates',
      importance: 5,
    });

    const perm = await PushNotifications.checkPermissions();
    console.log('[Push] checkPermissions:', perm);
    if (perm.receive !== 'granted') {
      const req = await PushNotifications.requestPermissions();
      console.log('[Push] requestPermissions:', req);
    }

    await PushNotifications.register();
    console.log('[Push] register() called');

    // You can keep your Firestore write here exactly as before...
    // (no changes needed beyond the dynamic imports + guards)
  } catch (e) {
    console.error('[Push] init error:', e);
  }
}
