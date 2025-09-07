"use client";

import Link from "next/link";
import { useEffect, useState, useRef } from "react";
import { useRouter, usePathname } from "next/navigation";
import {
  User, MessageCircle, Bell, Search, Settings
} from "lucide-react";
import { GiTennisCourt, GiTennisBall } from "react-icons/gi";
import {
  collection, query, where, onSnapshot, getDoc, doc, updateDoc, writeBatch
} from "firebase/firestore";
// ✅ Import the function instead
import { auth, db } from "@/lib/firebaseConfig";
import { onAuthStateChanged, signOut } from "firebase/auth";
import InstallPwaAndroidPrompt from "@/components/InstallPwaAndroidPrompt";
import InstallPwaIosPrompt from "@/components/InstallPwaIosPrompt";
import dynamic from "next/dynamic";

const PushClientOnly = dynamic(() => import("./PushClientOnly"), { ssr: false });

// ---- Add the useSystemTheme hook after imports ----
function useSystemTheme() {
  useEffect(() => {
    if (typeof window === "undefined") return; // SSR guard

    // Ensure matchMedia exists
if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
  return;
}

const matchMedia = window.matchMedia("(prefers-color-scheme: dark)");

    const root = document.documentElement;

    const updateTheme = (e?: MediaQueryListEvent) => {
      const isDark = e?.matches ?? matchMedia.matches;
      if (isDark) {
        root.classList.add("dark");
      } else {
        root.classList.remove("dark");
      }
    };

    updateTheme();

    // ✅ Use optional chaining to avoid calling undefined
    matchMedia.addEventListener?.("change", updateTheme);

    return () => {
      matchMedia.removeEventListener?.("change", updateTheme);
    };
  }, []);
}

// ---------------------------------------------------

export default function LayoutWrapper({ children }: { children: React.ReactNode }) {
  useSystemTheme(); // <-- Call the hook at the top of your component

  const [user, setUser] = useState<any>(null);
  const [photoURL, setPhotoURL] = useState<string | null>(null);
  const [unreadMatchRequests, setUnreadMatchRequests] = useState<any[]>([]);
  const [unreadMessages, setUnreadMessages] = useState<any[]>([]);
  const [notifications, setNotifications] = useState<any[]>([]);
  const [showSettings, setShowSettings] = useState(false);
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [showVerify, setShowVerify] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const settingsRef = useRef<HTMLDivElement>(null);

useEffect(() => {
  function onKey(e: KeyboardEvent) {
    if (e.key === "Escape") {
      setDropdownOpen(false);
      setShowSettings(false);
    }
  }
  if (dropdownOpen || showSettings) {
    window.addEventListener("keydown", onKey);
  }
  return () => window.removeEventListener("keydown", onKey);
}, [dropdownOpen, showSettings]);

const router = useRouter();
const pathname = usePathname() || "";
const PUBLIC_ROUTES = new Set(["/login", "/signup", "/verify-email"]);
const [gateReady, setGateReady] = useState(false);

// Existing hides
const hideNavMessages = pathname.startsWith("/messages/");
const hideNavVerify = pathname.startsWith("/verify-email"); // 👈 hide chrome on verify page

// Hide on match completion/summary routes (supports optional trailing slash)
const hideFeedback =
  /^\/matches\/[^/]+\/(complete(?:\/details)?|summary)\/?$/.test(pathname);

// NEW: hide on the feedback form route
const hideNavFeedback =
  /^\/matches\/[^/]+\/feedback\/?$/.test(pathname);

// Aggregate: header/footer/FAB should be hidden if any of the above match
const hideAllNav = hideNavMessages || hideNavVerify || hideFeedback || hideNavFeedback;


useEffect(() => {
  function handleClickOutside(event: MouseEvent) {
    const target = event.target as Node;

    if (dropdownRef.current && !dropdownRef.current.contains(target)) {
      setDropdownOpen(false);
    }
    if (settingsRef.current && !settingsRef.current.contains(target)) {
      setShowSettings(false);
    }
  }

  if (dropdownOpen || showSettings) {
    document.addEventListener("mousedown", handleClickOutside);
  }
  return () => {
    document.removeEventListener("mousedown", handleClickOutside);
  };
}, [dropdownOpen, showSettings]);


  useEffect(() => {
    let unsubAuth = () => {};
    let unsubInbox = () => {};
    let unsubMessages = () => {};
    let unsubNotifications = () => {};
    let unsubPlayer = () => {};

    unsubAuth = onAuthStateChanged(auth, async (u) => {
      if (u) {
        await u.reload();
        setUser(auth.currentUser);

          const userDocSnap = await getDoc(doc(db, "users", u.uid));
    const requireVerification =
      userDocSnap.exists() && userDocSnap.data()?.requireVerification === true;
    setShowVerify(requireVerification && !u.emailVerified);

        const playerRef = doc(db, "players", u.uid);
        unsubPlayer = onSnapshot(playerRef, (docSnap) => {
          if (docSnap.exists()) {
            const data = docSnap.data();
            setPhotoURL(data.photoURL || null);
          }
        });

        // ...rest of your useEffect code

        unsubInbox = onSnapshot(
          query(collection(db, "match_requests"), where("toUserId", "==", u.uid), where("status", "==", "unread")),
          (snap) => setUnreadMatchRequests(snap.docs.map(doc => ({ id: doc.id, ...doc.data() })))
        );

        unsubMessages = onSnapshot(
          query(collection(db, "conversations"), where("participants", "array-contains", u.uid)),
          async (snap) => {
            const unreadList: any[] = [];
            for (const docSnap of snap.docs) {
              const data = docSnap.data();
              const lastSeen = data.lastRead?.[u.uid];
              const latest = data.latestMessage?.timestamp;

              if (latest?.toMillis && (!lastSeen || latest.toMillis() > lastSeen.toMillis())) {
                const otherUserId = data.participants.find((id: string) => id !== u.uid);
                const userDoc = await getDoc(doc(db, "users", otherUserId));
                unreadList.push({
                  id: docSnap.id,
                  name: userDoc.exists() ? userDoc.data().name : "Unknown",
                  text: data.latestMessage?.text || ""
                });
              }
            }
            setUnreadMessages(unreadList);
          }
        );

        unsubNotifications = onSnapshot(
          query(collection(db, "notifications"), where("recipientId", "==", u.uid), where("read", "==", false)),
          (snap) => setNotifications(snap.docs.map((doc) => ({ id: doc.id, ...doc.data() })))
        );

      } else {
        setUser(null);
        setPhotoURL(null);
      }
    });

    return () => {
      unsubAuth();
      unsubInbox();
      unsubMessages();
      unsubNotifications();
      unsubPlayer();
    };
  }, []);

 useEffect(() => {
  let cancelled = false;

  (async () => {
    // Public routes: render immediately (no gating)
    if (PUBLIC_ROUTES.has(pathname || "")) {
      if (!cancelled) setGateReady(true);
      return;
    }

    // Start gating → hide content until we decide
    if (!cancelled) setGateReady(false);

    const u = auth.currentUser;

    // Not signed in: let page-level logic handle redirects
    if (!u) {
      if (!cancelled) setGateReady(true);
      return;
    }

    await u.reload();

    // Check Firestore flag
    const snap = await getDoc(doc(db, "users", u.uid));
    const requireVerification =
      snap.exists() && snap.data()?.requireVerification === true;

    const needsVerify = requireVerification && !u.emailVerified;

    // Needs verification and not on /verify-email → force /verify-email
    if (needsVerify && !pathname?.startsWith("/verify-email")) {
      router.replace("/verify-email");
      return; // we'll render verify page on next route
    }

    // Already verified but on /verify-email → send to /match
    if (!needsVerify && pathname?.startsWith("/verify-email")) {
      router.replace("/match");
      return;
    }

    // All good → render current page
    if (!cancelled) setGateReady(true);
  })();

  return () => {
    cancelled = true;
  };
}, [pathname, router]);



  const handleLogout = async () => {
    await signOut(auth);
    router.push("/login");
  };

const messageCount = unreadMessages.length;
const alertCount = unreadMatchRequests.length + notifications.length; // bell only
const hasAnyAlerts = alertCount > 0;

async function clearAllAlerts() {
  try {
    const batch = writeBatch(db);

    // Mark in-app notifications as read
    notifications.forEach((n) => {
      batch.update(doc(db, "notifications", n.id), { read: true });
    });

    // Mark match requests as read
    unreadMatchRequests.forEach((req) => {
      batch.update(doc(db, "match_requests", req.id), { status: "read" });
    });

    await batch.commit();

    // Local state tidy-up
    setNotifications([]);
    setUnreadMatchRequests([]);
    setDropdownOpen(false);
  } catch (e) {
    console.error("Failed to clear alerts", e);
  }
}

    // Floating feedback button component
  function FloatingFeedbackButton() {
    const router = useRouter();
    return (
      <button
        onClick={() => router.push("/support")}
        className="fixed bottom-24 right-6 bg-green-600 hover:bg-green-700 text-white px-4 py-3 rounded-full shadow-lg flex items-center gap-2 transition-all duration-200 z-50"
      >
        <span className="text-sm font-medium">Give Feedback</span>
      </button>
    );
  }

    if (!gateReady && !PUBLIC_ROUTES.has(pathname || "")) {
    return null; // prevent first-paint flicker on gated pages
  }

  return (
 <div className={`min-h-screen text-gray-900 ${hideAllNav ? "" : "bg-gray-100"} ${hideAllNav ? "" : "pb-20"}`}>
    <InstallPwaAndroidPrompt />
    <InstallPwaIosPrompt />
    <PushClientOnly />
      {!hideAllNav && (
       <header className="sticky top-0 z-40 bg-white/90 backdrop-blur supports-[backdrop-filter]:bg-white/60 border-b">
  <div className="max-w-6xl mx-auto flex items-center justify-between px-4 py-3">
            <Link href="/" className="flex items-center">
              <img src="/logo.png" alt="TennisMate" className="w-[40px] h-[40px] rounded-full object-cover" />
            </Link>

            <nav className="flex items-center space-x-6 text-sm">
              {user ? (
                <>
                  <Link href="/profile" title="Profile">
                    {photoURL ? (
                      <img src={photoURL} alt="Profile" className="w-8 h-8 rounded-full object-cover border border-green-600" />
                    ) : (
                      <User className="w-6 h-6 text-blue-600 hover:text-blue-800" />
                    )}
                  </Link>
                  <Link href="/directory" title="Directory">
                    <Search className="w-6 h-6 text-green-600 hover:text-blue-800" />
                  </Link>
<Link href="/messages" title="Messages" className="relative">
  <MessageCircle className="w-6 h-6 text-green-600 hover:text-blue-800" />
  {messageCount > 0 && (
    <span className="absolute -top-2 -right-2 bg-red-600 text-white text-xs font-bold px-1.5 py-0.5 rounded-full leading-none animate-pulse">
      {messageCount > 9 ? "9+" : messageCount}
    </span>
  )}
</Link>  {/* ← Close this before the bell dropdown */}

<div className="relative" ref={dropdownRef}>
  <button onClick={() => setDropdownOpen(!dropdownOpen)} className="relative focus:outline-none">
    <Bell className="w-6 h-6 text-green-600" />
    {alertCount > 0 && (
      <span className="absolute -top-2 -right-2 bg-red-600 text-white text-xs font-bold px-1.5 py-0.5 rounded-full animate-pulse">
        {alertCount > 9 ? "9+" : alertCount}
      </span>
    )}
  </button>

  {dropdownOpen && (
    <div className="absolute right-0 mt-2 w-72 bg-white border border-gray-200 shadow-lg rounded-md z-50">
      <div className="flex items-center justify-between px-3 py-2 text-sm bg-gray-50 border-b border-gray-200">
        <span className="font-semibold text-gray-700">Notifications</span>
        {hasAnyAlerts ? (
          <button onClick={clearAllAlerts} className="text-blue-600 hover:underline text-xs">
            Clear all
          </button>
        ) : (
          <span className="text-xs text-gray-400">No notifications</span>
        )}
      </div>

      {hasAnyAlerts && (
        <ul className="divide-y divide-gray-100 max-h-96 overflow-y-auto text-sm">
          {notifications.map((notif) => (
            <li
              key={notif.id}
              className="p-3 hover:bg-gray-100 cursor-pointer"
              onClick={async () => {
                setDropdownOpen(false);
                await updateDoc(doc(db, "notifications", notif.id), { read: true });
                router.push("/matches");
              }}
            >
              {notif.message}
            </li>
          ))}

          {unreadMatchRequests.map((req) => (
            <li
              key={req.id}
              className="p-3 hover:bg-gray-100 cursor-pointer"
              onClick={async () => {
                setDropdownOpen(false);
                await updateDoc(doc(db, "match_requests", req.id), { status: "read" });
                router.push("/matches");
              }}
            >
              Match request from {req.fromName || "a player"}
            </li>
          ))}
        </ul>
      )}
    </div>
  )}
                  </div>
                  <div className="relative" ref={settingsRef}>
                    <button onClick={() => setShowSettings(!showSettings)} title="Settings">
                      <Settings className="w-6 h-6 text-green-600 hover:text-green-800" />
                    </button>
                    {showSettings && (
                      <div className="absolute right-0 mt-2 w-48 bg-white border rounded shadow z-50">
                        <Link
                          href="/profile?edit=true"
                          className="block px-4 py-2 text-sm hover:bg-gray-100"
                          onClick={() => setShowSettings(false)}
                        >
                          Edit Profile
                        </Link>
                        <Link
                          href="/support"
                          className="block px-4 py-2 text-sm hover:bg-gray-100"
                          onClick={() => setShowSettings(false)}
                        >
                          Support
                        </Link>
                        <button
                          onClick={handleLogout}
                          className="w-full text-left px-4 py-2 text-sm text-red-600 hover:bg-gray-100"
                        >
                          Logout
                        </button>
                      </div>
                    )}
                  </div>
                </>
              ) : (
                <Link href="/login" className="text-blue-600 hover:underline">Login / Sign Up</Link>
              )}
            </nav>
          </div>
        </header>
      )}

<main className={`max-w-5xl mx-auto px-4 ${hideAllNav ? "pb-0" : "pb-20"}`}>
  {children}
</main>
      {user && !hideAllNav && (
        <footer className="fixed bottom-0 left-0 right-0 bg-white border-t shadow-md z-50">
          <div className="max-w-5xl mx-auto flex justify-around py-2 text-sm">
            <Link href="/match" className="flex flex-col items-center text-green-600 hover:text-green-800">
              <GiTennisCourt className="w-6 h-6 mb-1" />
              <span>Match Me</span>
            </Link>
            <Link href="/matches" className="flex flex-col items-center text-green-600 hover:text-green-800 relative">
              <GiTennisBall className="w-6 h-6 mb-1" />
              <span>Matches</span>
              {unreadMatchRequests.length > 0 && (
                <span className="absolute top-0 right-1 -mt-1 bg-red-600 text-white text-xs font-bold px-1.5 py-0.5 rounded-full leading-none animate-pulse">
                  {unreadMatchRequests.length > 9 ? "9+" : unreadMatchRequests.length}
                </span>
              )}
            </Link>
          </div>
        </footer>
      )}
     {user && !hideAllNav && !hideFeedback && <FloatingFeedbackButton />}
    </div>
  );
}
