"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import debounce from "lodash.debounce";
import { ArrowLeft } from "lucide-react";

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

  // ===== STATE (keep all useState together) =====
  const [user, setUser] = useState<any>(null);
  const [messages, setMessages] = useState<any[]>([]);
  const [input, setInput] = useState("");
  const [userAvatar, setUserAvatar] = useState<string | null>(null);

  const [participants, setParticipants] = useState<string[]>([]);
  const [profiles, setProfiles] = useState<Record<string, { name?: string; photoURL?: string }>>({});
  const [typingUsers, setTypingUsers] = useState<string[]>([]);
  const [isEventChat, setIsEventChat] = useState(false);
  const [eventTitle, setEventTitle] = useState<string | null>(null);

  const [lastReadAt, setLastReadAt] = useState<number | null>(null);
  const [showScrollDown, setShowScrollDown] = useState(false);
  const [vvBottomInset, setVvBottomInset] = useState(0);
  const [inputBarH, setInputBarH] = useState(56); // measured later

  // ===== REFS =====
  const bottomRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const inputBarRef = useRef<HTMLDivElement>(null);

  // --- auto-scroll helpers ---
const firstLoadRef = useRef(true);

const isNearBottom = () => {
  const el = listRef.current;
  if (!el) return true;
  return el.scrollHeight - el.scrollTop - el.clientHeight < 350;
};

const scrollToBottom = (smooth = false) => {
  bottomRef.current?.scrollIntoView({ behavior: smooth ? "smooth" : "auto" });
};


  // ===== HELPERS =====

  const focusWithoutScroll = () => {
    const el = inputRef.current;
    if (!el) return;
    try { el.focus({ preventScroll: true }); } catch { el.focus(); }
  };


  const ts = (m: any) => (m?.timestamp?.toDate ? m.timestamp.toDate().getTime() : 0);
  const isSameDay = (a: Date, b: Date) =>
    a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
  const dayLabel = (d: Date) => {
    const today = new Date();
    const yest = new Date(); yest.setDate(today.getDate() - 1);
    if (isSameDay(d, today)) return "Today";
    if (isSameDay(d, yest)) return "Yesterday";
    return d.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
  };
  const timeLabel = (d: Date) => d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

  // ===== AUTH / CONVO SNAPSHOT =====
  useEffect(() => {
    let unsubscribeTyping: () => void = () => {};
    let currentUserId: string | null = null;

    const unsubscribeAuth = auth.onAuthStateChanged(async (u) => {
      if (!u) return;
      setUser(u);
      currentUserId = u.uid;

      try {
        await updateDoc(doc(db, "users", u.uid), { activeConversationId: conversationID });
      } catch (err) {
        console.error("Failed to set activeConversationId:", err);
      }

      const convoRef = doc(db, "conversations", String(conversationID));
      let convoSnap = await getDoc(convoRef);

      // Only auto-create 1:1 conversations (IDs that look like "<uid>_<uid>")
      const parts = String(conversationID || "").split("_");
      const looksLikeOneToOne = parts.length === 2 && parts.every(Boolean);
      const otherUserId = looksLikeOneToOne ? parts.find((id) => id !== u.uid) : null;

      if (!convoSnap.exists() && looksLikeOneToOne && otherUserId) {
        await setDoc(convoRef, {
          participants: [u.uid, otherUserId],
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
          typing: {},
          lastRead: { [u.uid]: serverTimestamp() },
        });
      } else if (convoSnap.exists()) {
        await updateDoc(convoRef, { [`lastRead.${u.uid}`]: serverTimestamp() });
      }

      // refresh after potential creation/update
      convoSnap = await getDoc(convoRef);

      // load my avatar
      const meRef = doc(db, "players", u.uid);
      const meSnap = await getDoc(meRef);
      if (meSnap.exists()) setUserAvatar(meSnap.data().photoURL || null);

      // conversation snapshot (context/participants/typing/lastRead)
      unsubscribeTyping = onSnapshot(convoRef, (snap) => {
        const data = snap.data() || {};

        const ctx = data.context || {};
        const isEvent = ctx.type === "event";
        setIsEventChat(!!isEvent);
        setEventTitle(isEvent ? (ctx.title || "Event Chat") : null);

        const ps: string[] = Array.isArray(data.participants) ? data.participants : [];
        setParticipants(ps);

        const typingMap = data.typing || {};
        const me = auth.currentUser?.uid;
        const othersTyping = ps.filter((id: string) => id !== me && typingMap[id] === true);
        setTypingUsers(othersTyping);

        const lr = data.lastRead?.[me || ""];
        setLastReadAt(lr?.toMillis ? lr.toMillis() : null);
      });
    });

    return () => {
      unsubscribeAuth();
      unsubscribeTyping();
      if (currentUserId) {
        (async () => {
          try {
            await updateDoc(doc(db, "users", currentUserId!), { activeConversationId: null });
          } catch (err) {
            console.error("Failed to clear activeConversationId:", err);
          }
        })();
      }
    };
  }, [conversationID]);

  // ===== INPUT BAR MEASUREMENT =====
  
  useEffect(() => {
    const el = inputBarRef.current;
    if (!el) return;

    const setH = () => setInputBarH(el.clientHeight || 56);
    setH();

    let ro: ResizeObserver | null = null;
    if ("ResizeObserver" in window) {
      ro = new ResizeObserver(setH);
      ro.observe(el);
    }
    window.addEventListener("resize", setH);
    return () => {
      ro?.disconnect();
      window.removeEventListener("resize", setH);
    };
  }, []);

  // ===== VISUAL VIEWPORT (mobile keyboards) =====
  useEffect(() => {
    const vv = (window as any).visualViewport;
    if (!vv) return;

    const computeInset = () => {
      const bottomInset = Math.max(0, window.innerHeight - (vv.height + vv.offsetTop));
      setVvBottomInset(bottomInset);
    };

    computeInset();
    vv.addEventListener("resize", computeInset);
    vv.addEventListener("scroll", computeInset);
    return () => {
      vv.removeEventListener("resize", computeInset);
      vv.removeEventListener("scroll", computeInset);
    };
  }, []);

 useEffect(() => {
  // If the textarea is focused (keyboard up), always keep latest visible.
  // Otherwise, only stick if user was already near bottom.
  if (document.activeElement === inputRef.current) {
    scrollToBottom(false);
  } else if (isNearBottom()) {
    scrollToBottom(false);
  }
}, [vvBottomInset, inputBarH]);


  // ===== LOAD PARTICIPANT PROFILES (TOP-LEVEL EFFECT) =====
  useEffect(() => {
    if (!participants.length) return;

    let cancelled = false;
    (async () => {
      const out: Record<string, { name?: string; photoURL?: string }> = {};
      for (const uid of participants) {
        try {
          const pSnap = await getDoc(doc(db, "players", uid));
          if (pSnap.exists()) {
            const d = pSnap.data() as any;
            out[uid] = { name: d.name, photoURL: d.photoURL };
          } else {
            out[uid] = {};
          }
        } catch {
          out[uid] = {};
        }
      }
      if (!cancelled) setProfiles(out);
    })();

    return () => { cancelled = true; };
  }, [participants]);

  // ===== MESSAGES SUBSCRIPTION =====
  useEffect(() => {
    if (!conversationID) return;
    const msgRef = collection(db, "conversations", String(conversationID), "messages");
    const q = query(msgRef, orderBy("timestamp"));

   const unsub = onSnapshot(q, async (snap) => {
  const msgs = snap.docs.map((d) => ({ id: d.id, ...d.data() }));

  // decide before React paints whether we should stick to bottom
  const shouldStick = firstLoadRef.current || isNearBottom();

  setMessages(msgs);

  // scroll after DOM updates
  requestAnimationFrame(() => {
    if (firstLoadRef.current) {
      scrollToBottom(false);        // jump on first load
      firstLoadRef.current = false;
    } else if (shouldStick) {
      scrollToBottom(true);         // smooth follow if near bottom
    }
  });

  if (!user) return;

  // Per-message read flags for 1:1 only
  if (!isEventChat) {
    const batch = writeBatch(db);
    let needsCommit = false;
    snap.docs.forEach((d) => {
      const msg = d.data();
      if (msg.recipientId === user.uid && msg.read === false) {
        batch.update(d.ref, { read: true });
        needsCommit = true;
      }
    });
    if (needsCommit) await batch.commit();
  }

  // Always bump my lastRead
  await updateDoc(doc(db, "conversations", String(conversationID)), {
    [`lastRead.${user.uid}`]: serverTimestamp(),
  });
});


    return () => unsub();
  }, [conversationID, user?.uid, isEventChat]);

  // ===== SEND =====
  const sendMessage = async () => {
    if (!input.trim() || !user) return;

    let recipientId: string | null = null;
    if (!isEventChat) {
      const allIds = String(conversationID || "").split("_");
      recipientId = allIds.find((id) => id !== user.uid) ?? null;
      if (!recipientId) return; // ensure valid 1:1
    }

    const newMessage: any = {
      senderId: user.uid,
      recipientId, // null for event chats
      text: input,
      timestamp: serverTimestamp(),
    };
    if (!isEventChat) newMessage.read = false;

    await addDoc(collection(db, "conversations", String(conversationID), "messages"), newMessage);
    setInput("");

    await updateDoc(doc(db, "conversations", String(conversationID)), {
      [`lastRead.${user.uid}`]: serverTimestamp(),
      [`typing.${user.uid}`]: false,
      latestMessage: { text: newMessage.text, senderId: user.uid, timestamp: serverTimestamp() },
      updatedAt: serverTimestamp(),
    });

  };

  // ===== TYPING =====
  const updateTypingStatus = debounce(async (isTyping: boolean) => {
    if (!user) return;
    await updateDoc(doc(db, "conversations", String(conversationID)), {
      [`typing.${user.uid}`]: isTyping,
    });
  }, 300);

  useEffect(() => {
  return () => updateTypingStatus.cancel();
}, [updateTypingStatus]);

  // ===== TEXTAREA AUTOGROW =====
useEffect(() => {
  const el = inputRef.current;
  if (!el) return;
  el.style.height = "0px";
  el.style.height = Math.min(el.scrollHeight, 160) + "px";
}, [input]);

useEffect(() => {
  // Focus once when the page loads (or when conversation changes),
  // without hijacking subsequent taps/clicks.
  focusWithoutScroll();
  // eslint-disable-next-line react-hooks/exhaustive-deps
}, [conversationID]);


  // ===== ROWS =====
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

  // ===== RENDER =====
  return (
    <div className="flex flex-col h-[100svh] bg-white overflow-hidden">
      {/* Header */}
      <div className="sticky top-0 z-10 bg-white/90 backdrop-blur border-b shadow-sm px-4 py-2">
        <div className="flex items-center gap-3">
          <button onClick={() => router.push("/messages")} aria-label="Back">
            <ArrowLeft className="w-5 h-5 text-gray-700" />
          </button>

          {/* Avatar: calendar badge for event chats; otherwise first "other" participant */}
          {isEventChat ? (
            <div className="w-8 h-8 rounded-full bg-emerald-100 flex items-center justify-center text-emerald-700 font-semibold">📅</div>
          ) : (
            (() => {
              const others = participants.filter(p => p !== user?.uid);
              const first = others[0];
              const photo = first ? profiles[first]?.photoURL : null;
              return photo
                ? <img src={photo} alt="avatar" className="w-8 h-8 rounded-full object-cover" />
                : <div className="w-8 h-8 rounded-full bg-gray-200" />;
            })()
          )}

          <div className="flex-1 min-w-0">
            <div className="truncate font-medium text-sm text-gray-900">
              {isEventChat
                ? (eventTitle || "Event Chat")
                : (() => {
                    const names = participants
                      .filter(p => p !== user?.uid)
                      .map(uid => profiles[uid]?.name || "Player");
                    return names.length <= 1 ? (names[0] || "Chat") : `${names[0]} + ${names.length - 1}`;
                  })()
              }
            </div>

            {/* Typing indicator (multi-user) */}
            {typingUsers.length > 0 && (
              <div className="text-[11px] text-gray-500">
                {typingUsers.length === 1
                  ? `${profiles[typingUsers[0]]?.name || "Someone"} is typing…`
                  : `${profiles[typingUsers[0]]?.name || "Someone"} and ${typingUsers.length - 1} other${typingUsers.length > 2 ? "s" : ""} are typing…`}
              </div>
            )}
          </div>
        </div>
      </div>

{/* Messages */}
<div
  ref={listRef}
  onScroll={() => {
    const el = listRef.current;
    if (!el) return;
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 350;
    setShowScrollDown(!nearBottom);
  }}
  className="flex-1 overflow-y-auto overscroll-contain px-4 pt-3 pb-2 bg-gradient-to-b from-emerald-50/40 to-white"
  style={{
    // Reserve room for input bar + keyboard inset so the last message never hides
    scrollPaddingBottom: `${inputBarH + vvBottomInset + 24}px`,
    paddingBottom: `${inputBarH + vvBottomInset + 24}px`,
  }}
>
  {/* ⬇️ Anchor short threads to the bottom */}
  <div className="min-h-full flex flex-col justify-end">
    <div>
      {rows.map((row) => {
        // ... paste your existing row render EXACTLY as-is ...
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

        const { msg, isOther, isTail } = row as any;
        const senderProfile = profiles[msg.senderId] || {};
        const avatarURL = isOther
          ? (senderProfile.photoURL || "/default-avatar.png")
          : (userAvatar || "/default-avatar.png");
        const d = msg.timestamp?.toDate ? msg.timestamp.toDate() : new Date();

        return (
          <div key={row.key} className={`mb-1.5 flex ${isOther ? "justify-start" : "justify-end"}`}>
            {/* Avatar only on cluster tail */}
            {isOther && isTail ? (
              <img src={avatarURL} alt="avatar" className="mr-2 h-6 w-6 rounded-full object-cover" />
            ) : isOther ? (
              <div className="mr-8" />
            ) : null}

            <div className="max-w-[75%] sm:max-w-md">
              <div
                className={[
                  "px-3 py-2 text-sm shadow-[0_1px_2px_rgba(0,0,0,0.04)]",
                  isOther
                    ? "bg-gray-100 text-gray-900 rounded-2xl rounded-bl-md"
                    : "bg-green-600 text-white rounded-2xl rounded-br-md",
                ].join(" ")}
              >
                {msg.text}
              </div>

              {isTail && (
                <>
                  <div className={`mt-1 text-[11px] text-gray-400 ${isOther ? "text-left" : "text-right"}`}>
                    {timeLabel(d)}
                  </div>
                  {isOther && isEventChat && (
                    <div className="mt-0.5 text-[11px] text-gray-500">
                      {senderProfile.name || "Player"}
                    </div>
                  )}
                </>
              )}
            </div>

            {!isOther && isTail ? (
              <img src={avatarURL} alt="me" className="ml-2 h-6 w-6 rounded-full object-cover" />
            ) : !isOther ? (
              <div className="ml-8" />
            ) : null}
          </div>
        );
      })}
    </div>

    {/* Bottom spacer so scrollToBottom() lands correctly */}
    <div
      ref={bottomRef}
      style={{
        height: 1,
        scrollMarginBottom: inputBarH + vvBottomInset + 24,
      }}
    />
  </div>
</div>


      {/* Scroll-to-bottom FAB */}
     {showScrollDown && (
  <button
    onClick={() => scrollToBottom(true)}
    className="fixed bottom-24 right-4 rounded-full bg-white border shadow px-3 py-1.5 text-xs text-gray-700"
  >
    Jump to latest
  </button>
)}

      {/* Input */}
      <div
        ref={inputBarRef}
        className="fixed left-0 right-0 z-10 border-t bg-white px-3 py-2"
        style={{
          bottom: vvBottomInset,
          paddingBottom: `calc(env(safe-area-inset-bottom) + 8px)`,
        }}
      >
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
  );
}

export default ChatPage;
