import * as admin from "firebase-admin";

const db = admin.firestore();

export const MESSAGE_NOTIFICATION_ACTIVE_WINDOW_MS = 60 * 1000;
export const MESSAGE_NOTIFICATION_PUSH_COOLDOWN_MS = 10 * 60 * 1000;
export const MESSAGE_NOTIFICATION_EMAIL_COOLDOWN_MS = 60 * 60 * 1000;

type MessageNotificationUpdateInput = {
  conversationId: string;
  recipientId: string;
  messageId: string;
  conversationLastReadAt?: unknown;
  nowMillis?: number;
};

export type MessageNotificationUpdateResult = {
  stateId: string;
  activeInThread: boolean;
  sendPush: boolean;
  sendEmail: boolean;
  unreadCount: number;
};

export function messageNotificationStateId(
  conversationId: string,
  recipientId: string
): string {
  return `${conversationId}_${recipientId}`;
}

export function messageNotificationStateRef(
  conversationId: string,
  recipientId: string
) {
  return db
    .collection("message_notification_state")
    .doc(messageNotificationStateId(conversationId, recipientId));
}

export function timestampToMillis(value: unknown): number | null {
  if (!value) return null;

  if (value instanceof admin.firestore.Timestamp) {
    return value.toMillis();
  }

  const maybeDate =
    value instanceof Date
      ? value
      : typeof (value as any)?.toDate === "function"
      ? (value as any).toDate()
      : null;

  if (maybeDate && !Number.isNaN(maybeDate.getTime())) {
    return maybeDate.getTime();
  }

  return null;
}

export async function updateMessageNotificationStateForMessage(
  input: MessageNotificationUpdateInput
): Promise<MessageNotificationUpdateResult> {
  const {
    conversationId,
    recipientId,
    messageId,
    conversationLastReadAt,
    nowMillis = Date.now(),
  } = input;

  const stateRef = messageNotificationStateRef(conversationId, recipientId);
  const lastReadMillis = timestampToMillis(conversationLastReadAt);
  const activeInThread =
    lastReadMillis !== null &&
    nowMillis - lastReadMillis >= 0 &&
    nowMillis - lastReadMillis <= MESSAGE_NOTIFICATION_ACTIVE_WINDOW_MS;

  return db.runTransaction(async (tx) => {
    const stateSnap = await tx.get(stateRef);
    const state = stateSnap.exists ? (stateSnap.data() as any) : null;

    const previousUnreadCount =
      typeof state?.unreadCount === "number" && Number.isFinite(state.unreadCount)
        ? state.unreadCount
        : 0;

    const nextUnreadCount = previousUnreadCount + 1;
    const lastPushMillis = timestampToMillis(state?.lastPushSentAt);
    const lastEmailMillis = timestampToMillis(state?.lastEmailSentAt);

    const sendPush =
      !activeInThread &&
      (lastPushMillis === null ||
        nowMillis - lastPushMillis >= MESSAGE_NOTIFICATION_PUSH_COOLDOWN_MS);

    const sendEmail =
      !activeInThread &&
      (lastEmailMillis === null ||
        nowMillis - lastEmailMillis >= MESSAGE_NOTIFICATION_EMAIL_COOLDOWN_MS);

    const payload: Record<string, unknown> = {
      conversationId,
      recipientId,
      lastMessageId: messageId,
      unreadCount: nextUnreadCount,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    };

    if (sendPush) {
      payload.lastPushSentAt = admin.firestore.FieldValue.serverTimestamp();
    }

    if (sendEmail) {
      payload.lastEmailSentAt = admin.firestore.FieldValue.serverTimestamp();
    }

    tx.set(stateRef, payload, { merge: true });

    return {
      stateId: stateRef.id,
      activeInThread,
      sendPush,
      sendEmail,
      unreadCount: nextUnreadCount,
    };
  });
}
