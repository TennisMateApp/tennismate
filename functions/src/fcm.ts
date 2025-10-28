// functions/src/fcm.ts
import * as admin from 'firebase-admin';
const fcm = admin.messaging();

export async function sendAndroidPushToUser(
  uid: string,
  payload: { title: string; body: string; route?: string }
) {
  const snap = await admin.firestore().collection('users').doc(uid).collection('devices').get();
  const tokens = snap.docs
    .map(d => ({ token: d.id, platform: d.get('platform') as string }))
    .filter(d => d.platform === 'android')
    .map(d => d.token);

  if (!tokens.length) return false;

  const message: admin.messaging.MulticastMessage = {
    tokens,
    notification: { title: payload.title, body: payload.body },
    data: payload.route ? { route: payload.route } : {},
    android: {
      priority: 'high',
      notification: {
        channelId: 'messages',
        sound: 'default',
      }
    }
  };

  const res = await fcm.sendEachForMulticast(message);
  const failures = res.responses.filter(r => !r.success);
  if (failures.length) {
    // optionally cleanup invalid tokens
  }
  return true;
}
