"use client";

import Link from "next/link";
import { useEffect, useState, useRef } from "react";
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
  collection,
  query,
  where,
  onSnapshot,
  getDoc,
  doc,
  setDoc,
  updateDoc,
  writeBatch,
  serverTimestamp,
} from "firebase/firestore";

import { auth, db } from "@/lib/firebaseConfig";
import { onAuthStateChanged, signOut } from "firebase/auth";
import dynamic from "next/dynamic";

const PushClientOnly = dynamic(
  () => import("@/components/PushClientOnly").then(m => m.default),
  { ssr: false }
);

import NotificationBell from "@/components/notifications/NotificationBell";
import { initNativePush, bindTokenToUserIfAvailable } from '@/lib/nativePush';
import { Capacitor } from '@capacitor/core';
import { StatusBar, Style } from '@capacitor/status-bar';
import { SplashScreen } from '@capacitor/splash-screen'; //
import { SafeAreaTop, SafeAreaBottom } from "@/components/SafeArea";
import BackButtonHandler from "@/components/BackButtonHandler";
import { GoogleAuth } from "@codetrix-studio/capacitor-google-auth";
import { track, trackSetUserId } from "@/lib/track";
import AgeGateModal from "@/components/AgeGateModal";
import Image from "next/image";
import { useIsDesktop } from "@/lib/useIsDesktop";
import { cn } from "@/lib/utils";
import { initMixpanel, identifyUser, trackEvent } from "@/lib/mixpanel";


const TM = {
  forest: "#0B3D2E",
  neon: "#39FF14",
  bg: "#F5F5F0",
};

const FOOTER = {
  bg: TM.forest,
  inactive: "rgba(255,255,255,0.55)",
  active: TM.neon,
};

function useAppBootLoader() {
  const [bootDone, setBootDone] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => setBootDone(true), 800);
    return () => clearTimeout(t);
  }, []);

  return bootDone;
}

function shouldPingLastActive(uid: string) {
  if (typeof window === "undefined") return false;

  const key = `tm_lastActivePing_${uid}`;
  const last = Number(localStorage.getItem(key) || "0");
  const now = Date.now();

  const THROTTLE_MS = 1000 * 60 * 30;
  if (now - last < THROTTLE_MS) return false;

  localStorage.setItem(key, String(now));
  return true;
}

export default function LayoutWrapper({ children }: { children: React.ReactNode }) {

useEffect(() => {
  initMixpanel();
}, []);

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
useEffect(() => {
  if (!bootDone) return;
  if (!Capacitor.isNativePlatform()) return;

  SplashScreen.hide().catch(() => {});
}, [bootDone]);
  // iOS: do NOT overlay the status bar (so content starts below it)
useEffect(() => {
  if (Capacitor.getPlatform && Capacitor.getPlatform() === "ios") {
    StatusBar.setOverlaysWebView({ overlay: false }).catch(() => {});
    StatusBar.setStyle({ style: Style.Dark }).catch(() => {});
  }
}, []);


const [user, setUser] = useState<any>(null);
const [photoURL, setPhotoURL] = useState<string | null>(null);
const [photoThumbURL, setPhotoThumbURL] = useState<string | null>(null);
const [profileComplete, setProfileComplete] = useState<boolean | null>(null);
  const [unreadMatchRequests, setUnreadMatchRequests] = useState<any[]>([]);
  const [unreadMessages, setUnreadMessages] = useState<any[]>([]);
  const [showSettings, setShowSettings] = useState(false);
  const [showVerify, setShowVerify] = useState(false);
  const settingsRef = useRef<HTMLDivElement>(null);
  const profileTrackedRef = useRef(false);



const router = useRouter();
const pathname = usePathname() || "";

const isDesktop = useIsDesktop(1024);
const isApp = Capacitor.isNativePlatform();
const isDesktopWeb = isDesktop && !isApp;


useEffect(() => {
  if (!pathname) return;

  void track("page_view", {
    page_path: pathname,
    page_location: typeof window !== "undefined" ? window.location.href : undefined,
    page_title: typeof document !== "undefined" ? document.title : undefined,
  });
}, [pathname]);




// 👇 routes that should be full-bleed (no boxed max-width)
const fullBleedRoutes = [
  "/login",
  "/signup",
  "/home",
  "/match",
  "/matches",
  "/messages",
  "/directory",
  "/calendar",
  "/invites",
  "/courts",
  "/coaches",
  "/profile",
];
const isFullBleed = fullBleedRoutes.some((r) => pathname.startsWith(r));


const isActive = (href: string) =>
  pathname === href || pathname.startsWith(href + "/");  

const PUBLIC_ROUTES = new Set(["/login", "/signup", "/verify-email"]);

const [showAgeGate, setShowAgeGate] = useState(false);
const [ageGateChecked, setAgeGateChecked] = useState(false);
const [profileGateReady, setProfileGateReady] = useState(false);

// --- Update players/{uid}.lastActiveAt (throttled) ---
useEffect(() => {
  // Only run when we know the logged-in user
  if (!user?.uid) return;

  // Don't write on public routes or verify flow
  if (PUBLIC_ROUTES.has(pathname || "")) return;
  if (pathname?.startsWith("/verify-email")) return;

  // Optional: don't write while age gate modal is blocking
  if (showAgeGate) return;

  // Throttle writes to avoid cost + spam
  if (!shouldPingLastActive(user.uid)) return;

  // Use setDoc(merge) so it works even if player doc doesn't exist yet
  setDoc(
    doc(db, "players", user.uid),
    { lastActiveAt: serverTimestamp() },
    { merge: true }
  ).catch(() => {});
}, [user?.uid, pathname, showAgeGate]);


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
  unsubInbox();
  unsubMessages();
  unsubPlayer();

  setProfileGateReady(false);

  if (u) {
    setAgeGateChecked(false);
    setShowAgeGate(false);

    profileTrackedRef.current = false;
    void trackSetUserId(u.uid);

    identifyUser(u.uid, {
      email: u.email ?? undefined,
    });

  // ✅ Track login only once per browser session (prevents firing on every refresh)
  const loginKey = `ga_login_tracked_${u.uid}`;
  if (typeof window !== "undefined" && !sessionStorage.getItem(loginKey)) {
   void track("login", { method: "firebase" });
    sessionStorage.setItem(loginKey, "1");
  }
 
  await u.reload();
  setUser(auth.currentUser);

          // ✅ Initialize native push for Android app runtime


      const userDocSnap = await getDoc(doc(db, "users", u.uid));
      const requireVerification =
        userDocSnap.exists() && userDocSnap.data()?.requireVerification === true;
      setShowVerify(requireVerification && !u.emailVerified);

const playerRef = doc(db, "players", u.uid);
const privatePlayerRef = doc(db, "players_private", u.uid);

unsubPlayer = onSnapshot(playerRef, async (docSnap) => {
  const canShowGate = !PUBLIC_ROUTES.has(pathname || "") && !showVerify;

  if (docSnap.exists()) {
    const data = docSnap.data() as any;
    const privateSnap = await getDoc(privatePlayerRef);
    const privateData = privateSnap.exists() ? (privateSnap.data() as any) : null;

    setPhotoURL(typeof data.photoURL === "string" ? data.photoURL : null);
    setPhotoThumbURL(typeof data.photoThumbURL === "string" ? data.photoThumbURL : null);
    setProfileComplete(data.profileComplete === true);

    const birthYear =
      typeof privateData?.birthYear === "number" && Number.isFinite(privateData.birthYear)
        ? privateData.birthYear
        : typeof data.birthYear === "number" && Number.isFinite(data.birthYear)
        ? data.birthYear
        : null;

    const currentYear = new Date().getFullYear();
    const computedAge = birthYear ? currentYear - birthYear : null;

    const needsBirthYear =
      !birthYear ||
      birthYear < 1900 ||
      birthYear > currentYear ||
      computedAge === null ||
      computedAge < 18 ||
      computedAge > 110;

    setShowAgeGate(canShowGate ? needsBirthYear : false);
    setAgeGateChecked(true);
    setProfileGateReady(true);
  } else {
    setPhotoURL(null);
    setPhotoThumbURL(null);
    setProfileComplete(false);

    setShowAgeGate(canShowGate);
    setAgeGateChecked(true);
    setProfileGateReady(true);
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
  profileTrackedRef.current = false;
  void trackSetUserId(null);
  void track("logout");

  setUser(null);
  setPhotoURL(null);
  setPhotoThumbURL(null);
  setProfileComplete(null);
  setShowAgeGate(false);
  setAgeGateChecked(false);
  setProfileGateReady(true);
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
  if (profileComplete !== true) return;
  if (profileTrackedRef.current) return;

  profileTrackedRef.current = true;

  void track("profile_completed", {
  user_id: user.uid,
});
}, [user, profileComplete]);


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
  if (!user) return;
  if (profileComplete === null) return;
  if (!ageGateChecked) return;

  // don't fight email verification gate
  if (showVerify) return;
  if (showAgeGate) return;


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
}, [user, profileComplete, showVerify, showAgeGate, ageGateChecked, pathname, router]);

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

    const shouldHoldProtectedRender =
  !!user &&
  !PUBLIC_ROUTES.has(pathname || "") &&
  !pathname.startsWith("/verify-email") &&
  !profileGateReady;

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

if (shouldHoldProtectedRender) {
  return (
    <div className="flex flex-col items-center justify-center h-screen bg-white">
      <BackButtonHandler />
      <img src="/logo.png" alt="TennisMate" className="w-28 h-28" />
      <div className="mt-4 text-green-700 font-semibold">
        Loading TennisMate...
      </div>
    </div>
  );
}

return (
  <div
    className="min-h-screen w-full overflow-x-hidden text-gray-900"
    style={{ background: TM.bg }} // or your cream if you want global cream
  >


      <BackButtonHandler />

    <PushClientOnly />

{profileGateReady && (
  <AgeGateModal
    isOpen={
      !!user &&
      ageGateChecked &&
      showAgeGate &&
      !PUBLIC_ROUTES.has(pathname || "") &&
      !showVerify
    }
    onSave={async (birthYear) => {
      const u = auth.currentUser;
      if (!u) return;

      await setDoc(
        doc(db, "players_private", u.uid),
        {
          birthYear,
          birthYearUpdatedAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        },
        { merge: true }
      );

      setShowAgeGate(false);
    }}
    onSignOut={async () => {
      await signOut(auth);
      router.push("/login");
    }}
  />
)}


<main
    className={cn(
    isFullBleed
      ? "w-full px-0"
      : isDesktopWeb
      ? "w-full"
      : "max-w-5xl mx-auto px-4",
    hideAllNav ? "pb-0" : ""
  )}
  style={
    hideAllNav
      ? undefined
      : {
          paddingBottom: isDesktopWeb
            ? undefined
            : "calc(5rem + env(safe-area-inset-bottom, 0px))",
        }
  }
>
  {children}
</main>



{user && !hideAllNav && !isDesktopWeb && (
  <footer
    className="fixed bottom-0 left-0 right-0 z-50"
    style={{ background: FOOTER.bg }}
  >
    <div className="w-full px-4 safe-x">
      <div className="flex items-center justify-around py-3 text-sm">
        {/* 🏠 HOME */}
        <Link
          href="/home"
          aria-label="Home"
          data-tour="home"
          className="flex flex-col items-center gap-1"
          style={{ color: isActive("/home") ? FOOTER.active : FOOTER.inactive }}
        >
          <Home className="h-6 w-6" />
          <span className="text-[10px] font-semibold tracking-widest">HOME</span>
        </Link>

        {/* 💬 CHAT */}
        <Link
          href="/messages"
          aria-label="Chat"
          className="relative flex flex-col items-center gap-1"
          style={{
            color: isActive("/messages") ? FOOTER.active : FOOTER.inactive,
          }}
        >
          <MessageCircle className="h-6 w-6" />
          <span className="text-[10px] font-semibold tracking-widest">CHAT</span>

          {totalMessages > 0 && (
            <span className="absolute -top-1 right-1 min-w-[18px] rounded-full bg-red-600 px-1 text-center text-[10px] font-bold leading-[18px] text-white">
              {totalMessages > 9 ? "9+" : totalMessages}
            </span>
          )}
        </Link>

        {/* 🔍 SEARCH */}
        <Link
          href="/directory"
          aria-label="Search"
          data-tour="directory"
          className="flex flex-col items-center gap-1"
          style={{
            color: isActive("/directory") ? FOOTER.active : FOOTER.inactive,
          }}
        >
          <Search className="h-6 w-6" />
          <span className="text-[10px] font-semibold tracking-widest">DIRECTORY</span>
        </Link>

        {/* 👤 PROFILE */}
        <Link
          href="/profile"
          aria-label="Profile"
          data-tour="profile"
          className="flex flex-col items-center gap-1"
          style={{
            color: isActive("/profile") ? FOOTER.active : FOOTER.inactive,
          }}
        >
          <User className="h-6 w-6" />
          <span className="text-[10px] font-semibold tracking-widest">PROFILE</span>
        </Link>
      </div>
    </div>

    <SafeAreaBottom extra={8} />
  </footer>
)}




     {user && !hideAllNav && !hideFeedback && !isDesktopWeb && <FloatingFeedbackButton />}


    </div>
  );
}
