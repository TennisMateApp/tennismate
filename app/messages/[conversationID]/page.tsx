"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import debounce from "lodash.debounce";
import { ArrowLeft } from "lucide-react";
import withAuth from "@/components/withAuth";

import { db, auth } from "@/lib/firebaseConfig";
import {
  doc,
  getDoc,
  setDoc,
  collection,
  addDoc,
  onSnapshot,
  serverTimestamp,
  orderBy,
  query,
  updateDoc,
  writeBatch,
  deleteDoc,
  deleteField,
  where,
  Timestamp,
} from "firebase/firestore";

// 🆕 Event UI
import ProposeTimeButton from "@/components/events/ProposeTimeButton";
import ProposalCard from "@/components/events/ProposalCard";

function ChatPage() {
  const { conversationID } = useParams();
  const router = useRouter();
  const [user, setUser] = useState<any>(null);

  // Messages
  const [messages, setMessages] = useState<any[]>([]);
  const [input, setInput] = useState("");

  // Opponent display
  const [otherUserName, setOtherUserName] = useState<string | null>(null);
  const [otherUserAvatar, setOtherUserAvatar] = useState<string | null>(null);
  const [userAvatar, setUserAvatar] = useState<string | null>(null);
  const [otherUserTyping, setOtherUserTyping] = useState(false);

  // 🆕 Conversation participants (source of truth for events)
  const [participants, setParticipants] = useState<string[]>([]);

  // Read/unread UI
  const [lastReadAt, setLastReadAt] = useState<number | null>(null);
  const [showScrollDown, setShowScrollDown] = useState(false);

  // 🆕 Event proposals for this conversation
  const [events, setEvents] = useState<any[]>([]);

  const bottomRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  function smartScrollToBottom() {
  const el = listRef.current;
  if (!el) return;
  const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 200;
  if (nearBottom) {
    requestAnimationFrame(() => {
      bottomRef.current?.scrollIntoView({ behavior: "auto" });
    });
  }
}

  // helpers (timeline timestamps)
 const tsMsg = (m: any) =>
  m?.timestamp?.toDate ? m.timestamp.toDate().getTime() : 0;

  // 🔁 use createdAt for event placement in chat timeline
const tsEvent = (e: any) => {
  const ca = e?.createdAt;
  if (ca?.toDate) return ca.toDate().getTime();
  return Date.now(); // show at the bottom immediately
};

  const isSameDay = (a: Date, b: Date) =>
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate();

  const dayLabel = (d: Date) => {
    const today = new Date();
    const yest = new Date();
    yest.setDate(today.getDate() - 1);
    if (isSameDay(d, today)) return "Today";
    if (isSameDay(d, yest)) return "Yesterday";
    return d.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
  };

  const timeLabel = (d: Date) =>
    d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

  useEffect(() => {
    let unsubscribeTyping: () => void = () => {};
    let currentUserId: string | null = null;

    const unsubscribeAuth = auth.onAuthStateChanged(async (u) => {
      if (!u) return;
      setUser(u);
      currentUserId = u.uid;

      // Set activeConversationId (used to suppress pushes)
      try {
        await updateDoc(doc(db, "users", u.uid), { activeConversationId: conversationID });
      } catch (err) {
        console.error("Failed to set activeConversationId:", err);
      }

      const convoRef = doc(db, "conversations", conversationID as string);
      let convoSnap = await getDoc(convoRef);

      const allIds = (conversationID as string).split("_");
      const otherUserId = allIds.find((id) => id !== u.uid);

      if (!convoSnap.exists() && otherUserId) {
        // Create conversation doc
        await setDoc(convoRef, {
          participants: [u.uid, otherUserId],
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
          typing: {},
          lastReadAt: { [u.uid]: serverTimestamp() },
          lastRead: { [u.uid]: serverTimestamp() },
        });
        setParticipants([u.uid, otherUserId]);
      } else {
        const data = convoSnap.data() || {};
        if (Array.isArray(data.participants)) setParticipants(data.participants);

        // Mark as read on open
        await updateDoc(convoRef, {
          [`lastReadAt.${u.uid}`]: serverTimestamp(),
          [`lastRead.${u.uid}`]: serverTimestamp(),
        });
      }

      // Clear firstUnread + any pending reminder for this user/thread
      try {
        await updateDoc(convoRef, { [`firstUnreadAt.${u.uid}`]: deleteField() });
      } catch {}
      try {
        await deleteDoc(doc(db, "email_reminders", `${u.uid}_${conversationID}`));
      } catch {}

      // Load other user display info
      if (otherUserId) {
        try {
          const otherUserRef = doc(db, "players", otherUserId);
          const otherSnap = await getDoc(otherUserRef);
          if (otherSnap.exists()) {
            const otherData = otherSnap.data();
            setOtherUserName(otherData.name || "TennisMate");
            setOtherUserAvatar(otherData.photoURL || null);
          }
        } catch (err) {
          console.error("Error loading other user profile:", err);
        }
      }

      const meRef = doc(db, "players", u.uid);
      const meSnap = await getDoc(meRef);
      if (meSnap.exists()) setUserAvatar(meSnap.data().photoURL || null);

      // Live typing + read watermark + participants
      unsubscribeTyping = onSnapshot(convoRef, (snap) => {
        const data = snap.data() || {};
        const typingData = data.typing || {};
        const otherTypingId = data.participants?.find((id: string) => id !== u.uid);
        setOtherUserTyping(typingData[otherTypingId] === true);
        if (Array.isArray(data.participants)) setParticipants(data.participants);

        const lr =
          (data.lastReadAt && data.lastReadAt[u.uid]) ||
          (data.lastRead && data.lastRead[u.uid]);
        const ms =
          lr?.toMillis?.() ?? (lr?.toDate ? lr.toDate().getTime() : null);
        setLastReadAt(typeof ms === "number" ? ms : null);
      });
    });

    return () => {
      unsubscribeAuth();
      unsubscribeTyping();
      if (currentUserId) {
        const clearActive = async () => {
          try {
            await updateDoc(doc(db, "users", currentUserId!), { activeConversationId: null });
          } catch (err) {
            console.error("Failed to clear activeConversationId:", err);
          }
        };
        clearActive();
      }
    };
  }, [conversationID]);

  // Messages stream
  useEffect(() => {
    if (!conversationID) return;
    const msgRef = collection(db, "conversations", conversationID as string, "messages");
    const qy = query(msgRef, orderBy("timestamp"));

    const unsub = onSnapshot(qy, async (snap) => {
      const msgs = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      setMessages(msgs);

      // Mark unread incoming as read
      const batch = writeBatch(db);
      let anyUnread = false;
      snap.docs.forEach((d) => {
        const msg = d.data() as any;
        if (msg.recipientId === user?.uid && msg.read === false) {
          batch.update(d.ref, { read: true });
          anyUnread = true;
        }
      });
      if (anyUnread) {
        try {
          await batch.commit();
        } catch (e) {
          console.error("Failed to mark messages read:", e);
        }
      }

      // Also bump conversation read fields + clear firstUnread & reminder
      if (user?.uid) {
        const convoRef = doc(db, "conversations", conversationID as string);
        try {
          await updateDoc(convoRef, {
            [`lastReadAt.${user.uid}`]: serverTimestamp(),
            [`lastRead.${user.uid}`]: serverTimestamp(),
            [`firstUnreadAt.${user.uid}`]: deleteField(),
          });
        } catch {}
        try {
          await deleteDoc(doc(db, "email_reminders", `${user.uid}_${conversationID}`));
        } catch {}
      }

      // Scroll to bottom after render
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          bottomRef.current?.scrollIntoView({ behavior: "auto" });
        });
      });
    });

    return () => unsub();
  }, [conversationID, user?.uid]);

// 🆕 Event proposals stream (order by post time, not event time)
useEffect(() => {
  if (!conversationID) return;

  const qEvents = query(
    collection(db, "match_events"),
    where("matchId", "==", conversationID as string),
    orderBy("createdAt", "asc")
  );

  const unsub = onSnapshot(
    qEvents,
    (snap) => {
      setEvents(snap.docs.map((d) => ({ id: d.id, ...d.data() })));

      // ✅ scroll after events render too
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          bottomRef.current?.scrollIntoView({ behavior: "auto" });
        });
      });
    },
    (err) => console.error("match_events listener error", err)
  );

  return () => unsub();
}, [conversationID]);



  const sendMessage = async () => {
    if (!input.trim() || !user) return;

    const allIds = (conversationID as string).split("_");
    const recipientId = allIds.find((id) => id !== user.uid);
    if (!recipientId) return;

    const newMessage = {
      senderId: user.uid,
      recipientId,
      text: input,
      timestamp: serverTimestamp(),
      read: false,
    };

    await addDoc(collection(db, "conversations", conversationID as string, "messages"), newMessage);
    setInput("");

    // Keep conversation metadata up to date
    await updateDoc(doc(db, "conversations", conversationID as string), {
      latestMessage: newMessage,
      lastMessageAt: serverTimestamp(),
      [`lastReadAt.${user.uid}`]: serverTimestamp(),
      [`lastRead.${user.uid}`]: serverTimestamp(),
      [`typing.${user.uid}`]: false,
    });
  };

  const updateTypingStatus = debounce(async (isTyping: boolean) => {
    if (!user) return;
    await updateDoc(doc(db, "conversations", conversationID as string), {
      [`typing.${user.uid}`]: isTyping,
    });
  }, 300);

  // auto-grow textarea
  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = "0px";
    el.style.height = Math.min(el.scrollHeight, 160) + "px";
  }, [input]);

  // 🆕 Merge messages + events chronologically with day & unread dividers
  const rows = useMemo(() => {
    type Row =
      | { type: "day"; key: string; label: string }
      | { type: "unread"; key: string }
      | { type: "msg"; key: string; msg: any; isOther: boolean; isTail: boolean }
      | { type: "event"; key: string; ev: any };

    // Build a unified list with timeline timestamps
    const items: Array<{ kind: "msg" | "event"; t: number; data: any }> = [];

    for (const m of messages) items.push({ kind: "msg", t: tsMsg(m), data: m });
    for (const e of events) items.push({ kind: "event", t: tsEvent(e), data: e });

    // Sort by post time ascending
    items.sort((a, b) => a.t - b.t);

    const out: Row[] = [];
    let lastDayKey = "";
    let unreadInserted = false;

    items.forEach((it, i) => {
      // Day divider should reflect timeline timestamp (message time or event createdAt)
      const date = new Date(it.t);

      const dayKey = date.toDateString();
      if (dayKey !== lastDayKey) {
        out.push({ type: "day", key: `day-${dayKey}`, label: dayLabel(date) });
        lastDayKey = dayKey;
      }

      // Unread divider (only relevant to messages from other user)
      if (
        it.kind === "msg" &&
        !unreadInserted &&
        lastReadAt &&
        it.t > lastReadAt &&
        it.data.senderId !== user?.uid
      ) {
        out.push({ type: "unread", key: `unread-${it.t}` });
        unreadInserted = true;
      }

      if (it.kind === "msg") {
        const m = it.data;
        const next = items[i + 1]?.kind === "msg" ? items[i + 1].data : null;
        const isTail =
          !next ||
          next.senderId !== m.senderId ||
          (items[i + 1]?.t ?? 0) - it.t > 2 * 60 * 1000;

        out.push({
          type: "msg",
          key: m.id,
          msg: m,
          isOther: m.senderId !== user?.uid,
          isTail,
        });
      } else {
        out.push({ type: "event", key: `event-${it.data.id}`, ev: it.data });
      }
    });

    return out;
  }, [messages, events, lastReadAt, user?.uid]);

  return (
    <div className="flex flex-col h-screen bg-white">
      {/* Header */}
      <div className="sticky top-0 z-10 bg-white/90 backdrop-blur border-b shadow-sm px-4 py-2">
        <div className="flex items-center gap-3">
          <button onClick={() => router.push("/messages")} aria-label="Back">
            <ArrowLeft className="w-5 h-5 text-gray-700" />
          </button>

          {otherUserAvatar ? (
            <img
              src={otherUserAvatar}
              alt="avatar"
              className="w-8 h-8 rounded-full object-cover opacity-0 transition-opacity duration-300"
              onLoad={(e) => e.currentTarget.classList.add("opacity-100")}
            />
          ) : (
            <div className="w-8 h-8 rounded-full bg-gray-200" />
          )}

          <div className="flex-1 min-w-0">
            <div className="truncate font-medium text-sm text-gray-900">{otherUserName || "Chat"}</div>
            {otherUserTyping && <div className="text-[11px] text-gray-500">typing…</div>}
          </div>
        </div>
      </div>

      {/* Messages + Events */}
      <div
        ref={listRef}
        onScroll={() => {
          const el = listRef.current;
          if (!el) return;
          const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 200;
          setShowScrollDown(!nearBottom);
        }}
        className="flex-1 overflow-y-auto px-4 pt-3 pb-2 bg-gradient-to-b from-emerald-50/40 to-white"
      >
        {rows.map((row) => {
          if (row.type === "day") {
            return (
              <div key={row.key} className="my-3 text-center">
                <span className="inline-block rounded-full border bg-white px-3 py-1 text-xs text-gray-600">
                  {row.label}
                </span>
              </div>
            );
          }

          if (row.type === "unread") {
            return (
              <div key={row.key} className="my-2 flex items-center gap-3">
                <div className="h-px flex-1 bg-red-200" />
                <span className="text-[11px] font-medium text-red-600">New</span>
                <div className="h-px flex-1 bg-red-200" />
              </div>
            );
          }

          if (row.type === "event") {
            const ev = row.ev;
            return (
              <div key={row.key} className="mb-2 max-w-[90%]">
                <ProposalCard
                  eventId={ev.id}
                  start={ev.start as Timestamp}
                  end={ev.end as Timestamp}
                  durationMins={ev.durationMins}
                  courtName={ev.courtName}
                  note={ev.note}
                  state={ev.state}
                  currentUserId={user?.uid}
                  participants={ev.participants || []}
                  proposerId={ev.proposerId}
                />
              </div>
            );
          }

          const { msg, isOther, isTail } = row;
          const avatarURL = isOther ? otherUserAvatar : userAvatar;
          const d = msg.timestamp?.toDate ? msg.timestamp.toDate() : new Date();

          return (
            <div key={row.key} className={`mb-1.5 flex ${isOther ? "justify-start" : "justify-end"}`}>
              {/* Avatar only on cluster tail */}
              {isOther && isTail ? (
                <img src={avatarURL || "/images/default-avatar.png"} alt="avatar" className="mr-2 h-6 w-6 rounded-full object-cover" />
              ) : isOther ? (
                <div className="mr-8" />
              ) : null}

              <div className="max-w-[75%] sm:max-w-md">
                <div
                  className={[
                    "px-3 py-2 text-sm shadow-[0_1px_2px_rgba(0,0,0,0.04)]",
                    isOther ? "bg-gray-100 text-gray-900 rounded-2xl rounded-bl-md" : "bg-green-600 text-white rounded-2xl rounded-br-md",
                  ].join(" ")}
                >
                  {msg.text}
                </div>

                {isTail && (
                  <div className={`mt-1 text-[11px] text-gray-400 ${isOther ? "text-left" : "text-right"}`}>{timeLabel(d)}</div>
                )}
              </div>

              {!isOther && isTail ? (
                <img src={avatarURL || "/images/default-avatar.png"} alt="me" className="ml-2 h-6 w-6 rounded-full object-cover" />
              ) : !isOther ? (
                <div className="ml-8" />
              ) : null}
            </div>
          );
        })}

        <div ref={bottomRef} />
      </div>

      {/* Scroll-to-bottom FAB */}
      {showScrollDown && (
        <button
          onClick={() => bottomRef.current?.scrollIntoView({ behavior: "smooth" })}
          className="fixed bottom-24 right-4 rounded-full bg-white border shadow px-3 py-1.5 text-xs text-gray-700"
        >
          Jump to latest
        </button>
      )}

      {/* Actions row + Composer (stacked, sticky) */}
      <div
        className="sticky bottom-0 z-10 border-t bg-white"
        style={{ paddingBottom: "calc(env(safe-area-inset-bottom) + 8px)" }}
      >
        {/* Actions row */}
        <div className="px-3 py-2">
          {!!participants.length && (
            <div className="flex">
              <ProposeTimeButton
                matchId={conversationID as string}
                participants={participants}
                currentUserId={user?.uid}
              />
            </div>
          )}
        </div>

        {/* Composer row */}
        <div className="px-3 pb-2">
          <div className="flex items-end gap-2">
            <textarea
              ref={inputRef}
              rows={1}
              className="flex-1 max-h-40 resize-none rounded-lg border px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-green-600"
              placeholder="Type a message…"
              value={input}
              onChange={(e) => {
                setInput(e.target.value);
                updateTypingStatus(true);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  sendMessage();
                }
              }}
              onBlur={() => updateTypingStatus(false)}
            />

            <button
              onClick={sendMessage}
              disabled={!input.trim()}
              className="rounded-lg bg-green-600 px-4 py-2 text-sm font-semibold text-white shadow hover:bg-green-700 disabled:opacity-50"
            >
              Send
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default withAuth(ChatPage);
