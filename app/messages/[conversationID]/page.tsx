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
} from "firebase/firestore";

function ChatPage() {
  const { conversationID } = useParams();
  const router = useRouter();
  const [user, setUser] = useState<any>(null);
  const [messages, setMessages] = useState<any[]>([]);
  const [input, setInput] = useState("");
  const [otherUserName, setOtherUserName] = useState<string | null>(null);
  const [otherUserAvatar, setOtherUserAvatar] = useState<string | null>(null);
  const [userAvatar, setUserAvatar] = useState<string | null>(null);
  const [otherUserTyping, setOtherUserTyping] = useState(false);

  const bottomRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const didInitialAutoscroll = useRef(false);

    const keepBottomPinned = () => {
    const el = listRef.current;
    if (!el) return;
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 250;
    if (nearBottom) {
      bottomRef.current?.scrollIntoView({ behavior: "auto", block: "end" });
    }
  };

  const [lastReadAt, setLastReadAt] = useState<number | null>(null);
  const [showScrollDown, setShowScrollDown] = useState(false);

  // helpers
  const ts = (m: any) => (m?.timestamp?.toDate ? m.timestamp.toDate().getTime() : 0);

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

  const timeLabel = (d: Date) => d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

  useEffect(() => {
      didInitialAutoscroll.current = false;
    let unsubscribeTyping: () => void = () => {};
    let currentUserId: string | null = null;

    const unsubscribeAuth = auth.onAuthStateChanged(async (u) => {
      if (!u) return;
      setUser(u);
      currentUserId = u.uid;

      // Set activeConversationId
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
        await setDoc(convoRef, {
          participants: [u.uid, otherUserId],
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
          typing: {},
          lastRead: { [u.uid]: serverTimestamp() },
        });
      } else {
        await updateDoc(convoRef, { [`lastRead.${u.uid}`]: serverTimestamp() });
      }

      convoSnap = await getDoc(convoRef);

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

      unsubscribeTyping = onSnapshot(convoRef, (snap) => {
        const data = snap.data() || {};
        const typingData = data.typing || {};
        const otherTypingId = data.participants?.find((id: string) => id !== u.uid);
        setOtherUserTyping(typingData[otherTypingId] === true);

        const lr = data.lastRead?.[u.uid];
        setLastReadAt(lr?.toMillis ? lr.toMillis() : null);
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

        // When the mobile keyboard changes the visual viewport, keep the bottom in view
  useEffect(() => {
    const vv = (window as any).visualViewport;
    if (!vv) return;

    const onVVChange = () => {
      // delay slightly so layout settles
      setTimeout(() => keepBottomPinned(), 50);
    };

    vv.addEventListener("resize", onVVChange);
    vv.addEventListener("scroll", onVVChange); // some browsers fire scroll while keyboard animates
    return () => {
      vv.removeEventListener("resize", onVVChange);
      vv.removeEventListener("scroll", onVVChange);
    };
  }, []);

  useEffect(() => {
    if (!conversationID) return;
    const msgRef = collection(db, "conversations", conversationID as string, "messages");
    const q = query(msgRef, orderBy("timestamp"));

    const unsub = onSnapshot(q, (snap) => {
      const msgs = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      setMessages(msgs);

      // mark unread incoming as read
      const markAsRead = async () => {
        const batch = writeBatch(db);
        snap.docs.forEach((d) => {
          const msg = d.data();
          if (msg.recipientId === user?.uid && msg.read === false) {
            batch.update(d.ref, { read: true });
          }
        });
        await batch.commit();
      };

      markAsRead();

      if (!didInitialAutoscroll.current) {
        // First render of this thread: force jump to bottom
        requestAnimationFrame(() => {
          bottomRef.current?.scrollIntoView({ behavior: "auto", block: "end" });
          didInitialAutoscroll.current = true;
        });
      } else {
        // Subsequent updates: only pin if user is near bottom
        keepBottomPinned();
      }

    });

    return () => unsub();
  }, [conversationID, user?.uid]);

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

    await updateDoc(doc(db, "conversations", conversationID as string), {
      [`lastRead.${user.uid}`]: serverTimestamp(),
      [`typing.${user.uid}`]: false,
      latestMessage: newMessage,
    });
  };

  keepBottomPinned();

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

    // Auto-grow now
    el.style.height = "0px";
    el.style.height = Math.min(el.scrollHeight, 160) + "px";
    keepBottomPinned();

    // Also react to future growth (e.g., long messages/paste)
    let ro: ResizeObserver | null = null;
    if ("ResizeObserver" in window) {
      ro = new ResizeObserver(() => keepBottomPinned());
      ro.observe(el);
    }
    return () => ro?.disconnect();
  }, [input]);


  // rows for day/unread dividers + cluster tails
  const rows = useMemo(() => {
    const out: Array<
      | { type: "day"; key: string; label: string }
      | { type: "unread"; key: string }
      | { type: "msg"; key: string; msg: any; isOther: boolean; isTail: boolean }
    > = [];

    let lastDayKey = "";
    let unreadInserted = false;

    messages.forEach((m, i) => {
      const curDate = m.timestamp?.toDate ? m.timestamp.toDate() : new Date(0);
      const dayKey = curDate.toDateString();

      if (dayKey !== lastDayKey) {
        out.push({ type: "day", key: `day-${dayKey}`, label: dayLabel(curDate) });
        lastDayKey = dayKey;
      }

      if (!unreadInserted && lastReadAt && ts(m) > lastReadAt && m.senderId !== user?.uid) {
        out.push({ type: "unread", key: `unread-${ts(m)}` });
        unreadInserted = true;
      }

      const next = messages[i + 1];
      const isTail = !next || next.senderId !== m.senderId || ts(next) - ts(m) > 2 * 60 * 1000;

      out.push({
        type: "msg",
        key: m.id,
        msg: m,
        isOther: m.senderId !== user?.uid,
        isTail,
      });
    });

    return out;
  }, [messages, lastReadAt, user?.uid]);

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

      {/* Messages */}
<div
  ref={listRef}
  onScroll={() => {
    const el = listRef.current;
    if (!el) return;
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 200;
    setShowScrollDown(!nearBottom);
  }}
  className="flex-1 overflow-y-auto overscroll-contain px-4 pt-3 pb-2 bg-gradient-to-b from-emerald-50/40 to-white"
  style={{
    // ensure there's breathing room so the last message isn't hidden by the input
    scrollPaddingBottom: "120px",
    overflowAnchor: "none",
  }}
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

          const { msg, isOther, isTail } = row;
          const avatarURL = isOther ? otherUserAvatar : userAvatar;
          const d = msg.timestamp?.toDate ? msg.timestamp.toDate() : new Date();

          return (
            <div key={row.key} className={`mb-1.5 flex ${isOther ? "justify-start" : "justify-end"}`}>
              {/* Avatar only on cluster tail */}
              {isOther && isTail ? (
                <img src={avatarURL || "/default-avatar.png"} alt="avatar" className="mr-2 h-6 w-6 rounded-full object-cover" />
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
                <img src={avatarURL || "/default-avatar.png"} alt="me" className="ml-2 h-6 w-6 rounded-full object-cover" />
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

      {/* Input */}
      <div
        className="sticky bottom-0 z-10 border-t bg-white px-3 py-2"
        style={{ paddingBottom: "calc(env(safe-area-inset-bottom) + 8px)" }}
      >
        <div className="flex items-end gap-2">
<textarea
  ref={inputRef}
  rows={1}
  className="flex-1 max-h-40 resize-none rounded-lg border px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-green-600"
  placeholder="Type a message…"
  value={input}
  onFocus={() => {
    // allow keyboard animation to start then pin bottom
    setTimeout(() => {
      bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
    }, 50);
  }}
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
  );
}

export default ChatPage;
