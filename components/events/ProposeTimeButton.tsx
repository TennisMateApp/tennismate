"use client";
import { useState } from "react";
import { PlusCircle } from "lucide-react";
import TimeProposalSheet from "./TimeProposalSheet"; // default import

export default function ProposeTimeButton(props: {
  matchId: string;
  participants: string[];
  currentUserId: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-2 px-3 py-2 rounded-xl bg-green-600 text-white text-sm shadow hover:bg-green-700"
      >
        <PlusCircle className="w-4 h-4" />
        Propose time
      </button>

      {open && (
        <TimeProposalSheet
          onClose={() => setOpen(false)}
          matchId={props.matchId}
          participants={props.participants}
          currentUserId={props.currentUserId}
        />
      )}
    </>
  );
}
