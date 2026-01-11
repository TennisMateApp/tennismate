"use client";

import { useEffect, useState, useMemo } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { auth, db, storage } from "@/lib/firebaseConfig";
import { getFunctionsClient } from "@/lib/getFunctionsClient";
import { onAuthStateChanged } from "firebase/auth";
import {
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  setDoc,
  serverTimestamp,
  where,
  getCountFromServer,
} from "firebase/firestore";
import { ref, uploadBytes, getDownloadURL, deleteObject } from "firebase/storage";
import Cropper from "react-easy-crop";
import getCroppedImg from "../utils/cropImage";
import { Edit2, Trophy, CheckCircle2, CalendarDays } from "lucide-react";
import type { SkillBand } from "../../lib/skills";
import { clampUTR, SKILL_OPTIONS, skillFromUTR } from "../../lib/skills";
import type { ChangeEvent } from "react";
import React from "react";
import { httpsCallable } from "firebase/functions";

const RATING_LABEL = "TennisMate Rating (TMR)";
// ---- fallback options in case SKILL_OPTIONS is missing/mis-exported ----
const SKILL_OPTIONS_SAFE =
  Array.isArray(SKILL_OPTIONS) && SKILL_OPTIONS.length > 0
    ? SKILL_OPTIONS
    : ([
        { value: "beginner", label: "Beginner" },
        { value: "intermediate", label: "Intermediate" },
        { value: "advanced", label: "Advanced" },
      ] as Array<{ value: SkillBand; label: string }>);


const coarseFromBand = (b?: SkillBand | "") =>
  !b ? "" :
  b.includes("beginner") ? "Beginner" :
  b.includes("intermediate") ? "Intermediate" :
  "Advanced";

// Canonical band -> human-readable label
const toSkillLabel = (band: SkillBand | "" | undefined): string | null => {
  if (!band) return null;

  // Prefer official label from SKILL_OPTIONS_SAFE
  const fromOptions = SKILL_OPTIONS_SAFE.find(o => o.value === band)?.label;
  if (fromOptions) return fromOptions;

  // Fallback: lower_beginner -> Lower Beginner
  const raw = String(band);
  if (raw.includes("_")) {
    return raw
      .split("_")
      .map(w => w.charAt(0).toUpperCase() + w.slice(1))
      .join(" ");
  }

  // Simple capitalisation fallback
  return raw.charAt(0).toUpperCase() + raw.slice(1);
};

const getSkillLabel = (band: SkillBand | "" | undefined) =>
  toSkillLabel(band) ?? "—";



const legacyToBand = (level?: string): SkillBand | "" => {
  if (!level) return "";
  const norm = level.toLowerCase();
  if (norm.includes("beginner")) return "beginner";
  if (norm.includes("intermediate")) return "intermediate";
  if (norm.includes("advanced") || norm.includes("advance")) return "advanced";
  return "";
};


export default function ProfilePage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [user, setUser] = useState<any>(null);
  const [userRole, setUserRole] = useState<string>("");
  const [coachInvited, setCoachInvited] = useState<boolean>(false);
  const canSeeCoachingSection =
  coachInvited === true || userRole === "coach" || userRole === "both";
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState("");
  const [imageSrc, setImageSrc] = useState<string | null>(null);
  const [croppedImage, setCroppedImage] = useState<File | null>(null);
  const [previewURL, setPreviewURL] = useState<string | null>(null);
  const [crop, setCrop] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [croppedAreaPixels, setCroppedAreaPixels] = useState<any>(null);
  const [showCropper, setShowCropper] = useState(false);
  const [editMode, setEditMode] = useState(false);
  const [bioExpanded, setBioExpanded] = useState(false);


 const [formData, setFormData] = useState({
  name: "",
  postcode: "",
  skillBand: "" as SkillBand | "",
  rating: "" as number | "",
  availability: [] as string[],
  isMatchable: true,
  bio: "",
  photoURL: "",
  badges: [] as string[],
  birthYear: "" as number | "",
  gender: "",
  timestamp: null as any,
});

const derivedAge = useMemo(() => {
  if (typeof formData.birthYear !== "number") return null;
  const currentYear = new Date().getFullYear();
  const age = currentYear - formData.birthYear;
  if (!Number.isFinite(age) || age < 0 || age > 120) return null;
  return age;
}, [formData.birthYear]);


// Profile photo presence (preview, stored, or freshly cropped)
// NOTE: compute after formData is declared to avoid "Cannot access 'formData' before initialization"
const hasPhoto = useMemo(
  () => Boolean(previewURL || formData.photoURL || croppedImage),
  [previewURL, formData.photoURL, croppedImage]
);

const [matchStats, setMatchStats] = useState({ matches: 0, completed: 0, wins: 0 });

// 🔐 Always coerce badges to an array before using .includes
const safeBadges = Array.isArray(formData.badges) ? formData.badges : [];


  useEffect(() => {
  const unsubscribe = onAuthStateChanged(auth, async (currentUser) => {
    if (!currentUser) return;
    setUser(currentUser);

    const userRef = doc(db, "users", currentUser.uid);
    const userSnap = await getDoc(userRef);
    const u = userSnap.exists() ? (userSnap.data() as any) : {};

    setUserRole(typeof u.role === "string" ? u.role : "");
    setCoachInvited(u.coachInvited === true);


    const playerRef = doc(db, "players", currentUser.uid);
    const snap = await getDoc(playerRef);
    const data = snap.data() || {};

    // ⬇️ Add this block
  // Derive band from skillRating or fallback to UTR or legacy level
const ratingNumber =
  typeof data.skillRating === "number" ? data.skillRating :
  typeof data.utr === "number" ? data.utr : null;

const derivedBand: SkillBand | "" =
  (data.skillBand as SkillBand) ||
  (typeof ratingNumber === "number" ? (skillFromUTR(ratingNumber) ?? "") : "") ||
  legacyToBand(data.skillLevel) ||
  "";

setFormData({
  name: data.name || "",
  postcode: data.postcode || "",
  skillBand: derivedBand || "",
  rating: typeof ratingNumber === "number" ? ratingNumber : "",
  availability: data.availability || [],
  isMatchable: typeof data.isMatchable === "boolean" ? data.isMatchable : true,
  bio: data.bio || "",
  photoURL: data.photoURL || "",
  badges: Array.isArray(data.badges) ? data.badges : [],
  birthYear: typeof data.birthYear === "number" ? data.birthYear : "",
  gender: typeof data.gender === "string" ? data.gender : "",
  timestamp: data.timestamp || null,
});


    if (data.photoURL) setPreviewURL(data.photoURL);

    // ✅ Matches = accepted match requests (sent or received)
const acceptedFromQ = query(
  collection(db, "match_requests"),
  where("fromUserId", "==", currentUser.uid),
  where("status", "==", "accepted")
);

const acceptedToQ = query(
  collection(db, "match_requests"),
  where("toUserId", "==", currentUser.uid),
  where("status", "==", "accepted")
);

// Use count aggregation (faster/cheaper than getDocs)
const [acceptedFromCount, acceptedToCount] = await Promise.all([
  getCountFromServer(acceptedFromQ),
  getCountFromServer(acceptedToQ),
]);

const acceptedMatches =
  (acceptedFromCount.data().count ?? 0) + (acceptedToCount.data().count ?? 0);

// ✅ Completed + Wins = from match_history
const historyQ = query(
  collection(db, "match_history"),
  where("players", "array-contains", currentUser.uid)
);

const historySnap = await getDocs(historyQ);

let completed = 0;
let wins = 0;

historySnap.forEach((d) => {
  const m = d.data() as any;
  if (m.completed === true || m.status === "completed") completed++;
  if (m.winnerId === currentUser.uid) wins++;
});

setMatchStats({ matches: acceptedMatches, completed, wins });
setLoading(false);

  });
  return () => unsubscribe();
}, []);


  useEffect(() => {
    setEditMode(searchParams.get("edit") === "true");
  }, [searchParams]);

const handleChange = (e: any) => {
  const { name, value } = e.target;

if (name === "birthYear") {
  const digits = String(value).replace(/\D/g, "").slice(0, 4); // YYYY
  const by = digits === "" ? "" : Number(digits);
  setFormData((prev) => ({ ...prev, birthYear: by }));
  return;
}


  setFormData((prev) => ({ ...prev, [name]: value }));
};


// NEW: UTR field (optional)
const handleRatingChange = (raw: string) => {
  if (raw.trim() === "") {
    setFormData(prev => ({ ...prev, rating: "" }));
    return;
  }
  const n = Number(raw);
  if (Number.isNaN(n)) {
    setFormData(prev => ({ ...prev, rating: "" }));
    return;
  }
  const clamped = clampUTR(n);                 // reusing your existing util
  const derived = skillFromUTR(clamped) ?? ""; // reusing your existing util
  setFormData(prev => ({ ...prev, rating: clamped, skillBand: derived }));
};



  const handleCheckbox = (e: any) => {
    const { value, checked } = e.target;
    setFormData((prev) => ({
      ...prev,
      availability: checked
        ? [...prev.availability, value]
        : prev.availability.filter((v) => v !== value),
    }));
  };

const handleImageChange = (e: ChangeEvent<HTMLInputElement>) => {
  const file = e.target.files?.[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    setImageSrc(reader.result as string);   // sets the image to be cropped
    setShowCropper(true);                   // show the crop popup
  };
  reader.readAsDataURL(file);
};

  const handleCropComplete = (_: any, areaPix: any) => setCroppedAreaPixels(areaPix);

const showCroppedImage = async () => {
  if (!imageSrc || !croppedAreaPixels) return;
  try {
    const blob = await getCroppedImg(imageSrc, croppedAreaPixels);
    const file = new File([blob], "profile.jpg", { type: "image/jpeg" });
    setCroppedImage(file); // Save the cropped file for later upload
    setPreviewURL(URL.createObjectURL(file)); // Show preview in edit mode
    setShowCropper(false); // Close cropper
    // 🚫 Do not call handleSubmit or any save/redirect logic here
  } catch {
    setStatus("❌ Crop failed.");
  }
};

const handleRemovePhoto = async () => {
  try {
    setCroppedImage(null);
    setPreviewURL(null);
    setFormData((p) => ({ ...p, photoURL: "" }));
    // optional: also delete from storage if it exists
    if (user) {
      const refSt = ref(storage, `profile_pictures/${user.uid}/profile.jpg`);
      await deleteObject(refSt).catch(() => {}); // ignore if missing
    }
    setStatus("Photo removed. Please upload a new profile photo before saving.");
  } catch {
    setStatus("Could not remove photo.");
  }
};

const handleActivateCoachProfile = async () => {
  if (!user) return;

  try {
    setSaving(true);
    setStatus("Activating coach profile...");

    const uid = user.uid;

    // If they already have a player profile, make them BOTH so Match Me still works
    const playerSnap = await getDoc(doc(db, "players", uid));
    const nextRole = playerSnap.exists() ? "both" : "coach";

    // 1) Update users doc to grant coach access
    await setDoc(
      doc(db, "users", uid),
      {
        role: nextRole,
        coachInvited: false, // consume invite
        coachActivatedAt: serverTimestamp(),
      },
      { merge: true }
    );

    // 2) Ensure coaches/{uid} exists (create starter doc if missing)
    const coachRef = doc(db, "coaches", uid);
    const coachSnap = await getDoc(coachRef);

    if (!coachSnap.exists()) {
      await setDoc(
        coachRef,
        {
          userId: uid,
          name: formData.name || "",
avatar: formData.photoURL || null,
          mobile: "",
          contactFirstForRate: true,
          coachingExperience: "",
          bio: "",
          playingBackground: "",
          courtAddress: "",
          coachingSkillLevels: [],
          galleryPhotos: [],
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        },
        { merge: true }
      );
    }

    // local state update
    setUserRole(nextRole);
    setCoachInvited(false);

    setStatus("✅ Coach profile activated!");
    router.push("/coach/profile");
  } catch (e: any) {
    console.error(e);
    setStatus(e?.message ?? "❌ Failed to activate coach profile.");
  } finally {
    setSaving(false);
  }
};


  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;

    // Require a profile photo to save
if (!hasPhoto) {
  setStatus("Please add a profile photo to continue.");
  return;
}
    // basic client-side validation
    
if (!formData.name.trim()) {
  setStatus("Please enter your name.");
  return;
}
if (!formData.skillBand) {
  setStatus("Please choose a skill level.");
  return;
}
if (!formData.availability || formData.availability.length === 0) {
  setStatus("Please select at least one availability option.");
  return;
}

// Birth Year validation (18+)
const currentYear = new Date().getFullYear();
const by = typeof formData.birthYear === "number" ? formData.birthYear : null;

if (!by) {
  setStatus("Please enter your birth year.");
  return;
}

const age = currentYear - by;

if (!Number.isFinite(by) || by < 1900 || by > currentYear) {
  setStatus("Please enter a valid birth year (e.g. 1994).");
  return;
}

if (age < 18) {
  setStatus("TennisMate is for adults only (18+).");
  return;
}

if (age > 110) {
  setStatus("Please enter a valid birth year (e.g. 1994).");
  return;
}


// AU postcode (4 digits), VIC + NSW only for now
const trimmedPostcode = formData.postcode.trim();

if (!/^\d{4}$/.test(trimmedPostcode)) {
  setStatus("Enter a valid 4-digit postcode.");
  return;
}

const firstDigit = trimmedPostcode.charAt(0);
if (firstDigit !== "2" && firstDigit !== "3") {
  setStatus(
    "For now TennisMate is only available in VIC and NSW (postcodes starting with 2 or 3)."
  );
  return;
}

    setSaving(true);
    setStatus("Saving...");
    try {
      let photoURL = formData.photoURL;
      if (croppedImage) {
        const refSt = ref(storage, `profile_pictures/${user.uid}/profile.jpg`);
        await uploadBytes(refSt, croppedImage);
        photoURL = await getDownloadURL(refSt);
      }

await setDoc(
  doc(db, "players", user.uid),
  (() => {
    const { rating, ...rest } = formData; // ← strip UI-only field
    const badges = Array.isArray(formData.badges) ? formData.badges : [];

return {
  ...rest,
  badges,
  // canonical fields:
  birthYear: formData.birthYear === "" ? null : formData.birthYear,
  gender: formData.gender || null,

  skillBand: formData.skillBand || null,
  skillBandLabel: toSkillLabel(formData.skillBand),
  skillRating: formData.rating === "" ? null : formData.rating,
  utr: formData.rating === "" ? null : formData.rating, // TEMP mirror
  skillLevel: coarseFromBand(formData.skillBand),

  photoURL,
  nameLower: (formData.name || "").toLowerCase(),
  email: user.email,
  timestamp: serverTimestamp(),
  profileComplete: true,
  isMatchable: !!formData.isMatchable,
};

  })(),
  { merge: true }
);



      setStatus("✅ Profile saved successfully!");
      router.push("/profile");
    } catch {
      setStatus("❌ Error saving profile.");
    } finally {
      setSaving(false);
    }
  };

const handleDeleteProfile = async () => {
  const ok = confirm(
    "Are you sure you want to permanently delete your TennisMate account? This cannot be undone."
  );
  if (!ok) return;

  const uid = auth.currentUser?.uid;
  if (!uid) {
    setStatus("You must be signed in to delete your account.");
    return;
  }

  try {
    setSaving(true);
    setStatus("Deleting your account…");

    console.log("[Profile] delete start", { uid });

    // best-effort storage cleanup
    await deleteObject(
      ref(storage, `profile_pictures/${uid}/profile.jpg`)
    ).catch((e) =>
      console.warn("[Profile] storage delete skipped", e)
    );

    const functions = getFunctionsClient();
    const fn = httpsCallable(functions, "deleteMyAccount");

    const res = await fn();

    console.log("[Profile] delete success", res.data);

    await auth.signOut();
    router.replace("/");
  } catch (err: any) {
    const code = err?.code;
    const message = err?.message;
    const details = err?.details;

    console.error("[Profile] delete FAILED", {
      code,
      message,
      details,
    });

    setStatus(
      `❌ Delete failed${
        details?.runId ? ` (ref ${details.runId})` : ""
      }`
    );
  } finally {
    setSaving(false);
  }
};




  if (loading) return <p className="p-6">Loading...</p>;

  return (
    <div className="relative mx-auto max-w-3xl p-4 sm:p-6 space-y-5 pb-28 overflow-x-hidden bg-gradient-to-b from-emerald-50/60 to-white">
      {!editMode ? (
        <>
          {/* HERO HEADER */}
          <section className="relative overflow-hidden rounded-2xl border border-gray-200 bg-gradient-to-b from-white to-emerald-50 p-5 sm:p-6 shadow-sm text-center">
            <span className="pointer-events-none absolute -top-10 -right-10 h-28 w-28 rounded-full bg-emerald-200/40 blur-2xl" />
            <span className="pointer-events-none absolute -bottom-8 -left-8 h-24 w-24 rounded-full bg-emerald-100/60 blur-2xl" />

          <img
  src={previewURL || "/default-avatar.png"}
  alt={`${formData.name || "User"} avatar`}
  className="h-24 w-24 rounded-full object-cover ring-4 ring-white"
  onError={() => {
    console.warn("[Profile] avatar failed to load:", previewURL);
    setPreviewURL(null);
    setFormData((p) => ({ ...p, photoURL: "" }));
  }}
/>

            <h1 className="mt-3 text-2xl sm:text-3xl font-bold break-words">
              {formData.name || "Your Name"}
            </h1>

            <div className="mt-1 flex flex-wrap items-center justify-center gap-2 text-sm text-gray-600">
              <span className="rounded-full border border-emerald-200 bg-emerald-50 text-emerald-700 px-2.5 py-0.5">
                Skill: {getSkillLabel(formData.skillBand)}
              </span>
             {typeof formData.rating === "number" && (
  <span className="rounded-full border border-emerald-200 bg-emerald-50 text-emerald-700 px-2.5 py-0.5">
    TMR {formData.rating.toFixed(2)}
  </span>
)}
              {formData.postcode && (
                <span className="rounded-full border border-emerald-200 bg-emerald-50 text-emerald-700 px-2.5 py-0.5">
                  Postcode {formData.postcode}
                </span>
              )}
            </div>

{/* Age + Gender pills (above email) */}
{(typeof derivedAge === "number" && derivedAge > 0) || !!formData.gender ? (
  <div className="mt-2 flex flex-wrap items-center justify-center gap-2 text-sm text-gray-600">
    {typeof derivedAge === "number" && derivedAge > 0 && (
      <span className="rounded-full border border-emerald-200 bg-emerald-50 text-emerald-700 px-2.5 py-0.5">
        Age {derivedAge}
      </span>
    )}

    {formData.gender && (
      <span className="rounded-full border border-emerald-200 bg-emerald-50 text-emerald-700 px-2.5 py-0.5">
        {formData.gender}
      </span>
    )}
  </div>
) : null}


{/* Email (now below age/gender) */}
{user?.email && (
  <p className="mt-1 text-sm text-gray-500">
    <a href={`mailto:${user.email}`} className="hover:underline">
      {user.email}
    </a>
  </p>
)}



            {formData.bio && (
              <>
                <p
                  className={`mx-auto mt-3 text-[15px] text-gray-700 leading-relaxed ${
                    bioExpanded ? "" : "line-clamp-3"
                  } max-w-prose`}
                >
                  {formData.bio}
                </p>
                {formData.bio.length > 160 && (
                  <button
                    type="button"
                    onClick={() => setBioExpanded(v => !v)}
                    className="mt-1 text-sm text-gray-600 underline"
                  >
                    {bioExpanded ? "Show less" : "Read more"}
                  </button>
                )}
              </>
            )}

            <div className="mt-3 flex items-center justify-center gap-2">
              <button
                type="button"
                onClick={() => router.push("/profile?edit=true")}
                className="inline-flex items-center gap-2 rounded-xl border px-3 py-2 text-sm font-semibold hover:bg-gray-50"
                aria-label="Edit profile"
              >
                <Edit2 size={16} /> Edit Profile
              </button>
            </div>
          </section>

          {/* STATS GRID */}
          <section className="grid grid-cols-3 gap-3" aria-labelledby="stats-heading">
            <h2 id="stats-heading" className="sr-only">Profile statistics</h2>

            <button
              type="button"
              onClick={() => router.push("/matches")}
              className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm text-center hover:bg-emerald-50/40 focus:outline-none focus:ring-2 focus:ring-emerald-600"
              aria-label="View matches"
            >
              <div className="mx-auto mb-2 flex h-8 w-8 items-center justify-center rounded-full bg-emerald-100 text-emerald-700">
                <CalendarDays className="h-4 w-4" />
              </div>
              <div className="text-2xl font-bold tabular-nums">{matchStats.matches ?? 0}</div>
              <div className="mt-1 text-sm text-gray-700">Accepted Matches</div>
            </button>

            <button
              type="button"
              onClick={() => router.push("/matches?tab=completed")}
              className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm text-center hover:bg-emerald-50/40 focus:outline-none focus:ring-2 focus:ring-emerald-600"
              aria-label="View completed matches"
            >
              <div className="mx-auto mb-2 flex h-8 w-8 items-center justify-center rounded-full bg-emerald-100 text-emerald-700">
                <CheckCircle2 className="h-4 w-4" />
              </div>
              <div className="text-2xl font-bold tabular-nums">{matchStats.completed ?? 0}</div>
              <div className="mt-1 text-sm text-gray-700">Completed</div>
            </button>

            <button
              type="button"
              onClick={() => router.push("/matches?tab=wins")}
              className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm text-center hover:bg-emerald-50/40 focus:outline-none focus:ring-2 focus:ring-emerald-600"
              aria-label="View wins"
            >
              <div className="mx-auto mb-2 flex h-8 w-8 items-center justify-center rounded-full bg-emerald-100 text-emerald-700">
                <Trophy className="h-4 w-4" />
              </div>
              <div className="text-2xl font-bold tabular-nums">{matchStats.wins ?? 0}</div>
              <div className="mt-1 text-sm text-gray-700">Wins</div>
            </button>
          </section>

          {/* AVAILABILITY */}
          <section className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm" aria-labelledby="availability-heading">
            <h2 id="availability-heading" className="text-lg font-semibold">Availability</h2>
            {formData.availability?.length ? (
              <div className="mt-2 flex flex-wrap gap-2">
                {formData.availability.map((slot) => (
                  <button
                    key={slot}
                    type="button"
                    onClick={() => router.push(`/match?availability=${encodeURIComponent(slot)}`)}
                    className="rounded-full border border-emerald-200 bg-emerald-50 text-emerald-800 px-3 py-1 text-sm hover:bg-emerald-100 focus:outline-none focus:ring-2 focus:ring-emerald-600"
                  >
                    {slot}
                  </button>
                ))}
              </div>
            ) : (
              <p className="mt-2 text-sm text-gray-600">No availability set.</p>
            )}
          </section>


      {/* COACH (invite-only) */}
{canSeeCoachingSection && (
  <section className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
    <h2 className="text-lg font-semibold">Coaching</h2>
    <p className="mt-1 text-sm text-gray-600">
      Offer lessons and appear in the coach directory.
    </p>

    <div className="mt-3 flex flex-wrap gap-2">
      {(userRole === "coach" || userRole === "both") ? (
        <button
          type="button"
          onClick={() => router.push("/coach/profile")}
          className="rounded-xl bg-green-600 px-3 py-2 text-sm font-semibold text-white shadow hover:bg-green-700"
        >
          Edit Coach Profile
        </button>
      ) : coachInvited ? (
        <button
          type="button"
          onClick={handleActivateCoachProfile}
          disabled={saving}
          className="rounded-xl bg-green-600 px-3 py-2 text-sm font-semibold text-white shadow hover:bg-green-700 disabled:opacity-60"
        >
          {saving ? "Activating..." : "Activate Coach Profile"}
        </button>
      ) : null}
    </div>
  </section>
)}

         {/* Coach-only: Match Me availability status (view mode) */}
{(userRole === "coach" || userRole === "both") && (
  <section className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
    <div className="flex items-start justify-between gap-4">
      <div>
        <h2 className="text-lg font-semibold">Matchmaking availability</h2>
        <p className="mt-1 text-sm text-gray-600">
          This controls whether your player profile appears in Match Me suggestions.
        </p>
      </div>

      <span
        className={[
          "inline-flex items-center rounded-full px-2.5 py-1 text-xs font-semibold border",
          formData.isMatchable
            ? "bg-emerald-50 text-emerald-800 border-emerald-200"
            : "bg-gray-50 text-gray-700 border-gray-200",
        ].join(" ")}
      >
        {formData.isMatchable ? "Available" : "Not available"}
      </span>
    </div>

    <div className="mt-3 text-xs text-gray-600">
      Status:{" "}
      <strong className={formData.isMatchable ? "text-emerald-700" : "text-gray-700"}>
        {formData.isMatchable ? "Visible in Match Me" : "Hidden from Match Me"}
      </strong>
    </div>

    <div className="mt-4">
      <button
        type="button"
        onClick={() => router.push("/profile?edit=true")}
        className="rounded-xl border px-3 py-2 text-sm font-semibold hover:bg-gray-50"
      >
        Change availability
      </button>
    </div>
  </section>
)}


{/* BADGES */}
<section className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm" aria-labelledby="badges-heading">
  <h2 id="badges-heading" className="text-lg font-semibold">Badges</h2>
  <div className="mt-3 grid grid-cols-2 sm:grid-cols-4 gap-4 text-center">
    <div className="rounded-xl border border-gray-200 bg-white p-3 hover:bg-gray-50" title="Thanks for being part of the MVP launch!">
      <img src="/badges/mvp-badge.svg" width={64} height={64} alt="MVP Launch" className="mx-auto" />
      <span className="text-xs mt-1 block">MVP Launch</span>
    </div>

    <div className="rounded-xl border border-gray-200 bg-white p-3 hover:bg-gray-50" title="Complete your first match">
      <img
        src={safeBadges.includes("firstMatch") ? "/badges/first-match.svg" : "/badges/first-match-locked.svg"}
        alt="First Match"
        width={64}
        height={64}
        className={`mx-auto ${safeBadges.includes("firstMatch") ? "" : "opacity-40"}`}
      />
      <span className="text-xs mt-1 block">First Match</span>
    </div>

    <div className="rounded-xl border border-gray-200 bg-white p-3 hover:bg-gray-50" title="Finish your first completed match">
      <img
        src={safeBadges.includes("firstMatchComplete") ? "/badges/first-match-complete.svg" : "/badges/first-match-complete-locked.svg"}
        alt="First Match Complete"
        width={64}
        height={64}
        className={`mx-auto ${safeBadges.includes("firstMatchComplete") ? "" : "opacity-40"}`}
      />
      <span className="text-xs mt-1 block">First Match Complete</span>
    </div>

    <div className="rounded-xl border border-gray-200 bg-white p-3 hover:bg-gray-50" title="Win your first match">
      <img
        src={safeBadges.includes("firstWin") ? "/badges/first-win.svg" : "/badges/first-win-locked.svg"}
        alt="First Win"
        width={64}
        height={64}
        className={`mx-auto ${safeBadges.includes("firstWin") ? "" : "opacity-40"}`}
      />
      <span className="text-xs mt-1 block">First Win</span>
    </div>
  </div>
</section>


        </>
      ) : (
        <>
          <section className="rounded-2xl border bg-white p-5 sm:p-6 shadow-sm">
            <h2 className="text-lg font-semibold mb-4">Edit profile</h2>

          <form id="editProfile" onSubmit={handleSubmit} className="space-y-5">
  {/* Name */}
  <div>
    <label className="block text-sm font-medium text-gray-800">
      Name <span className="text-red-600">*</span>
    </label>
    <input
      name="name"
      required
      value={formData.name}
      onChange={handleChange}
      className="mt-1 w-full rounded-xl border px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-green-600 bg-white"
    />
  </div>

  {/* Postcode */}
  <div>
    <label className="block text-sm font-medium text-gray-800">
      Postcode <span className="text-red-600">*</span>
    </label>
    <input
      name="postcode"
      inputMode="numeric"
      pattern="[0-9]{4}"
      placeholder="4-digit postcode"
      value={formData.postcode}
      onChange={handleChange}
      className="mt-1 w-full rounded-xl border px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-green-600 bg-white"
    />
    <p className="mt-1 text-xs text-gray-500">
  Australian 4-digit format (e.g. 3000). We currently support VIC &amp; NSW (postcodes starting with 2 or 3).
</p>

  </div>

  {/* Age + Gender */}
<div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
<div>
  <label className="block text-sm font-medium text-gray-800">
    Birth Year <span className="text-red-600">*</span>
  </label>
  <input
    name="birthYear"
    type="text"
    inputMode="numeric"
    placeholder="e.g. 1994"
    value={formData.birthYear === "" ? "" : String(formData.birthYear)}
    onChange={handleChange}
    maxLength={4}
    required
    className="mt-1 w-full rounded-xl border px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-green-600 bg-white"
  />
  <p className="mt-1 text-xs text-gray-500">
    Used to confirm you’re 18+ and improve matchmaking. Not shown publicly.
  </p>
</div>


  <div>
    <label className="block text-sm font-medium text-gray-800">
      Gender
    </label>
    <select
      name="gender"
      value={formData.gender}
      onChange={handleChange}
      className="mt-1 w-full rounded-xl border px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-green-600 bg-white"
    >
      <option value="">Prefer not to say</option>
      <option value="Male">Male</option>
      <option value="Female">Female</option>
      <option value="Non-binary">Non-binary</option>
      <option value="Other">Other</option>
    </select>
    <p className="mt-1 text-xs text-gray-500">Optional.</p>
  </div>
</div>


  {/* Skill level */}
  <div>
    <label className="block text-sm font-medium text-gray-800">
      Skill Level <span className="text-red-600">*</span>
    </label>
    <select
      name="skillBand"
      required
      value={formData.skillBand}
      onChange={(e) => setFormData(prev => ({ ...prev, skillBand: e.target.value as SkillBand }))}
      className="mt-1 w-full rounded-xl border px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-green-600 bg-white"
    >
      <option value="" disabled>Select your level…</option>
      {SKILL_OPTIONS_SAFE.map(o => (
        <option key={o.value} value={o.value}>{o.label}</option>
      ))}
    </select>

{typeof formData.rating === "number" && (
  <p className="mt-1 text-xs text-gray-500">
    Based on TMR {formData.rating.toFixed(2)}, suggested level is{" "}
    <strong>
      {(Array.isArray(SKILL_OPTIONS) ? SKILL_OPTIONS : [])
        .find(s => s.value === (
          skillFromUTR(typeof formData.rating === "number" ? formData.rating : undefined) ?? ""
          ))?.label ?? "—"}
    </strong>.
  </p>
)}


  </div>

  {/* UTR (optional) */}
  <div>
    <label className="block text-sm font-medium text-gray-800">
  {RATING_LABEL} (optional)
</label>
<input
  type="number"
  step="0.01"
  min={1}
  max={16.5}
  inputMode="decimal"
  placeholder="e.g., 6.20"
  value={formData.rating}
  onChange={(e) => handleRatingChange(e.target.value)}
  className="mt-1 w-full rounded-xl border px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-green-600 bg-white"
/>
<p className="mt-1 text-xs text-gray-500">
  1.00–16.50. Comparable to UTR® (TennisMate is not affiliated with Universal Tennis).
</p>
  </div>

  {/* Availability */}
  <fieldset>
    <legend className="block text-sm font-medium text-gray-800">
  Availability <span className="text-red-600">*</span>
</legend>

    <div className="mt-1 grid grid-cols-1 sm:grid-cols-2 gap-1">
      {["Weekdays AM","Weekdays PM","Weekends AM","Weekends PM"].map((slot) => (
        <label key={slot} className="flex items-center gap-2 text-sm py-1">
          <input
            type="checkbox"
            value={slot}
            checked={formData.availability.includes(slot)}
            onChange={handleCheckbox}
            className="h-4 w-4"
          />
          {slot}
        </label>
      ))}
    </div>
  </fieldset>

  {/* Match Me visibility */}
<div className="rounded-2xl border border-gray-200 bg-white p-4">
  <div className="flex items-start justify-between gap-4">
    <div>
      <div className="text-sm font-semibold text-gray-800">Match Me visibility</div>
      <p className="mt-1 text-xs text-gray-500">
        Turn this off to hide your player profile from Match Me suggestions.
      </p>
    </div>

    <button
      type="button"
      onClick={() =>
        setFormData((p) => ({ ...p, isMatchable: !p.isMatchable }))
      }
      className={[
        "relative inline-flex h-7 w-12 items-center rounded-full transition",
        formData.isMatchable ? "bg-green-600" : "bg-gray-300",
      ].join(" ")}
      aria-pressed={formData.isMatchable}
      aria-label="Toggle Match Me visibility"
    >
      <span
        className={[
          "inline-block h-5 w-5 transform rounded-full bg-white transition",
          formData.isMatchable ? "translate-x-6" : "translate-x-1",
        ].join(" ")}
      />
    </button>
  </div>

  <div className="mt-2 text-xs">
    Status:{" "}
    <span className={formData.isMatchable ? "text-green-700 font-semibold" : "text-gray-700 font-semibold"}>
      {formData.isMatchable ? "Visible in Match Me" : "Hidden from Match Me"}
    </span>
  </div>
</div>


  {/* Bio */}
  <div>
    <label className="block text-sm font-medium text-gray-800">Bio</label>
    <textarea
      name="bio"
      rows={5}
      maxLength={300}
      placeholder="Tell others about your game, favorite courts, preferred times…"
      value={formData.bio}
      onChange={handleChange}
      className="mt-1 w-full min-h-[8rem] resize-y rounded-xl border px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-green-600 bg-white"
    />
    <div className="mt-1 text-xs text-gray-500">{formData.bio.length}/300</div>
  </div>

  {/* Photo (required) */}
<div>
  <label className="block text-sm font-medium text-gray-800">
    Profile Photo <span className="text-red-600">*</span>
  </label>

  <div className="mt-1 flex items-center gap-4">
    {previewURL ? (
      <img
        src={previewURL}
        className="h-20 w-20 rounded-full object-cover ring-2 ring-gray-200"
        alt="Preview"
      />
    ) : (
      <div
        className={`h-20 w-20 rounded-full ring-2 ${
          hasPhoto ? "bg-gray-100 ring-gray-200" : "bg-red-50 ring-red-200"
        }`}
        aria-label="No profile photo selected"
      />
    )}

    <div className="flex flex-wrap gap-2 items-center">
      <label
        htmlFor="upload"
        className="cursor-pointer inline-block rounded-xl bg-green-600 text-white px-3 py-2 text-sm font-semibold shadow hover:bg-green-700"
      >
        Choose Photo
      </label>
      <input
        id="upload"
        type="file"
        accept="image/*"
        onChange={handleImageChange}
        className="hidden"
      />

      {previewURL && (
        <button
          type="button"
          onClick={handleRemovePhoto}
          className="rounded-xl border px-3 py-2 text-sm hover:bg-gray-50"
        >
          Remove Photo
        </button>
      )}

      {!hasPhoto && (
        <span className="text-xs text-red-700 bg-red-50 border border-red-200 rounded px-2 py-1">
          A profile photo is required to save.
        </span>
      )}
    </div>
  </div>
</div>

</form>

          </section>

          {/* Cropper modal */}
          {showCropper && imageSrc && (
            <div className="fixed inset-0 bg-white/80 backdrop-blur-sm flex items-center justify-center z-50">
              <div className="bg-white rounded-xl shadow-lg p-4 flex flex-col items-center justify-center w-[340px]">
                <div className="relative w-[300px] h-[300px]">
                  <Cropper
                    image={imageSrc}
                    crop={crop}
                    zoom={zoom}
                    aspect={1}
                    cropShape="round"
                    showGrid={true}
                    onCropChange={setCrop}
                    onZoomChange={setZoom}
                    onCropComplete={handleCropComplete}
                  />
                </div>
                <div className="mt-4 flex gap-2">
                  <button
                    type="button"
                    onClick={showCroppedImage}
                    className="rounded-xl bg-green-600 px-4 py-2 text-white text-sm font-semibold shadow hover:bg-green-700"
                  >
                    {/* prevents form submit */}
                    Confirm Crop
                  </button>
                  <button
                    type="button"
                    onClick={() => setShowCropper(false)}
                    className="rounded-xl border px-3 py-2 text-sm hover:bg-gray-50"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            </div>
          )}

        {/* Actions + danger zone */}
<section className="mt-4 rounded-2xl border bg-white p-5 sm:p-6 shadow-sm">
  <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
    <div className="flex items-center gap-3">
      <button
        type="button"
        onClick={() => router.push("/profile")}
        className="text-sm text-gray-600 underline hover:text-gray-900"
      >
        Cancel
      </button>
      <button
  form="editProfile"
  type="submit"
  disabled={
  saving ||
  !hasPhoto ||
  formData.availability.length === 0 ||
  formData.birthYear === ""
}

 title={
  !hasPhoto
    ? "Add a profile photo to enable Save"
    : formData.availability.length === 0
    ? "Select at least one availability option to enable Save"
    : formData.birthYear === ""
    ? "Enter your birth year to enable Save"
    : undefined
}

  className="rounded-xl bg-green-600 px-3 py-2 text-sm font-semibold text-white shadow hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed"
>
  {saving ? "Saving…" : "Save Profile"}
</button>


    </div>

    <div className="text-right">
      <p className="text-xs font-medium text-red-700">Danger zone</p>
      <p className="mt-0.5 text-[11px] leading-4 text-gray-600">
        Permanently delete your profile and data.
      </p>
      <button
        type="button"
        onClick={handleDeleteProfile}
        className="mt-1.5 rounded-lg border border-red-200 bg-red-50 px-2 py-1 text-xs font-semibold text-red-700 hover:bg-red-100"
      >
        Delete Profile
      </button>
    </div>
  </div>
</section>

        </>
      )}

      {status && <p className="text-sm mt-2">{status}</p>}
    </div>
  );
}
