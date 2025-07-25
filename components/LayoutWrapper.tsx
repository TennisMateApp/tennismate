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

// ---- Add the useSystemTheme hook after imports ----
function useSystemTheme() {
  useEffect(() => {
    if (typeof window === "undefined") return;
    const root = window.document.documentElement;
    const matchMedia = window.matchMedia("(prefers-color-scheme: dark)");

    function updateTheme(e?: MediaQueryListEvent) {
      if (e ? e.matches : matchMedia.matches) {
        root.classList.add("dark");
      } else {
        root.classList.remove("dark");
      }
    }

    updateTheme();
    matchMedia.addEventListener("change", updateTheme);

    return () => matchMedia.removeEventListener("change", updateTheme);
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
  const dropdownRef = useRef<HTMLDivElement>(null);
  const router = useRouter();
  const pathname = usePathname();

  const hideNav = pathname?.startsWith("/messages/");

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setDropdownOpen(false);
      }
    }
    if (dropdownOpen) {
      document.addEventListener("mousedown", handleClickOutside);
    }
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, [dropdownOpen]);

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
  if (typeof window === "undefined" || !("Notification" in window)) return;

  const requestPermissionAndListen = async () => {
    try {
      const { getMessagingClient } = await import("@/lib/firebaseMessaging");
      const { vapidKey } = await import("@/lib/firebaseConfig");

      const client = await getMessagingClient();
      if (!client) return;

      const messaging = client;
      const { getToken, onMessage } = await import("firebase/messaging");

      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        console.warn("🚫 Push permission denied");
        return;
      }

      const token = await getToken(messaging, { vapidKey });
      console.log("📲 Push token:", token);

      onMessage(messaging, (payload) => {
        console.log("🔔 Foreground push received:", payload);
        alert(payload?.notification?.title || "📬 New notification received");
      });
    } catch (err) {
      console.error("❌ Error setting up push notifications:", err);
    }
  };

  requestPermissionAndListen();

  if ("serviceWorker" in navigator) {
    navigator.serviceWorker
      .register("/firebase-messaging-sw.js")
      .then((registration) => {
        console.log("🛠️ Service Worker registered:", registration);
      })
      .catch((err) => {
        console.error("❌ Service Worker registration failed:", err);
      });
  }
}, []);


  const handleLogout = async () => {
    await signOut(auth);
    router.push("/login");
  };

  const totalNotifications = unreadMessages.length + unreadMatchRequests.length + notifications.length;

  return (
  <div className={`bg-gray-100 min-h-screen text-gray-900 ${hideNav ? "" : "pb-20"}`}>
    <InstallPwaAndroidPrompt />
    <InstallPwaIosPrompt />
      {!hideNav && (
        <header className="bg-white border-b p-4 mb-6 shadow-sm">
          <div className="max-w-5xl mx-auto flex justify-between items-center">
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
                  <Link href="/messages" title="Messages">
                    <MessageCircle className="w-6 h-6 text-green-600 hover:text-blue-800" />
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
                                      router.push("/matches");
                                    }}
                                  >
                                    {notif.message}
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
                  <div className="relative">
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

<main className={`max-w-5xl mx-auto px-4 ${hideNav ? "pb-0" : "pb-20"}`}>
  {children}
</main>
      {user && !hideNav && (
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
    </div>
  );
}
