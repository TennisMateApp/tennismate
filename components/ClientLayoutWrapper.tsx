"use client";

import Link from "next/link";
import { useEffect, useState, useRef } from "react";
import { useRouter, usePathname } from "next/navigation";
import {
  User, MessageCircle, Search, Settings, Home, CalendarDays, UsersRound
} from "lucide-react";
import { GiTennisCourt, GiTennisBall, GiTennisRacket } from "react-icons/gi";
import {
  collection, query, where, onSnapshot, getDoc, doc, updateDoc, writeBatch, serverTimestamp
} from "firebase/firestore";
import { auth, db } from "@/lib/firebaseConfig";
import { onAuthStateChanged, signOut } from "firebase/auth";
import InstallPwaAndroidPrompt from "@/components/InstallPwaAndroidPrompt";
import InstallPwaIosPrompt from "@/components/InstallPwaIosPrompt";
import dynamic from "next/dynamic";
const OnboardingTour = dynamic(
  () => import("@/components/OnboardingTour").then((m) => m.default),
  { ssr: false }
);
const PushClientOnly = dynamic(
  () => import("@/components/PushClientOnly").then(m => m.default),
  { ssr: false }
);
import { ONBOARDING_VERSION } from "@/app/constants/onboarding";
import NotificationBell from "@/components/notifications/NotificationBell";
import { initNativePush, bindTokenToUserIfAvailable } from '@/lib/nativePush';
import { Capacitor } from '@capacitor/core';
import { StatusBar, Style } from '@capacitor/status-bar';
import { SplashScreen } from '@capacitor/splash-screen'; //
import { useLayoutEffect } from "react";

export default function LayoutWrapper({ children }: { children: React.ReactNode }) {
  useSystemTheme();
  useEffect(() => {
    initNativePush();
  }, []);

  const bootDone = useAppBootLoader();

  // ✅ Safe-area setup (iOS only)
  useLayoutEffect(() => {
    if (Capacitor.getPlatform() !== "ios") return;
    document.documentElement.style.setProperty(
      "--safe-top",
      "env(safe-area-inset-top, 0px)"
    );
    document.documentElement.style.setProperty(
      "--safe-bottom",
      "env(safe-area-inset-bottom, 0px)"
    );
  }, []);

  // ✅ Preserve Android status bar logic
  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;
    StatusBar.setOverlaysWebView({ overlay: false });
    StatusBar.setBackgroundColor({ color: "#0B132B" });
    StatusBar.setStyle({ style: Style.Light });
  }, []);

function useAppBootLoader() {
  const [bootDone, setBootDone] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setBootDone(true), 800);
    return () => clearTimeout(t);
  }, []);
  return bootDone;
}


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


export default function LayoutWrapper({ children }: { children: React.ReactNode }) {
  useSystemTheme(); // <-- Call the hook at the top of your component
    useEffect(() => {
    initNativePush();
  }, []);

    const bootDone = useAppBootLoader();


  // ✅ Keep native splash visible briefly, then hide (prevents white flash)
useEffect(() => {
  if (!Capacitor.isNativePlatform()) return;

  // give the WebView time to paint before hiding splash
  const t = setTimeout(() => {
    SplashScreen.hide().catch(() => {});
  }, 400);

  return () => clearTimeout(t);
}, []);


  const [user, setUser] = useState<any>(null);
  const [photoURL, setPhotoURL] = useState<string | null>(null);
  const [unreadMatchRequests, setUnreadMatchRequests] = useState<any[]>([]);
  const [unreadMessages, setUnreadMessages] = useState<any[]>([]);
  const [showSettings, setShowSettings] = useState(false);
  const [showVerify, setShowVerify] = useState(false);
  const settingsRef = useRef<HTMLDivElement>(null);
  const [userOnboardingSeen, setUserOnboardingSeen] = useState<number | null>(null);
const [showTour, setShowTour] = useState(false);

// ...inside a top-level useEffect that runs on mount:
useEffect(() => {
  if (!Capacitor.isNativePlatform()) return;

  StatusBar.setOverlaysWebView({ overlay: false });
  StatusBar.setBackgroundColor({ color: '#0B132B' }); // ✅ same color as splash
  StatusBar.setStyle({ style: Style.Light });          // ✅ white icons
}, []);


// NEW:
const [needsTour, setNeedsTour] = useState(false);
const tourShownThisSession = useRef(false);


const router = useRouter();
const pathname = usePathname() || "";
const isActive = (href: string) =>
pathname === href || pathname.startsWith(href + "/");  
const PUBLIC_ROUTES = new Set(["/login", "/signup", "/verify-email"]);

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
  let unsubAuth: () => void = () => {};
  let unsubInbox: () => void = () => {};
  let unsubMessages: () => void = () => {};
  let unsubPlayer: () => void = () => {};

  unsubAuth = onAuthStateChanged(auth, async (u) => {
    // tear down any prior listeners before wiring fresh ones on user switch
    unsubInbox(); unsubMessages(); unsubPlayer();

    if (u) {
      await u.reload();
      setUser(auth.currentUser);
          // ✅ Initialize native push for Android app runtime
    try {
      await initNativePush();
    } catch (e) {
      console.warn("initNativePush skipped/non-native or failed:", e);
    }


      const userDocSnap = await getDoc(doc(db, "users", u.uid));
      const requireVerification =
        userDocSnap.exists() && userDocSnap.data()?.requireVerification === true;
      setShowVerify(requireVerification && !u.emailVerified);

      const seen = userDocSnap.exists() ? userDocSnap.data()?.onboardingVersionSeen ?? 0 : 0;
      setUserOnboardingSeen(seen);
      setNeedsTour((seen ?? 0) < ONBOARDING_VERSION);

      const playerRef = doc(db, "players", u.uid);
      unsubPlayer = onSnapshot(playerRef, (docSnap) => {
        if (docSnap.exists()) {
          const data = docSnap.data();
          setPhotoURL((data as any).photoURL || null);
        }
      });

      unsubInbox = onSnapshot(
        query(
          collection(db, "match_requests"),
          where("toUserId", "==", u.uid),
          where("status", "==", "unread")
        ),
        (snap) => setUnreadMatchRequests(snap.docs.map(d => ({ id: d.id, ...d.data() })))
      );

      unsubMessages = onSnapshot(
        query(collection(db, "conversations"), where("participants", "array-contains", u.uid)),
        async (snap) => {
          const unreadList: any[] = [];
          for (const docSnap of snap.docs) {
            const data = docSnap.data() as any;
           const lastSeen = data.lastRead?.[u.uid];
const latest = data.latestMessage?.timestamp;

// Identify who sent the latest message (be defensive about the field name)
const latestSender: string | undefined =
  data.latestMessage?.senderId ??
  data.latestMessage?.fromUserId ??
  data.latestMessage?.authorId;

// Only count if:
// 1) there's a newer message than lastSeen
// 2) that newer (latest) message was NOT sent by the current user (inbound)
const hasNewer = latest?.toMillis && (!lastSeen || latest.toMillis() > lastSeen.toMillis());
const inbound = latestSender && latestSender !== u.uid;

if (hasNewer && inbound) {
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
    } else {
      setUser(null);
      setPhotoURL(null);
      setShowTour(false);
    }
  });

  // ✅ proper cleanup
  return () => {
    unsubAuth();
    unsubInbox();
    unsubMessages();
    unsubPlayer();
  };
}, []);


useEffect(() => {
  // Only show when:
  if (!user) return;
  if (PUBLIC_ROUTES.has(pathname || "")) return;
  if (!needsTour) return;
  if (tourShownThisSession.current) return;
  if (hideAllNav) return;

  tourShownThisSession.current = true;
  setShowTour(true);
}, [user, pathname, needsTour, hideAllNav]);



// ✅ Redirect watcher on navigation (does NOT touch gateReady)
useEffect(() => {
  (async () => {
    const u = auth.currentUser;
    if (!u) return;

    await u.reload();

    const snap = await getDoc(doc(db, "users", u.uid));
    const requireVerification = snap.exists() && snap.data()?.requireVerification === true;
    const needsVerify = requireVerification && !u.emailVerified;

    if (needsVerify && !pathname?.startsWith("/verify-email")) {
      router.replace("/verify-email");
    }
  })();
}, [pathname, router]);




useEffect(() => {
  const unsub = onAuthStateChanged(auth, async (u) => {
    if (u) {
      await bindTokenToUserIfAvailable();
    }
  });
  return () => unsub();
}, []);

  const handleLogout = async () => {
    await signOut(auth);
    router.push("/login");
  };

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

  // Show lightweight splash until boot timer completes (runs AFTER all hooks)
if (!bootDone) {
  return (
    <div className="flex flex-col items-center justify-center h-screen bg-white">
      <img src="/logo.png" alt="TennisMate" className="w-28 h-28 animate-bounce" />
      <div className="mt-4 text-green-700 font-semibold">Loading TennisMate...</div>
    </div>
  );
}


  return (
 <div className={`min-h-screen text-gray-900 ${hideAllNav ? "" : "bg-gray-100"} ${hideAllNav ? "" : "pb-20"}`}>
    <InstallPwaAndroidPrompt />
    <InstallPwaIosPrompt />
    <PushClientOnly />
      {!hideAllNav && (
       <header className="sticky top-0 z-40 bg-white/90 backdrop-blur supports-[backdrop-filter]:bg-white/60 border-b pt-[var(--safe-top,0px)]">
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

<NotificationBell />

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

<main
  className={`max-w-5xl mx-auto px-4 ${
    hideAllNav ? "pb-0" : "pb-[calc(5rem+var(--safe-bottom,0px))]"
  }`}
>
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
  open={!!user && showTour && !PUBLIC_ROUTES.has(pathname || "") && !hideAllNav}
  onClose={completeOnboardingTour}
  onComplete={completeOnboardingTour}
/>



    </div>
  );
}
