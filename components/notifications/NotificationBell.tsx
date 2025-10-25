// components/notifications/NotificationBell.tsx
"use client";

import { useEffect, useState, useMemo, useRef } from "react";
import { auth, db } from "@/lib/firebaseConfig";
import {
  collection,
  query,
  where,
  orderBy,
  limit,
  onSnapshot,
  DocumentData,
  writeBatch,
  doc,
  updateDoc,
} from "firebase/firestore";
import { onAuthStateChanged } from "firebase/auth";
import { Bell } from "lucide-react";
import { useRouter } from "next/navigation";

type Notification = {
  id: string;
  read?: boolean;
  title?: string;
  body?: string;
  message?: string;
  type?: string;
  matchId?: string;
  conversationId?: string;
  eventId?: string;
  timestamp?: any; // Firestore Timestamp
  recipientId?: string;
};

export default function NotificationBell() {
  const [userId, setUserId] = useState<string | null>(null);
  const [items, setItems] = useState<Notification[]>([]);
  const [open, setOpen] = useState(false);
  const [clearing, setClearing] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const router = useRouter();

  // auth -> userId
  useEffect(() => {
    return onAuthStateChanged(auth, (u) => setUserId(u ? u.uid : null));
  }, []);

  // live unread feed (requires composite index: recipientId ASC, read ASC, timestamp DESC)
  useEffect(() => {
    if (!userId) { setItems([]); return; }

    const q = query(
      collection(db, "notifications"),
      where("recipientId", "==", userId),
      where("read", "==", false),
      orderBy("timestamp", "desc"),
      limit(50)
    );

    const unsub = onSnapshot(
      q,
      (snap) => {
        const raw: Notification[] = snap.docs.map((d) => ({
          id: d.id,
          ...(d.data() as DocumentData),
        }));
        raw.sort(
          (a, b) =>
            (b.timestamp?.toMillis?.() ?? 0) - (a.timestamp?.toMillis?.() ?? 0)
        );
         const filtered = raw.filter(n => n.type !== "message");
    setItems(filtered)
      },
      (err) => {
        console.error("[Bell] snapshot error:", err);
        setItems([]);
      }
    );

    return () => unsub();
  }, [userId]);

  useEffect(() => {
  if (!open) return;

  const onPointer = (e: MouseEvent | TouchEvent) => {
    const el = containerRef.current;
    if (!el) return;
    // Close if the click/touch is outside our container
    if (!el.contains(e.target as Node)) setOpen(false);
  };

  const onKey = (e: KeyboardEvent) => {
    if (e.key === "Escape") setOpen(false);
  };

  document.addEventListener("mousedown", onPointer);
  document.addEventListener("touchstart", onPointer, { passive: true });
  document.addEventListener("keydown", onKey);

  return () => {
    document.removeEventListener("mousedown", onPointer);
    document.removeEventListener("touchstart", onPointer);
    document.removeEventListener("keydown", onKey);
  };
}, [open]);


  const unreadCount = items.length;

  const handleItemClick = async (n: Notification) => {
    setOpen(false);

    // mark this one as read (fire and forget)
    try {
      await updateDoc(doc(db, "notifications", n.id), { read: true });
    } catch (e) {
      console.warn("Failed to mark read:", e);
    }

    if (n.matchId) return router.push(`/matches?matchId=${n.matchId}`);
    if (n.type === "message" && n.conversationId)
      return router.push(`/messages/${n.conversationId}`);
    if (n.eventId) return router.push(`/events/${n.eventId}`);
    return router.push("/matches");
  };

  const clearAll = async () => {
    if (!items.length) return;
    setClearing(true);
    try {
      const batch = writeBatch(db);
      items.forEach((n) => {
        batch.update(doc(db, "notifications", n.id), { read: true });
      });
      await batch.commit();
      // UI will auto-refresh from onSnapshot (list becomes empty)
    } catch (e) {
      console.error("Failed to clear notifications:", e);
    } finally {
      setClearing(false);
    }
  };

  const headerRight = useMemo(() => {
    if (!items.length) return null;
    return (
      <button
        onClick={clearAll}
        disabled={clearing}
        className="text-blue-600 hover:underline text-xs disabled:opacity-50"
      >
        {clearing ? "Clearing…" : "Clear all"}
      </button>
    );
  }, [items.length, clearing]);

  // Friendly label + time-ago
const typeLabel: Record<string, string> = {
  message: "Message",
  match_request: "Match request",
  match_accepted: "Match accepted",
  event: "Event",
};

function timeAgo(d?: Date) {
  if (!d) return "";
  const s = Math.floor((Date.now() - d.getTime()) / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const dys = Math.floor(h / 24);
  return `${dys}d ago`;
}


  return (
       <div ref={containerRef} className="relative inline-block shrink-0 align-top">
      <button onClick={() => setOpen(v => !v)} className="relative">
        <Bell className="w-6 h-6 text-green-600" />
        {unreadCount > 0 && (
          <span className="absolute -top-1 -right-1 bg-red-600 text-white text-xs px-1.5 py-0.5 rounded-full">
            {unreadCount > 9 ? "9+" : unreadCount}
          </span>
        )}
      </button>

      {open && (
      <div
  className="
    absolute top-full right-0 mt-2 z-50
    bg-white border border-gray-200 shadow-lg rounded-md
    w-[min(20rem,calc(100vw-1rem))]   /* 20rem desktop, shrink-to-fit on mobile */
    max-h-[70vh] overflow-y-auto overflow-x-hidden
    origin-top-right
  "
>

    <div className="flex items-center justify-between px-3 py-2 text-sm text-gray-700 font-semibold bg-gray-50 border-b border-gray-200">
      <span>Notifications</span>
      {headerRight}
    </div>

          {items.length === 0 ? (
            <div className="p-4 text-sm text-gray-500">No notifications</div>
          ) : (
            <ul className="divide-y divide-gray-100 max-h-96 overflow-y-auto text-sm">
              {items.map((n) => (
                <li
                  key={n.id}
                  className="p-3 hover:bg-gray-100 cursor-pointer"
                  onClick={() => handleItemClick(n)}
                >
                  <p className="font-semibold text-gray-800">
                    {n.title || "Notification"}
                  </p>
                  <p className="text-gray-600 text-sm">
                    {n.body || n.message}
                  </p>
                  <p className="text-[11px] text-gray-400 mt-1">
  {[typeLabel[n.type ?? ""] || "Notification",
    n.timestamp?.toDate?.() ? timeAgo(n.timestamp.toDate()) : ""]
    .filter(Boolean)
    .join(" · ")}
</p>

                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
