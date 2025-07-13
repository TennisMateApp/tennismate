"use client";

import { useEffect, useRef, useState } from "react";
import { db, auth } from "@/lib/firebaseConfig";
import {
  doc,
  getDoc,
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
    const unsubscribe = auth.onAuthStateChanged(async (u) => {
      if (!u) return;
      setUser(u);

      const convoRef = doc(db, "conversations", conversationID as string);
      const convoSnap = await getDoc(convoRef);
      if (!convoSnap.exists()) return;

      const data = convoSnap.data();
      const otherUserId = data.participants.find((id: string) => id !== u.uid);

      if (otherUserId) {
        const otherUserRef = doc(db, "players", otherUserId);
        const otherSnap = await getDoc(otherUserRef);
        if (otherSnap.exists()) {
          const otherData = otherSnap.data();
          setOtherUserName(otherData.name || "TennisMate");
          setOtherUserAvatar(otherData.photoURL || null);
        }
      }

      const meRef = doc(db, "players", u.uid);
      const meSnap = await getDoc(meRef);
      if (meSnap.exists()) {
        const myData = meSnap.data();
        setUserAvatar(myData.photoURL || null);
      }

      await updateDoc(convoRef, {
        [`lastRead.${u.uid}`]: serverTimestamp(),
      });

      const unsubscribeTyping = onSnapshot(convoRef, (snap) => {
        const typingData = snap.data()?.typing || {};
        const otherUserId = data.participants.find((id: string) => id !== u.uid);
        setOtherUserTyping(typingData[otherUserId] === true);
      });

      return () => unsubscribeTyping();
    });

    return () => unsubscribe();
  }, [conversationID]);

  useEffect(() => {
    if (!conversationID) return;

    const msgRef = collection(db, "conversations", conversationID as string, "messages");
    const q = query(msgRef, orderBy("timestamp"));

    const unsub = onSnapshot(q, (snap) => {
      const msgs = snap.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
      setMessages(msgs);
      bottomRef.current?.scrollIntoView({ behavior: "smooth" });
    });

    return () => unsub();
  }, [conversationID]);

  const sendMessage = async () => {
    if (!input.trim() || !user) return;

    const newMessage = {
      senderId: user.uid,
      text: input,
      timestamp: serverTimestamp(),
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
  <div className="flex flex-col min-h-screen bg-white pt-safe-top">
    {/* Header */}
    <div className="shrink-0 flex items-center gap-3 px-4 py-3 border-b shadow-sm">
      <button onClick={() => router.push("/messages")}>
        <ArrowLeft className="w-5 h-5 text-blue-600" />
      </button>
      {otherUserAvatar ? (
        <img
          src={otherUserAvatar}
          alt="avatar"
          className="w-8 h-8 rounded-full object-cover"
        />
      ) : (
        <div className="w-8 h-8 rounded-full bg-gray-300 flex items-center justify-center text-xs text-gray-600">
          No Photo
        </div>
      )}
      <span className="font-medium text-sm text-gray-900">{otherUserName}</span>
    </div>

    {/* Messages */}
    <div className="flex-1 min-h-0 overflow-y-auto px-4 py-3 space-y-4">
      {messages.map((msg) => {
        const isOtherUser = msg.senderId !== user?.uid;
        const avatarURL = isOtherUser ? otherUserAvatar : userAvatar;
        const timestamp = msg.timestamp?.toDate
          ? msg.timestamp.toDate().toLocaleTimeString([], {
              hour: "2-digit",
              minute: "2-digit",
            })
          : "";

        return (
          <div
            key={msg.id}
            className={`flex items-end ${
              isOtherUser ? "justify-start" : "justify-end"
            }`}
          >
            {avatarURL && (
              <img
                src={avatarURL}
                alt="avatar"
                className={`w-7 h-7 rounded-full object-cover ${
                  isOtherUser ? "mr-2" : "ml-2"
                }`}
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
    <div className="shrink-0 bg-white border-t px-4 py-3 flex items-center gap-2 pb-safe-bottom">
      <input
        className="flex-1 border border-gray-300 rounded px-3 py-2 text-sm"
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
