"use client";

import Link from "next/link";
import { useEffect, useState, useRef, useLayoutEffect } from "react";
import { useRouter, usePathname } from "next/navigation";
import {
  User,
  MessageCircle,
  Search,
  Home,
  UsersRound,
  CalendarDays,
  MoreVertical,
} from "lucide-react";
import { GiTennisBall, GiTennisRacket } from "react-icons/gi";

import {
  collection, query, where, onSnapshot, getDoc, doc, updateDoc, writeBatch, serverTimestamp
} from "firebase/firestore";
import { auth, db } from "@/lib/firebaseConfig";
import { onAuthStateChanged, signOut } from "firebase/auth";
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
import { SafeAreaTop, SafeAreaBottom } from "@/components/SafeArea";
import BackButtonHandler from "@/components/BackButtonHandler";
import GetTheAppPrompt from "@/components/growth/GetTheAppPrompt";
import { GoogleAuth } from "@codetrix-studio/capacitor-google-auth";


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

  // 🔔 Kick off native push once on app boot (Android + iOS native only)
  useEffect(() => {
    console.log("[LayoutWrapper] calling initNativePush()");
    initNativePush().catch((err) => {
      console.error("[LayoutWrapper] initNativePush failed:", err);
    });
  }, []);

useEffect(() => {
  if (!Capacitor.isNativePlatform()) return;

  const NATIVE_WEB_CLIENT_ID =
    "16871894453-pq6n70u7remnbu2pmdjf98jcshdr8geu.apps.googleusercontent.com";

  const t = setTimeout(() => {
    try {
      GoogleAuth.initialize({
        clientId: NATIVE_WEB_CLIENT_ID,
        scopes: ["profile", "email"],
        grantOfflineAccess: false,
      });

      console.log("[LayoutWrapper] GoogleAuth initialized ✅", {
        platform: Capacitor.getPlatform(),
        clientId: NATIVE_WEB_CLIENT_ID,
      });
    } catch (e) {
      console.error("[LayoutWrapper] GoogleAuth init failed ❌:", e);
    }
  }, 300); // small delay helps some Android cold starts

  return () => clearTimeout(t);
}, []);




  const bootDone = useAppBootLoader();

  // iOS: do NOT overlay the status bar (so content starts below it)
useEffect(() => {
  if (Capacitor.getPlatform && Capacitor.getPlatform() === "ios") {
    StatusBar.setOverlaysWebView({ overlay: false }).catch(() => {});
    StatusBar.setStyle({ style: Style.Dark }).catch(() => {});
  }
}, []);


  const [user, setUser] = useState<any>(null);
  const [photoURL, setPhotoURL] = useState<string | null>(null);
  const [profileComplete, setProfileComplete] = useState<boolean | null>(null);
  const [unreadMatchRequests, setUnreadMatchRequests] = useState<any[]>([]);
  const [unreadMessages, setUnreadMessages] = useState<any[]>([]);
  const [showSettings, setShowSettings] = useState(false);
  const [showVerify, setShowVerify] = useState(false);
  const settingsRef = useRef<HTMLDivElement>(null);
  const [userOnboardingSeen, setUserOnboardingSeen] = useState<number | null>(null);
const [showTour, setShowTour] = useState(false);


// NEW:
const [needsTour, setNeedsTour] = useState<boolean | null>(null);
const tourShownThisSession = useRef(false);


const router = useRouter();
const pathname = usePathname() || "";

// 👇 routes that should be full-bleed (no grey background, no boxed layout)
const fullBleedRoutes = ["/login", "/signup"];
const isFullBleed = fullBleedRoutes.some((r) => pathname.startsWith(r));

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

// Show "Matches" in the footer by default instead of "Events"
const footerTabs = inEventsFlow
  ? ["home", "calendar", "events"]        // still show Events + Calendar when you're in the events flow
  : ["home", "match", "matches"];        // default (Home, Match Me, Matches)



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
  tourShownThisSession.current = false; // ✅ reset for this user session
  await u.reload();
  setUser(auth.currentUser);

          // ✅ Initialize native push for Android app runtime


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
    const data = docSnap.data() as any;
    setPhotoURL(data.photoURL || null);
    setProfileComplete(data.profileComplete === true);
  } else {
    setPhotoURL(null);
    setProfileComplete(false); // no player doc = not complete
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
  tourShownThisSession.current = false; // ✅ reset on logout
  setUser(null);
      setPhotoURL(null);
      setShowTour(false);
      setProfileComplete(null);
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
  if (!user) return;
  if (PUBLIC_ROUTES.has(pathname || "")) return;
  if (needsTour !== true) return;          // ✅ only when known + needed
  if (tourShownThisSession.current) return;
  if (hideAllNav) return;

  const t = setTimeout(() => {
    tourShownThisSession.current = true;
    setShowSettings(false);
    setShowTour(true);
  }, 300);

  return () => clearTimeout(t);
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
  // wait until we know if profile is complete
  if (!user) return;
  if (profileComplete === null) return;

  // don't fight email verification gate
  if (showVerify) return;

  // routes we allow even when profile is incomplete
  const allowedPrefixes = [
    "/profile",         // must allow the completion screen
    "/verify-email",
    "/verify-complete",
    "/login",
    "/signup",
  ];

  const isAllowed = allowedPrefixes.some((p) => pathname.startsWith(p));
  if (isAllowed) return;

  // 🔒 If incomplete, force them to complete profile before doing anything else
  if (profileComplete === false) {
    router.replace("/profile?edit=true");
  }
}, [user, profileComplete, showVerify, pathname, router]);

useEffect(() => {
  function handleClickOutside(event: MouseEvent) {
    if (
      showSettings &&
      settingsRef.current &&
      !settingsRef.current.contains(event.target as Node)
    ) {
      setShowSettings(false);
    }
  }

  document.addEventListener("mousedown", handleClickOutside);

  return () => {
    document.removeEventListener("mousedown", handleClickOutside);
  };
}, [showSettings]);


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

function dismissOnboardingTour() {
  setShowTour(false);
}


async function completeOnboardingTour() {
  // ✅ close immediately so UI never gets stuck
  setShowTour(false);
  setNeedsTour(false);
  setUserOnboardingSeen(ONBOARDING_VERSION);

  try {
    const u = auth.currentUser;
    if (!u) return;

    await updateDoc(doc(db, "users", u.uid), {
      onboardingVersionSeen: ONBOARDING_VERSION,
      onboardingCompletedAt: serverTimestamp(),
    });
  } catch (e) {
    console.error("[Onboarding] failed to update onboardingVersionSeen:", e);
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

  // Show lightweight splash until boot timer completes (runs AFTER all hooks)
  // Show lightweight splash until boot timer completes (runs AFTER all hooks)
  if (!bootDone) {
    return (
      <div className="flex flex-col items-center justify-center h-screen bg-white">
        <img src="/logo.png" alt="TennisMate" className="w-28 h-28 animate-bounce" />
        <div className="mt-4 text-green-700 font-semibold">Loading TennisMate...</div>
      </div>
    );
  }

  // 🔐 Gate unverified users so they don't see Home first
  const shouldGateToVerify =
    !!user &&
    showVerify &&
    !pathname.startsWith("/verify-email");

if (shouldGateToVerify) {
  return (
    <div className="flex flex-col items-center justify-center h-screen bg-white">
      <BackButtonHandler />
      <img src="/logo.png" alt="TennisMate" className="w-28 h-28" />
      <div className="mt-4 text-green-700 font-semibold">
        One last step… check your email to verify your account.
      </div>
    </div>
  );
}

  return (
    <div
      className={`min-h-screen text-gray-900 ${
        hideAllNav || isFullBleed ? "" : "bg-gray-100"
      }`}
    >
      <BackButtonHandler />

    <PushClientOnly />
{!hideAllNav && (
  <>
<header
  className="sticky top-0 z-40 bg-white/90 backdrop-blur supports-[backdrop-filter]:bg-white/60 border-b"
  style={{
    // pad the header itself under the iOS status bar / Dynamic Island
    paddingTop: 'env(safe-area-inset-top)',
  }}
>
  <div className="max-w-6xl mx-auto flex items-center justify-between py-3 px-4">




            <Link href="/" className="flex items-center">
              <img src="/logo.png" alt="TennisMate" className="w-[40px] h-[40px] rounded-full object-cover" />
            </Link>

                    <nav className="flex items-center space-x-6 text-sm">
              {user ? (
                <>
                  <Link href="/profile" title="Profile" data-tour="profile">
                    {photoURL ? (
                      <img
                        src={photoURL}
                        alt="Profile"
                        className="w-8 h-8 rounded-full object-cover border border-green-600"
                      />
                    ) : (
                      <User className="w-6 h-6 text-blue-600 hover:text-blue-800" />
                    )}
                  </Link>

                  {/* Directory */}
                  <Link href="/directory" title="Directory" data-tour="directory">
                    <Search className="w-6 h-6 text-green-600 hover:text-blue-800" />
                  </Link>


                  {/* Messages */}
                  <Link href="/messages" title="Messages" className="relative">
                    <MessageCircle className="w-6 h-6 text-green-600 hover:text-blue-800" />
                    {totalMessages > 0 && (
                      <span className="absolute -top-2 -right-2 bg-red-600 text-white text-xs font-bold px-1.5 py-0.5 rounded-full animate-pulse">
                        {totalMessages > 9 ? "9+" : totalMessages}
                      </span>
                    )}
                  </Link>

                  {/* Notifications */}
                  <div className="relative flex items-center justify-center top-[2px]" data-tour="notifications">
                    <NotificationBell />
                  </div>

                  {/* Settings dropdown */}
                  <div className="relative" ref={settingsRef}>
                    <button
                      onClick={() => setShowSettings(!showSettings)}
                      title="Menu"
                      className="flex items-center justify-center mt-[1px]"
                    >
                      <MoreVertical className="w-7 h-7 text-green-600 hover:text-green-800" />
                    </button>
                    {showSettings && (
                      <div className="absolute right-0 mt-2 w-48 bg-white border rounded shadow z-50">
                        <Link
  href="/profile"
  className="block px-4 py-2 text-sm hover:bg-gray-100"
  onClick={() => setShowSettings(false)}
>
  Profile
</Link>
                        <Link
  href="/calendar"
  className="block px-4 py-2 text-sm hover:bg-gray-100"
  onClick={() => setShowSettings(false)}
>
  Calendar
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
                <Link href="/login" className="text-blue-600 hover:underline">
                  Login / Sign Up
                </Link>
              )}
            </nav>

          </div>
        </header>
        </>
      )}

<main
  className={`${
    isFullBleed ? "w-full" : "max-w-5xl mx-auto px-4"
  } ${hideAllNav ? "pb-0" : ""}`}
  style={
    hideAllNav
      ? undefined
      : { paddingBottom: "calc(5rem + env(safe-area-inset-bottom, 0px))" }
  }
>
  {children}
</main>




{user && !hideAllNav && (
  <footer className="fixed bottom-0 left-0 right-0 bg-white border-t shadow-md z-50">
    <div
      className="max-w-5xl mx-auto flex justify-around text-sm px-4"
      style={{ paddingTop: 8 }}
    >



      {/* 🏠 Home */}
      {footerTabs.includes("home") && (
      <Link href="/home" aria-label="Home" data-tour="home"
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
<Link href="/match" aria-label="Match Me" data-tour="match-me"

    className={`flex flex-col items-center ${
      isActive("/match") ? "text-blue-700" : "text-green-600 hover:text-green-800"
    }`}
  >
    <GiTennisRacket className="w-6 h-6 mb-1" />
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
        <Link href="/matches" aria-label="Matches" data-tour="matches"

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
    <SafeAreaBottom extra={8} />
  </footer>
)}



     {user && !hideAllNav && !hideFeedback && <FloatingFeedbackButton />}

     {/* 🔔 Suggest native app for mobile web users after 20s of being logged in */}
     {user && !hideAllNav && <GetTheAppPrompt />}

   {showTour && (
  <OnboardingTour
    open={!!user && !PUBLIC_ROUTES.has(pathname || "") && !hideAllNav}
    onClose={dismissOnboardingTour}       // ✅ close = dismiss
    onComplete={completeOnboardingTour}   // ✅ finish = complete
  />
)}





    </div>
  );
}
