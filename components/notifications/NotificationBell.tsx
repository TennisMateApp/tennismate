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
  getDoc,
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

  // ids
  matchId?: string;
  conversationId?: string;
  eventId?: string;
  inviteId?: string;

  // routing
  route?: string; // e.g. "/invites/abc"
  url?: string;   // e.g. "https://tennismate.vercel.app/invites/abc"

  timestamp?: any; // Firestore Timestamp
  recipientId?: string;
};

type ViewportDebugInfo = {
  innerWidth: number;
  innerHeight: number;
  clientWidth: number;
  clientHeight: number;
  devicePixelRatio: number;
  userAgent: string;
};

function useViewportDebug() {
  const [info, setInfo] = useState<ViewportDebugInfo | null>(null);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const update = () => {
      setInfo({
        innerWidth: window.innerWidth,
        innerHeight: window.innerHeight,
        clientWidth: document.documentElement.clientWidth,
        clientHeight: document.documentElement.clientHeight,
        devicePixelRatio: window.devicePixelRatio,
        userAgent: navigator.userAgent,
      });
    };
    update();
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, []);

  return info;
}

export default function NotificationBell() {
  const [userId, setUserId] = useState<string | null>(null);
  const [items, setItems] = useState<Notification[]>([]);
  const [open, setOpen] = useState(false);
  const [clearing, setClearing] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const router = useRouter();
  const debug = useViewportDebug();
  const [debugEnabled, setDebugEnabled] = useState(false);

  // 🔹 NEW: ref for the bell button
  const bellButtonRef = useRef<HTMLButtonElement | null>(null);

  // 🔹 NEW: dropdown position so it sits just under the bell
  const [dropdownPos, setDropdownPos] = useState<{
    top: number;
    right: number;
    fullWidth: boolean;
  } | null>(null);

  // auth -> userId + debug flag from users/{uid}.debugNotifications
  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (u) => {
      if (!u) {
        setUserId(null);
        setDebugEnabled(false);
        return;
      }

      setUserId(u.uid);

      try {
        const snap = await getDoc(doc(db, "users", u.uid));
        const data = snap.data() as any;
        setDebugEnabled(!!data?.debugNotifications);
      } catch (e) {
        console.warn("[Bell] failed to load debug flag", e);
        setDebugEnabled(false);
      }
    });

    return () => unsub();
  }, []);

  // live unread feed
  useEffect(() => {
    if (!userId) {
      setItems([]);
      return;
    }

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
            (b.timestamp?.toMillis?.() ?? 0) -
            (a.timestamp?.toMillis?.() ?? 0)
        );
        const filtered = raw.filter((n) => n.type !== "message");
        setItems(filtered);
      },
      (err) => {
        console.error("[Bell] snapshot error:", err);
        setItems([]);
      }
    );

    return () => unsub();
  }, [userId]);

  // 🔹 NEW: when the dropdown opens (or window resizes), position it under the bell
  useEffect(() => {
    if (!open) return;
    if (typeof window === "undefined") return;

    const updatePosition = () => {
      const btn = bellButtonRef.current;
      if (!btn) return;
      const rect = btn.getBoundingClientRect();
      const vw = window.innerWidth;

      const gap = 8; // px gap between icons and dropdown

      if (vw < 640) {
        // mobile: full width with margin
        setDropdownPos({
          top: rect.bottom + gap,
          right: 8,
          fullWidth: true,
        });
      } else {
        // desktop: anchor to the right of the bell
        const right = Math.max(vw - rect.right - 8, 8);
        setDropdownPos({
          top: rect.bottom + gap,
          right,
          fullWidth: false,
        });
      }
    };

    updatePosition();
    window.addEventListener("resize", updatePosition);
    return () => window.removeEventListener("resize", updatePosition);
  }, [open]);

  // close when clicking outside / Escape
  useEffect(() => {
    if (!open) return;

    const onPointer = (e: MouseEvent | TouchEvent) => {
      const el = containerRef.current;
      if (!el) return;
      if (!el.contains(e.target as Node) && !bellButtonRef.current?.contains(e.target as Node)) {
        setOpen(false);
      }
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

  function resolveNotificationRoute(n: Notification): string {
  const t = (n.type || "").toLowerCase();
  const title = (n.title || "").toLowerCase();
  const body = (n.body || n.message || "").toLowerCase();

  // ✅ HARD OVERRIDE (ALWAYS first):
  // Any match invite should go to /messages no matter what route/url says.
  const looksLikeInvite =
    t === "match_invite" ||
    (typeof n.inviteId === "string" && n.inviteId.length > 0) ||
    title.includes("match invite") ||
    body.includes("invited you");

    if (looksLikeInvite) {
  console.log("[Bell] resolve → /messages (invite override)", {
    t,
    inviteId: n.inviteId,
    title: n.title,
    body: n.body,
    route: n.route,
    url: n.url,
  });
  return "/messages";
}

  if (looksLikeInvite) return "/messages";

  // ✅ 1) Prefer explicit route if present
  if (typeof n.route === "string" && n.route.startsWith("/")) return n.route;

  // ✅ 2) Next: derive from full URL if present
  if (typeof n.url === "string" && n.url) {
    try {
      return new URL(n.url).pathname || "/matches";
    } catch {
      if (n.url.startsWith("/")) return n.url;
    }
  }

  // ✅ 3) Type-based rules
  if (t === "match_request") return "/matches";

  const looksAccepted =
    t === "match_accepted" ||
    title.includes("accepted") ||
    body.includes("accepted");

  if (looksAccepted) {
    const mid = typeof n.matchId === "string" && n.matchId ? n.matchId : null;
    return mid
      ? `/matches?matchId=${encodeURIComponent(mid)}&tab=accepted`
      : "/matches?tab=accepted";
  }

  if (t.includes("event")) {
    if (n.eventId) return `/events/${encodeURIComponent(n.eventId)}`;
    return "/events";
  }

  if (t === "message" && n.conversationId) {
    return `/messages/${encodeURIComponent(n.conversationId)}`;
  }

  if (n.matchId) return `/matches?matchId=${encodeURIComponent(n.matchId)}`;

  return "/matches";
}

const handleItemClick = async (n: Notification) => {
  setOpen(false);

  try {
    await updateDoc(doc(db, "notifications", n.id), { read: true });
  } catch (e) {
    console.warn("Failed to mark read:", e);
  }

  

  const target = resolveNotificationRoute(n);

    // 3) DEBUG: prove what we are doing
  console.log("[Bell] navigate", {
    id: n.id,
    type: n.type,
    inviteId: n.inviteId,
    conversationId: n.conversationId,
    route: n.route,
    url: n.url,
    target,
  });

    // 4) Navigate
  // If it's an invite, do replace to reduce “bounce back” behaviour
  const t = (n.type || "").toLowerCase();
  const title = (n.title || "").toLowerCase();
  const body = (n.body || n.message || "").toLowerCase();

  const looksLikeInvite =
    t === "match_invite" ||
    (typeof n.inviteId === "string" && n.inviteId.length > 0) ||
    title.includes("match invite") ||
    body.includes("invited you");

  if (looksLikeInvite) {
    router.replace("/messages");
    return;
  }
  
  return router.push(target);
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
    <div className="relative inline-block shrink-0 align-top">
      <button
        ref={bellButtonRef} // 🔹 NEW: attach ref here
        onClick={() => setOpen((v) => !v)}
        className="relative"
        aria-label="Notifications"
      >
        <Bell className="w-6 h-6 text-green-600" />
        {unreadCount > 0 && (
          <span className="absolute -top-1 -right-1 bg-red-600 text-white text-xs px-1.5 py-0.5 rounded-full">
            {unreadCount > 9 ? "9+" : unreadCount}
          </span>
        )}
      </button>

      {open && dropdownPos && (
        <div
          className="
            fixed z-50
            origin-top-right
          "
          style={{
            top: dropdownPos.top,
            right: dropdownPos.fullWidth ? dropdownPos.right : dropdownPos.right,
            left: dropdownPos.fullWidth ? 8 : "auto", // full width on mobile
          }}
        >
          <div
            ref={containerRef}
            className="
              ml-auto
              w-[calc(100vw-1rem)] sm:w-[20rem]
              bg-white border border-gray-200 shadow-lg rounded-md
              max-h-[60vh]
              flex flex-col
              overflow-hidden
            "
          >
            <div className="flex items-center justify-between px-3 py-2 text-sm text-gray-700 font-semibold bg-gray-50 border-b border-gray-200">
              <span>Notifications</span>
              {headerRight}
            </div>

            {items.length === 0 ? (
              <div className="p-4 text-sm text-gray-500 flex-1">
                No notifications
              </div>
            ) : (
              <ul className="divide-y divide-gray-100 overflow-y-auto overscroll-contain text-sm">
                {items.map((n) => (
                  <li
                    key={n.id}
                    className="p-3 hover:bg-gray-100 cursor-pointer"
                    onClick={() => handleItemClick(n)}
                  >
                    <p className="font-semibold text-gray-800 break-words">
                      {n.title || "Notification"}
                    </p>
                    <p className="text-gray-600 text-sm break-words">
                      {n.body || n.message}
                    </p>
                    <p className="text-[11px] text-gray-400 mt-1">
                      {[
                        typeLabel[n.type ?? ""] || "Notification",
                        n.timestamp?.toDate?.()
                          ? timeAgo(n.timestamp.toDate())
                          : "",
                      ]
                        .filter(Boolean)
                        .join(" · ")}
                    </p>
                  </li>
                ))}
              </ul>
            )}

            {debugEnabled && debug && (
              <div className="border-t border-gray-200 text-[10px] leading-tight p-2 break-all bg-gray-50">
                <div>
                  inner: {debug.innerWidth} × {debug.innerHeight}
                </div>
                <div>
                  client: {debug.clientWidth} × {debug.clientHeight}
                </div>
                <div>dpr: {debug.devicePixelRatio}</div>
                <div className="mt-1">UA: {debug.userAgent}</div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
