"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { db, auth } from "@/lib/firebaseConfig";
import {
  collection,
  query,
  where,
  getDocs,
  orderBy,
  limit,
  getDoc,
  doc,
  deleteDoc,
  onSnapshot,
} from "firebase/firestore";
import { useRouter } from "next/navigation";
import { Search, Trash2 } from "lucide-react";
import { onAuthStateChanged } from "firebase/auth";
import withAuth from "@/components/withAuth";

/** ---------- Helpers ---------- */
function formatRelative(ts?: any): string {
  if (!ts?.toDate) return "";
  const d: Date = ts.toDate();
  const now = new Date();
  const isSameDay = (a: Date, b: Date) => a.toDateString() === b.toDateString();

  if (isSameDay(now, d)) {
    return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  }
  const yest = new Date();
  yest.setDate(now.getDate() - 1);
  if (isSameDay(yest, d)) return "Yesterday";

  const diffDays = Math.floor((now.getTime() - d.getTime()) / 86400000);
  if (diffDays < 7) return d.toLocaleDateString([], { weekday: "short" });
  return d.toLocaleDateString([], { month: "short", day: "numeric" });
}

function MessagesHome() {
  const [conversations, setConversations] = useState<any[]>([]);
  const [user, setUser] = useState<any>(null);
  const router = useRouter();

  // one ref only
  const msgUnsubsRef = useRef<Record<string, () => void>>({});

  // UI state: search + tab
  const [queryText, setQueryText] = useState("");
  const [tab, setTab] = useState<"all" | "unread" | "read">("all");

  // Swipe state
  const [openSwipeId, setOpenSwipeId] = useState<string | null>(null);
  const [dragId, setDragId] = useState<string | null>(null);
  const [touchStartX, setTouchStartX] = useState<number | null>(null);
  const [dragDX, setDragDX] = useState<number>(0);

const filteredConversations = useMemo(() => {
  const q = queryText.trim().toLowerCase();

  const filtered = conversations
    .filter((c) => {
      if (tab === "all") return true;
      if (tab === "unread") return c.isUnread;
      if (tab === "read") return !c.isUnread;
      return true;
    })
    .filter((c) => {
      if (!q) return true;
      const name = c.displayName?.toLowerCase?.() || "";
      const text = c.latestMessage?.text?.toLowerCase?.() || "";
      return name.includes(q) || text.includes(q);
    });

  return [...filtered].sort((a, b) => {
    const ta = a?.latestMessage?.timestamp?.toMillis?.() ?? 0;
    const tb = b?.latestMessage?.timestamp?.toMillis?.() ?? 0;
    return tb - ta; // newest first
  });
}, [conversations, tab, queryText]);



 useEffect(() => {
  let convoUnsub: (() => void) | null = null;

  const stopAllMsgListeners = () => {
    Object.values(msgUnsubsRef.current).forEach((fn) => fn?.());
    msgUnsubsRef.current = {};
  };

  const unsubAuth = onAuthStateChanged(auth, async (u) => {
    if (!u) return;
    setUser(u);

    const convoQuery = query(
      collection(db, "conversations"),
      where("participants", "array-contains", u.uid)
    );

    convoUnsub = onSnapshot(convoQuery, async (convoSnap) => {
      // ---------- Build base rows from conversation docs ----------
      const bases = await Promise.all(
        convoSnap.docs.map(async (docSnap) => {
          const convoData = docSnap.data() as any;
          const convoId = docSnap.id;

          // Detect event chats
          const ctx = convoData.context || {};
          const isEvent = ctx.type === "event";

          let displayName = "Unknown";
          let photoURL: string | null = null; // only for 1:1
          let otherUserId: string | null = null; // only for 1:1
          let lastReadOtherMillis: number | null = null; // only for 1:1

          if (isEvent) {
            // Event: use event title; we render a 📅 avatar in the UI
            displayName = ctx.title || "Event Chat";
            lastReadOtherMillis = null; // no ✓✓ for group/event
          } else {
            // 1:1 chat (existing behavior)
            otherUserId =
              (convoData.participants as string[]).find((id) => id !== u.uid) || null;

            try {
              if (otherUserId) {
                const playerSnap = await getDoc(doc(db, "players", otherUserId));
                if (playerSnap.exists()) {
                  const playerData = playerSnap.data() as any;
                  displayName = playerData.name || "Unknown";
                  photoURL = playerData.photoURL || null;
                }
              }
            } catch (err) {
              console.warn("Error fetching player profile", err);
            }

            // keep “seen by other” only for 1:1
            const lastReadOther = otherUserId
              ? convoData.lastRead?.[otherUserId] || null
              : null;
            lastReadOtherMillis = lastReadOther?.toMillis
              ? lastReadOther.toMillis()
              : null;
          }

          const lastReadMe = convoData.lastRead?.[u.uid] || null;

          return {
            id: convoId,
            isEvent,
            displayName,
            photoURL,
            otherUserId,
            lastReadMeMillis: lastReadMe?.toMillis ? lastReadMe.toMillis() : null,
            lastReadOtherMillis, // null for events
          };
        })
      );

      // ---------- Seed/merge with previous (prevents flicker) ----------
      setConversations((prev) => {
        const prevById = new Map(prev.map((c) => [c.id, c]));

        const seeded = bases.map((b) => {
          const prevRow = prevById.get(b.id);
          const latestMessage = prevRow?.latestMessage || null;

          const iSentLast = latestMessage?.senderId === u.uid;

          // Read receipts: only for 1:1
          const seenByOther =
            !b.isEvent &&
            iSentLast &&
            b.lastReadOtherMillis &&
            latestMessage?.timestamp?.toMillis &&
            b.lastReadOtherMillis >= latestMessage.timestamp.toMillis();

          const readBadge: "none" | "sent" | "seen" = b.isEvent
            ? "none"
            : iSentLast
            ? (seenByOther ? "seen" : "sent")
            : "none";

          const isUnread =
            latestMessage?.timestamp?.toMillis &&
            (!b.lastReadMeMillis ||
              latestMessage.timestamp.toMillis() > b.lastReadMeMillis);

          const timestampStr = latestMessage?.timestamp
            ? formatRelative(latestMessage.timestamp)
            : "";

          return {
            id: b.id,
            isEvent: b.isEvent,
            displayName: b.displayName,
            photoURL: b.photoURL,
            otherUserId: b.otherUserId,
            lastReadMeMillis: b.lastReadMeMillis,
            lastReadOtherMillis: b.lastReadOtherMillis,
            latestMessage,
            iSentLast,
            readBadge,
            isUnread,
            timestampStr,
          };
        });

        return seeded;
      });

      // ---------- Sync per-convo "latest message" listeners ----------
      const liveIds = new Set(bases.map((b) => b.id));

      // Remove old listeners
      Object.keys(msgUnsubsRef.current).forEach((id) => {
        if (!liveIds.has(id)) {
          msgUnsubsRef.current[id]?.();
          delete msgUnsubsRef.current[id];
        }
      });

      // Add listeners for current convos
      for (const b of bases) {
        if (msgUnsubsRef.current[b.id]) continue;

        msgUnsubsRef.current[b.id] = onSnapshot(
          query(
            collection(db, "conversations", b.id, "messages"),
            orderBy("timestamp", "desc"),
            limit(1)
          ),
          (msgSnap) => {
            const latestMessage = msgSnap.docs[0]?.data() || null;

            setConversations((prev) =>
              prev.map((c) => {
                if (c.id !== b.id) return c;

                const iSentLast = latestMessage?.senderId === u.uid;

                // Read receipts: only for 1:1
                const seenByOther =
                  !c.isEvent &&
                  iSentLast &&
                  c.lastReadOtherMillis &&
                  latestMessage?.timestamp?.toMillis &&
                  c.lastReadOtherMillis >= latestMessage.timestamp.toMillis();

                const readBadge: "none" | "sent" | "seen" = c.isEvent
                  ? "none"
                  : iSentLast
                  ? (seenByOther ? "seen" : "sent")
                  : "none";

                const isUnread =
                  latestMessage?.timestamp?.toMillis &&
                  (!c.lastReadMeMillis ||
                    latestMessage.timestamp.toMillis() > c.lastReadMeMillis);

                return {
                  ...c,
                  latestMessage,
                  iSentLast,
                  readBadge,
                  isUnread,
                  timestampStr: latestMessage?.timestamp
                    ? formatRelative(latestMessage.timestamp)
                    : "",
                };
              })
            );
          }
        );
      }
    });
  });

  return () => {
    convoUnsub?.();
    unsubAuth();
    stopAllMsgListeners();
  };
}, []);


  const handleDeleteConversation = async (convoId: string) => {
    const confirmed = window.confirm("Delete this chat? This can't be undone.");
    if (!confirmed) return;

    try {
      const messagesSnap = await getDocs(
        collection(db, "conversations", convoId, "messages")
      );
      await Promise.all(messagesSnap.docs.map((msg) => deleteDoc(msg.ref)));
      await deleteDoc(doc(db, "conversations", convoId));

      setConversations((prev) => prev.filter((c) => c.id !== convoId));
      if (openSwipeId === convoId) setOpenSwipeId(null);
    } catch (err) {
      console.error("Failed to delete conversation:", err);
      alert("Something went wrong.");
    }
  };

  return (
    <div
      className="min-h-screen bg-white mx-auto max-w-3xl p-4 sm:p-6 pb-28"
      onClick={() => openSwipeId && setOpenSwipeId(null)}
    >
      <div className="pt-4 pb-3 border-b border-gray-200">
        <div className="flex items-center justify-center">
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight">Messages</h1>
        </div>
        <p className="mt-1 text-center text-sm text-gray-600">
          Chats with players and coaches.
        </p>

        {/* Search */}
        <div className="mt-3 flex items-center gap-2">
          <div className="relative flex-1">
            <input
              type="search"
              value={queryText}
              onChange={(e) => setQueryText(e.target.value)}
              placeholder="Search by name or message"
              className="w-full rounded-xl border px-10 py-2 text-sm outline-none focus:ring-2 focus:ring-green-600"
            />
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400">
              <Search size={16} />
            </span>
            {queryText && (
              <button
                type="button"
                onClick={() => setQueryText("")}
                aria-label="Clear search"
                className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
              >
                ×
              </button>
            )}
          </div>
        </div>

        {/* Filter pills: All / Unread / Read */}
<div className="mt-3 flex gap-2">
  <button
    type="button"
    onClick={() => setTab("all")}
    className={`rounded-full border px-3 py-1.5 text-sm ${
      tab === "all"
        ? "border-green-600 bg-green-50 font-semibold"
        : "hover:bg-gray-50"
    }`}
  >
    All
  </button>

  <button
    type="button"
    onClick={() => setTab("unread")}
    className={`rounded-full border px-3 py-1.5 text-sm ${
      tab === "unread"
        ? "border-green-600 bg-green-50 font-semibold"
        : "hover:bg-gray-50"
    }`}
  >
    Unread
  </button>

  <button
    type="button"
    onClick={() => setTab("read")}
    className={`rounded-full border px-3 py-1.5 text-sm ${
      tab === "read"
        ? "border-green-600 bg-green-50 font-semibold"
        : "hover:bg-gray-50"
    }`}
  >
    Read
  </button>
</div>

      </div>

    {filteredConversations.length === 0 ? (
  <p className="text-gray-600 mt-6 text-center">
    {queryText
      ? "No conversations match your search."
      : tab === "unread"
      ? "No unread conversations."
      : tab === "read"
      ? "No read conversations yet."
      : "You have no conversations yet."}
  </p>
) : (

        <ul className="mt-2 space-y-2">
          {filteredConversations.map((convo) => {
            const isDragging = dragId === convo.id && touchStartX !== null;
            const translateX = isDragging
              ? Math.max(-80, Math.min(0, dragDX))
              : openSwipeId === convo.id
              ? -72
              : 0;

            return (
              <li key={convo.id} className="relative">
                {/* Delete action behind the card */}
                <div className="absolute inset-y-0 right-0 flex items-center pr-2">
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      handleDeleteConversation(convo.id);
                    }}
                    className="flex items-center gap-1 rounded-lg bg-red-600 text-white px-3 py-2 shadow hover:bg-red-700 active:scale-[0.99]"
                    aria-label="Delete chat"
                  >
                    <Trash2 size={16} />
                    <span className="text-sm">Delete</span>
                  </button>
                </div>

                {/* Sliding card */}
                <div
                  className="group flex items-center justify-between gap-3 rounded-xl border bg-white px-3 py-3 sm:px-4 hover:bg-gray-50 shadow-sm will-change-transform"
                  style={{
                    transform: `translateX(${translateX}px)`,
                    transition: isDragging ? "none" : "transform 150ms ease",
                  }}
                  onTouchStart={(e) => {
                    setDragId(convo.id);
                    setOpenSwipeId(null);
                    setTouchStartX(e.touches[0].clientX);
                    setDragDX(0);
                  }}
                  onTouchMove={(e) => {
                    if (dragId !== convo.id || touchStartX === null) return;
                    const dx = e.touches[0].clientX - touchStartX;
                    if (dx <= 0) setDragDX(dx); // only left swipe
                  }}
                  onTouchEnd={() => {
                    if (dragId !== convo.id) return;
                    if (dragDX <= -40) setOpenSwipeId(convo.id);
                    else setOpenSwipeId(null);
                    setDragId(null);
                    setTouchStartX(null);
                    setDragDX(0);
                  }}
                >
                  {/* Left: avatar + name + snippet */}
                  <button
  className="flex items-center gap-3 flex-grow text-left min-w-0"
  onClick={(e) => {
    e.stopPropagation();
    router.push(`/messages/${convo.id}`);
  }}
  aria-label={`Open chat with ${convo.displayName || "conversation"}`}
>
  {/* Avatar */}
  {convo.isEvent ? (
    // Event avatar: calendar badge (matches messages/[id]/page.tsx)
    <div
      className={`h-11 w-11 rounded-full ring-2 ${
        convo.isUnread ? "ring-green-500" : "ring-gray-200"
      } bg-emerald-100 flex items-center justify-center text-base`}
      title="Event chat"
    >
      📅
    </div>
  ) : convo.photoURL ? (
    <img
      src={convo.photoURL}
      alt={convo.displayName || "Chat"}
      className={`h-11 w-11 rounded-full object-cover ring-2 ${
        convo.isUnread ? "ring-green-500" : "ring-gray-200"
      }`}
    />
  ) : (
    <div
      className={`h-11 w-11 rounded-full bg-gray-200 ring-2 ${
        convo.isUnread ? "ring-green-500" : "ring-gray-200"
      } flex items-center justify-center text-[10px] text-gray-600`}
    >
      No Photo
    </div>
  )}

  {/* Title + snippet */}
  <div className="flex-1 min-w-0">
    <p
      className={`truncate text-sm ${
        convo.isUnread ? "font-extrabold" : "font-semibold"
      } text-gray-900`}
    >
      {convo.displayName}
    </p>

    <p className="truncate text-sm text-gray-600">
      {/* Read receipts: hide for events */}
      {convo.iSentLast && !convo.isEvent && (
        <span
          className={`mr-1 ${
            convo.readBadge === "seen" ? "text-green-600" : "text-gray-400"
          }`}
          aria-label={convo.readBadge === "seen" ? "Seen" : "Sent"}
          title={convo.readBadge === "seen" ? "Seen" : "Sent"}
        >
          {convo.readBadge === "seen" ? "✓✓" : "✓"}
        </span>
      )}
      {convo.latestMessage?.text?.slice(0, 80) || "New conversation"}
    </p>
  </div>
</button>


                  {/* Right: time + unread badge */}
                  <div className="ml-2 flex flex-col items-end gap-1 min-w-[72px]">
                    {convo.timestampStr && (
                      <p className="text-xs text-gray-500">{convo.timestampStr}</p>
                    )}
                    {convo.isUnread && (
                      <span className="text-[11px] px-1.5 py-0.5 rounded-full bg-green-600 text-white">
                        New
                      </span>
                    )}
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

export default withAuth(MessagesHome);
