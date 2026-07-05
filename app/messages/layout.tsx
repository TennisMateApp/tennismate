"use client";

import { type ReactNode, useEffect, useState } from "react";
import { useSelectedLayoutSegment } from "next/navigation";
import MessagesClient from "./MessagesClient";
import { MatchHubChat } from "./MatchHubChat";

export default function MessagesLayout({ children }: { children: ReactNode }) {
  const selectedSegment = useSelectedLayoutSegment();
  const selectedConversationId = selectedSegment ? decodeURIComponent(selectedSegment) : null;
  const [isDesktop, setIsDesktop] = useState<boolean | null>(null);

  useEffect(() => {
    const mq = window.matchMedia("(min-width: 1024px)");
    const sync = () => setIsDesktop(mq.matches);

    sync();
    mq.addEventListener("change", sync);
    return () => mq.removeEventListener("change", sync);
  }, []);

  if (isDesktop === null) return null;

  return isDesktop ? (
      <div className="h-dvh min-h-0">
        <MessagesClient
          selectedConversationId={selectedConversationId}
          activeThread={
            selectedConversationId ? (
              <MatchHubChat conversationId={selectedConversationId} embeddedDesktop />
            ) : null
          }
        />
      </div>
  ) : (
    <>{children}</>
  );
}
