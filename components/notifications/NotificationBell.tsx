"use client";

import { useEffect, useState } from "react";
import { auth, db } from "@/lib/firebaseConfig";
import {
  collection,
  query,
  where,
  onSnapshot,
  orderBy,
  DocumentData,
} from "firebase/firestore";
import { onAuthStateChanged } from "firebase/auth";
import { useRouter } from "next/navigation";
import { Bell } from "lucide-react";

// ✅ Define the Notification type
type Notification = {
  id: string;
  read: boolean;
  title: string;
  body: string;
  timestamp: any;
  type?: string;
  matchId?: string;
};


export default function NotificationBell() {
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [userId, setUserId] = useState<string | null>(null);
  const router = useRouter();

  useEffect(() => {
    const unsubscribeAuth = onAuthStateChanged(auth, (user) => {
      if (user) setUserId(user.uid);
    });
    return () => unsubscribeAuth();
  }, []);

  useEffect(() => {
    if (!userId) return;

    const q = query(
      collection(db, "notifications"),
      where("recipientId", "==", userId),
      orderBy("timestamp", "desc")
    );

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const data: Notification[] = snapshot.docs.map((doc) => ({
        id: doc.id,
        ...(doc.data() as Omit<Notification, "id">),
      }));
      setNotifications(data);
      setUnreadCount(data.filter((n) => !n.read).length);
    });

    return () => unsubscribe();
  }, [userId]);

  const handleNotificationClick = (notif: Notification) => {
    setDropdownOpen(false);

    if (notif.matchId) {
      router.push(`/matches?matchId=${notif.matchId}`);
    } else if (notif.type === "message") {
      router.push("/messages");
    } else {
      router.push("/matches");
    }

    // Optionally: mark as read here
  };

  return (
    <div className="relative">
      <button onClick={() => setDropdownOpen(!dropdownOpen)} className="relative">
        <Bell className="w-6 h-6 text-green-600" />
        {unreadCount > 0 && (
          <span className="absolute -top-1 -right-1 bg-red-600 text-white text-xs px-1.5 py-0.5 rounded-full animate-pulse">
            {unreadCount > 9 ? "9+" : unreadCount}
          </span>
        )}
      </button>

      {dropdownOpen && (
        <div className="absolute right-0 mt-2 w-72 bg-white border border-gray-200 shadow-lg rounded-md z-50">
          {notifications.length === 0 ? (
            <div className="p-4 text-sm text-gray-500">No notifications</div>
          ) : (
            <ul className="divide-y divide-gray-100 max-h-96 overflow-y-auto text-sm">
              {notifications.map((notif) => (
                <li
                  key={notif.id}
                  className="p-3 hover:bg-gray-100 cursor-pointer"
                  onClick={() => handleNotificationClick(notif)}
                >
                  <div>
  <p className="font-semibold text-gray-800">{notif.title}</p>
  <p className="text-gray-600 text-sm">{notif.body}</p>
</div>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
