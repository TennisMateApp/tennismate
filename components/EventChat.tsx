// components/EventChat.tsx
"use client";

import { useEffect, useRef, useState } from "react";
import { auth, db } from "@/lib/firebaseConfig";
import {
  addDoc,
  collection,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
} from "firebase/firestore";
import Link from "next/link";

type Props = {
  eventId: string;
  uid: string | null;
  disabled?: boolean;
  participantIds: string[];
};

type ChatMessage = {
  id: string;
  text: string;
  userId: string;
  createdAt?: any;
};

export default function EventChat({ eventId, uid, disabled, participantIds }: Props) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [value, setValue] = useState("");
  const listRef = useRef<HTMLDivElement>(null);

  // Subscribe to chat messages for this event
  useEffect(() => {
    if (!eventId) return;
    const q = query(
      collection(db, "events", eventId, "chat"),
      orderBy("createdAt", "asc")
    );
    const off = onSnapshot(q, (snap) => {
      const items: ChatMessage[] = snap.docs.map((d) => ({ id: d.id, ...(d.data() as any) }));
      setMessages(items);
      // scroll to bottom on new messages
      requestAnimationFrame(() => {
        listRef.current?.scrollTo({ top: listRef.current.scrollHeight });
      });
    });
    return () => off();
  }, [eventId]);

  async function handleSend() {
    if (!uid || !value.trim() || disabled) return;
    try {
      await addDoc(collection(db, "events", eventId, "chat"), {
        text: value.trim(),
        userId: uid,
        createdAt: serverTimestamp(),
      });
      setValue("");
    } catch (e) {
      console.error("send failed", e);
    }
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter") {
      e.preventDefault();
      handleSend();
    }
  }

  const canPost = !!uid && !disabled;

  return (
    <div className="flex h-[55vh] flex-col rounded-xl border">
      {/* Messages */}
      <div ref={listRef} className="flex-1 overflow-y-auto p-3 space-y-2 bg-white">
        {messages.length === 0 && (
          <p className="text-center text-xs text-gray-500 mt-6">No messages yet.</p>
        )}
        {messages.map((m) => {
          const mine = m.userId === uid;
          return (
            <div key={m.id} className={`flex ${mine ? "justify-end" : "justify-start"}`}>
              <div
                className={`max-w-[75%] rounded-2xl px-3 py-2 text-sm ${
                  mine ? "bg-emerald-600 text-white" : "bg-gray-100 text-gray-900"
                }`}
                title={m.createdAt?.toDate ? m.createdAt.toDate().toLocaleString() : ""}
              >
                <p className="whitespace-pre-wrap break-words">{m.text}</p>
              </div>
            </div>
          );
        })}
      </div>

      {/* Composer */}
      <div className="border-t bg-white p-2">
        {!uid ? (
          <div className="flex items-center justify-between">
            <p className="text-xs text-gray-600">Sign in to chat with players in this event.</p>
            <Link
              href="/login"
              className="rounded-lg bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-emerald-700"
            >
              Sign in
            </Link>
          </div>
        ) : (
          <div className="flex items-center gap-2">
            <input
              type="text"
              value={value}
              onChange={(e) => setValue(e.target.value)}
              onKeyDown={onKeyDown}
              disabled={!canPost}
              placeholder={disabled ? "Chat is closed for this event" : "Type a message…"}
              className="flex-1 rounded-lg border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-300 disabled:bg-gray-100"
            />
            <button
              onClick={handleSend}
              disabled={!canPost || !value.trim()}
              className="rounded-lg bg-emerald-600 px-3 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-60"
            >
              Send
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
