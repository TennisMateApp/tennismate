"use client";

import { useEffect, useRef, useState } from "react";
import { db, auth } from "@/lib/firebaseConfig";
import {
  doc,
  getDoc,
  setDoc,
  collection,
  addDoc,
  onSnapshot,
  serverTimestamp,
  orderBy,
  query,
  updateDoc,
} from "firebase/firestore";
import { useParams, useRouter } from "next/navigation";
import debounce from "lodash.debounce";
import { ArrowLeft } from "lucide-react";
import withAuth from "@/components/withAuth";
import { writeBatch } from "firebase/firestore"; 

function ChatPage() {
  const { conversationID } = useParams();
  const router = useRouter();
  const [user, setUser] = useState<any>(null);
  const [messages, setMessages] = useState<any[]>([]);
  const [input, setInput] = useState("");
  const [otherUserName, setOtherUserName] = useState<string | null>(null);
  const [otherUserAvatar, setOtherUserAvatar] = useState<string | null>(null);
  const [userAvatar, setUserAvatar] = useState<string | null>(null);
  const [otherUserTyping, setOtherUserTyping] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

useEffect(() => {
  let unsubscribeTyping: () => void = () => {};
  let currentUserId: string | null = null;

  const unsubscribeAuth = auth.onAuthStateChanged(async (u) => {
    if (!u) return;
    setUser(u);
    currentUserId = u.uid;

    // ✅ Set activeConversationId
    try {
      await updateDoc(doc(db, "users", u.uid), {
        activeConversationId: conversationID,
      });
    } catch (err) {
      console.error("🔥 Failed to set activeConversationId:", err);
    }

    const convoRef = doc(db, "conversations", conversationID as string);
    let convoSnap = await getDoc(convoRef);

    const allIds = (conversationID as string).split("_");
    const otherUserId = allIds.find((id) => id !== u.uid);

    if (!convoSnap.exists() && otherUserId) {
      await setDoc(convoRef, {
        participants: [u.uid, otherUserId],
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
        typing: {},
        lastRead: { [u.uid]: serverTimestamp() },
      });
    } else {
      await updateDoc(convoRef, {
        [`lastRead.${u.uid}`]: serverTimestamp(),
      });
    }

    convoSnap = await getDoc(convoRef);

    if (otherUserId) {
      try {
        const otherUserRef = doc(db, "players", otherUserId);
        const otherSnap = await getDoc(otherUserRef);

        if (otherSnap.exists()) {
          const otherData = otherSnap.data();
          setOtherUserName(otherData.name || "TennisMate");
          setOtherUserAvatar(otherData.photoURL || null);
        }
      } catch (err) {
        console.error("🔥 Error loading other user profile:", err);
      }
    }

    const meRef = doc(db, "players", u.uid);
    const meSnap = await getDoc(meRef);
    if (meSnap.exists()) {
      setUserAvatar(meSnap.data().photoURL || null);
    }

    unsubscribeTyping = onSnapshot(convoRef, (snap) => {
      const typingData = snap.data()?.typing || {};
      const otherTypingId = snap.data()?.participants?.find((id: string) => id !== u.uid);
      setOtherUserTyping(typingData[otherTypingId] === true);
    });
  });

  // ✅ Outer useEffect return: cleanup logic for unmount
  return () => {
    unsubscribeAuth();
    unsubscribeTyping();

    if (currentUserId) {
      const clearActive = async () => {
        try {
          await updateDoc(doc(db, "users", currentUserId!), {
            activeConversationId: null,
          });
        } catch (err) {
          console.error("🔥 Failed to clear activeConversationId:", err);
        }
      };
      clearActive();
    }
  };
}, [conversationID]);

  useEffect(() => {
    if (!conversationID) return;

    const msgRef = collection(db, "conversations", conversationID as string, "messages");
    const q = query(msgRef, orderBy("timestamp"));

   const unsub = onSnapshot(q, (snap) => {
  const msgs = snap.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
  setMessages(msgs);

  // ✅ Mark unread messages as read
  const markAsRead = async () => {
    const batch = writeBatch(db);
    snap.docs.forEach((doc) => {
      const msg = doc.data();
      if (msg.recipientId === user?.uid && msg.read === false) {
        batch.update(doc.ref, { read: true });
      }
    });
    await batch.commit();
  };

  markAsRead();

  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      bottomRef.current?.scrollIntoView({ behavior: "auto" });
    });
  });
});

    return () => unsub();
  }, [conversationID]);

const sendMessage = async () => {
  if (!input.trim() || !user) return;

  // ✅ Split to get recipientId
  const allIds = (conversationID as string).split("_");
  const recipientId = allIds.find((id) => id !== user.uid);

  if (!recipientId) return; // Optional safeguard

  const newMessage = {
    senderId: user.uid,
    recipientId,
    text: input,
    timestamp: serverTimestamp(),
    read: false,
  };

  await addDoc(
    collection(db, "conversations", conversationID as string, "messages"),
    newMessage
  );

  setInput("");

  await updateDoc(doc(db, "conversations", conversationID as string), {
    [`lastRead.${user.uid}`]: serverTimestamp(),
    [`typing.${user.uid}`]: false,
    latestMessage: newMessage,
  });
};

  const updateTypingStatus = debounce(async (isTyping: boolean) => {
    if (!user) return;
    await updateDoc(doc(db, "conversations", conversationID as string), {
      [`typing.${user.uid}`]: isTyping,
    });
  }, 300);

  return (
    <div className="flex flex-col h-screen bg-white">
      {/* Header */}
      <div className="flex items-center gap-3 px-4 py-3 border-b shadow-sm">
        <button onClick={() => router.push("/messages")}>
          <ArrowLeft className="w-5 h-5 text-blue-600" />
        </button>
        {otherUserAvatar ? (
          <img
            src={otherUserAvatar}
            alt="avatar"
            className="w-8 h-8 rounded-full object-cover opacity-0 transition-opacity duration-300"
            onLoad={(e) => e.currentTarget.classList.add("opacity-100")}
          />
        ) : otherUserName ? (
          <div className="w-8 h-8 rounded-full bg-gray-300 flex items-center justify-center text-xs text-gray-600">
            No Photo
          </div>
        ) : (
          <div className="w-8 h-8" />
        )}
        <span className="font-medium text-sm text-gray-900">{otherUserName}</span>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-4">
        {messages.map((msg) => {
          const isOtherUser = msg.senderId !== user?.uid;
          const avatarURL = isOtherUser ? otherUserAvatar : userAvatar;
          const timestamp = msg.timestamp?.toDate?.()
            ? msg.timestamp.toDate().toLocaleTimeString([], {
                hour: "2-digit",
                minute: "2-digit",
              })
            : "Sending...";

          return (
            <div
              key={msg.id}
              className={`flex items-end ${isOtherUser ? "justify-start" : "justify-end"}`}
            >
              {avatarURL && (
                <img
                  src={avatarURL}
                  alt="avatar"
                  className={`w-7 h-7 rounded-full object-cover opacity-0 transition-opacity duration-300 ${
                    isOtherUser ? "mr-2" : "ml-2"
                  }`}
                  onLoad={(e) => e.currentTarget.classList.add("opacity-100")}
                />
              )}
              <div className="max-w-[75%] sm:max-w-xs">
                <div
                  className={`px-3 py-2 rounded-lg text-sm ${
                    isOtherUser
                      ? "bg-gray-200 text-gray-800"
                      : "bg-blue-600 text-white"
                  }`}
                >
                  {msg.text}
                </div>
                <div
                  className={`text-xs mt-1 text-gray-400 ${
                    isOtherUser ? "text-left" : "text-right"
                  }`}
                >
                  {timestamp}
                </div>
              </div>
            </div>
          );
        })}
        {otherUserTyping && (
          <p className="text-xs text-gray-500 italic">{otherUserName} is typing...</p>
        )}
        <div ref={bottomRef}></div>
      </div>

      {/* Input */}
      <div className="px-4 py-3 border-t flex items-center gap-2 bg-white">
        <input
          className="flex-1 border border-gray-300 rounded px-3 py-2 text-base"
          value={input}
          onChange={(e) => {
            setInput(e.target.value);
            updateTypingStatus(true);
          }}
          onBlur={() => updateTypingStatus(false)}
          placeholder="Type a message..."
        />
        <button
          onClick={sendMessage}
          className="bg-blue-600 text-white text-sm px-4 py-2 rounded"
        >
          Send
        </button>
      </div>
    </div>
  );
}

export default withAuth(ChatPage);
