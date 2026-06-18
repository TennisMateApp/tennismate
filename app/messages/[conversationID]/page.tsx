"use client";

import { useParams } from "next/navigation";
import { MatchHubChat } from "../MatchHubChat";

export default function ChatPage() {
  const params = useParams();
  const conversationID = String(params.conversationID || "");

  return <MatchHubChat conversationId={conversationID} />;
}
