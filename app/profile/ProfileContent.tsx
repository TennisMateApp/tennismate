"use client";

import Link from "next/link";
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
import { Trash2 } from "lucide-react";

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

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (currentUser) => {
      if (!currentUser) return;
      setUser(currentUser);
      const playerRef = doc(db, "players", currentUser.uid);
      const snap = await getDoc(playerRef);
      const data = snap.data() || {};
      setFormData({
        name: data.name || "",
        postcode: data.postcode || "",
        skillLevel: data.skillLevel || "",
        availability: data.availability || [],
        bio: data.bio || "",
        photoURL: data.photoURL || "",
        badges: data.badges || [],
        timestamp: data.timestamp || null,
      });
      if (data.photoURL) setPreviewURL(data.photoURL);
      const q = query(
        collection(db, "match_history"),
        where("players", "array-contains", currentUser.uid)
      );
      const msnap = await getDocs(q);
      let total = 0, complete = 0, wins = 0;
      msnap.forEach((doc) => {
        const m = doc.data();
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
    if (file.size > 5 * 1024 * 1024) {
      setStatus("❌ Image too large (max 5MB). Please choose a smaller image.");
      return;
    }
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

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;
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
        { ...formData, photoURL, email: user.email, timestamp: serverTimestamp(), profileComplete: true },
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
    <div className="relative max-w-2xl mx-auto p-6 space-y-6">
      {/* Delete button */}
      {editMode && (
        <button
          onClick={handleDeleteProfile}
          className="absolute top-4 right-4 text-red-600 hover:text-red-800"
          title="Delete Profile"
        >
          <Trash2 size={24} />
        </button>
      )}

      {/* Profile Image */}
      <div className="flex items-center mb-4">
        {previewURL && <img src={previewURL} className="w-24 h-24 rounded-full object-cover" alt="Profile" />}      
      </div>

      {/* View Mode Info */}
      {!editMode ? (
        <>
          {/* Basic Info */}
          <div className="space-y-2">
            <p><strong>Name:</strong> {formData.name}</p>
            <p><strong>Email:</strong> {user.email}</p>
            <p><strong>Postcode:</strong> {formData.postcode}</p>
            <p><strong>Skill Level:</strong> {formData.skillLevel}</p>

            {/* Bio */}
            <div>
              <h2 className="font-semibold">Bio</h2>
              <p>{formData.bio}</p>
            </div>

            {/* Availability */}
            <div>
              <h2 className="font-semibold">Availability</h2>
              <p>{formData.availability.join(", ")}</p>
            </div>
          </div>

          {/* Match Stats */}
          <div className="grid grid-cols-3 gap-4">
            <div className="bg-white p-4 rounded-xl shadow text-center">
              <h3 className="text-sm text-gray-500">Matches</h3>
              <p className="text-xl font-bold">{matchStats.matches}</p>
            </div>
            <div className="bg-white p-4 rounded-xl shadow text-center">
              <h3 className="text-sm text-gray-500">Completed</h3>
              <p className="text-xl font-bold">{matchStats.completed}</p>
            </div>
            <div className="bg-white p-4 rounded-xl shadow text-center">
              <h3 className="text-sm text-gray-500">Wins</h3>
              <p className="text-xl font-bold">{matchStats.wins}</p>
            </div>
          </div>

{/* Badges Title */}
<h2 className="font-semibold mt-6">Badges</h2>

{/* Badges Box */}
<div className="border rounded-xl p-4 bg-white shadow mt-2">
  {/* Single flex row for all badges, aligned at the top */}
  <div className="flex items-start gap-4">
    {/* MVP Launch badge */}
    <div className="flex flex-col items-center">
      <img
        src="/badges/mvp-badge.svg"
        width={64}
        height={64}
        alt="MVP Launch"
      />
      <span className="text-xs mt-1">MVP Launch</span>
    </div>

    {/* First Match badge */}
    <div className="flex flex-col items-center">
      <img
        src={
          formData.badges.includes("firstMatch")
            ? "/badges/first-match.svg"
            : "/badges/first-match-locked.svg"
        }
        alt="First Match"
        width={64}
        height={64}
        className={formData.badges.includes("firstMatch") ? "" : "opacity-40"}
      />
      <span className="text-xs mt-1">First Match</span>
    </div>
{/* First Match Complete badge */}
<div className="flex flex-col items-center">
  <img
    src={
      formData.badges.includes("firstMatchComplete")
        ? "/badges/first-match-complete.svg"
        : "/badges/first-match-complete-locked.svg"
    }
    alt="First Match Complete"
    width={64}
    height={64}
    className={formData.badges.includes("firstMatchComplete") ? "" : "opacity-40"}
  />
  <span className="text-xs mt-1">First Match Complete</span>
</div>
{/* **New** First Win badge */}
<div className="flex flex-col items-center">
  <img
    src={
      formData.badges.includes("firstWin")
        ? "/badges/first-win.svg"
        : "/badges/first-win-locked.svg"
    }
    alt="First Win"
    width={64}
    height={64}
    className={formData.badges.includes("firstWin") ? "" : "opacity-40"}
  />
  <span className="text-xs mt-1">First Win</span>
</div>
  </div>
</div>
        </>
      ) : (
        // Edit Form
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block font-medium">Name:</label>
            <input
              name="name"
              value={formData.name}
              onChange={handleChange}
              className="w-full p-2 border rounded" />
          </div>
          <div>
            <label className="block font-medium">Postcode:</label>
            <input
              name="postcode"
              value={formData.postcode}
              onChange={handleChange}
              className="w-full p-2 border rounded" />
          </div>
          <div>
            <label className="block font-medium">Skill Level:</label>
            <select
              name="skillLevel"
              value={formData.skillLevel}
              onChange={handleChange}
              className="w-full p-2 border rounded"
            >
              <option value="">Select</option>
              <option value="Beginner">Beginner</option>
              <option value="Intermediate">Intermediate</option>
              <option value="Advanced">Advanced</option>
            </select>
          </div>
          <fieldset>
            <legend className="font-medium mb-1">Availability:</legend>
            {['Weekdays AM', 'Weekdays PM', 'Weekends AM', 'Weekends PM'].map((slot) => (
              <label key={slot} className="block text-sm">
                <input
                  type="checkbox"
                  value={slot}
                  checked={formData.availability.includes(slot)}
                  onChange={handleCheckbox}
                  className="mr-2"
                />
                {slot}
              </label>
            ))}
          </fieldset>
          <div>
            <label className="block font-medium">Bio:</label>
            <textarea
              name="bio"
              value={formData.bio}
              onChange={handleChange}
              rows={4}
              className="w-full p-2 border rounded"
            />
          </div>
          <div className="flex items-center space-x-4">
            {previewURL && (
              <img
                src={previewURL}
                className="w-20 h-20 rounded-full object-cover border"
                alt="Preview"
              />
            )}
            <div className="space-y-2">
              <label
                htmlFor="upload"
                className="cursor-pointer inline-block bg-green-600 text-white px-3 py-1 rounded"
              >Choose Photo</label>
              <input
                id="upload"
                type="file"
                accept="image/*"
                onChange={handleImageChange}
                className="hidden"
              />
            </div>
          </div>
          {showCropper && imageSrc && (
            <div className="relative w-full h-64 bg-gray-100">
              <Cropper
                image={imageSrc}
                crop={crop}
                zoom={zoom}
                aspect={1}
                cropShape="round"
                onCropChange={setCrop}
                onZoomChange={setZoom}
                onCropComplete={handleCropComplete}
              />
              <button
                onClick={showCroppedImage}
                className="absolute bottom-2 left-2 bg-blue-500 text-white px-3 py-1 rounded"
              >Confirm Crop</button>
            </div>
          )}
          <button
            type="submit"
            disabled={saving}
            className="bg-blue-600 text-white px-4 py-2 rounded disabled:opacity-50"
          >
            {saving ? "Saving..." : "Save Profile"}
          </button>
        </form>
      )}

      {status && <p className="text-sm mt-2">{status}</p>}
    </div>
  );
}
