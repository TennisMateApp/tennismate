"use client";
import { useRef, useState, useEffect } from "react";
import { X } from "lucide-react";
import { createProposal } from "@/lib/events";

export default function TimeProposalSheet(props: {
  onClose: () => void;
  matchId: string;
  participants: string[];
  currentUserId: string;
}) {
  const [date, setDate] = useState("");
  const [hour, setHour] = useState("09");     // default 09 to start list near 9am
  const [minute, setMinute] = useState("15"); // 00|15|30|45
  const [time, setTime] = useState("");
  const [duration, setDuration] = useState(90);
  const [courtName, setCourtName] = useState("");

  // date picker helpers
  const dateRef = useRef<HTMLInputElement>(null);
  const openPicker = (ref: React.RefObject<HTMLInputElement>) => {
    ref.current?.showPicker?.(); // Chromium; iOS Safari opens on focus
  };
  const blockKeys = (e: React.KeyboardEvent<HTMLInputElement>) => {
    e.preventDefault();
  };

  // derive time from hour/minute
  useEffect(() => {
    if (hour && minute) setTime(`${hour.padStart(2, "0")}:${minute.padStart(2, "0")}`);
    else setTime("");
  }, [hour, minute]);

  const canSubmit = Boolean(date && time);

  async function handleSubmit() {
    if (!canSubmit) return;
    const startISO = new Date(`${date}T${time}`).toISOString();
    await createProposal({
      matchId: props.matchId,
      participants: props.participants,
      proposerId: props.currentUserId,
      startISO,
      durationMins: duration,
      courtName,       // keep optional court
      // note is removed
    });
    props.onClose();
  }

  const hours = Array.from({ length: 24 }, (_, i) => String(i).padStart(2, "0"));
  const minutes = ["00", "15", "30", "45"];

  return (
    <div className="fixed inset-0 z-50">
      <div className="absolute inset-0 bg-black/40" onClick={props.onClose} />
      <div className="absolute inset-x-0 bottom-0 bg-white rounded-t-2xl shadow-xl p-4">
        <div className="flex items-center justify-between mb-2">
          <h3 className="text-base font-semibold">Propose a time</h3>
          <button onClick={props.onClose} className="p-1" aria-label="Close">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            {/* Date (native picker; no typing) */}
            <label className="block text-sm">
              <span className="text-gray-600">Date</span>
              <input
                ref={dateRef}
                type="date"
                className="mt-1 w-full rounded-xl border px-3 py-2"
                value={date}
                inputMode="none"
                onKeyDown={blockKeys}
                onMouseDown={(e) => {
                  e.preventDefault();
                  openPicker(dateRef);
                }}
                onFocus={() => openPicker(dateRef)}
                onChange={(e) => setDate(e.target.value)}
              />
            </label>

            {/* Time = Hour + 15-min Minute */}
            <div className="grid grid-cols-2 gap-2">
              <label className="block text-sm">
                <span className="text-gray-600">Hour</span>
                <select
                  className="mt-1 w-full rounded-xl border px-3 py-2 max-h-52 overflow-auto"
                  value={hour}
                  onChange={(e) => setHour(e.target.value)}
                >
                  {hours.map((h) => (
                    <option key={h} value={h}>
                      {h}
                    </option>
                  ))}
                </select>
              </label>

              <label className="block text-sm">
                <span className="text-gray-600">Minute</span>
                <select
                  className="mt-1 w-full rounded-xl border px-3 py-2 max-h-52 overflow-auto"
                  value={minute}
                  onChange={(e) => setMinute(e.target.value)}
                >
                  {minutes.map((m) => (
                    <option key={m} value={m}>
                      {m}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          </div>

          <label className="block text-sm">
            <span className="text-gray-600">Duration</span>
            <select
              className="mt-1 w-full rounded-xl border px-3 py-2"
              value={duration}
              onChange={(e) => setDuration(parseInt(e.target.value))}
            >
              <option value={60}>60 mins</option>
              <option value={90}>90 mins</option>
              <option value={120}>120 mins</option>
            </select>
          </label>

          <label className="block text-sm">
            <span className="text-gray-600">Court (optional)</span>
            <input
              className="mt-1 w-full rounded-xl border px-3 py-2"
              placeholder="e.g., Fawkner Park"
              value={courtName}
              onChange={(e) => setCourtName(e.target.value)}
            />
          </label>

          <button
            onClick={handleSubmit}
            disabled={!canSubmit}
            className="w-full rounded-xl bg-green-600 text-white py-2.5 font-medium shadow disabled:opacity-50"
          >
            Send proposal
          </button>
        </div>
      </div>
    </div>
  );
}
