"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { auth, db } from "@/lib/firebaseConfig";
import { addDoc, collection, serverTimestamp } from "firebase/firestore";

type EventType = "singles" | "doubles" | "social";

// Build ["00:00","00:30","01:00",...,"23:30"]
function buildHalfHourOptions(start = "00:00", end = "23:30") {
  const [startH, startM] = start.split(":").map(Number);
  const [endH, endM] = end.split(":").map(Number);
  const startTotal = startH * 60 + startM;
  const endTotal = endH * 60 + endM;

  const out: string[] = [];
  for (let t = startTotal; t <= endTotal; t += 30) {
    const h = Math.floor(t / 60);
    const m = t % 60;
    const hh = String(h).padStart(2, "0");
    const mm = String(m).padStart(2, "0");
    out.push(`${hh}:${mm}`);
  }
  return out;
}

export default function NewEventPage() {
  const router = useRouter();

  // Form state
  const [title, setTitle] = useState("");
  const [eventType, setEventType] = useState<EventType>("singles");
  const [date, setDate] = useState("");
  const [time, setTime] = useState("");
  const [duration, setDuration] = useState(60); // minutes
  const [location, setLocation] = useState("");
  const [minSkill, setMinSkill] = useState<"" | "Beginner" | "Intermediate" | "Advanced">("");
  const [maxSpots, setMaxSpots] = useState<number>(1); // opponent slots (singles=1, doubles=3, social=10?)
  const [description, setDescription] = useState("");
  const [submitting, setSubmitting] = useState(false);
const todayISO = new Date().toISOString().slice(0, 10); // YYYY-MM-DD


  // Optional: keep long blurbs tidy
const DESC_LIMIT = 300;


// Capacity rules
function minCapacityFor(type: EventType) {
  if (type === "singles") return 1;  // fixed
  if (type === "doubles") return 2;  // you may already have a partner
  return 5;                          // social minimal 5
}

function maxCapacityFor(type: EventType) {
  if (type === "singles") return 1;  // fixed
  if (type === "doubles") return 4;  // cap at 4
  return Number.POSITIVE_INFINITY;   // social: no hard max (adjust if you want)
}

function defaultCapacityFor(type: EventType) {
  if (type === "singles") return 1;
  if (type === "doubles") return 3;  // sensible default between 2–4
  return 5;                          // start social at its minimum
}

function onTypeChange(t: EventType) {
  setEventType(t);
  const nextMin = minCapacityFor(t);
  const nextMax = maxCapacityFor(t);
  setMaxSpots((prev) => {
    // move inside the new type’s bounds; prefer default if prev was out-of-bounds
    const clamped = Math.min(nextMax, Math.max(nextMin, prev));
    const def = defaultCapacityFor(t);
    // if clamped equals prev we keep it, otherwise use a good default
    return clamped === prev ? clamped : def;
  });
}


  // Treat the form as "dirty" if any field differs from its initial value
const dirty =
  title.trim() !== "" ||
  location.trim() !== "" ||
  description.trim() !== "" ||
  date !== "" ||
  time !== "" ||
  duration !== 60 ||
  minSkill !== "" ||
  maxSpots !== defaultCapacityFor(eventType);

// Warn if user tries to close/reload the tab with unsaved edits
useEffect(() => {
  const onBeforeUnload = (e: BeforeUnloadEvent) => {
    if (!dirty) return;
    e.preventDefault();
    e.returnValue = ""; // required for Chrome
  };
  window.addEventListener("beforeunload", onBeforeUnload);
  return () => window.removeEventListener("beforeunload", onBeforeUnload);
}, [dirty]);

function handleCancel() {
  if (dirty && !confirm("Discard this event? Your changes will be lost.")) {
    return;
  }
  router.push("/events");
}

function isHalfHour(value: string) {
  // expects "HH:MM"
  const [h, m] = value.split(":").map(Number);
  return Number.isInteger(h) && Number.isInteger(m) && (m === 0 || m === 30);
}

async function createEvent(e: React.FormEvent) {
  e.preventDefault();
  const u = auth.currentUser;
  if (!u || submitting) return;

  // Basic validation
  if (!title.trim() || !date || !time || !location.trim()) return;

  // Enforce 30-minute increments for time
if (!isHalfHour(time)) {
  alert("Please select a time in 30-minute steps (e.g., 1:00, 1:30, 2:00).");
  return;
}

  // Build times
  const start = new Date(`${date}T${time}:00`);
  const end = new Date(start.getTime() + Number(duration || 60) * 60_000);

  // Optional: light guard against creating events in the past
  if (start.getTime() < Date.now() - 60_000) {
    alert("Start time is in the past. Please pick a future time.");
    return;
  }

const minCap = minCapacityFor(eventType);
const maxCap = maxCapacityFor(eventType);
const spots = Math.min(maxCap, Math.max(minCap, Number(maxSpots)));


  setSubmitting(true);
  try {
    await addDoc(collection(db, "events"), {
      hostId: u.uid,
      visibility: "public",

      title: title.trim(),
      type: eventType,
      location: location.trim(),
      start: start.toISOString(),
      end: end.toISOString(),
      durationMins: Number(duration || 60),

      description: description.trim() === "" ? null : description.trim(),

      minSkill: null, // keep numeric null for backward-compat
minSkillLabel: minSkill === "" ? null : minSkill,
      spotsTotal: spots,
      spotsFilled: 0,
      status: "open",

      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });

    router.push("/events");
  } finally {
    setSubmitting(false);
  }
}

  return (
   <main className="mx-auto w-full max-w-2xl px-4 py-8">
  {/* Page header */}
  <header className="mb-6">
    <div className="mb-4 flex items-center justify-between">
  <button
    type="button"
    onClick={handleCancel}
    className="
      inline-flex items-center gap-2
      rounded-full border border-primary/20
      bg-white text-primary
      px-3 py-1.5 text-sm font-medium
      shadow-sm hover:bg-primary/10
      focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30
      transition
    "
  >
    ← Back to Events
  </button>
</div>

    <h1 className="text-2xl font-bold">Create Public Event</h1>
    <p className="text-sm text-muted-foreground">
      Post a game or social hit that other players can request to join.
    </p>
  </header>

  <form onSubmit={createEvent} className="space-y-5">
    {/* Card: Event details */}
    <section className="rounded-xl border bg-white p-4 shadow-sm">
      <h2 className="text-base font-semibold mb-3">Event details</h2>

      <div className="space-y-4">
        <div>
          <label className="block text-sm mb-1">Title</label>
          <input
            className="w-full rounded-xl border px-3 py-2 focus:outline-none focus:ring-2 focus:ring-primary/30"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Singles at Melbourne Park"
            required
          />
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className="block text-sm mb-1">Event Type</label>
            <select
              className="w-full rounded-xl border px-3 py-2 focus:outline-none focus:ring-2 focus:ring-primary/30"
              value={eventType}
              onChange={(e) => onTypeChange(e.target.value as EventType)}
            >
              <option value="singles">Singles</option>
              <option value="doubles">Doubles</option>
              <option value="social">Social</option>
            </select>
          </div>

          <div>
  <label className="block text-sm mb-1">Min Skill (optional)</label>
  <select
    className="w-full rounded-xl border px-3 py-2 focus:outline-none focus:ring-2 focus:ring-primary/30"
    value={minSkill}
    onChange={(e) =>
      setMinSkill(
        (e.target.value as "" | "Beginner" | "Intermediate" | "Advanced")
      )
    }
  >
    <option value="">Any skill level</option>
    <option value="Beginner">Beginner</option>
    <option value="Intermediate">Intermediate</option>
    <option value="Advanced">Advanced</option>
  </select>
  <p className="text-xs text-muted-foreground mt-1">
    Set a minimum skill to filter joiners.
  </p>
</div>
        </div>

        <div>
          <label className="block text-sm mb-1">Location</label>
          <input
            className="w-full rounded-xl border px-3 py-2 focus:outline-none focus:ring-2 focus:ring-primary/30"
            value={location}
            onChange={(e) => setLocation(e.target.value)}
            placeholder="Melbourne Park – Court 2"
            required
          />
        </div>
      </div>
    </section>

    {/* Card: Date & capacity */}
    <section className="rounded-xl border bg-white p-4 shadow-sm">
      <h2 className="text-base font-semibold mb-3">Date & capacity</h2>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div>
          <label className="block text-sm mb-1">Date</label>
         <input
  className="w-full rounded-xl border px-3 py-2 focus:outline-none focus:ring-2 focus:ring-primary/30"
  type="date"
  value={date}
  onChange={(e) => setDate(e.target.value)}
  min={todayISO}
  required
/>

        </div>

        <div>
          <label className="block text-sm mb-1">Time</label>
<select
  className="w-full rounded-xl border px-3 py-2 focus:outline-none focus:ring-2 focus:ring-primary/30"
  value={time}
  onChange={(e) => setTime(e.target.value)}
  required
>
  <option value="" disabled>Select a time</option>
  {buildHalfHourOptions(/* e.g., "06:00", "22:30" */).map((t) => (
    <option key={t} value={t}>
      {t}
    </option>
  ))}
</select>
<p className="text-xs text-muted-foreground mt-1">
  Times are in 30-minute increments.
</p>

        </div>

        <div>
          <label className="block text-sm mb-1">Duration (mins)</label>
          <input
            className="w-full rounded-xl border px-3 py-2 focus:outline-none focus:ring-2 focus:ring-primary/30"
            type="number"
            min={15}
            step={15}
            value={duration}
            onChange={(e) => setDuration(parseInt(e.target.value || "60", 10))}
          />
        </div>

        <div>
  <label className="block text-sm mb-1">Max Spots</label>
  <input
    className="w-full rounded-xl border px-3 py-2 focus:outline-none focus:ring-2 focus:ring-primary/30 disabled:opacity-60"
    type="number"
    min={minCapacityFor(eventType)}
    max={Number.isFinite(maxCapacityFor(eventType)) ? maxCapacityFor(eventType) : undefined}
    value={maxSpots}
    onChange={(e) => {
      const raw = parseInt(e.target.value || "0", 10);
      const min = minCapacityFor(eventType);
      const max = maxCapacityFor(eventType);
      const next = isNaN(raw) ? min : raw;
      setMaxSpots(Math.min(max, Math.max(min, next)));
    }}
    disabled={eventType === "singles"}
    readOnly={eventType === "singles"}
  />
  <p className="text-xs text-muted-foreground mt-1">
    {eventType === "singles" && "Singles events always need 1 opponent."}
    {eventType === "doubles" && "Doubles can be 2–4 (2 if you have a partner, up to 4 if you need a full pairing)."}
    {eventType === "social" && "Social events require at least 5 players."}
  </p>
</div>

      </div>
    </section>

    {/* Card: Description */}
    <section className="rounded-xl border bg-white p-4 shadow-sm">
      <h2 className="text-base font-semibold mb-3">Description</h2>

      <div>
        <label className="block text-sm mb-1">Description (optional)</label>
        <textarea
          className="w-full min-h-[110px] rounded-xl border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
          maxLength={DESC_LIMIT}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="Share details—what to bring, preferred balls, pace, parking notes, court surface, etc."
        />
        <div className="mt-1 flex items-center justify-between">
          <p className="text-xs text-muted-foreground">
            Tip: keep it friendly and specific to attract the right players.
          </p>
          <span className="text-xs text-muted-foreground">
            {description.length}/{DESC_LIMIT}
          </span>
        </div>
      </div>
    </section>

    {/* Submit */}
    <div className="pt-2">
    <button
  type="submit"
  disabled={submitting}
  className="w-full rounded-xl bg-emerald-600 px-4 py-3 text-white font-semibold shadow-sm hover:bg-emerald-700 active:scale-[0.98] transition disabled:opacity-60 disabled:cursor-not-allowed"
>
  {submitting ? "Posting…" : "Post Event"}
</button>
    </div>
  </form>
</main>
  );
}
