"use client";

import { type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
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
  type DocumentData,
} from "firebase/firestore";
import { useRouter } from "next/navigation";
import { Search, Trash2, SquarePen, Settings } from "lucide-react";
import { onAuthStateChanged } from "firebase/auth";
import { getPlayerPhotoUrl, resolveSmallProfilePhoto } from "@/lib/profilePhoto";
import withAuth from "@/components/withAuth";
import TMDesktopSidebar from "@/components/desktop_layout/TMDesktopSidebar"; // adjust path
// optional (if you have it):
import { useIsDesktop } from "@/lib/useIsDesktop";

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

function safeSnippet(text?: string) {
  if (!text) return "New conversation";
  return text.replace(/\s+/g, " ").trim();
}


type MessagesHomeProps = {
  selectedConversationId?: string | null;
  activeThread?: ReactNode;
};

export function MessagesDesktopShell({
  selectedConversationId = null,
  activeThread = null,
}: MessagesHomeProps) {
  
  const [conversations, setConversations] = useState<any[]>([]);
  const [user, setUser] = useState<any>(null);
  const router = useRouter();

  // one ref only
  const msgUnsubsRef = useRef<Record<string, () => void>>({});
  const playerUnsubsRef = useRef<Record<string, () => void>>({});

  // UI state: search + tab
  const [queryText, setQueryText] = useState("");

  // NEW: loading state
const [loading, setLoading] = useState<boolean>(true);

const [myPhotoURL, setMyPhotoURL] = useState<string | null>(null);

  // Swipe state
  const [openSwipeId, setOpenSwipeId] = useState<string | null>(null);
  const [dragId, setDragId] = useState<string | null>(null);
  const [touchStartX, setTouchStartX] = useState<number | null>(null);
  const [dragDX, setDragDX] = useState<number>(0);

const filteredConversations = useMemo(() => {
  const q = queryText.trim().toLowerCase();

  const filtered = conversations.filter((c) => {
    if (!q) return true;
    const name = c.displayName?.toLowerCase?.() || "";
    const text = c.latestMessage?.text?.toLowerCase?.() || "";
    return name.includes(q) || text.includes(q);
  });

  return [...filtered].sort((a, b) => {
    const ta = a?.latestMessage?.timestamp?.toMillis?.() ?? 0;
    const tb = b?.latestMessage?.timestamp?.toMillis?.() ?? 0;
    return tb - ta;
  });
}, [conversations, queryText]);



useEffect(() => {
  let convoUnsub: (() => void) | null = null;

  const stopAllMsgListeners = () => {
    Object.values(msgUnsubsRef.current).forEach((fn) => fn?.());
    msgUnsubsRef.current = {};
  };

  const stopAllPlayerListeners = () => {
    Object.values(playerUnsubsRef.current).forEach((fn) => fn?.());
    playerUnsubsRef.current = {};
  };

  const unsubAuth = onAuthStateChanged(auth, async (u) => {
    if (!u) {
      setUser(null);
      setConversations([]);
      stopAllMsgListeners();
      stopAllPlayerListeners();
      setLoading(false); // no user, nothing to load
      return;
    }

    setUser(u);
    setLoading(true); // start loading when we know we have a user

    // Try Firestore first (players doc), then auth photoURL
try {
  const meSnap = await getDoc(doc(db, "players", u.uid));
  if (meSnap.exists()) {
    const me = meSnap.data() as any;

    const url = resolveSmallProfilePhoto(me);
    setMyPhotoURL(url);
  } else {
    setMyPhotoURL(u.photoURL || null);
  }
} catch (e) {
  console.warn("Could not load my profile photo", e);
  setMyPhotoURL(u.photoURL || null);
}


    const convoQuery = query(
      collection(db, "conversations"),
      where("participants", "array-contains", u.uid)
    );

    convoUnsub = onSnapshot(
      convoQuery,
      async (convoSnap) => {
        // ---------- Build base rows from conversation docs ----------
        const bases = await Promise.all(
          convoSnap.docs.map(async (docSnap) => {
            const convoData = docSnap.data() as any;
            const convoId = docSnap.id;
            if (convoData.hiddenFor?.[u.uid]) return null;

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
                (convoData.participants as string[]).find(
                  (id) => id !== u.uid
                ) || null;

              const snapshotProfile = otherUserId
                ? convoData.playerSnapshots?.[otherUserId] ||
                  convoData.participantSnapshots?.[otherUserId] ||
                  null
                : null;
              displayName = snapshotProfile?.name || displayName;
              photoURL = getPlayerPhotoUrl(null, snapshotProfile);

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
              lastReadMeMillis: lastReadMe?.toMillis
                ? lastReadMe.toMillis()
                : null,
              lastReadOtherMillis, // null for events
            };
          })
        );
        const visibleBases = bases.filter(Boolean) as any[];
        const liveOtherIds = new Set(
          visibleBases
            .map((b) => b.otherUserId)
            .filter((id): id is string => typeof id === "string" && id.length > 0)
        );

        Object.keys(playerUnsubsRef.current).forEach((uid) => {
          if (!liveOtherIds.has(uid)) {
            playerUnsubsRef.current[uid]?.();
            delete playerUnsubsRef.current[uid];
          }
        });

        liveOtherIds.forEach((otherUid) => {
          if (playerUnsubsRef.current[otherUid]) return;

          playerUnsubsRef.current[otherUid] = onSnapshot(
            doc(db, "players", otherUid),
            (playerSnap) => {
              const playerData = playerSnap.exists() ? (playerSnap.data() as DocumentData) : null;

              setConversations((prev) =>
                prev.map((conversation) =>
                  conversation.otherUserId === otherUid
                    ? {
                        ...conversation,
                        displayName:
                          (typeof playerData?.name === "string" && playerData.name.trim()) ||
                          conversation.displayName,
                        photoURL: getPlayerPhotoUrl(playerData, conversation),
                      }
                    : conversation
                )
              );
            },
            (error) => {
              console.warn("Error listening to player profile", otherUid, error);
            }
          );
        });

        // ---------- Seed/merge with previous (prevents flicker) ----------
        setConversations((prev) => {
          const prevById = new Map(prev.map((c) => [c.id, c]));

          const seeded = visibleBases.map((b) => {
            const prevRow = prevById.get(b.id);
            const latestMessage = prevRow?.latestMessage || null;

            const iSentLast = latestMessage?.senderId === u.uid;

            // Read receipts: only for 1:1
            const seenByOther =
              !b.isEvent &&
              iSentLast &&
              b.lastReadOtherMillis &&
              latestMessage?.timestamp?.toMillis &&
              b.lastReadOtherMillis >=
                latestMessage.timestamp.toMillis();

            const readBadge: "none" | "sent" | "seen" = b.isEvent
              ? "none"
              : iSentLast
              ? seenByOther
                ? "seen"
                : "sent"
              : "none";

            const isUnread =
              latestMessage?.timestamp?.toMillis &&
              (!b.lastReadMeMillis ||
                latestMessage.timestamp.toMillis() >
                  b.lastReadMeMillis);

            const timestampStr = latestMessage?.timestamp
              ? formatRelative(latestMessage.timestamp)
              : "";

            return {
              id: b.id,
              isEvent: b.isEvent,
              displayName:
                prevRow?.otherUserId === b.otherUserId
                  ? prevRow.displayName || b.displayName
                  : b.displayName,
              photoURL:
                prevRow?.otherUserId === b.otherUserId
                  ? prevRow.photoURL || b.photoURL
                  : b.photoURL,
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

        // ✅ First snapshot received (even if empty) – stop loading
        setLoading(false);

        // ---------- Sync per-convo "latest message" listeners ----------
        const liveIds = new Set(visibleBases.map((b) => b.id));

        // Remove old listeners
        Object.keys(msgUnsubsRef.current).forEach((id) => {
          if (!liveIds.has(id)) {
            msgUnsubsRef.current[id]?.();
            delete msgUnsubsRef.current[id];
          }
        });

        // Add listeners for current convos
        for (const b of visibleBases) {
          if (msgUnsubsRef.current[b.id]) continue;

          msgUnsubsRef.current[b.id] = onSnapshot(
            query(
              collection(db, "conversations", b.id, "messages"),
              orderBy("timestamp", "desc"),
              limit(1)
            ),
            (msgSnap) => {
              const latestMessage =
                msgSnap.docs[0]?.data() || null;

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
                    c.lastReadOtherMillis >=
                      latestMessage.timestamp.toMillis();

                  const readBadge: "none" | "sent" | "seen" =
                    c.isEvent
                      ? "none"
                      : iSentLast
                      ? seenByOther
                        ? "seen"
                        : "sent"
                      : "none";

                  const isUnread =
                    latestMessage?.timestamp?.toMillis &&
                    (!c.lastReadMeMillis ||
                      latestMessage.timestamp.toMillis() >
                        c.lastReadMeMillis);

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
      },
      (error) => {
        console.error("Conversations onSnapshot error:", error);
        setLoading(false);
      }
    );
  });

  return () => {
    convoUnsub?.();
    unsubAuth();
    stopAllMsgListeners();
    stopAllPlayerListeners();
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
    className="min-h-screen bg-white lg:h-full lg:min-h-0"
    onClick={() => openSwipeId && setOpenSwipeId(null)}
  >
    {/* =========================
        DESKTOP (md and up)
        ========================= */}
{/* =========================
    DESKTOP (md and up)
    ========================= */}
{/* =========================
    DESKTOP (md and up)
    ========================= */}
<div className="hidden lg:block">
  <div className="h-screen min-h-0 overflow-hidden" style={{ background: "#F7FAF8" }}>
    <div className="h-full w-full px-6 py-6 2xl:px-10">
      <div className="grid h-full min-h-0 grid-cols-[300px_minmax(360px,420px)_minmax(0,1fr)] gap-6">
        {/* Sidebar (same as Home) */}
        <TMDesktopSidebar
          active="Chat"
          player={{
            name: user?.displayName || "Me",
            skillLevel: "",
            photoURL: myPhotoURL ?? null,
            photoThumbURL: myPhotoURL ?? null,
            avatar: myPhotoURL ?? null,
          }}
        />

        {/* Main */}
        <main className="min-h-0 min-w-0 overflow-y-auto">
          <div>
            {/* Top bar */}
            <div className="flex items-center gap-3">
              <button
                type="button"
                className="h-10 w-10 rounded-full overflow-hidden ring-2 ring-green-400 bg-gray-100 flex items-center justify-center"
                aria-label="Open profile"
                onClick={() => router.push("/profile")}
              >
                {myPhotoURL ? (
                  <img
                    src={myPhotoURL}
                    alt="Your profile"
                    className="h-full w-full object-cover"
                    onError={() => setMyPhotoURL(null)}
                  />
                ) : (
                  <span className="text-xs text-gray-600">🙂</span>
                )}
              </button>

              <h1 className="text-3xl font-extrabold tracking-tight text-gray-900">
                Messages
              </h1>
            </div>

            {/* Search */}
            <div className="mt-5">
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400">
                  <Search size={16} />
                </span>

                <input
                  type="search"
                  value={queryText}
                  onChange={(e) => setQueryText(e.target.value)}
                  placeholder="Search conversations..."
                  className="w-full rounded-2xl bg-white border border-gray-200 px-10 py-3 text-sm outline-none focus:border-green-500 focus:ring-2 focus:ring-green-200"
                />

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

            {/* Conversations */}
            <div className="mt-6 rounded-2xl border border-gray-200 bg-white overflow-hidden">
              {loading ? (
                <div className="p-8 text-sm text-gray-600">
                  Loading your conversations...
                </div>
              ) : filteredConversations.length === 0 ? (
                <div className="p-8 text-sm text-gray-600">
                  {queryText
                    ? "No conversations match your search."
                    : "You have no conversations yet."}
                </div>
              ) : (
                <ul className="divide-y divide-gray-200">
                  {filteredConversations.map((convo) => {
                    const ring = convo.isUnread ? "ring-green-500" : "ring-transparent";
                    const selected = convo.id === selectedConversationId;

                    return (
                      <li key={convo.id}>
                        <Link
                          href={`/messages/${convo.id}`}
                          className={`w-full px-5 py-4 text-left flex items-center gap-4 ${
                            selected ? "bg-emerald-50" : "hover:bg-gray-50"
                          }`}
                        >
                          {/* Avatar */}
                          <div className="relative shrink-0">
                            {convo.isEvent ? (
                              <div
                                className={`h-12 w-12 rounded-full ${ring} ring-2 bg-emerald-100 flex items-center justify-center text-base`}
                              >
                                📅
                              </div>
                            ) : convo.photoURL ? (
                              <img
                                src={convo.photoURL}
                                alt={convo.displayName || "Chat"}
                                className={`h-12 w-12 rounded-full object-cover ring-2 ${ring}`}
                              />
                            ) : (
                              <div className={`h-12 w-12 rounded-full bg-gray-200 ring-2 ${ring}`} />
                            )}

                            {convo.isUnread && (
                              <span className="absolute bottom-0 right-0 h-3.5 w-3.5 rounded-full border-2 border-white bg-green-500" />
                            )}
                          </div>

                          {/* Text */}
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center justify-between gap-3">
                              <p
                                className={`truncate text-sm ${
                                  convo.isUnread ? "font-extrabold" : "font-semibold"
                                } ${selected ? "text-emerald-950" : "text-gray-900"}`}
                              >
                                {convo.displayName}
                              </p>

                              {convo.timestampStr && (
                                <p className="text-xs text-gray-500 shrink-0">
                                  {convo.timestampStr}
                                </p>
                              )}
                            </div>

                            <p className="truncate text-sm text-gray-600">
                              {safeSnippet(convo.latestMessage?.text)}
                            </p>
                          </div>
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          </div>
        </main>
        <section className="min-h-0 min-w-0">
          <div className="mx-auto h-full min-h-0 max-w-[980px] overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm">
            {activeThread ? (
              activeThread
            ) : (
              <div className="flex h-full items-center justify-center px-6 text-center">
                <div>
                  <div className="text-xl font-black text-gray-900">Select a conversation</div>
                  <div className="mt-2 text-sm font-semibold text-gray-500">
                    Choose a chat from the list to open Match Hub.
                  </div>
                </div>
              </div>
            )}
          </div>
        </section>
      </div>
    </div>
  </div>
</div>


    {/* =========================
        MOBILE (below md)
        ========================= */}
    <div className="lg:hidden w-full pt-4 pb-28">
      {/* Paste your existing MOBILE UI here */}

      {/* Top bar */}
     <div className="flex items-center justify-between px-3">
        <div className="flex items-center gap-2">
          <button
            type="button"
            className="h-9 w-9 rounded-full overflow-hidden ring-2 ring-green-400 bg-gray-100 flex items-center justify-center"
            aria-label="Open profile"
            onClick={() => router.push("/profile")}
          >
            {myPhotoURL ? (
              <img
                src={myPhotoURL}
                alt="Your profile"
                className="h-full w-full object-cover"
                onError={() => setMyPhotoURL(null)}
              />
            ) : (
              <span className="text-xs text-gray-600">🙂</span>
            )}
          </button>

          <h1 className="text-3xl font-extrabold tracking-tight">Messages</h1>
        </div>
      </div>

      {/* Search */}
      <div className="mt-4 px-3">
        <div className="relative">
          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400">
            <Search size={16} />
          </span>

          <input
            type="search"
            value={queryText}
            onChange={(e) => setQueryText(e.target.value)}
            placeholder="Search players..."
            className="w-full rounded-2xl bg-gray-100 border border-transparent px-10 py-3 text-sm outline-none focus:bg-white focus:border-green-500 focus:ring-2 focus:ring-green-200"
          />

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

      {/* Conversations */}
      <div className="mt-6 px-3">
        <p className="text-sm font-semibold text-gray-900 mb-3">
          Conversations
        </p>

        {loading ? (
          <div className="p-6 text-sm text-gray-600">Loading...</div>
        ) : filteredConversations.length === 0 ? (
          <p className="text-gray-600 mt-2 text-center">
            {queryText
              ? "No conversations match your search."
              : "You have no conversations yet."}
          </p>
        ) : (
          <ul className="divide-y divide-gray-200">
            {filteredConversations.map((convo) => {
              const ring = convo.isUnread
                ? "ring-green-500"
                : "ring-transparent";

              return (
                <li key={convo.id} className="relative">
                  <button
                    className="w-full flex items-center gap-3 py-3 text-left"
                    onClick={() => router.push(`/messages/${convo.id}`)}
                  >
                    {/* Avatar */}
                    <div className="relative shrink-0">
                      {convo.isEvent ? (
                        <div
                          className={`h-12 w-12 rounded-full ${ring} ring-2 bg-emerald-100 flex items-center justify-center text-base`}
                        >
                          📅
                        </div>
                      ) : convo.photoURL ? (
                        <img
                          src={convo.photoURL}
                          alt={convo.displayName || "Chat"}
                          className={`h-12 w-12 rounded-full object-cover ring-2 ${ring}`}
                        />
                      ) : (
                        <div
                          className={`h-12 w-12 rounded-full bg-gray-200 ring-2 ${ring}`}
                        />
                      )}

                      {convo.isUnread && (
                        <span className="absolute bottom-0 right-0 h-3.5 w-3.5 rounded-full border-2 border-white bg-green-500" />
                      )}
                    </div>

                    {/* Text */}
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center justify-between gap-2">
                        <p
                          className={`truncate text-sm ${
                            convo.isUnread
                              ? "font-extrabold"
                              : "font-semibold"
                          } text-gray-900`}
                        >
                          {convo.displayName}
                        </p>

                        {convo.timestampStr && (
                          <p className="text-xs text-gray-500 shrink-0">
                            {convo.timestampStr}
                          </p>
                        )}
                      </div>

                      <p className="truncate text-sm text-gray-600">
                        {safeSnippet(convo.latestMessage?.text)}
                      </p>
                    </div>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  </div>
);


}

export default withAuth(MessagesDesktopShell);
