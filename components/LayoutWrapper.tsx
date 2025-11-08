"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { User, MessageCircle, Search, Settings } from "lucide-react";
import { GiTennisCourt, GiTennisBall } from "react-icons/gi";
import { collection, query, where, onSnapshot, getDoc, doc } from "firebase/firestore";
import { auth, db } from "@/lib/firebaseConfig";
import { onAuthStateChanged, signOut } from "firebase/auth";
import NotificationBell from "@/components/notifications/NotificationBell";

export default function LayoutWrapper({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<any>(null);
  const [photoURL, setPhotoURL] = useState<string | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  // Footer bubble only: count unread match_requests (separate from header bell)
  const [unreadMatchRequests, setUnreadMatchRequests] = useState<number>(0);

  const router = useRouter();

  useEffect(() => {
    let unsubAuth = () => {};
    let unsubMR = () => {};

    unsubAuth = onAuthStateChanged(auth, async (u) => {
      if (u) {
        await u.reload();
        setUser(auth.currentUser);

        if (u.photoURL) {
          setPhotoURL(u.photoURL);
        } else {
          const playerDoc = await getDoc(doc(db, "players", u.uid));
          setPhotoURL(playerDoc.exists() ? playerDoc.data().photoURL || null : null);
        }

        // Footer badge: unread match_requests addressed to this user
        unsubMR = onSnapshot(
          query(
            collection(db, "match_requests"),
            where("toUserId", "==", u.uid),
            where("status", "==", "unread")
          ),
          (snap) => setUnreadMatchRequests(snap.size)
        );
      } else {
        setUser(null);
        setPhotoURL(null);
        setUnreadMatchRequests(0);
        unsubMR();
      }
    });

    return () => {
      unsubAuth();
      unsubMR();
    };
  }, []);

  const handleLogout = async () => {
    await signOut(auth);
    router.push("/login");
  };

  return (
    <div className="bg-gray-100 min-h-screen text-gray-900">
      {/* Header */}
      <header className="sticky top-0 z-40 bg-white border-b shadow-sm p-4 pt-[var(--safe-top,0px)]">
        <div className="max-w-5xl mx-auto flex justify-between items-center">
          <Link href="/" className="flex items-center">
            <img src="/logo.png" alt="TennisMate" className="w-[40px] h-[40px] rounded-full object-cover" />
          </Link>

          <nav className="flex items-center space-x-6 text-sm">
            {user ? (
              <>
                <Link href="/profile" title="Profile">
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

                <Link href="/directory" title="Directory">
                  <Search className="w-6 h-6 text-green-600 hover:text-blue-800" />
                </Link>

                <Link href="/messages" title="Messages">
                  <MessageCircle className="w-6 h-6 text-green-600 hover:text-blue-800" />
                </Link>

                {/* Header bell: uses notifications collection with built-in de-dupe */}
                <NotificationBell />

                <div className="relative">
                  <button onClick={() => setShowSettings(!showSettings)} title="Settings">
                    <Settings className="w-6 h-6 text-green-600 hover:text-green-800" />
                  </button>
                  {showSettings && (
                    <div className="absolute right-0 mt-2 w-48 bg-white border rounded shadow z-50">
                      <Link
                        href="/profile"
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
              <Link href="/login" className="text-blue-600 hover:underline">
                Login / Sign Up
              </Link>
            )}
          </nav>
        </div>
      </header>

      {/* Page Content */}
      <main className="max-w-5xl mx-auto px-4 pb-safe-20">{children}</main>

      {/* Footer */}
      {user && (
       <footer className="fixed bottom-0 left-0 right-0 bg-white border-t shadow-md z-50">
  <div className="max-w-5xl mx-auto flex justify-around py-2 text-sm footer-safe-inner">
            <Link href="/match" className="flex flex-col items-center text-green-600 hover:text-green-800">
              <GiTennisCourt className="w-6 h-6 mb-1" />
              <span>Match Me</span>
            </Link>

            <Link href="/matches" className="flex flex-col items-center text-green-600 hover:text-green-800 relative">
              <GiTennisBall className="w-6 h-6 mb-1" />
              <span>Matches</span>
              {unreadMatchRequests > 0 && (
                <span className="absolute top-0 right-1 -mt-1 bg-red-600 text-white text-xs font-bold px-1.5 py-0.5 rounded-full leading-none animate-pulse">
                  {unreadMatchRequests > 9 ? "9+" : unreadMatchRequests}
                </span>
              )}
            </Link>
          </div>
        </footer>
      )}
    </div>
  );
}
