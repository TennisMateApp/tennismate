"use client";
import { Timestamp } from "firebase/firestore";
import { respondToProposal, cancelEvent } from "@/lib/events";
import { CalendarDays, Clock } from "lucide-react";

type EventState = "proposed" | "accepted" | "declined" | "cancelled";

export default function ProposalCard(props: {
  eventId: string;
  start: Timestamp;
  end: Timestamp;
  durationMins: number;
  courtName?: string | null;
  note?: string | null;
  state: EventState;
  currentUserId: string;
  participants: string[];
  proposerId: string;
}) {
  const startDate = props.start.toDate();
  const endDate = props.end.toDate();

  const when = `${startDate.toLocaleDateString()} • ${startDate.toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  })}–${endDate.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`;

  const isSender = props.currentUserId === props.proposerId;

  function StatusBadge({
    text,
    tone = "gray",
  }: {
    text: string;
    tone?: "green" | "red" | "gray";
  }) {
    const map: Record<string, string> = {
      green: "bg-green-100 text-green-700",
      red: "bg-red-100 text-red-700",
      gray: "bg-gray-100 text-gray-600",
    };
    return <span className={`px-2 py-1 rounded-md text-xs ${map[tone]}`}>{text}</span>;
  }

  return (
    <div className="rounded-2xl border shadow-sm p-3 bg-white">
      <div className="flex items-start gap-3">
        <div className="p-2 rounded-xl bg-gray-100">
          <CalendarDays className="w-5 h-5" />
        </div>
        <div className="flex-1">
          <div className="text-sm font-semibold">{when}</div>
          {props.courtName ? (
            <div className="text-sm text-gray-600">{props.courtName}</div>
          ) : null}
          <div className="mt-1 flex items-center gap-2 text-xs text-gray-500">
            <Clock className="w-4 h-4" />
            {props.durationMins} mins
          </div>

          <div className="mt-3 flex items-center gap-2">
            {/* STATE: proposed */}
            {props.state === "proposed" && (
              <>
                {isSender ? (
                  <>
                    <StatusBadge text="Pending" />
                    <button
                      onClick={() => cancelEvent(props.eventId)}
                      className="px-3 py-1.5 rounded-lg border text-sm"
                    >
                      Cancel
                    </button>
                  </>
                ) : (
                  <button
                    onClick={() => respondToProposal(props.eventId, "accepted")}
                    className="px-3 py-1.5 rounded-lg bg-green-600 text-white text-sm"
                  >
                    Accept
                  </button>
                )}
              </>
            )}

            {/* STATE: accepted */}
            {props.state === "accepted" && (
              <>
                <StatusBadge text="Accepted" tone="green" />
                <button
                  onClick={() => cancelEvent(props.eventId)}
                  className="px-3 py-1.5 rounded-lg border text-sm"
                >
                  Cancel
                </button>
              </>
            )}

            {/* STATE: declined */}
            {props.state === "declined" && <StatusBadge text="Declined" tone="red" />}

            {/* STATE: cancelled */}
            {props.state === "cancelled" && <StatusBadge text="Cancelled" />}
          </div>
        </div>
      </div>
    </div>
  );
}
