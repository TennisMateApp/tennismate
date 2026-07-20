// lib/conversations.ts
import { db, auth } from "@/lib/firebaseConfig";
import { doc, runTransaction, serverTimestamp } from "firebase/firestore";

/** One group conversation per event: id = "event_<eventId>" (atomic & idempotent) */
export async function ensureEventConversation(
  eventId: string,
  participants: string[],
  title?: string
): Promise<string> {
  const conversationId = `event_${eventId}`;
  const ref = doc(db, "conversations", conversationId);

  const uniq = Array.from(new Set(participants.filter(Boolean)));

  await runTransaction(db, async (tx) => {
    const snap = await tx.get(ref);
    const now = serverTimestamp();
    const me = auth.currentUser?.uid || null;

    if (!snap.exists()) {
      tx.set(ref, {
        participants: uniq,
        context: { type: "event", eventId, title: title || "Event Chat" },
        typing: {},
        lastRead: me ? { [me]: now } : {},
        createdAt: now,
        updatedAt: now,
      });
    } else {
      const cur = (snap.data() as any) || {};

      // The event document is the source of truth for chat membership. This adds
      // newly accepted attendees and removes anyone who has left the event.
      const newContext = {
        ...(cur.context || {}),
        type: "event",
        eventId,
        title: title || cur?.context?.title || "Event Chat",
      };

      const updates: any = {
        participants: uniq,
        context: newContext,
        updatedAt: now,
      };

      // Bump my lastRead so the unread divider behaves predictably
      if (me) {
        updates.lastRead = { ...(cur.lastRead || {}), [me]: now };
      }

      tx.update(ref, updates);
    }
  });

  return conversationId;
}
