"use client";

import { useRouter, usePathname } from "next/navigation";
import { MessageSquare } from "lucide-react";

// Hide on any route that contains both "/matches/" and "/complete/details"
const shouldHideOn = (pathname: string) =>
  pathname.includes("/matches/") && pathname.includes("/complete/details");

export default function FloatingFeedbackButton() {
  const router = useRouter();
  const pathname = usePathname() || "";

  if (shouldHideOn(pathname)) return null;

  return (
    <button
      onClick={() => router.push("/support")}
      className="feedback-fab fixed bottom-6 right-6 bg-blue-600 hover:bg-blue-700 text-white px-4 py-3 rounded-full shadow-lg flex items-center gap-2 transition-all duration-200 z-40"
    >
      <MessageSquare size={18} />
      <span>Give Feedback</span>
    </button>
  );
}
