"use client";

import { useEffect, useState } from "react";
import { db, auth } from "@/lib/firebaseConfig";
import {
  collection,
  query,
  where,
  getDocs,
  orderBy,
  limit,
  getDoc,
  doc,
  deleteDoc
} from "firebase/firestore";
import { useRouter } from "next/navigation";
import { ArrowLeft, Trash2 } from "lucide-react";
import { onAuthStateChanged } from "firebase/auth";
import withAuth from "@/components/withAuth";

function MessagesHome() {
  const [conversations, setConversations] = useState<any[]>([]);
  const [user, setUser] = useState<any>(null);
  const router = useRouter();

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (u) => {
      if (!u) return;
      setUser(u);

      const convoQuery = query(
        collection(db, "conversations"),
        where("participants", "array-contains", u.uid)
      );

      const convoSnap = await getDocs(convoQuery);

      const convoList = await Promise.all(
        convoSnap.docs.map(async (docSnap) => {
          const convoData = docSnap.data();
          const convoId = docSnap.id;

          const otherUserId = convoData.participants.find(
            (id: string) => id !== u.uid
          );

          let otherUserName = "Unknown";
          let photoURL: string | null = null;
          try {
            const playerSnap = await getDoc(doc(db, "players", otherUserId));
            if (playerSnap.exists()) {
              const playerData = playerSnap.data();
              otherUserName = playerData.name || "Unknown";
              photoURL = playerData.photoURL || null;
            }
          } catch (err) {
            console.warn("Error fetching player profile", err);
          }

          const msgSnap = await getDocs(
            query(
              collection(db, "conversations", convoId, "messages"),
              orderBy("timestamp", "desc"),
              limit(1)
            )
          );

          const latestMessage = msgSnap.docs[0]?.data() || null;

          const lastSeen = convoData.lastRead?.[u.uid];
          const isUnread =
            latestMessage?.timestamp?.toMillis &&
            (!lastSeen || latestMessage.timestamp.toMillis() > lastSeen.toMillis());

          const timestampStr = latestMessage?.timestamp?.toDate
            ? latestMessage.timestamp.toDate().toLocaleTimeString([], {
                hour: "2-digit",
                minute: "2-digit",
              })
            : "";

          return {
            id: convoId,
            latestMessage,
            isUnread,
            timestampStr,
            otherUserName,
            photoURL,
          };
        })
      );

      setConversations(convoList);
    });

    return () => unsub();
  }, [router]);

  const handleDeleteConversation = async (convoId: string) => {
    const confirmed = window.confirm("Delete this chat? This can't be undone.");
    if (!confirmed) return;

    try {
      const messagesSnap = await getDocs(
        collection(db, "conversations", convoId, "messages")
      );

      await Promise.all(
        messagesSnap.docs.map((msg) => deleteDoc(msg.ref))
      );

      await deleteDoc(doc(db, "conversations", convoId));

      setConversations((prev) => prev.filter((c) => c.id !== convoId));
    } catch (err) {
      console.error("Failed to delete conversation:", err);
      alert("Something went wrong.");
    }
  };

  return (
    <div className="min-h-screen bg-white px-4">
   <div className="py-4 border-b border-gray-200 flex justify-center">
  <h1 className="text-lg font-semibold">Messages</h1>
</div>


      {conversations.length === 0 ? (
        <p className="text-gray-600 mt-6 text-center">You have no conversations yet.</p>
      ) : (
        <ul className="divide-y divide-gray-100">
          {conversations.map((convo) => (
            <li
              key={convo.id}
              className="flex items-center justify-between py-4 px-1 hover:bg-gray-50"
            >
              <div
                className="flex items-center gap-3 flex-grow cursor-pointer"
                onClick={() => router.push(`/messages/${convo.id}`)}
              >
                {convo.photoURL ? (
                  <img
                    src={convo.photoURL}
                    alt={convo.otherUserName}
                    className="w-12 h-12 rounded-full object-cover"
                  />
                ) : (
                  <div className="w-12 h-12 rounded-full bg-gray-300 flex items-center justify-center text-gray-600 text-xs">
                    No Photo
                  </div>
                )}

                <div className="flex flex-col overflow-hidden max-w-[180px] sm:max-w-[220px]">
                <p className="font-semibold text-sm truncate w-full">
  {convo.otherUserName}
</p>
<p className="text-gray-500 text-sm truncate w-full">
  {convo.latestMessage?.text?.slice(0, 80) || "New conversation"}
</p>
                </div>
              </div>

              <div className="flex flex-col items-end gap-2 min-w-[70px] ml-2">
                {convo.timestampStr && (
                  <p className="text-xs text-gray-500">{convo.timestampStr}</p>
                )}
                {convo.isUnread && (
                  <span className="bg-red-600 text-white text-xs px-2 py-0.5 rounded-full">
                    New
                  </span>
                )}
                <button
                  onClick={() => handleDeleteConversation(convo.id)}
                  className="text-red-500 hover:text-red-700"
                  title="Delete chat"
                >
                  <Trash2 size={18} />
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export default withAuth(MessagesHome);
