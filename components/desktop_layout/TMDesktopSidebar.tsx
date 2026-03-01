"use client";

import Link from "next/link";
import Image from "next/image";
import { useEffect, useRef, useState } from "react";
import { onAuthStateChanged } from "firebase/auth";
import {
  doc,
  getDoc,
  collection,
  onSnapshot,
  query,
  where,
  orderBy,
  limit,
  updateDoc,
  writeBatch,
  serverTimestamp,
} from "firebase/firestore";
import { auth, db } from "@/lib/firebaseConfig";
import { usePathname, useRouter } from "next/navigation";
import { Bell } from "lucide-react";
import { signOut } from "firebase/auth";

type Player = {
  name?: string | null;
  skillBandLabel?: string | null;
  skillLevel?: string | null;
  skillBand?: string | null;
  utr?: number | null;
  skillRating?: number | null;
  photoThumbURL?: string | null;
  photoURL?: string | null;
  avatar?: string | null;
};

type DesktopNotification = {
  id: string;
  title?: string | null;
  body?: string | null;
  message?: string | null;
  link?: string | null;
  type?: string | null;
  matchId?: string | null;
  conversationId?: string | null;
  eventId?: string | null;

    inviteId?: string | null;
  route?: string | null;
  url?: string | null;

  read?: boolean;
  timestamp?: any; // Firestore Timestamp
};



const TM = {
  forest: "#0B3D2E",
  neon: "#39FF14",
  bg: "#F7FAF8",
  ink: "#0F172A",
};

function resolveNotifHref(n: DesktopNotification): string {
  const t = (n.type || "").toLowerCase();
  const title = (n.title || "").toLowerCase();
  const body = ((n.body || n.message || "") as string).toLowerCase();

  // ✅ broaden invite detection (so it works even if type/title differs)
  const looksLikeInvite =
    t.includes("invite") ||
    !!n.inviteId ||
    title.includes("invite") ||
    title.includes("match invite") ||
    body.includes("invite") ||
    body.includes("invited you");

  if (looksLikeInvite) {
    // Keep your current behavior: go to Messages home
    // (Later you can deep-link to an invite screen if you add one)
    return "/messages";
  }

  // ✅ Direct message thread
  if (t === "message" && n.conversationId) return `/messages/${n.conversationId}`;

  // ✅ Events
  if (n.eventId) return `/events/${n.eventId}`;

  // ✅ Explicit route
  if (n.route && n.route.startsWith("/")) return n.route;

  // ✅ URL field
  if (n.url) {
    try {
      const u = new URL(n.url);
      return u.pathname || "/home";
    } catch {
      if (n.url.startsWith("/")) return n.url;
    }
  }

  // ✅ link field
  if (n.link) {
    if (n.link.startsWith("/")) return n.link;
    try {
      const u = new URL(n.link);
      return u.pathname || "/home";
    } catch {}
  }

  // ✅ Match
  if (n.matchId) return `/matches?matchId=${n.matchId}`;

  // ✅ safer final fallback than /matches
  return "/home";
}

function formatNotifTime(ts: any): string {
  if (!ts?.toDate) return "";

  const d = ts.toDate();
  const now = new Date();

  const isToday =
    d.getDate() === now.getDate() &&
    d.getMonth() === now.getMonth() &&
    d.getFullYear() === now.getFullYear();

  const yesterday = new Date();
  yesterday.setDate(now.getDate() - 1);

  const isYesterday =
    d.getDate() === yesterday.getDate() &&
    d.getMonth() === yesterday.getMonth() &&
    d.getFullYear() === yesterday.getFullYear();

  const time = d.toLocaleTimeString([], {
    hour: "numeric",
    minute: "2-digit",
  });

  if (isToday) return `Today · ${time}`;
  if (isYesterday) return `Yesterday · ${time}`;

  return d.toLocaleDateString([], {
    day: "numeric",
    month: "short",
  }) + ` · ${time}`;
}

export default function TMDesktopSidebar({
  active,
  player,
}: {
  active?: "Home" | "Chat" | "Calendar" | "Search" | "Profile";
  player?: Player | null;
}) {

  // ✅ NEW: local player state (used when prop "player" is not provided)
  const [me, setMe] = useState<Player | null>(null);
    const [avatarFallback, setAvatarFallback] = useState(false);

      // ✅ Notifications (desktop bell)
  const [uid, setUid] = useState<string | null>(null);
  const [notifOpen, setNotifOpen] = useState(false);
  const [notifs, setNotifs] = useState<DesktopNotification[]>([]);
  const [unreadMsgCount, setUnreadMsgCount] = useState(0);
  const notifWrapRef = useRef<HTMLDivElement | null>(null);

  const bellBtnRef = useRef<HTMLButtonElement | null>(null);
const [notifPos, setNotifPos] = useState<{ top: number; right: number; width: number }>({
  top: 0,
  right: 0,
  width: 360,
});

  const unreadCount = notifs.filter((n) => !n.read).length;

  const markNotifRead = async (id: string) => {
    try {
      await updateDoc(doc(db, "notifications", id), {
        read: true,
        readAt: serverTimestamp(),
      });
    } catch (e) {
      console.warn("Failed to mark notification read", e);
    }
  };

  const markAllRead = async () => {
    try {
      const batch = writeBatch(db);
      notifs.forEach((n) => {
        if (!n.read) {
          batch.update(doc(db, "notifications", n.id), {
            read: true,
            readAt: serverTimestamp(),
          });
        }
      });
      await batch.commit();
    } catch (e) {
      console.warn("Failed to mark all notifications read", e);
    }
  };


  useEffect(() => {
    // if parent already gave us a player, don't fetch again
    if (player) {
      setMe(player);
      return;
    }

    const unsub = onAuthStateChanged(auth, async (u) => {
      if (!u) {
        setMe(null);
        return;
      }

      try {
        const snap = await getDoc(doc(db, "players", u.uid));
        if (snap.exists()) {
          const data = snap.data() as any;
          setMe({
            name: data.name ?? null,
            skillBandLabel: data.skillBandLabel ?? null,
            skillLevel: data.skillLevel ?? null,
            skillBand: data.skillBand ?? null,
            utr: data.utr ?? null,
            skillRating: data.skillRating ?? null,
            photoThumbURL: data.photoThumbURL ?? null,
            photoURL: data.photoURL ?? null,
            avatar: data.avatar ?? null,
          });
        } else {
          // fallback to auth photo if no player doc
          setMe({
            name: u.displayName ?? "Player",
            photoURL: u.photoURL ?? null,
          });
        }
      } catch (e) {
        console.warn("TMDesktopSidebar: failed to load player", e);
        setMe({
          name: u.displayName ?? "Player",
          photoURL: u.photoURL ?? null,
        });
      }
    });

    return () => unsub();
  }, [player]);

    // ✅ Always know the current uid (even when "player" prop is passed in)
  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (u) => {
      setUid(u?.uid ?? null);
    });
    return () => unsub();
  }, []);

// ✅ Live UNREAD notifications feed (match mobile bell logic)
useEffect(() => {
 if (!uid) {
  setNotifs([]);
  setUnreadMsgCount(0);
  return;
}
  const qy = query(
  collection(db, "notifications"),
  where("recipientId", "==", uid),
  orderBy("timestamp", "desc"),
  limit(50)
);

const unsub = onSnapshot(
  qy,
  (snap) => {
    const rows: DesktopNotification[] = snap.docs.map((d) => {
      const data = d.data() as any;
      return {
        id: d.id,
        title: (data.title ?? data.heading ?? null) as any,
        body: (data.body ?? null) as any,
        message: (data.message ?? null) as any,
        link: (data.link ?? data.href ?? null) as any,
        type: (data.type ?? null) as any,
        matchId: (data.matchId ?? null) as any,
        conversationId: (data.conversationId ?? null) as any,
        eventId: (data.eventId ?? null) as any,

        inviteId: (data.inviteId ?? null) as any,
  route: (data.route ?? null) as any,
  url: (data.url ?? null) as any,
        
        read: !!data.read,
        timestamp: data.timestamp ?? null,
      };
    });

    // ✅ Count unread message notifications (for Chat pill)
   const unreadMessages = rows.filter(
  (n) => (n.type || "").toLowerCase() === "message" && !n.read
).length;
setUnreadMsgCount(unreadMessages);

    // ✅ Remove message notifications from bell dropdown
    const filtered = rows.filter((n) => (n.type || "").toLowerCase() !== "message");

    filtered.sort(
      (a, b) =>
        (b.timestamp?.toMillis?.() ?? 0) - (a.timestamp?.toMillis?.() ?? 0)
    );

    setNotifs(filtered);
  },
  (err) => {
    console.warn("Notifications snapshot error", err);
    setNotifs([]);
    setUnreadMsgCount(0);
  }
);

  return () => unsub();
}, [uid]);



    // ✅ Close dropdown on outside click
  useEffect(() => {
    if (!notifOpen) return;

    const onDown = (e: MouseEvent) => {
      const el = notifWrapRef.current;
      if (!el) return;
      if (!el.contains(e.target as Node)) setNotifOpen(false);
    };

    window.addEventListener("mousedown", onDown);
    return () => window.removeEventListener("mousedown", onDown);
  }, [notifOpen]);



  // ✅ Use "player" prop if provided, otherwise the fetched "me"
  const effectivePlayer = player ?? me;

  // ✅ MUST be defined before derivedActive uses it
  const pathname = usePathname();
  const router = useRouter();

  const avatarSrc = avatarFallback
  ? "/default-avatar.png"
  : effectivePlayer?.photoThumbURL ||
    effectivePlayer?.photoURL ||
    effectivePlayer?.avatar ||
    "/default-avatar.png";

  const userName = (effectivePlayer?.name || "Player").toString();

  

  const levelLabel = (
    effectivePlayer?.skillLevel ||
    effectivePlayer?.skillBandLabel ||
    "Beginner"
  )
    .toString()
    .toUpperCase();


const navItems: Array<{
  label: "Home" | "Chat" | "Calendar" | "Search" | "Profile";
  href: string;
}> = [
  { label: "Home", href: "/home" },
  { label: "Chat", href: "/messages" },

  // ✅ NEW: Calendar link (under Chat)
  { label: "Calendar", href: "/calendar" },

  { label: "Search", href: "/directory" },
  { label: "Profile", href: "/profile" },
];

const derivedActive: (typeof navItems)[number]["label"] | undefined = (() => {
  if (pathname.startsWith("/profile")) return "Profile";
  if (pathname.startsWith("/directory")) return "Search"; // ✅ Search only here
  if (pathname.startsWith("/calendar")) return "Calendar";
  if (pathname.startsWith("/messages")) return "Chat";
  if (pathname.startsWith("/home")) return "Home";

  // ✅ Match flows should NOT highlight Search
  if (
    pathname.startsWith("/match") ||
    pathname.startsWith("/matches") ||
    pathname.startsWith("/match")
  ) {
    return undefined;
  }

  return undefined; // ✅ no default highlight
})();

const handleLogout = async () => {
  try {
    await signOut(auth);
    router.replace("/login");
  } catch (err) {
    console.error("Logout failed", err);
  }
};

const isMatchesRoute = pathname.startsWith("/matches") || pathname.startsWith("/match");
const activeLabel = derivedActive ?? (isMatchesRoute ? undefined : active);

function computeNotifPos() {
  const btn = bellBtnRef.current;
  if (!btn) return;

  const r = btn.getBoundingClientRect();

  const desired = 360;
  const vw = window.innerWidth;

  // Width never exceeds viewport minus padding
  const width = Math.min(desired, vw - 24);

  // Ideal: align dropdown right edge with the bell button right edge
  let right = vw - r.right;

  // Clamp right so dropdown stays inside viewport
  // right must be between 12 and (vw - width - 12)
  right = Math.min(Math.max(right, 12), vw - width - 12);

  const top = r.bottom + 8;

  setNotifPos({ top, right, width });
}

useEffect(() => {
  if (!notifOpen) return;

  computeNotifPos();

  const onResize = () => computeNotifPos();
  const onScroll = () => computeNotifPos();

  window.addEventListener("resize", onResize);
  window.addEventListener("scroll", onScroll, true);

  return () => {
    window.removeEventListener("resize", onResize);
    window.removeEventListener("scroll", onScroll, true);
  };
}, [notifOpen]);

  return (
    <aside className="w-[300px] shrink-0">
      <div className="sticky top-6 rounded-3xl border border-black/10 bg-white p-4 flex flex-col h-[calc(100vh-48px)]">
         {/* Header / logo + notifications */}
        <div className="flex items-center justify-between gap-3">
          {/* Left: Logo + title */}
          <div className="flex items-center gap-3">
            <div
              className="h-10 w-10 rounded-2xl grid place-items-center font-extrabold"
              style={{ background: TM.forest, color: TM.neon }}
            >
              TM
            </div>

            <div className="min-w-0">
              <div className="text-sm font-extrabold text-black/85">TennisMate</div>
              <div className="text-xs text-black/50">Dashboard</div>
            </div>
          </div>

          {/* Right: Bell */}
          <div className="relative" ref={notifWrapRef}>
           <button
  ref={bellBtnRef}
  type="button"
  onClick={() => {
    setNotifOpen((v) => {
      const next = !v;
      // compute position right as we open
      if (next) setTimeout(() => computeNotifPos(), 0);
      return next;
    });
  }}
  className="relative inline-flex h-10 w-10 items-center justify-center rounded-2xl border border-black/10 bg-white hover:bg-black/[0.03]"
  aria-label="Notifications"
>
              <Bell size={18} className="text-black/70" />

              {unreadCount > 0 && (
                <span
                  className="absolute -top-1 -right-1 min-w-[18px] h-[18px] px-1 rounded-full text-[11px] font-extrabold grid place-items-center"
                  style={{ background: TM.neon, color: TM.forest }}
                >
                  {unreadCount > 99 ? "99+" : unreadCount}
                </span>
              )}
            </button>

            {/* Dropdown */}
            {notifOpen && (
  <div
    className="fixed rounded-2xl border border-black/10 bg-white shadow-lg overflow-hidden z-[9999]"
    style={{
  top: notifPos.top,
  right: notifPos.right,
  width: notifPos.width,
  maxWidth: "calc(100vw - 24px)",
  maxHeight: "calc(100vh - 24px)",
}}
  >
                <div className="flex items-center justify-between px-3 py-2 border-b border-black/10">
                  <div className="text-sm font-extrabold text-black/80">Notifications</div>

                  <button
                    type="button"
                    onClick={markAllRead}
                    className="text-xs font-semibold text-black/60 hover:text-black/80"
                  >
                    Mark all read
                  </button>
                </div>

                {notifs.length === 0 ? (
                  <div className="px-3 py-4 text-sm text-black/55">
                    No notifications yet.
                  </div>
                ) : (
                <div className="max-h-[420px] overflow-auto p-2 space-y-2">
  {notifs.map((n) => (
    <button
      key={n.id}
      type="button"
      onClick={async () => {
        await markNotifRead(n.id);
        setNotifOpen(false);
        router.push(resolveNotifHref(n));
      }}
      className={[
        "w-full text-left rounded-2xl border border-black/10 bg-white px-3 py-3",
        "hover:bg-black/[0.02] hover:shadow-sm transition",
        "focus:outline-none focus:ring-2 focus:ring-[#39FF14]/40",
        !n.read ? "shadow-[0_0_0_2px_rgba(57,255,20,0.10)]" : "opacity-90",
      ].join(" ")}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="text-sm font-extrabold text-black/85 truncate">
                {n.title || "Notification"}
              </div>

              {(n.body || n.message) && (
                <div className="mt-1 text-xs text-black/60 leading-relaxed line-clamp-2">
                  {n.body || n.message}
                </div>
              )}
            </div>

            {n.timestamp && (
              <div className="text-[11px] font-semibold text-black/40 whitespace-nowrap pt-[2px]">
                {formatNotifTime(n.timestamp)}
              </div>
            )}
          </div>
        </div>

        {!n.read && (
          <span
            className="mt-1.5 h-2.5 w-2.5 rounded-full shrink-0"
            style={{ background: TM.neon }}
          />
        )}
      </div>
    </button>
  ))}
</div>
                )}
              </div>
            )}
          </div>
        </div>


 {/* Main content (fills remaining space) */}
<div className="flex-1 flex flex-col">

  {/* Nav */}
  <div className="mt-5 space-y-1">
    {navItems.map((i) => {
      const isActive = activeLabel === i.label;

      return (
       <Link
  key={i.label}
  href={i.href}
  className={[
    "relative block w-full rounded-2xl px-3 py-2 text-left text-sm font-semibold transition-colors",
    isActive
      ? "bg-black/[0.04] text-black/90"
      : "text-black/70 hover:bg-black/[0.03]",
  ].join(" ")}
>
  <span>{i.label}</span>

  {/* ✅ Show pill only on Chat when unread messages exist */}
  {i.label === "Chat" && unreadMsgCount > 0 && activeLabel !== "Chat" && (
    <span
      className="absolute right-3 top-1/2 -translate-y-1/2 rounded-full px-2 py-1 text-[11px] font-extrabold"
      style={{
        background: TM.neon,
        color: TM.forest,
        boxShadow: "0 0 14px rgba(57,255,20,0.35)",
      }}
    >
      New message
    </span>
  )}
</Link>
      );
    })}
  </div>

  {/* Push user card to bottom */}
  <div className="mt-auto">
    <div className="rounded-2xl border border-black/10 bg-black/[0.02] p-3">
      <div className="flex items-center gap-3">
        <div className="relative h-10 w-10 overflow-hidden rounded-full border border-black/10 bg-white">
          <Image
            src={avatarSrc}
            alt="Me"
            fill
            sizes="40px"
            className="object-cover"
            onError={() => setAvatarFallback(true)}
          />
        </div>

        <div className="min-w-0">
          <div className="text-sm font-extrabold text-black/85 truncate">
            Hello, {userName}!
          </div>
          <div className="text-[11px] font-semibold tracking-widest text-black/45">
            {levelLabel}
          </div>
        </div>
      </div>

      <div className="mt-4">
        <button
          onClick={handleLogout}
          className="w-full rounded-2xl px-3 py-2 text-sm font-semibold border border-red-200 text-red-600 hover:bg-red-50 transition"
        >
          Log Out
        </button>
      </div>
    </div>
  </div>

</div>
</div>
    </aside>
  );
}
