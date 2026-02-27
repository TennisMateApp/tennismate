"use client";

import { useEffect, useMemo, useState, useRef } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import debounce from "lodash.debounce";
import { auth, db } from "@/lib/firebaseConfig";
import {
  addDoc,
  collection,
  serverTimestamp,
  doc,
  getDoc,
  updateDoc,
  getDocs,      // ✅ ADD
  query,        // ✅ ADD
  where,        // ✅ ADD
  orderBy,      // ✅ ADD
  limit,        // ✅ ADD
} from "firebase/firestore";
import { ChevronLeft, CalendarDays } from "lucide-react";

import DesktopCreateEventPage from "@/components/events/DesktopCreateEventPage";
import { useIsDesktop } from "@/lib/useIsDesktop";

type EventType = "practice" | "social" | "competitive";

type SkillBandLabel =
  | "lower beginner"
  | "beginner"
  | "upper beginner"
  | "lower intermediate"
  | "intermediate"
  | "upper intermediate"
  | "lower advance"
  | "advance"
  | "upper advance";

const EVENT_TYPES: { value: EventType; label: string }[] = [
  { value: "practice", label: "Practice / Drills" },
  { value: "social", label: "Social" },
  { value: "competitive", label: "Competitive" },
];

const SKILL_LEVELS: { value: SkillBandLabel; label: string }[] = [
  { value: "lower beginner", label: "Lower beginner" },
  { value: "beginner", label: "Beginner" },
  { value: "upper beginner", label: "Upper beginner" },
  { value: "lower intermediate", label: "Lower intermediate" },
  { value: "intermediate", label: "Intermediate" },
  { value: "upper intermediate", label: "Upper intermediate" },
  { value: "lower advance", label: "Lower advance" },
  { value: "advance", label: "Advance" },
  { value: "upper advance", label: "Upper advance" },
];

const SKILL_ORDER = SKILL_LEVELS.map((s) => s.value);

function clampSkillRange(from: SkillBandLabel, to: SkillBandLabel) {
  const fromIdx = SKILL_ORDER.indexOf(from);
  const toIdx = SKILL_ORDER.indexOf(to);
  if (fromIdx === -1 || toIdx === -1) return { from, to };
  if (fromIdx <= toIdx) return { from, to };
  // if invalid, force "to" up to match "from"
  return { from, to: from };
}

type EventDoc = {
  hostId?: string;
  title?: string;
  type?: EventType | string;
  location?: string;
  start?: string; // ISO
  end?: string; // ISO
  durationMins?: number;
  minSkillLabel?: SkillBandLabel | string | null; // skill from
maxSkillLabel?: SkillBandLabel | string | null; // skill to (NEW)
  spotsTotal?: number;
  description?: string | null;
  status?: string;
    court?: any | null; // ✅ ADD (or define a proper type later)
};

function formatDisplayDateTime(d: string, t: string) {
  if (!d || !t) return "";
  const dt = new Date(`${d}T${t}:00`);
  if (Number.isNaN(dt.getTime())) return "";
  return new Intl.DateTimeFormat(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(dt);
}

// ✅ Avoid UTC shifting the date: build YYYY-MM-DD from local time
function isoToDateTime(iso?: string) {
  if (!iso) return { date: "", time: "" };
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return { date: "", time: "" };

  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");

  const hh = String(d.getHours()).padStart(2, "0");
  const min = String(d.getMinutes()).padStart(2, "0");

  return { date: `${yyyy}-${mm}-${dd}`, time: `${hh}:${min}` };
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

export default function NewEventPage() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const editId = searchParams.get("edit"); // /events/new?edit=<eventId>
  const isEditing = !!editId;

  const isDesktop = useIsDesktop();

  const todayISO = useMemo(() => new Date().toISOString().slice(0, 10), []);
  const DESC_LIMIT = 300;

  // --- Form state ---
  const [title, setTitle] = useState("");
  const [eventType, setEventType] = useState<EventType>("practice");
  const [date, setDate] = useState("");
  const [time, setTime] = useState("");
  const [location, setLocation] = useState("");

  // ===== COURT MATCHING (like invite flow) =====
const [courtQuery, setCourtQuery] = useState("");
const [courtMatches, setCourtMatches] = useState<any[]>([]);
const [courtMatchesLoading, setCourtMatchesLoading] = useState(false);
const [selectedCourt, setSelectedCourt] = useState<any>(null); // predetermined court

const activeCourt = selectedCourt || null;

// ✅ DROPDOWN OVERLAY (fixed-position dropdown)
const locationWrapRef = useRef<HTMLDivElement>(null);
const selectingCourtRef = useRef(false); // ✅ prevents clearing selectedCourt on dropdown select
const [dropdownOpen, setDropdownOpen] = useState(false);
const [dropdownPos, setDropdownPos] = useState<{ left: number; top: number; width: number } | null>(null);

const updateDropdownPosition = () => {
  const el = locationWrapRef.current;
  if (!el) return;

  const r = el.getBoundingClientRect();
  setDropdownPos({
    left: r.left,
    top: r.bottom + 8, // drop below input
    width: r.width,
  });
};

  const [skillFrom, setSkillFrom] = useState<SkillBandLabel>("beginner");
const [skillTo, setSkillTo] = useState<SkillBandLabel>("upper advance");
  const [players, setPlayers] = useState<number>(4);
  const [description, setDescription] = useState("");
  const [submitting, setSubmitting] = useState(false);

  // editing UX
  const [loadingEvent, setLoadingEvent] = useState(false);
  const [didHydrateFromEvent, setDidHydrateFromEvent] = useState(false);

  // ✅ Load existing event when editing
  useEffect(() => {
    if (!editId) {
      setDidHydrateFromEvent(true);
      return;
    }

    let cancelled = false;

    (async () => {
      try {
        setLoadingEvent(true);

        const snap = await getDoc(doc(db, "events", editId));
        if (!snap.exists()) {
          alert("Event not found.");
          router.push("/events");
          return;
        }

        const data = snap.data() as EventDoc;

        // optional: enforce host-only editing
        const me = auth.currentUser?.uid || null;
        if (me && data.hostId && me !== data.hostId) {
          alert("You can only edit events you host.");
          router.push(`/events/${editId}`);
          return;
        }

        if (cancelled) return;

        setTitle(data.title ?? "");

        setEventType(
          data.type === "practice" || data.type === "social" || data.type === "competitive"
            ? (data.type as EventType)
            : "practice"
        );

        const dt = isoToDateTime(data.start);
        setDate(dt.date);
        setTime(dt.time);

        setLocation(data.location ?? "");
        // ✅ if the event already has a predetermined court, restore it
        setSelectedCourt((data as any)?.court ?? null);
        setPlayers(typeof data.spotsTotal === "number" ? data.spotsTotal : 4);

  const fromRaw = (data.minSkillLabel ?? "beginner").toString().toLowerCase();
const toRaw = (data.maxSkillLabel ?? "upper advance").toString().toLowerCase();

const from = (SKILL_LEVELS.some((s) => s.value === fromRaw)
  ? (fromRaw as SkillBandLabel)
  : "beginner");

const to = (SKILL_LEVELS.some((s) => s.value === toRaw)
  ? (toRaw as SkillBandLabel)
  : "upper advance");

const fixed = clampSkillRange(from, to);
setSkillFrom(fixed.from);
setSkillTo(fixed.to);


        setDescription(data.description ?? "");
      } catch (e) {
        console.error("Failed to load event for editing:", e);
        alert("Could not load this event to edit.");
      } finally {
        if (!cancelled) {
          setLoadingEvent(false);
          setDidHydrateFromEvent(true);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [editId, router]);

  // ✅ dirty guard should NOT trigger before we've hydrated the form
  const dirty =
    didHydrateFromEvent &&
    (title.trim() !== "" ||
      location.trim() !== "" ||
      description.trim() !== "" ||
      date !== "" ||
      time !== "" ||
      players !== 4 ||
      eventType !== "practice" ||
      skillFrom !== "beginner" || skillTo !== "upper advance");

  useEffect(() => {
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (!dirty) return;
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [dirty]);

  function handleBack() {
    if (dirty && !confirm("Discard changes? Your changes will be lost.")) return;
    router.push(isEditing ? `/events/${editId}` : "/events");
  }

  // ===== COURT SEARCH (prefix search using courts.nameLower) =====
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

   // ✅ keep dropdown aligned under the input if user scrolls/resizes
useEffect(() => {
  if (!dropdownOpen) return;

  const onReposition = () => updateDropdownPosition();
  window.addEventListener("resize", onReposition);
  window.addEventListener("scroll", onReposition, true); // capture scroll inside containers too

  return () => {
    window.removeEventListener("resize", onReposition);
    window.removeEventListener("scroll", onReposition, true);
  };
}, [dropdownOpen]);

   async function saveEvent(e: React.FormEvent) {
    e.preventDefault();
    const u = auth.currentUser;
    if (!u || submitting) return;

    if (!title.trim() || !date || !time || !location.trim()) {
      alert("Please fill in: title, date/time, and location.");
      return;
    }

    const start = new Date(`${date}T${time}:00`);
    if (Number.isNaN(start.getTime())) {
      alert("Please choose a valid date/time.");
      return;
    }
    if (start.getTime() < Date.now() - 60_000) {
      alert("Start time is in the past. Please pick a future time.");
      return;
    }

    const durationMins = 90;
    const end = new Date(start.getTime() + durationMins * 60_000);

    const fixed = clampSkillRange(skillFrom, skillTo);
    const fromToSave = fixed.from;
    const toToSave = fixed.to;

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

    setSubmitting(true);
    try {
      if (isEditing && editId) {
        await updateDoc(doc(db, "events", editId), {
  title: title.trim(),
  type: eventType,
  location: location.trim(),
  court: courtPayload, // ✅ ADD
  start: start.toISOString(),
  end: end.toISOString(),
  durationMins,
  description: description.trim() === "" ? null : description.trim(),
  minSkillLabel: fromToSave,
  maxSkillLabel: toToSave,
  spotsTotal: players,
  updatedAt: serverTimestamp(),
});
        router.push(`/events/${editId}`);
      } else {
        const ref = await addDoc(collection(db, "events"), {
  hostId: u.uid,
  visibility: "public",

  title: title.trim(),
  type: eventType,
  location: location.trim(),
  court: courtPayload, // ✅ ADD
  start: start.toISOString(),
  end: end.toISOString(),
  durationMins,

  description: description.trim() === "" ? null : description.trim(),

  minSkill: null,
  minSkillLabel: fromToSave,
  maxSkillLabel: toToSave,

  spotsTotal: players,
  spotsFilled: 0,
  status: "open",

  createdAt: serverTimestamp(),
  updatedAt: serverTimestamp(),
});

        router.push(`/events/${ref.id}`);
      }
    } finally {
      setSubmitting(false);
    }
  }

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

  const TM = {
    forest: "#0B3D2E",
    forestDark: "#071B15",
    neon: "#39FF14",
    bg: "#F3F4F6",
  };

  const dateTimeLabel = formatDisplayDateTime(date, time);

  // ✅ Keep desktop create as-is (edit goes through the editable form)
  if (isDesktop && !isEditing) {
    return <DesktopCreateEventPage />;
  }

  // Loader while hydrating edit data
  if (isEditing && (loadingEvent || !didHydrateFromEvent)) {
    return (
      <main className="min-h-screen flex items-center justify-center" style={{ background: TM.bg }}>
        <div className="text-sm font-semibold text-gray-700">Loading event…</div>
      </main>
    );
  }

  return (
    <main className="min-h-screen" style={{ background: TM.bg }}>
      <div className="mx-auto w-full max-w-md">
        <div className="bg-white rounded-b-2xl shadow-sm">
          <div className="px-4 pt-4 pb-3">
            <div className="relative flex items-center justify-center">
              <button
                type="button"
                onClick={handleBack}
                aria-label="Back"
                className="absolute left-0 inline-flex h-10 w-10 items-center justify-center rounded-full hover:bg-gray-100"
              >
                <ChevronLeft className="h-6 w-6" style={{ color: TM.forest }} />
              </button>

              <div className="text-[15px] font-extrabold" style={{ color: TM.forest }}>
                {isEditing ? "Edit Event" : "Create New Event"}
              </div>
            </div>
          </div>
        </div>

        <div className="px-4 py-4">
          <div className="rounded-2xl bg-white shadow-sm ring-1 ring-black/5 overflow-hidden">
            <form onSubmit={saveEvent} className="p-5 space-y-5">
              <div>
                <label className="block text-[11px] font-extrabold tracking-widest text-gray-500 mb-2">
                  EVENT TITLE
                </label>
                <input
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="e.g., Sunday Morning Singles"
                  className="w-full rounded-xl border border-gray-200 bg-white px-4 py-3 text-sm outline-none focus:border-gray-300 focus:ring-2 focus:ring-black/5"
                  required
                />
              </div>

              <div>
                <label className="block text-[11px] font-extrabold tracking-widest text-gray-500 mb-2">
                  EVENT TYPE
                </label>
                <select
                  value={eventType}
                  onChange={(e) => setEventType(e.target.value as EventType)}
                  className="w-full rounded-xl border border-gray-200 bg-white px-4 py-3 text-sm outline-none focus:border-gray-300 focus:ring-2 focus:ring-black/5"
                >
                  {EVENT_TYPES.map((t) => (
                    <option key={t.value} value={t.value}>
                      {t.label}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-[11px] font-extrabold tracking-widest text-gray-500 mb-2">
                  DATE &amp; TIME
                </label>

                <div className="space-y-3">
                  <div className="grid grid-cols-2 gap-3">
                    <input
                      type="date"
                      value={date}
                      min={todayISO}
                      onChange={(e) => setDate(e.target.value)}
                      className="w-full rounded-xl border border-gray-200 bg-white px-4 py-3 text-sm outline-none focus:border-gray-300 focus:ring-2 focus:ring-black/5"
                      required
                    />
                    <input
                      type="time"
                      value={time}
                      onChange={(e) => setTime(e.target.value)}
                      className="w-full rounded-xl border border-gray-200 bg-white px-4 py-3 text-sm outline-none focus:border-gray-300 focus:ring-2 focus:ring-black/5"
                      required
                    />
                  </div>

                  {!!dateTimeLabel && (
                    <div className="flex items-center gap-3 rounded-xl border border-gray-200 px-4 py-3">
                      <div className="h-9 w-9 rounded-lg flex items-center justify-center bg-lime-100">
                        <CalendarDays className="h-5 w-5" style={{ color: TM.forest }} />
                      </div>
                      <div className="text-sm font-semibold text-gray-700">{dateTimeLabel}</div>
                    </div>
                  )}
                </div>
              </div>

             <div className="relative">
  <div className="relative" ref={locationWrapRef}>
  <label className="block text-[11px] font-extrabold tracking-widest text-gray-500 mb-2">
    LOCATION
  </label>

  <input
    value={location}
    onChange={(e) => {
      setLocation(e.target.value);
      setDropdownOpen(true);
    }}
    onFocus={() => {
      if (location.trim().length >= 2) {
        setDropdownOpen(true);
        updateDropdownPosition();
      }
    }}
    placeholder="Start typing a court name..."
    className="w-full rounded-xl border border-gray-200 bg-white px-4 py-3 text-sm outline-none focus:border-gray-300 focus:ring-2 focus:ring-black/5"
    required
  />

  {/* ✅ FIXED overlay dropdown (overlays the page) */}
  {dropdownOpen && dropdownPos && (courtMatchesLoading || courtMatches.length > 0) && (
    <>
      {/* click-away layer */}
      <button
        type="button"
        className="fixed inset-0 z-[60] cursor-default"
        onClick={() => setDropdownOpen(false)}
        aria-label="Close court dropdown"
      />

      {/* dropdown itself */}
      <div
        className="fixed z-[70] rounded-xl border bg-white overflow-hidden shadow-2xl"
        style={{
          left: dropdownPos.left,
          top: dropdownPos.top,
          width: dropdownPos.width,
          maxHeight: 260,
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
  selectingCourtRef.current = true;   // ✅ mark: this change came from dropdown click
  setSelectedCourt(c);
  setCourtMatches([]);
  setDropdownOpen(false);
  setLocation(c.name || "");
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

  {/* ✅ Map ONLY loads AFTER a court is selected */}
  {activeCourt && (() => {
    const court = activeCourt;

    const fullAddress = [
      court?.address,
      court?.suburb,
      court?.state,
      court?.postcode,
    ]
      .filter(Boolean)
      .join(", ");

    const mapsHref = mapsUrlForAddress(fullAddress || court?.name);
    const mapsEmbedUrl = mapsEmbedUrlForAddress(fullAddress || court?.name);

    if (!mapsEmbedUrl || !mapsHref) return null;

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
              height="180"
              loading="lazy"
              referrerPolicy="no-referrer-when-downgrade"
              className="block w-full pointer-events-none"
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

              <div className="grid grid-cols-2 gap-3">
                <div className="col-span-2">
  <label className="block text-[11px] font-extrabold tracking-widest text-gray-500 mb-2">
    SKILL RANGE
  </label>

  <div className="grid grid-cols-2 gap-3">
    {/* From */}
    <div>
      <div className="mb-2 text-[11px] font-extrabold tracking-widest text-gray-400">
        FROM
      </div>
      <select
        value={skillFrom}
        onChange={(e) => {
          const nextFrom = e.target.value as SkillBandLabel;
          const fixed = clampSkillRange(nextFrom, skillTo);
          setSkillFrom(fixed.from);
          setSkillTo(fixed.to);
        }}
        className="w-full rounded-xl border border-gray-200 bg-white px-4 py-3 text-sm outline-none focus:border-gray-300 focus:ring-2 focus:ring-black/5"
      >
        {SKILL_LEVELS.map((s) => (
          <option key={s.value} value={s.value}>
            {s.label}
          </option>
        ))}
      </select>
    </div>

    {/* To */}
    <div>
      <div className="mb-2 text-[11px] font-extrabold tracking-widest text-gray-400">
        TO
      </div>
      <select
        value={skillTo}
        onChange={(e) => {
          const nextTo = e.target.value as SkillBandLabel;
          const fixed = clampSkillRange(skillFrom, nextTo);
          setSkillFrom(fixed.from);
          setSkillTo(fixed.to);
        }}
        className="w-full rounded-xl border border-gray-200 bg-white px-4 py-3 text-sm outline-none focus:border-gray-300 focus:ring-2 focus:ring-black/5"
      >
        {SKILL_LEVELS.map((s) => (
          <option key={s.value} value={s.value}>
            {s.label}
          </option>
        ))}
      </select>
    </div>
  </div>
</div>


                <div>
                  <label className="block text-[11px] font-extrabold tracking-widest text-gray-500 mb-2">
                    PLAYERS
                  </label>

                  <div className="flex items-center justify-between rounded-xl border border-gray-200 px-3 py-2">
                    <button
                      type="button"
                      onClick={() => setPlayers((p) => Math.max(2, p - 1))}
                      className="h-10 w-10 rounded-lg font-extrabold text-lg"
                      style={{ background: "rgba(57,255,20,0.20)", color: TM.forest }}
                      aria-label="Decrease players"
                    >
                      –
                    </button>

                    <div className="text-sm font-extrabold text-gray-800">{players}</div>

                    <button
                      type="button"
                      onClick={() => setPlayers((p) => Math.min(24, p + 1))}
                      className="h-10 w-10 rounded-lg font-extrabold text-lg"
                      style={{ background: "rgba(57,255,20,0.20)", color: TM.forest }}
                      aria-label="Increase players"
                    >
                      +
                    </button>
                  </div>

                  <p className="mt-1 text-[11px] text-gray-500">Min 2 • Max 24</p>
                </div>
              </div>

              <div>
                <label className="block text-[11px] font-extrabold tracking-widest text-gray-500 mb-2">
                  EVENT DESCRIPTION
                </label>
                <textarea
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  maxLength={DESC_LIMIT}
                  placeholder="Describe the format, ball cost, or any specific details..."
                  className="w-full min-h-[120px] rounded-xl border border-gray-200 bg-white px-4 py-3 text-sm outline-none focus:border-gray-300 focus:ring-2 focus:ring-black/5"
                />
              </div>

              <button
                type="submit"
                disabled={submitting}
                className="w-full rounded-2xl py-4 text-sm font-extrabold disabled:opacity-60 disabled:cursor-not-allowed"
                style={{
                  background: TM.neon,
                  color: TM.forest,
                  boxShadow: "0 14px 34px rgba(57,255,20,0.22)",
                }}
              >
                {submitting ? "Saving…" : isEditing ? "Save Changes" : "Post Event"}
              </button>
            </form>
          </div>
        </div>
      </div>
    </main>
  );
}
