"use client";

import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { auth, db, storage } from "@/lib/firebaseConfig";
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
  deleteDoc,
} from "firebase/firestore";
import { ref, uploadBytes, getDownloadURL, deleteObject } from "firebase/storage";
import Cropper from "react-easy-crop";
import getCroppedImg from "../utils/cropImage";
import { Edit2, Trophy, CheckCircle2, CalendarDays } from "lucide-react";

export default function ProfilePage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [user, setUser] = useState<any>(null);
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
    skillLevel: "",
    availability: [] as string[],
    bio: "",
    photoURL: "",
    badges: [] as string[],
    timestamp: null as any,
  });
  const [matchStats, setMatchStats] = useState({ matches: 0, completed: 0, wins: 0 });

  const DEFAULT_AVATAR = "/images/default-avatar.jpg";

function normalizePhoto(url?: string | null) {
  if (!url) return DEFAULT_AVATAR;
  // Map old preview-domain default to local default
  if (url.startsWith("https://tennismate-s7vk.vercel.app/images/default-avatar"))
    return DEFAULT_AVATAR;
  return url;
}


  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (currentUser) => {
      if (!currentUser) return;
      setUser(currentUser);
      const playerRef = doc(db, "players", currentUser.uid);
      const snap = await getDoc(playerRef);
const data = snap.data() || {};
const normalized = normalizePhoto(data.photoURL);

setFormData({
  name: data.name || "",
  postcode: data.postcode || "",
  skillLevel: data.skillLevel || "",
  availability: data.availability || [],
  bio: data.bio || "",
  photoURL: normalized,           // ← use normalized
  badges: data.badges || [],
  timestamp: data.timestamp || null,
});

setPreviewURL(normalized);        // ← always use normalized for preview

      const q = query(
        collection(db, "match_history"),
        where("players", "array-contains", currentUser.uid)
      );
      const msnap = await getDocs(q);
      let total = 0, complete = 0, wins = 0;
     msnap.forEach((d) => {
  const m = d.data();
  total++;
  if (m.completed) complete++;
  if (m.winnerId === currentUser.uid) wins++;
});
      setMatchStats({ matches: total, completed: complete, wins });
      setLoading(false);
    });
    return () => unsubscribe();
  }, []);

  useEffect(() => {
    setEditMode(searchParams.get("edit") === "true");
  }, [searchParams]);

  const handleChange = (e: any) => {
    const { name, value } = e.target;
    setFormData((prev) => ({ ...prev, [name]: value }));
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

const handleImageChange = (e: React.ChangeEvent<HTMLInputElement>) => {
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
    setStatus("Photo removed.");
  } catch {
    setStatus("Could not remove photo.");
  }
};


  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;
    // basic client-side validation
if (!formData.name.trim()) {
  setStatus("Please enter your name.");
  return;
}
if (!formData.skillLevel) {
  setStatus("Please choose a skill level.");
  return;
}
// AU postcode (4 digits). Adjust if your regions differ.
if (!/^\d{4}$/.test(formData.postcode.trim())) {
  setStatus("Enter a valid 4-digit postcode.");
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
        { ...formData, photoURL,  nameLower: (formData.name || "").toLowerCase(), email: user.email, timestamp: serverTimestamp(), profileComplete: true },
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
    if (!confirm("Are you sure you want to permanently delete your profile?")) return;
    if (!user) return;
    try {
      await deleteObject(ref(storage, `profile_pictures/${user.uid}/profile.jpg`)).catch(() => {});
      await deleteDoc(doc(db, "players", user.uid));
      await deleteDoc(doc(db, "users", user.uid));
      await user.delete();
      router.push("/");
    } catch {
      setStatus("❌ Error deleting profile.");
    }
  };

  if (loading) return <p className="p-6">Loading...</p>;

return (
  <div className="relative mx-auto max-w-3xl p-4 sm:p-6 space-y-5 pb-28 overflow-x-hidden bg-gradient-to-b from-emerald-50/60 to-white">
    {!editMode ? (
      <>
        {/* HERO HEADER */}
        <section className="relative overflow-hidden rounded-2xl border border-gray-200 bg-gradient-to-b from-white to-emerald-50 p-5 sm:p-6 shadow-sm text-center">
          {/* decorative blobs */}
          <span className="pointer-events-none absolute -top-10 -right-10 h-28 w-28 rounded-full bg-emerald-200/40 blur-2xl" />
          <span className="pointer-events-none absolute -bottom-8 -left-8 h-24 w-24 rounded-full bg-emerald-100/60 blur-2xl" />

          <img
  src={previewURL || DEFAULT_AVATAR}
  alt={`${formData.name || "User"} avatar`}
  className="h-24 w-24 rounded-full object-cover ring-4 ring-white"
/>

          <h1 className="mt-3 text-2xl sm:text-3xl font-bold break-words">
            {formData.name || "Your Name"}
          </h1>

          <div className="mt-1 flex flex-wrap items-center justify-center gap-2 text-sm text-gray-600">
            <span className="rounded-full border border-emerald-200 bg-emerald-50 text-emerald-700 px-2.5 py-0.5">
              Skill: {formData.skillLevel || "—"}
            </span>
            {formData.postcode && (
              <span className="rounded-full border border-emerald-200 bg-emerald-50 text-emerald-700 px-2.5 py-0.5">
                Postcode {formData.postcode}
              </span>
            )}
          </div>

          {user?.email && (
            <p className="mt-1 text-sm text-gray-500">
              <a href={`mailto:${user.email}`} className="hover:underline">{user.email}</a>
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

          {/* Actions (owner only) */}
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
          {[
            { label: "Matches", value: matchStats.matches, href: "/matches", icon: <CalendarDays className="h-4 w-4" /> },
            { label: "Completed", value: matchStats.completed, href: "/matches?tab=completed", icon: <CheckCircle2 className="h-4 w-4" /> },
            { label: "Wins", value: matchStats.wins, href: "/matches?tab=wins", icon: <Trophy className="h-4 w-4" /> },
          ].map((s) => (
            <button
              key={s.label}
              type="button"
              onClick={() => router.push(s.href)}
              className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm text-center hover:bg-emerald-50/40 focus:outline-none focus:ring-2 focus:ring-emerald-600"
              aria-label={`View ${s.label.toLowerCase()}`}
            >
              <div className="mx-auto mb-2 flex h-8 w-8 items-center justify-center rounded-full bg-emerald-100 text-emerald-700">
                {s.icon}
              </div>
              <div className="text-2xl font-bold tabular-nums">{s.value ?? 0}</div>
              <div className="mt-1 text-sm text-gray-700">{s.label}</div>
            </button>
          ))}
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
                src={formData.badges.includes("firstMatch") ? "/badges/first-match.svg" : "/badges/first-match-locked.svg"}
                alt="First Match"
                width={64}
                height={64}
                className={`mx-auto ${formData.badges.includes("firstMatch") ? "" : "opacity-40"}`}
              />
              <span className="text-xs mt-1 block">First Match</span>
            </div>
            <div className="rounded-xl border border-gray-200 bg-white p-3 hover:bg-gray-50" title="Finish your first completed match">
              <img
                src={formData.badges.includes("firstMatchComplete") ? "/badges/first-match-complete.svg" : "/badges/first-match-complete-locked.svg"}
                alt="First Match Complete"
                width={64}
                height={64}
                className={`mx-auto ${formData.badges.includes("firstMatchComplete") ? "" : "opacity-40"}`}
              />
              <span className="text-xs mt-1 block">First Match Complete</span>
            </div>
            <div className="rounded-xl border border-gray-200 bg-white p-3 hover:bg-gray-50" title="Win your first match">
              <img
                src={formData.badges.includes("firstWin") ? "/badges/first-win.svg" : "/badges/first-win-locked.svg"}
                alt="First Win"
                width={64}
                height={64}
                className={`mx-auto ${formData.badges.includes("firstWin") ? "" : "opacity-40"}`}
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
              <p className="mt-1 text-xs text-gray-500">Australian 4-digit format (e.g. 3000).</p>
            </div>

            {/* Skill level */}
            <div>
              <label className="block text-sm font-medium text-gray-800">
                Skill Level <span className="text-red-600">*</span>
              </label>
              <select
                name="skillLevel"
                required
                value={formData.skillLevel}
                onChange={handleChange}
                className="mt-1 w-full rounded-xl border px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-green-600 bg-white"
              >
                <option value="">Select</option>
                <option value="Beginner">Beginner</option>
                <option value="Intermediate">Intermediate</option>
                <option value="Advanced">Advanced</option>
              </select>
            </div>

            {/* Availability */}
            <fieldset>
              <legend className="block text-sm font-medium text-gray-800">Availability</legend>
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

            {/* Photo */}
            <div className="flex items-center gap-4">
             <img
  src={previewURL || DEFAULT_AVATAR}
  className="h-20 w-20 rounded-full object-cover ring-2 ring-gray-200"
  alt="Preview"
/>

              <div className="flex flex-wrap gap-2">
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
                  type="button" /* prevents form submit */
                  onClick={showCroppedImage}
                  className="rounded-xl bg-green-600 px-4 py-2 text-white text-sm font-semibold shadow hover:bg-green-700"
                >
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

        {/* Actions + compact danger zone */}
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
                disabled={saving}
                className="rounded-xl bg-green-600 px-3 py-2 text-sm font-semibold text-white shadow hover:bg-green-700 disabled:opacity-50"
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