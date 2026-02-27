"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import TMDesktopSidebar from "@/components/desktop_layout/TMDesktopSidebar";
import { ArrowLeft, HelpCircle, CalendarDays, MapPin, ChevronDown } from "lucide-react";
import { auth, db } from "@/lib/firebaseConfig";
import {
  addDoc,
  collection,
  serverTimestamp,
  getDocs,
  query,
  where,
  orderBy,
  limit,
} from "firebase/firestore";
import debounce from "lodash.debounce";

/** Desktop Create Event (matches screenshot layout) */

export type DesktopEventType = "Practice / Drills" | "Social" | "Competitive";

export type DesktopSkillLevel =
  | "Lower Beginner"
  | "Beginner"
  | "Upper Beginner"
  | "Lower Intermediate"
  | "Intermediate"
  | "Upper Intermediate"
  | "Lower Advance"
  | "Advance"
  | "Upper Advance";

const EVENT_TYPES: DesktopEventType[] = ["Practice / Drills", "Social", "Competitive"];

const SKILL_LEVELS: DesktopSkillLevel[] = [
  "Lower Beginner",
  "Beginner",
  "Upper Beginner",
  "Lower Intermediate",
  "Intermediate",
  "Upper Intermediate",
  "Lower Advance",
  "Advance",
  "Upper Advance",
];

function buildHalfHourOptions(start = "00:00", end = "23:30") {
  const [startH, startM] = start.split(":").map(Number);
  const [endH, endM] = end.split(":").map(Number);
  const startTotal = startH * 60 + startM;
  const endTotal = endH * 60 + endM;

  const out: string[] = [];
  for (let t = startTotal; t <= endTotal; t += 30) {
    const h = Math.floor(t / 60);
    const m = t % 60;
    out.push(`${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`);
  }
  return out;
}

function isHalfHour(value: string) {
  const [h, m] = value.split(":").map(Number);
  return Number.isInteger(h) && Number.isInteger(m) && (m === 0 || m === 30);
}

function classNames(...arr: Array<string | false | undefined | null>) {
  return arr.filter(Boolean).join(" ");
}

function InputShell({
  label,
  icon,
  children,
}: {
  label: string;
  icon?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div className="mb-2 flex items-center gap-2">
        <div className="text-[12px] font-semibold text-gray-700">{label}</div>
      </div>
      <div className="relative">
        {icon ? (
          <div className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-gray-400">
            {icon}
          </div>
        ) : null}
        {children}
      </div>
    </div>
  );
}

function Select({
  value,
  onChange,
  children,
  disabled,
}: {
  value: string;
  onChange: (v: string) => void;
  children: React.ReactNode;
  disabled?: boolean;
}) {
  return (
    <div className="relative">
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        className={classNames(
          "w-full appearance-none rounded-xl border border-gray-200 bg-white px-3 py-2.5 text-sm text-gray-900 shadow-sm",
          "focus:outline-none focus:ring-2 focus:ring-lime-300/70",
          disabled && "opacity-60"
        )}
      >
        {children}
      </select>
      <ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-500" />
    </div>
  );
}

function TextInput({
  value,
  onChange,
  placeholder,
  type = "text",
  leftPad = true,
  onFocus,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  type?: string;
  leftPad?: boolean;
  onFocus?: () => void;
}) {
  return (
    <input
      type={type}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      onFocus={onFocus}
      placeholder={placeholder}
      className={classNames(
        "w-full rounded-xl border border-gray-200 bg-white py-2.5 text-sm text-gray-900 shadow-sm",
        "focus:outline-none focus:ring-2 focus:ring-lime-300/70",
        leftPad ? "pl-10 pr-3" : "px-3"
      )}
    />
  );
}

function NumberInput({
  value,
  onChange,
  min,
  max,
}: {
  value: number;
  onChange: (v: number) => void;
  min?: number;
  max?: number;
}) {
  return (
    <input
      type="number"
      value={value}
      min={min}
      max={max}
      onChange={(e) => onChange(parseInt(e.target.value || "0", 10))}
      className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2.5 text-sm text-gray-900 shadow-sm focus:outline-none focus:ring-2 focus:ring-lime-300/70"
    />
  );
}

function mapsUrlForAddress(address?: string | null) {
  const q = (address || "").trim();
  if (!q) return null;
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(q)}`;
}

function mapsEmbedUrlForAddress(address?: string | null) {
  const q = (address || "").trim();
  if (!q) return null;
  return `https://www.google.com/maps?q=${encodeURIComponent(q)}&output=embed`;
}

export default function DesktopCreateEventPage() {
  const todayISO = useMemo(() => new Date().toISOString().slice(0, 10), []);

  const [title, setTitle] = useState("");
  const [type, setType] = useState<DesktopEventType>("Practice / Drills");
  const [skill, setSkill] = useState<DesktopSkillLevel | "">("");
  const [maxPlayers, setMaxPlayers] = useState<number>(4);

  const [date, setDate] = useState<string>(todayISO);
  const [startTime, setStartTime] = useState<string>("09:00");
  const [endTime, setEndTime] = useState<string>("11:00");

  const [location, setLocation] = useState<string>("");

  // ===== COURT MATCHING (desktop) =====
const [courtMatches, setCourtMatches] = useState<any[]>([]);
const [courtMatchesLoading, setCourtMatchesLoading] = useState(false);
const [selectedCourt, setSelectedCourt] = useState<any>(null);

const activeCourt = selectedCourt || null;

// dropdown overlay positioning (same idea as mobile)
const locationWrapRef = useRef<HTMLDivElement>(null);
const selectingCourtRef = useRef(false); // ✅ key: prevents “double select”
const [dropdownOpen, setDropdownOpen] = useState(false);
const [dropdownPos, setDropdownPos] = useState<{ left: number; top: number; width: number } | null>(null);

const updateDropdownPosition = () => {
  const el = locationWrapRef.current;
  if (!el) return;
  const r = el.getBoundingClientRect();
  setDropdownPos({
    left: r.left,
    top: r.bottom + 8,
    width: r.width,
  });
};

// ✅ keep dropdown aligned under the input if user scrolls/resizes
useEffect(() => {
  if (!dropdownOpen) return;

  const onReposition = () => updateDropdownPosition();
  window.addEventListener("resize", onReposition);
  window.addEventListener("scroll", onReposition, true);

  return () => {
    window.removeEventListener("resize", onReposition);
    window.removeEventListener("scroll", onReposition, true);
  };
}, [dropdownOpen]);
  
  const [description, setDescription] = useState<string>("");

  const [submitting, setSubmitting] = useState(false);

  const DESC_LIMIT = 400;

  // keep endTime >= startTime by at least 30 mins if user changes startTime
  useEffect(() => {
    if (!startTime || !endTime) return;
    // naive compare ok because HH:MM strings
    if (endTime <= startTime) {
      const opts = buildHalfHourOptions();
      const idx = opts.indexOf(startTime);
      const next = opts[Math.min(opts.length - 1, idx + 2)]; // +60 mins
      setEndTime(next || startTime);
    }
  }, [startTime]); // eslint-disable-line react-hooks/exhaustive-deps

  const searchCourtsPrefix = async (text: string) => {
  const qText = text.trim().toLowerCase();
  if (qText.length < 2) {
    setCourtMatches([]);
    return;
  }

  setCourtMatchesLoading(true);
  try {
    const courtsRef = collection(db, "courts");

    const qs = query(
      courtsRef,
      orderBy("nameLower"),
      where("nameLower", ">=", qText),
      where("nameLower", "<", qText + "\uf8ff"),
      limit(8)
    );

    const snap = await getDocs(qs);
    setCourtMatches(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
  } catch (e) {
    console.error("searchCourtsPrefix error:", e);
    setCourtMatches([]);
  } finally {
    setCourtMatchesLoading(false);
  }
};

const debouncedCourtSearch = useMemo(
  () => debounce((val: string) => searchCourtsPrefix(val), 250),
  []
);

useEffect(() => {
  return () => debouncedCourtSearch.cancel();
}, [debouncedCourtSearch]);

// ✅ Keep court search in sync with typing in Location
useEffect(() => {
  const v = location.trim();

  // ✅ If location changed because user clicked a dropdown match,
  // don't clear selectedCourt and don't re-search.
  if (selectingCourtRef.current) {
    selectingCourtRef.current = false;
    setCourtMatches([]);
    setDropdownOpen(false);
    return;
  }

  if (!v) {
    setSelectedCourt(null);
    setCourtMatches([]);
    setDropdownOpen(false);
    return;
  }

  // user typing means they’re changing the selection
  setSelectedCourt(null);

  setDropdownOpen(true);
  updateDropdownPosition();

  debouncedCourtSearch(v);
  // eslint-disable-next-line react-hooks/exhaustive-deps
}, [location, debouncedCourtSearch]);

  const canSubmit =
    title.trim().length > 0 &&
    date &&
    startTime &&
    endTime &&
    location.trim().length > 0 &&
    !submitting;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const u = auth.currentUser;
    if (!u) return;

    if (!isHalfHour(startTime) || !isHalfHour(endTime)) {
      alert("Please select times in 30-minute increments.");
      return;
    }
    if (endTime <= startTime) {
      alert("End time must be after start time.");
      return;
    }

    const start = new Date(`${date}T${startTime}:00`);
    const end = new Date(`${date}T${endTime}:00`);

    if (start.getTime() < Date.now() - 60_000) {
      alert("Start time is in the past. Please choose a future time.");
      return;
    }

    setSubmitting(true);
    try {
      const courtPayload = activeCourt
  ? {
      id: activeCourt.id || null,
      name: activeCourt.name || null,
      nameLower: activeCourt.nameLower || null,
      address: activeCourt.address || null,
      suburb: activeCourt.suburb || null,
      state: activeCourt.state || null,
      postcode: activeCourt.postcode || null,
      bookingUrl: activeCourt.bookingUrl || null,
      lat: activeCourt.lat ?? null,
      lng: activeCourt.lng ?? null,
    }
  : null;
      await addDoc(collection(db, "events"), {
        hostId: u.uid,
        visibility: "public",

        title: title.trim(),
        type, // store as label

        location: location.trim(),
        start: start.toISOString(),
        end: end.toISOString(),
        durationMins: Math.max(0, Math.round((end.getTime() - start.getTime()) / 60_000)),

        // keep numeric field for backwards compat if you still use it elsewhere
        minSkill: null,
        minSkillLabel: skill === "" ? null : skill,

        spotsTotal: Number.isFinite(maxPlayers) ? Math.max(2, maxPlayers) : 4,
        spotsFilled: 0,
        participants: [],

        description: description.trim() === "" ? null : description.trim(),
        status: "open",

        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),

        court: courtPayload,
      });
      window.location.href = "/events";
    } catch (err) {
      console.error("Create event failed:", err);
      alert("Could not create event. Check console for details.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="min-h-screen bg-[#F7FAF8]">
      <div className="flex w-full gap-6 px-6 py-6">
        {/* LEFT SIDEBAR */}
        <aside className="w-[280px] shrink-0">
          <TMDesktopSidebar active="Home" player={null} />
        </aside>

        {/* CONTENT */}
        <section className="flex-1">
          {/* Top bar (back / title / help) */}
          <div className="mb-6 flex items-center justify-between">
            <Link
              href="/events"
              className="inline-flex items-center gap-2 rounded-xl px-3 py-2 text-sm font-semibold text-gray-700 hover:bg-white hover:shadow-sm"
            >
              <ArrowLeft className="h-4 w-4" />
              Back
            </Link>

            <div
  className="text-2xl font-extrabold tracking-tight"
  style={{ color: "#0B3D2E" }} // TM forest green
>
  Create Event
</div>


            <button
              type="button"
              className="inline-flex items-center gap-2 rounded-xl px-3 py-2 text-sm font-semibold text-gray-700 hover:bg-white hover:shadow-sm"
              onClick={() => alert("Tip: Add a clear title + exact location so players know what to expect.")}
            >
              <HelpCircle className="h-4 w-4" />
              Help
            </button>
          </div>

          {/* Centered form column */}
          <div className="mx-auto w-full max-w-[520px]">
            <form onSubmit={handleSubmit} className="space-y-6">
              {/* BASIC INFORMATION */}
              <div>
                <div className="mb-2 text-[11px] font-extrabold tracking-[0.18em] text-gray-500">
                  BASIC INFORMATION
                </div>

                <div className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
                  <InputShell label="Event Name">
                    <TextInput
                      value={title}
                      onChange={setTitle}
                      placeholder="e.g. Sunday Morning Mixed Doubles"
                      leftPad={false}
                    />
                  </InputShell>

                  <div className="mt-4 grid grid-cols-2 gap-4">
                    <InputShell label="Skill Level">
                      <Select value={skill} onChange={(v) => setSkill(v as any)}>
                        <option value="">Select Level</option>
                        {SKILL_LEVELS.map((s) => (
                          <option key={s} value={s}>
                            {s}
                          </option>
                        ))}
                      </Select>
                    </InputShell>

                    <InputShell label="Max Players">
                      <NumberInput value={maxPlayers} onChange={setMaxPlayers} min={2} max={32} />
                    </InputShell>
                  </div>

                  <div className="mt-4">
                    <div className="text-[12px] font-semibold text-gray-700 mb-2">Event Type</div>
                    <Select value={type} onChange={(v) => setType(v as DesktopEventType)}>
                      {EVENT_TYPES.map((t) => (
                        <option key={t} value={t}>
                          {t}
                        </option>
                      ))}
                    </Select>
                  </div>
                </div>
              </div>

              {/* WHEN & WHERE */}
              <div>
                <div className="mb-2 text-[11px] font-extrabold tracking-[0.18em] text-gray-500">
                  WHEN &amp; WHERE
                </div>

                <div className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
                  {/* Date row */}
                  <div className="grid grid-cols-1 gap-4">
                    <InputShell label="Date" icon={<CalendarDays className="h-4 w-4" />}>
                      <TextInput
                        type="date"
                        value={date}
                        onChange={setDate}
                        leftPad={true}
                      />
                    </InputShell>
                  </div>

                  {/* Times row */}
                  <div className="mt-4 grid grid-cols-2 gap-4">
                    <div>
                      <div className="mb-2 text-[12px] font-semibold text-gray-700">Start Time</div>
                      <Select value={startTime} onChange={setStartTime}>
                        {buildHalfHourOptions("05:00", "23:30").map((t) => (
                          <option key={t} value={t}>
                            {t}
                          </option>
                        ))}
                      </Select>
                    </div>

                    <div>
                      <div className="mb-2 text-[12px] font-semibold text-gray-700">End Time</div>
                      <Select value={endTime} onChange={setEndTime}>
                        {buildHalfHourOptions("05:30", "23:59").map((t) => (
                          <option key={t} value={t}>
                            {t}
                          </option>
                        ))}
                      </Select>
                    </div>
                  </div>

                  {/* Location (OPEN INPUT, NO IMAGE) */}
               <div className="mt-4">
  <div ref={locationWrapRef}>
    <InputShell label="Location" icon={<MapPin className="h-4 w-4" />}>
      <TextInput
        value={location}
       onChange={(v) => {
  setLocation(v);
  setDropdownOpen(true);
  updateDropdownPosition();
}}
onFocus={() => {
  if (location.trim().length >= 2) {
    setDropdownOpen(true);
    updateDropdownPosition();
  }
}}
        placeholder="Start typing a court name..."
        leftPad={true}
      />
    </InputShell>
  </div>

  {/* ✅ FIXED overlay dropdown */}
  {dropdownOpen && dropdownPos && (courtMatchesLoading || courtMatches.length > 0) && (
    <>
      {/* click-away layer */}
      <button
        type="button"
        className="fixed inset-0 z-[60] cursor-default"
        onClick={() => {
  setDropdownOpen(false);
  setCourtMatches([]);
}}
        aria-label="Close court dropdown"
      />

      {/* dropdown */}
      <div
        className="fixed z-[70] rounded-xl border bg-white overflow-hidden shadow-2xl"
        style={{
          left: dropdownPos.left,
          top: dropdownPos.top,
          width: dropdownPos.width,
          maxHeight: 320,
          overflowY: "auto",
          borderColor: "rgba(15,23,42,0.12)",
        }}
      >
        {courtMatchesLoading && (
          <div className="px-4 py-3 text-[12px] text-gray-600">Searching…</div>
        )}

        {!courtMatchesLoading &&
          courtMatches.map((c) => (
            <button
              key={c.id}
              type="button"
 onClick={() => {
  selectingCourtRef.current = true; // ✅ key line
  setSelectedCourt(c);
  setLocation(c.name || "");
  setDropdownOpen(false);
}}
              className="w-full text-left px-4 py-3 hover:bg-black/5"
            >
              <div className="text-[13px] font-extrabold text-gray-900 truncate">
                {c?.name || "Court"}
              </div>
              <div className="text-[12px] text-gray-600 truncate">
                {[c?.address, c?.suburb, c?.postcode].filter(Boolean).join(", ")}
              </div>
            </button>
          ))}
      </div>
    </>
  )}

  {/* ✅ Map only after court selected */}
  {activeCourt && (() => {
    const court = activeCourt;
    const fullAddress = [court?.address, court?.suburb, court?.state, court?.postcode]
      .filter(Boolean)
      .join(", ");

    const mapsHref = mapsUrlForAddress(fullAddress || court?.name);
    const mapsEmbedUrl = mapsEmbedUrlForAddress(fullAddress || court?.name);
    if (!mapsHref || !mapsEmbedUrl) return null;

    return (
      <div className="mt-3">
        {court?.name && (
          <div className="text-[12px] font-extrabold text-gray-800">{court.name}</div>
        )}

        <a href={mapsHref} target="_blank" rel="noreferrer" className="block mt-2">
          <div className="overflow-hidden rounded-2xl border border-gray-200">
            <iframe
              src={mapsEmbedUrl}
              width="100%"
              height="220"
              loading="lazy"
              referrerPolicy="no-referrer-when-downgrade"
              className="block w-full"
            />
          </div>
        </a>

        {court?.bookingUrl && (
          <a
            href={court.bookingUrl}
            target="_blank"
            rel="noreferrer"
            className="mt-3 inline-flex w-full items-center justify-center rounded-xl px-4 py-3 text-[12px] font-extrabold"
            style={{
              background: "#39FF14",
              color: "#0B3D2E",
              boxShadow: "0 6px 18px rgba(57,255,20,0.22)",
            }}
          >
            Book Court ↗
          </a>
        )}

        <button
          type="button"
          onClick={() => {
            setSelectedCourt(null);
            setCourtMatches([]);
            setLocation("");
          }}
          className="mt-2 w-full text-[12px] font-bold underline text-gray-600"
        >
          Clear court selection
        </button>
      </div>
    );
  })()}
</div>
                </div>
              </div>

              {/* ADDITIONAL DETAILS */}
              <div>
                <div className="mb-2 text-[11px] font-extrabold tracking-[0.18em] text-gray-500">
                  ADDITIONAL DETAILS
                </div>

                <div className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
                  <textarea
                    value={description}
                    onChange={(e) => setDescription(e.target.value.slice(0, DESC_LIMIT))}
                    placeholder="Tell players more about the event, rules, or what to bring..."
                    className="min-h-[120px] w-full rounded-xl border border-gray-200 bg-white px-3 py-2.5 text-sm text-gray-900 shadow-sm focus:outline-none focus:ring-2 focus:ring-lime-300/70"
                  />
                  <div className="mt-2 text-right text-[11px] text-gray-500">
                    {description.length}/{DESC_LIMIT}
                  </div>
                </div>
              </div>

              {/* Bottom actions */}
              <div className="pb-10">
                <div className="flex items-center justify-center gap-4">
                  <Link
                    href="/events"
                    className="w-[170px] rounded-xl border border-gray-200 bg-white px-4 py-3 text-center text-sm font-semibold text-gray-700 hover:bg-gray-50"
                  >
                    Cancel
                  </Link>

                  <button
                    type="submit"
                    disabled={!canSubmit}
                    className={classNames(
                      "w-[240px] rounded-xl px-4 py-3 text-sm font-extrabold",
                      "shadow-sm transition active:scale-[0.99]",
                      canSubmit
                        ? "bg-lime-400 text-green-950 hover:bg-lime-300"
                        : "bg-gray-200 text-gray-500 cursor-not-allowed"
                    )}
                  >
                    {submitting ? "Creating…" : "Create Event"}
                  </button>
                </div>
              </div>
            </form>
          </div>
        </section>
      </div>
    </main>
  );
}

/**
 * ✅ Export BOTH ways (prevents the “Element type is invalid” import mistake)
 */
export { DesktopCreateEventPage };
