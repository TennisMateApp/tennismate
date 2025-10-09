"use client";

import Link from "next/link";
import { useEffect, useState, useRef } from "react";
import { useRouter, usePathname } from "next/navigation";
import {
  User, MessageCircle, Bell, Search, Settings, Home, CalendarDays, UsersRound
} from "lucide-react";
import { GiTennisCourt, GiTennisBall, GiTennisRacket } from "react-icons/gi";
import {
  collection, query, where, onSnapshot, getDoc, doc, updateDoc, writeBatch, serverTimestamp
} from "firebase/firestore";
// ✅ Import the function instead
import { auth, db } from "@/lib/firebaseConfig";
import { onAuthStateChanged, signOut } from "firebase/auth";
import InstallPwaAndroidPrompt from "@/components/InstallPwaAndroidPrompt";
import InstallPwaIosPrompt from "@/components/InstallPwaIosPrompt";
import dynamic from "next/dynamic";
const OnboardingTour = dynamic(
  () => import("@/components/OnboardingTour").then((m) => m.default),
  { ssr: false }
);
import { ONBOARDING_VERSION } from "@/app/constants/onboarding";
console.log("OnboardingTour:", OnboardingTour);


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
  const [userOnboardingSeen, setUserOnboardingSeen] = useState<number | null>(null);
const [showTour, setShowTour] = useState(false);


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
const isActive = (href: string) =>
pathname === href || pathname.startsWith(href + "/");  
const PUBLIC_ROUTES = new Set(["/login", "/signup", "/verify-email"]);
const [gateReady, setGateReady] = useState(false);

// Show "Matches" instead of "Events" when the user is in the match flow
const inMatchFlow =
  pathname.startsWith("/match") ||
  pathname.startsWith("/matches") ||
  pathname.startsWith("/messages");

  const inEventsFlow =
  pathname.startsWith("/events") ||
  pathname.startsWith("/calendar");

const footerTabs = inEventsFlow
  ? ["home", "calendar", "events"]
  : inMatchFlow
  ? ["home", "match", "matches"]
  : ["home", "match", "events"];


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

    // ✅ Onboarding tour logic (now correctly scoped)
    const seen = userDocSnap.exists()
      ? userDocSnap.data()?.onboardingVersionSeen ?? 0
      : 0;
    setUserOnboardingSeen(seen);
    setShowTour((seen ?? 0) < ONBOARDING_VERSION);

    // ...rest of your snapshot wiring
    const playerRef = doc(db, "players", u.uid);
    unsubPlayer = onSnapshot(playerRef, (docSnap) => {
      if (docSnap.exists()) {
        const data = docSnap.data();
        setPhotoURL(data.photoURL || null);
      }
    });

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
    setShowTour(false); // ✅ hide tour on sign-out
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

 const totalNotifications = unreadMatchRequests.length + notifications.length; // ❌ exclude messages
const totalMessages = unreadMessages.length; // ✅ separate count for messages


   async function completeOnboardingTour() {
  try {
    const u = auth.currentUser;
    if (!u) {
      setShowTour(false);
      return;
    }
    await updateDoc(doc(db, "users", u.uid), {
      onboardingVersionSeen: ONBOARDING_VERSION,
      onboardingLastShownAt: serverTimestamp(),
    });
  } catch {}
  setShowTour(false);
  setUserOnboardingSeen(ONBOARDING_VERSION);
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
                  {/* Calendar */}
<Link href="/calendar" title="Calendar">
  <CalendarDays
    className={`w-6 h-6 ${isActive("/calendar") ? "text-blue-700" : "text-green-600 hover:text-blue-800"}`}
  />
</Link>
                  <Link href="/messages" title="Messages" className="relative">
  <MessageCircle className="w-6 h-6 text-green-600 hover:text-blue-800" />
  {totalMessages > 0 && (
    <span className="absolute -top-2 -right-2 bg-red-600 text-white text-xs font-bold px-1.5 py-0.5 rounded-full animate-pulse">
      {totalMessages > 9 ? "9+" : totalMessages}
    </span>
  )}
</Link>

                  <div className="relative" ref={dropdownRef}>
                    <button onClick={() => setDropdownOpen(!dropdownOpen)} className="relative focus:outline-none">
                      <Bell className="w-6 h-6 text-green-600" />
                      {totalNotifications > 0 && (
                        <span className="absolute -top-2 -right-2 bg-red-600 text-white text-xs font-bold px-1.5 py-0.5 rounded-full animate-pulse">
                          {totalNotifications > 9 ? "9+" : totalNotifications}
                        </span>
                      )}
                    </button>

                    {dropdownOpen && (
                      <div className="absolute right-0 mt-2 w-72 bg-white border border-gray-200 shadow-lg rounded-md z-50">
                        {unreadMatchRequests.length === 0 && unreadMessages.length === 0 && notifications.length === 0 ? (
                          <div className="p-4 text-sm text-gray-500">No notifications</div>
                        ) : (
                          <ul className="divide-y divide-gray-100 max-h-96 overflow-y-auto text-sm">
                            {notifications.length > 0 && (
                              <>
                                <li className="flex justify-between items-center px-3 py-2 text-sm text-gray-700 font-semibold bg-gray-50 border-b border-gray-200">
                                  <span>Notifications</span>
                                  <button
                                    onClick={async () => {
                                      const batch = writeBatch(db);
                                      notifications.forEach((notif) => {
                                        const ref = doc(db, "notifications", notif.id);
                                        batch.update(ref, { read: true });
                                      });
                                      await batch.commit();
                                      setNotifications([]);
                                    }}
                                    className="text-blue-600 hover:underline text-xs"
                                  >
                                    Clear All
                                  </button>
                                </li>
                                {notifications.map((notif) => (
  <li
    key={notif.id}
    className="p-3 hover:bg-gray-100 cursor-pointer"
    onClick={async () => {
      setDropdownOpen(false);
      await updateDoc(doc(db, "notifications", notif.id), { read: true });

      // Deep-link rules:
      if (notif.eventId) {
        router.push(`/events/${notif.eventId}`);
        return;
      }
      if (notif.conversationId) {
        router.push(`/messages/${notif.conversationId}`);
        return;
      }
      // Fallback
      router.push("/matches");
    }}
  >
    <div className="text-sm">
      <p className="font-medium">{notif.type === "event_join_request" ? "Join Request" : "Notification"}</p>
      <p className="text-gray-600">{notif.message}</p>
    </div>
  </li>
))}

                              </>
                            )}

                            {unreadMatchRequests.map((req) => (
                              <li
                                key={req.id}
                                className="p-3 hover:bg-gray-100 cursor-pointer"
                                onClick={() => {
                                  setDropdownOpen(false);
                                  router.push("/matches");
                                }}
                              >
                                Match request from {req.fromName || "a player"}
                              </li>
                            ))}

                            {unreadMessages.map((msg) => (
                              <li
                                key={msg.id}
                                className="p-3 hover:bg-gray-100 cursor-pointer"
                                onClick={() => {
                                  setDropdownOpen(false);
                                  router.push("/messages");
                                }}
                              >
                                New message from {msg.name}
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
      onClick={() => {
        setShowSettings(false);
        setShowTour(true); // 👈 Reopen onboarding tour
      }}
      className="w-full text-left px-4 py-2 text-sm hover:bg-gray-100"
    >
      What’s New
    </button>

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

      {/* 🏠 Home */}
      {footerTabs.includes("home") && (
        <Link
          href="/home"
          aria-label="Home"
          className={`flex flex-col items-center ${
            isActive("/home") ? "text-blue-700" : "text-green-600 hover:text-green-800"
          }`}
        >
          <Home className="w-6 h-6 mb-1" />
          <span>Home</span>
        </Link>
      )}

      {/* 🎯 Match Me */}
      {footerTabs.includes("match") && (
        <Link
          href="/match"
          aria-label="Match Me"
          className={`flex flex-col items-center ${
            isActive("/match") ? "text-blue-700" : "text-green-600 hover:text-green-800"
          }`}
        >
          <GiTennisCourt className="w-6 h-6 mb-1" />
          <span>Match Me</span>
        </Link>
      )}

      {/* 👥 Events (shown when NOT in match flow) */}
      {footerTabs.includes("events") && (
        <Link
          href="/events"
          aria-label="Events"
          className={`flex flex-col items-center ${
            isActive("/events") ? "text-blue-700" : "text-green-600 hover:text-green-800"
          }`}
        >
          <UsersRound className="w-6 h-6 mb-1" />
          <span>Events</span>
        </Link>
      )}

      {/* 🎾 Matches (shown IN match flow) */}
      {footerTabs.includes("matches") && (
        <Link
          href="/matches"
          aria-label="Matches"
          className={`relative flex flex-col items-center ${
            isActive("/matches") ? "text-blue-700" : "text-green-600 hover:text-green-800"
          }`}
        >
          <GiTennisBall className="w-6 h-6 mb-1" />
          <span>Matches</span>
          {unreadMatchRequests.length > 0 && (
            <span className="absolute top-0 right-1 -mt-1 bg-red-600 text-white text-xs font-bold px-1.5 py-0.5 rounded-full leading-none">
              {unreadMatchRequests.length > 9 ? "9+" : unreadMatchRequests.length}
            </span>
          )}
        </Link>
      )}
      {/* 📅 Calendar (shown in Events flow) */}
{footerTabs.includes("calendar") && (
  <Link
    href="/calendar"
    aria-label="Calendar"
    className={`flex flex-col items-center ${
      isActive("/calendar") ? "text-blue-700" : "text-green-600 hover:text-green-800"
    }`}
  >
    <CalendarDays className="w-6 h-6 mb-1" />
    <span>Calendar</span>
  </Link>
)}


    </div>
  </footer>
)}



     {user && !hideAllNav && !hideFeedback && <FloatingFeedbackButton />}
     <OnboardingTour
  open={!!user && showTour}
  onClose={completeOnboardingTour}  // close + persist as seen
  onComplete={completeOnboardingTour}
/>

    </div>
  );
}
