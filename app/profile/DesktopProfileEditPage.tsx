"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { onAuthStateChanged, updateProfile } from "firebase/auth";
import {
  doc,
  getDoc,
  setDoc,
  serverTimestamp,
} from "firebase/firestore";
import { ref, uploadBytes, getDownloadURL, deleteObject } from "firebase/storage";
import { auth, db, storage } from "@/lib/firebaseConfig";
import {
  PROFILE_FULL_PATH,
  PROFILE_THUMB_PATH,
  cleanupLegacyProfilePhotos,
  resolveProfilePhoto,
} from "@/lib/profilePhoto";

import TMDesktopSidebar from "@/components/desktop_layout/TMDesktopSidebar";
import type { SkillBand } from "@/lib/skills";
import { SKILL_OPTIONS, skillFromUTR, clampUTR } from "@/lib/skills";

import Cropper from "react-easy-crop";
import getCroppedImg from "../utils/cropImage";
import type { ChangeEvent } from "react";
import { geohashForLocation } from "geofire-common";
import { httpsCallable } from "firebase/functions";
import { getFunctionsClient } from "@/lib/getFunctionsClient";

const TM = {
  forest: "#0B3D2E",
  forestDark: "#071B15",
  neon: "#39FF14",
  cream: "#F5F5F0",
  tile: "#FFFFFF",
  border: "rgba(11,61,46,0.12)",
  sub: "rgba(11,61,46,0.72)",
};

const SKILL_OPTIONS_SAFE =
  Array.isArray(SKILL_OPTIONS) && SKILL_OPTIONS.length > 0
    ? SKILL_OPTIONS
    : ([
        { value: "beginner", label: "Beginner" },
        { value: "intermediate", label: "Intermediate" },
        { value: "advanced", label: "Advanced" },
      ] as Array<{ value: SkillBand; label: string }>);

const toSkillLabel = (band: SkillBand | "" | undefined): string | null => {
  if (!band) return null;
  const fromOptions = SKILL_OPTIONS_SAFE.find((o) => o.value === band)?.label;
  if (fromOptions) return fromOptions;
  return String(band).charAt(0).toUpperCase() + String(band).slice(1);
};

const coarseFromBand = (b?: SkillBand | "") =>
  !b ? "" : b.includes("beginner") ? "Beginner" : b.includes("intermediate") ? "Intermediate" : "Advanced";

const legacyToBand = (level?: string): SkillBand | "" => {
  if (!level) return "";
  const norm = level.toLowerCase();
  if (norm.includes("beginner")) return "beginner";
  if (norm.includes("intermediate")) return "intermediate";
  if (norm.includes("advanced") || norm.includes("advance")) return "advanced";
  return "";
};

const AVAILABILITY_OPTIONS = [
  "Weekdays AM",
  "Weekdays PM",
  "Weekends AM",
  "Weekends PM",
] as const;

type AvailabilityKey = (typeof AVAILABILITY_OPTIONS)[number];

function normalizeAvailability(raw: any): AvailabilityKey[] {
  const arr = Array.isArray(raw) ? raw : [];
  const set = new Set(arr.map((s) => String(s).trim()));
  return AVAILABILITY_OPTIONS.filter((k) => set.has(k));
}

export default function DesktopProfileEditPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState("");

    const [deletingAccount, setDeletingAccount] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);


  const [user, setUser] = useState<any>(null);

  const originalPostcodeRef = useRef<string>("");

  const [imageSrc, setImageSrc] = useState<string | null>(null);
  const [croppedImage, setCroppedImage] = useState<File | null>(null);
  const [previewURL, setPreviewURL] = useState<string | null>(null);
  const [crop, setCrop] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [croppedAreaPixels, setCroppedAreaPixels] = useState<any>(null);
  const [showCropper, setShowCropper] = useState(false);

const [formData, setFormData] = useState({
  name: "",
  postcode: "",
  skillBand: "" as SkillBand | "",
  rating: "" as number | "",
  availability: [] as string[],
  bio: "",
  photoURL: "",
  photoThumbURL: "",
  birthYear: "" as number | "",
  gender: "",
  isMatchable: true,
  badges: [] as string[],
});

  const hasPhoto = useMemo(
    () => Boolean(previewURL || formData.photoURL || croppedImage),
    [previewURL, formData.photoURL, croppedImage]
  );

  const derivedAge = useMemo(() => {
    if (typeof formData.birthYear !== "number") return null;
    const age = new Date().getFullYear() - formData.birthYear;
    if (!Number.isFinite(age) || age < 0 || age > 120) return null;
    return age;
  }, [formData.birthYear]);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (u) => {
      if (!u) return;
      setUser(u);

      const playerRef = doc(db, "players", u.uid);
      const privatePlayerRef = doc(db, "players_private", u.uid);
      const [snap, privateSnap] = await Promise.all([
        getDoc(playerRef),
        getDoc(privatePlayerRef),
      ]);
      const data = snap.exists() ? (snap.data() as any) : {};
      const privateData = privateSnap.exists() ? (privateSnap.data() as any) : {};

      const ratingNumber =
        typeof data.skillRating === "number"
          ? data.skillRating
          : typeof data.utr === "number"
          ? data.utr
          : null;

      const derivedBand: SkillBand | "" =
        (data.skillBand as SkillBand) ||
        (typeof ratingNumber === "number" ? (skillFromUTR(ratingNumber) ?? "") : "") ||
        legacyToBand(data.skillLevel) ||
        "";

setFormData({
  name: data.name || "",
  postcode: privateData.postcode || data.postcode || "",
  skillBand: derivedBand || "",
  rating: typeof ratingNumber === "number" ? ratingNumber : "",
  availability: normalizeAvailability(data.availability),
  bio: data.bio || "",
  photoURL: typeof data.photoURL === "string" ? data.photoURL : "",
  photoThumbURL: resolveProfilePhoto(data) || "",
  birthYear: typeof privateData.birthYear === "number" ? privateData.birthYear : "",
  gender: typeof data.gender === "string" ? data.gender : "",
  isMatchable: typeof data.isMatchable === "boolean" ? data.isMatchable : true,
  badges: Array.isArray(data.badges) ? data.badges : [],
});

      originalPostcodeRef.current = String(privateData.postcode || data.postcode || "").trim();
      const currentPhoto = resolveProfilePhoto(data);
      if (currentPhoto) setPreviewURL(currentPhoto);

      setLoading(false);
    });

    return () => unsub();
  }, []);

  const handleChange = (e: any) => {
    const { name, value } = e.target;

    if (name === "birthYear") {
      const digits = String(value).replace(/\D/g, "").slice(0, 4);
      const by = digits === "" ? "" : Number(digits);
      setFormData((prev) => ({ ...prev, birthYear: by }));
      return;
    }

    setFormData((prev) => ({ ...prev, [name]: value }));
  };

  const handleRatingChange = (raw: string) => {
    if (raw.trim() === "") {
      setFormData((prev) => ({ ...prev, rating: "" }));
      return;
    }
    const n = Number(raw);
    if (Number.isNaN(n)) {
      setFormData((prev) => ({ ...prev, rating: "" }));
      return;
    }
    const clamped = clampUTR(n);
    const derived = skillFromUTR(clamped) ?? "";
    setFormData((prev) => ({ ...prev, rating: clamped, skillBand: derived as SkillBand }));
  };

  const handleCheckbox = (slot: string) => {
    setFormData((prev) => ({
      ...prev,
      availability: prev.availability.includes(slot)
        ? prev.availability.filter((v) => v !== slot)
        : [...prev.availability, slot],
    }));
  };

  const handleImageChange = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      setImageSrc(reader.result as string);
      setShowCropper(true);
    };
    reader.readAsDataURL(file);
  };

  const handleCropComplete = (_: any, areaPix: any) => setCroppedAreaPixels(areaPix);

  const showCroppedImage = async () => {
    if (!imageSrc || !croppedAreaPixels) return;
    try {
      const blob = await getCroppedImg(imageSrc, croppedAreaPixels);
      const file = new File([blob], "profile.jpg", { type: "image/jpeg" });
      setCroppedImage(file);
      setPreviewURL(URL.createObjectURL(file));
      setShowCropper(false);
    } catch {
      setStatus("❌ Crop failed.");
    }
  };

const handleRemovePhoto = async () => {
  try {
    setCroppedImage(null);
    setPreviewURL(null);
    setFormData((p) => ({ ...p, photoURL: "", photoThumbURL: "" }));
    setStatus("Photo removed. Please upload a new one before saving.");
  } catch {
    setStatus("Could not remove photo.");
  }
};

  const getLatLngForPostcode = async (postcode: string): Promise<{ lat: number; lng: number }> => {
    const pcRef = doc(db, "postcodes", postcode.trim());
    const pcSnap = await getDoc(pcRef);
    if (!pcSnap.exists()) throw new Error("POSTCODE_NOT_FOUND");
    const data = pcSnap.data() as any;
    if (typeof data.lat !== "number" || typeof data.lng !== "number") throw new Error("POSTCODE_BAD_COORDS");
    return { lat: data.lat, lng: data.lng };
  };

   const handleDeleteAccount = async () => {
  setDeleteError(null);

  const ok = window.confirm(
    "Are you sure you want to permanently delete your TennisMate account? This cannot be undone."
  );
  if (!ok) return;

  const uid = auth.currentUser?.uid;
  if (!uid) {
    setDeleteError("You must be signed in to delete your account.");
    return;
  }

  try {
    setDeletingAccount(true);

    // Best-effort storage cleanup (same pattern as ProfileContent)
    await deleteObject(ref(storage, PROFILE_FULL_PATH(uid))).catch(() => {});
    await deleteObject(ref(storage, PROFILE_THUMB_PATH(uid))).catch(() => {});
    await cleanupLegacyProfilePhotos(storage, uid);

    // ✅ Use existing callable
    const fn = httpsCallable(getFunctionsClient(), "deleteMyAccount");
    await fn();

    await auth.signOut();
    router.replace("/");
  } catch (err: any) {
    console.error("[DesktopProfileEditPage] delete FAILED", err);

    const details = err?.details;
    setDeleteError(`❌ Delete failed${details?.runId ? ` (ref ${details.runId})` : ""}`);
  } finally {
    setDeletingAccount(false);
  }
};


  const saveProfile = async () => {
    if (!user) return;

    if (!hasPhoto) return setStatus("Please add a profile photo to continue.");
    if (!formData.name.trim()) return setStatus("Please enter your name.");
    if (!formData.skillBand) return setStatus("Please choose a skill level.");
    if (!formData.availability?.length) return setStatus("Please select at least one availability option.");

    const currentYear = new Date().getFullYear();
    const by = typeof formData.birthYear === "number" ? formData.birthYear : null;
    if (!by) return setStatus("Please enter your birth year.");
    const age = currentYear - by;
    if (!Number.isFinite(by) || by < 1900 || by > currentYear) return setStatus("Please enter a valid birth year.");
    if (age < 18) return setStatus("TennisMate is for adults only (18+).");

    const trimmedPostcode = formData.postcode.trim();
    if (!/^\d{4}$/.test(trimmedPostcode)) return setStatus("Enter a valid 4-digit postcode.");
    const firstDigit = trimmedPostcode.charAt(0);
    if (firstDigit !== "2" && firstDigit !== "3") return setStatus("VIC & NSW only (2xxx/3xxx).");

    const newPostcode = trimmedPostcode;
    const oldPostcode = (originalPostcodeRef.current || "").trim();
    const postcodeChanged = newPostcode !== oldPostcode;

    setSaving(true);
    setStatus("Saving...");

    try {
      let nextLat: number | null = null;
      let nextLng: number | null = null;
      let nextGeohash: string | null = null;

      if (postcodeChanged) {
        const { lat, lng } = await getLatLngForPostcode(newPostcode);
        nextLat = lat;
        nextLng = lng;
        nextGeohash = geohashForLocation([lat, lng]);
      }

let photoURL = formData.photoURL;
let photoThumbURL = formData.photoThumbURL || formData.photoURL;

if (croppedImage) {
  const fullRef = ref(storage, PROFILE_FULL_PATH(user.uid));
  const thumbRef = ref(storage, PROFILE_THUMB_PATH(user.uid));
  await uploadBytes(fullRef, croppedImage, { contentType: "image/jpeg" });
  await uploadBytes(thumbRef, croppedImage, { contentType: "image/jpeg" });
  photoURL = await getDownloadURL(fullRef);
  photoThumbURL = await getDownloadURL(thumbRef);
  await cleanupLegacyProfilePhotos(storage, user.uid);
}

const playerPayload = {
  name: formData.name || "",
  postcode: newPostcode,
  bio: formData.bio || "",
  availability: formData.availability || [],
  gender: formData.gender || null,
  isMatchable: !!formData.isMatchable,
  badges: Array.isArray(formData.badges) ? formData.badges : [],

  skillBand: formData.skillBand || null,
  skillBandLabel: toSkillLabel(formData.skillBand),
  skillRating: formData.rating === "" ? null : formData.rating,
  utr: formData.rating === "" ? null : formData.rating,
  skillLevel: coarseFromBand(formData.skillBand),
  ...(postcodeChanged ? { lat: nextLat, lng: nextLng, geohash: nextGeohash } : {}),

  photoURL,
  photoThumbURL,
  nameLower: (formData.name || "").toLowerCase(),
  timestamp: serverTimestamp(),
  profileComplete: true,
};

const privatePlayerPayload = {
  email: user.email || "",
  postcode: newPostcode,
  birthYear: formData.birthYear === "" ? null : formData.birthYear,
  ...(postcodeChanged ? { lat: nextLat, lng: nextLng, geohash: nextGeohash } : {}),
  updatedAt: serverTimestamp(),
};

const userPayload = {
  name: formData.name || "",
  photoURL,
  photoThumbURL,
  avatar: photoThumbURL || photoURL || null,
  updatedAt: serverTimestamp(),
};

await Promise.all([
  setDoc(
    doc(db, "players", user.uid),
    {
      ...playerPayload,
      avatar: photoThumbURL || photoURL || null,
      photoUpdatedAt: serverTimestamp(),
    },
    { merge: true }
  ),
  setDoc(doc(db, "players_private", user.uid), privatePlayerPayload, { merge: true }),
  setDoc(doc(db, "users", user.uid), userPayload, { merge: true }),
]);

if (auth.currentUser) {
  await updateProfile(auth.currentUser, {
    photoURL: photoThumbURL || photoURL || null,
    displayName: formData.name || auth.currentUser.displayName || null,
  }).catch((error) => {
    console.warn("[DesktopProfileEdit] auth profile sync skipped", error);
  });
}

      setFormData((p) => ({
  ...p,
  postcode: newPostcode,
  photoURL,
  photoThumbURL,
}));
setPreviewURL(photoURL);
      originalPostcodeRef.current = newPostcode;

      setStatus("✅ Saved!");
      router.push("/profile");
    } catch (e) {
      console.error(e);
      setStatus("❌ Error saving profile.");
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return <div className="min-h-screen w-full" style={{ background: TM.cream }} />;
  }

  return (
    <div className="min-h-screen w-full" style={{ background: TM.cream }}>
      <div className="w-full px-8 py-6 2xl:px-12">
        <div className="grid grid-cols-[280px_minmax(0,1fr)_360px] gap-6 items-start">
         {/* LEFT */}
<aside className="sticky top-6 self-start">
  <TMDesktopSidebar active="Profile" player={null} />

  {/* Danger Zone (Delete Account) */}
  <div className="mt-4 rounded-2xl border p-4"
    style={{
      background: "rgba(239, 68, 68, 0.06)",
      borderColor: "rgba(239, 68, 68, 0.25)",
    }}
  >
    <div className="text-xs font-extrabold" style={{ color: "rgb(185, 28, 28)" }}>
      Danger zone
    </div>

    <div className="mt-1 text-[11px] font-semibold" style={{ color: "rgba(11,61,46,0.65)" }}>
      Permanently delete your TennisMate account and profile data. This cannot be undone.
    </div>

    {deleteError && (
      <div
        className="mt-3 rounded-xl border px-3 py-2 text-xs font-semibold"
        style={{
          background: "rgba(239, 68, 68, 0.08)",
          borderColor: "rgba(239, 68, 68, 0.25)",
          color: "rgb(185, 28, 28)",
        }}
      >
        {deleteError}
      </div>
    )}

    <button
      type="button"
      onClick={handleDeleteAccount}
      disabled={deletingAccount}
      className="mt-3 w-full rounded-2xl border px-4 py-3 text-sm font-extrabold"
      style={{
        background: "rgba(239, 68, 68, 0.10)",
        borderColor: "rgba(239, 68, 68, 0.35)",
        color: "rgb(185, 28, 28)",
        opacity: deletingAccount ? 0.7 : 1,
        cursor: deletingAccount ? "not-allowed" : "pointer",
      }}
    >
      {deletingAccount ? "Deleting…" : "Delete account"}
    </button>
  </div>
</aside>


          {/* MIDDLE */}
          <main className="min-w-0">
            {/* Top bar */}
            <div className="flex items-center justify-between">
              <div>
                <div className="text-2xl font-black" style={{ color: TM.forest }}>
                  Edit Profile
                </div>
                <div className="text-sm font-semibold" style={{ color: "rgba(11,61,46,0.55)" }}>
                  Update your details to improve matching.
                </div>
              </div>

              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={() => router.push("/profile")}
                  className="rounded-2xl px-4 py-2 font-extrabold border"
                  style={{ background: TM.tile, borderColor: TM.border, color: TM.forest }}
                >
                  Cancel
                </button>

                <button
                  type="button"
                  onClick={saveProfile}
                  disabled={saving}
                  className="rounded-2xl px-4 py-2 font-extrabold shadow disabled:opacity-50"
                  style={{ background: TM.neon, color: TM.forest }}
                >
                  {saving ? "Saving…" : "Save Changes"}
                </button>
              </div>
            </div>

            {status ? (
              <div className="mt-3 text-sm font-semibold" style={{ color: TM.forest }}>
                {status}
              </div>
            ) : null}

            {/* Personal Introduction */}
            <section className="mt-6 rounded-2xl border p-5" style={{ background: TM.tile, borderColor: TM.border }}>
              <div className="text-sm font-black" style={{ color: TM.forest }}>
                Personal Introduction
              </div>

              <textarea
                name="bio"
                rows={5}
                maxLength={500}
                value={formData.bio}
                onChange={handleChange}
                className="mt-3 w-full rounded-2xl border px-4 py-3 text-sm outline-none"
                style={{ borderColor: "rgba(11,61,46,0.18)" }}
                placeholder="Tell others about your game, what you're looking for, and when you like to play…"
              />
              <div className="mt-2 text-xs font-semibold" style={{ color: "rgba(11,61,46,0.55)" }}>
                {formData.bio.length}/500 characters
              </div>
            </section>

            {/* Availability (desktop style, simple + fast) */}
            <section className="mt-6 rounded-2xl border p-5" style={{ background: TM.tile, borderColor: TM.border }}>
              <div className="flex items-center justify-between">
                <div className="text-sm font-black" style={{ color: TM.forest }}>
                  Availability
                </div>

                <button
                  type="button"
                  onClick={() => setFormData((p) => ({ ...p, availability: [] }))}
                  className="text-xs font-extrabold"
                  style={{ color: TM.forest }}
                >
                  Clear All
                </button>
              </div>

              <div className="mt-4 flex flex-wrap gap-3">
                {AVAILABILITY_OPTIONS.map((slot) => {
                  const on = formData.availability.includes(slot);
                  return (
                    <button
                      key={slot}
                      type="button"
                      onClick={() => handleCheckbox(slot)}
                      className="rounded-full px-4 py-2 text-sm font-extrabold border"
                      style={{
                        background: on ? TM.neon : "rgba(11,61,46,0.04)",
                        color: on ? TM.forest : "rgba(11,61,46,0.55)",
                        borderColor: on ? "rgba(57,255,20,0.55)" : "rgba(11,61,46,0.10)",
                      }}
                    >
                      {slot}
                    </button>
                  );
                })}
              </div>
            </section>

            {/* Core fields */}
            <section className="mt-6 rounded-2xl border p-5" style={{ background: TM.tile, borderColor: TM.border }}>
              <div className="text-sm font-black" style={{ color: TM.forest }}>
                Profile Details
              </div>

              <div className="mt-4 grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-extrabold" style={{ color: TM.sub }}>
                    Display Name *
                  </label>
                  <input
                    name="name"
                    value={formData.name}
                    onChange={handleChange}
                    className="mt-2 w-full rounded-2xl border px-4 py-3 text-sm outline-none"
                    style={{ borderColor: "rgba(11,61,46,0.18)" }}
                  />
                </div>

                <div>
                  <label className="block text-xs font-extrabold" style={{ color: TM.sub }}>
                    Postcode *
                  </label>
                  <input
                    name="postcode"
                    inputMode="numeric"
                    value={formData.postcode}
                    onChange={handleChange}
                    className="mt-2 w-full rounded-2xl border px-4 py-3 text-sm outline-none"
                    style={{ borderColor: "rgba(11,61,46,0.18)" }}
                  />
                </div>

                <div>
                  <label className="block text-xs font-extrabold" style={{ color: TM.sub }}>
                    Skill Level *
                  </label>
                  <select
                    name="skillBand"
                    value={formData.skillBand}
                    onChange={(e) => setFormData((p) => ({ ...p, skillBand: e.target.value as SkillBand }))}
                    className="mt-2 w-full rounded-2xl border px-4 py-3 text-sm outline-none bg-white"
                    style={{ borderColor: "rgba(11,61,46,0.18)" }}
                  >
                    <option value="" disabled>
                      Select…
                    </option>
                    {SKILL_OPTIONS_SAFE.map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-extrabold" style={{ color: TM.sub }}>
                    TMR Rating
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    min={1}
                    max={16.5}
                    value={formData.rating}
                    onChange={(e) => handleRatingChange(e.target.value)}
                    className="mt-2 w-full rounded-2xl border px-4 py-3 text-sm outline-none bg-white"
                    style={{ borderColor: "rgba(11,61,46,0.18)" }}
                  />
                </div>

                <div>
                  <label className="block text-xs font-extrabold" style={{ color: TM.sub }}>
                    Birth Year *
                  </label>
                  <input
                    name="birthYear"
                    inputMode="numeric"
                    value={formData.birthYear === "" ? "" : String(formData.birthYear)}
                    onChange={handleChange}
                    className="mt-2 w-full rounded-2xl border px-4 py-3 text-sm outline-none"
                    style={{ borderColor: "rgba(11,61,46,0.18)" }}
                  />
                  <div className="mt-1 text-[11px] font-semibold" style={{ color: "rgba(11,61,46,0.55)" }}>
                    Age: {typeof derivedAge === "number" ? derivedAge : "—"}
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-extrabold" style={{ color: TM.sub }}>
                    Gender
                  </label>
                  <div
                    className="mt-2 grid grid-cols-3 rounded-2xl border p-1"
                    style={{ borderColor: "rgba(11,61,46,0.18)" }}
                  >
                    {["Male", "Female", "Other"].map((g) => {
                      const active = formData.gender === g;
                      return (
                        <button
                          key={g}
                          type="button"
                          onClick={() => setFormData((p) => ({ ...p, gender: g }))}
                          className="rounded-xl py-2 text-sm font-extrabold"
                          style={{
                            background: active ? "rgba(11,61,46,0.08)" : "transparent",
                            color: active ? TM.forest : "rgba(11,61,46,0.55)",
                          }}
                        >
                          {g}
                        </button>
                      );
                    })}
                  </div>

                  <button
                    type="button"
                    onClick={() => setFormData((p) => ({ ...p, gender: "" }))}
                    className="mt-2 text-[11px] font-semibold underline"
                    style={{ color: "rgba(11,61,46,0.55)" }}
                  >
                    Clear
                  </button>
                </div>
              </div>
            </section>
          </main>

          {/* RIGHT: Avatar section (sticky) */}
          <aside className="sticky top-6 self-start">
            <div className="rounded-3xl border p-6" style={{ background: TM.tile, borderColor: TM.border }}>
              <div
                className="relative h-[260px] w-full overflow-hidden rounded-2xl border"
                style={{ borderColor: TM.border, background: "rgba(11,61,46,0.03)" }}
              >
                <Image
                  src={previewURL || formData.photoURL || "/default-avatar.png"}
                  alt="Profile"
                  fill
                  className="object-cover"
                  sizes="360px"
                />

                <label
                  htmlFor="uploadDesktop"
                  className="absolute inset-0 grid place-items-center cursor-pointer"
                  style={{ background: "rgba(0,0,0,0.20)", color: "white" }}
                  title="Change photo"
                >
                  <div className="text-sm font-extrabold">Change Photo</div>
                </label>

                <input
                  id="uploadDesktop"
                  type="file"
                  accept="image/*"
                  onChange={handleImageChange}
                  className="hidden"
                />
              </div>

              <div className="mt-4 flex items-center justify-between">
                <div className="text-sm font-black" style={{ color: TM.forest }}>
                  Profile Photo
                </div>

                {previewURL || formData.photoURL ? (
                  <button
                    type="button"
                    onClick={handleRemovePhoto}
                    className="text-xs font-extrabold underline"
                    style={{ color: "rgba(11,61,46,0.65)" }}
                  >
                    Remove
                  </button>
                ) : null}
              </div>

              {!hasPhoto ? (
                <div className="mt-3 text-xs font-semibold" style={{ color: "#B00020" }}>
                  A profile photo is required to save.
                </div>
              ) : null}
            </div>
          </aside>
        </div>
      </div>

      {/* Cropper modal */}
      {showCropper && imageSrc && (
        <div className="fixed inset-0 bg-black/30 backdrop-blur-sm flex items-center justify-center z-50">
          <div className="bg-white rounded-2xl shadow-lg p-4 w-[420px]">
            <div className="relative w-full h-[360px] rounded-xl overflow-hidden">
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

            <div className="mt-4 flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setShowCropper(false)}
                className="rounded-xl border px-4 py-2 text-sm font-extrabold"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={showCroppedImage}
                className="rounded-xl px-4 py-2 text-sm font-extrabold"
                style={{ background: TM.neon, color: TM.forest }}
              >
                Confirm Crop
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
