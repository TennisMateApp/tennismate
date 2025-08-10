"use client";

import { useRouter } from "next/navigation";
import { MessageSquare } from "lucide-react"; // You can use any icon

export default function FloatingFeedbackButton() {
  const router = useRouter();

  return (
    <button
      onClick={() => router.push("/support")}
      className="fixed bottom-6 right-6 bg-blue-600 hover:bg-blue-700 text-white px-4 py-3 rounded-full shadow-lg flex items-center gap-2 transition-all duration-200 z-50"
    >
      <MessageSquare size={18} />
      <span>Give Feedback</span>
    </button>
  );
}
