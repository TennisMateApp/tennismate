// components/EventFooterNav.tsx
"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { Home, MessageSquareText, CalendarDays } from "lucide-react";

export default function EventFooterNav({ eventId }: { eventId: string }) {
  const pathname = usePathname();
  const search = useSearchParams();
  const tab = search.get("tab") || "about";

  // Build URLs
  const eventUrl = `/events/${eventId}`;
  const chatUrl = `/events/${eventId}?tab=chat`;

  // Which item is active?
  const isChat = tab === "chat";
  const isEvent = pathname?.startsWith(eventUrl) && !isChat;

  return (
    <nav
      aria-label="Event navigation"
      className="fixed bottom-0 inset-x-0 z-30 border-t bg-white/95 backdrop-blur supports-[backdrop-filter]:bg-white/80"
    >
      <div className="mx-auto max-w-3xl">
        <ul className="grid grid-cols-3">
          <li>
            <Link
              href="/"
              className="flex h-16 flex-col items-center justify-center gap-1 text-xs"
            >
              <Home className="h-5 w-5" />
              <span>Home</span>
            </Link>
          </li>

          <li>
            <Link
              href={chatUrl}
              className={`flex h-16 flex-col items-center justify-center gap-1 text-xs ${
                isChat ? "text-emerald-700 font-medium" : "text-gray-700"
              }`}
            >
              <MessageSquareText className="h-5 w-5" />
              <span>Chat</span>
            </Link>
          </li>

          <li>
            <Link
              href={eventUrl}
              className={`flex h-16 flex-col items-center justify-center gap-1 text-xs ${
                isEvent ? "text-emerald-700 font-medium" : "text-gray-700"
              }`}
            >
              <CalendarDays className="h-5 w-5" />
              <span>Event</span>
            </Link>
          </li>
        </ul>
      </div>
    </nav>
  );
}
