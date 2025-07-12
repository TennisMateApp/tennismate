"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation"; // ✅ fix is here
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
  where
} from "firebase/firestore";
import {
  ref,
  uploadBytes,
  getDownloadURL,
  deleteObject
} from "firebase/storage";
import Cropper from "react-easy-crop";
import getCroppedImg from "../utils/cropImage";
import { deleteDoc } from "firebase/firestore";
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
  const [croppedAreaPixels, setCroppedAreaPixels] = useState(null);
  const [showCropper, setShowCropper] = useState(false);
  const [editMode, setEditMode] = useState(false);

  const [formData, setFormData] = useState({
    name: "",
    postcode: "",
    skillLevel: "",
    availability: [] as string[],
    bio: "",
    photoURL: ""
  });

  const [matchStats, setMatchStats] = useState({ matches: 0, completed: 0, wins: 0 });

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (currentUser) => {
      if (!currentUser) return;

      setUser(currentUser);
      const docRef = doc(db, "players", currentUser.uid);
      const docSnap = await getDoc(docRef);

      const data = docSnap.data() || {};

      setFormData({
        name: data.name || "",
        postcode: data.postcode || "",
        skillLevel: data.skillLevel || "",
        availability: data.availability || [],
        bio: data.bio || "",
        photoURL: data.photoURL || ""
      });

      if (data.photoURL) setPreviewURL(data.photoURL);

const matchQuery = query(
  collection(db, "match_history"), // ✅ changed from "match_requests"
  where("players", "array-contains", currentUser.uid)
);
const snapshot = await getDocs(matchQuery);

let total = 0, complete = 0, wins = 0;
snapshot.forEach(doc => {
  const match = doc.data();
  total++;
  if (match.completed) complete++;
  if (match.winnerId === currentUser.uid) wins++;
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
    setFormData(prev => ({ ...prev, [name]: value }));
  };

  const handleCheckbox = (e: any) => {
    const { value, checked } = e.target;
    setFormData(prev => ({
      ...prev,
      availability: checked
        ? [...prev.availability, value]
        : prev.availability.filter(v => v !== value)
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

  const handleCropComplete = (_: any, croppedAreaPixels: any) => {
    setCroppedAreaPixels(croppedAreaPixels);
  };

  const showCroppedImage = async () => {
    if (!imageSrc || !croppedAreaPixels) return;
    try {
      const croppedBlob = await getCroppedImg(imageSrc, croppedAreaPixels);
      const croppedFile = new File([croppedBlob], "profile.jpg", { type: "image/jpeg" });
      setCroppedImage(croppedFile);
      setPreviewURL(URL.createObjectURL(croppedFile));
      setShowCropper(false);
    } catch (e) {
      console.error(e);
      setStatus("❌ Failed to crop image.");
    }
  };

  const handleDeleteImage = async () => {
    if (!user) return;
    try {
      const imageRef = ref(storage, `profile_pictures/${user.uid}/profile.jpg`);
      await deleteObject(imageRef);
      await setDoc(doc(db, "players", user.uid), {
        ...formData,
        photoURL: "",
        email: user.email,
        timestamp: serverTimestamp(),
      }, { merge: true });
      setFormData(prev => ({ ...prev, photoURL: "" }));
      setPreviewURL(null);
      setCroppedImage(null);
      setStatus("🗑️ Profile picture deleted.");
    } catch (err) {
      console.error("Failed to delete image:", err);
      setStatus("❌ Failed to delete profile picture.");
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
      const storageRef = ref(storage, `profile_pictures/${user.uid}/profile.jpg`);
      await uploadBytes(storageRef, croppedImage);
      photoURL = await getDownloadURL(storageRef);
    }

    await setDoc(
      doc(db, "players", user.uid),
      {
        ...formData,
        photoURL,
        email: user.email,
        timestamp: serverTimestamp(),
        profileComplete: true,
      },
      { merge: true }
    );

    setEditMode(false);
    setStatus("✅ Profile saved successfully!");
    router.push("/profile");
  } catch (error) {
    console.error("Error saving profile:", error);
    setStatus("❌ Error saving profile. Make sure you're signed in and allowed to write to storage.");
  } finally {
    setSaving(false);
  }
};

const handleDeleteProfile = async () => {
  const confirmed = window.confirm("Are you sure you want to permanently delete your profile? This cannot be undone.");
  if (!confirmed) return;

  if (!user) return;

  try {
    setStatus("Deleting account...");

    // 1. Delete profile picture from storage
    const imageRef = ref(storage, `profile_pictures/${user.uid}/profile.jpg`);
    await deleteObject(imageRef).catch(() => {});

    // 2. Delete Firestore documents
    await deleteDoc(doc(db, "players", user.uid));
    await deleteDoc(doc(db, "users", user.uid)); // optional: if you're storing extra info

    // 3. Delete Firebase Auth user
    await user.delete();

    // 4. Redirect to homepage
    setStatus("✅ Account deleted. Redirecting...");
    router.push("/");

  } catch (error: any) {
    console.error("Delete error:", error);
    if (error.code === "auth/requires-recent-login") {
      setStatus("⚠️ Please log out and log back in before deleting your account.");
    } else {
      setStatus("❌ Failed to delete account.");
    }
  }
};


  if (loading) return <p className="p-6">Loading...</p>;

return (
  <div className="relative max-w-2xl mx-auto p-6">
    {editMode && (
      <button
        onClick={handleDeleteProfile}
        className="absolute top-4 right-4 text-red-600 hover:text-red-800"
        title="Delete Profile"
      >
        <Trash2 size={24} />
      </button>
    )}

    {!editMode && (
      <div className="grid grid-cols-3 gap-4 mb-6">
        <div className="bg-white shadow rounded-xl p-4 text-center">
          <h2 className="text-sm text-gray-500">Matches</h2>
          <p className="text-xl font-bold">{matchStats.matches}</p>
        </div>
        <div className="bg-white shadow rounded-xl p-4 text-center">
          <h2 className="text-sm text-gray-500">Completed</h2>
          <p className="text-xl font-bold">{matchStats.completed}</p>
        </div>
        <div className="bg-white shadow rounded-xl p-4 text-center">
          <h2 className="text-sm text-gray-500">Wins</h2>
          <p className="text-xl font-bold">{matchStats.wins}</p>
        </div>
      </div>
    )}

      <div className="flex justify-between items-center mb-4">
        {previewURL && (
          <img src={previewURL} alt="Profile" className="w-24 h-24 object-cover rounded-full" />
        )}
      </div>

      {!editMode ? (
        <div className="space-y-2">
          <p><strong>Name:</strong> {formData.name}</p>
          <p><strong>Email:</strong> {user?.email}</p>
          <p><strong>Postcode:</strong> {formData.postcode}</p>
          <p><strong>Skill Level:</strong> {formData.skillLevel}</p>
          <p><strong>Availability:</strong> {formData.availability.join(", ")}</p>
          <p><strong>Bio:</strong> {formData.bio}</p>
        </div>
      ) : (
<form onSubmit={handleSubmit} className="space-y-4">
  {!editMode ? (
    <div className="space-y-2">
      <p><strong>Name:</strong> {formData.name}</p>
      <p><strong>Email:</strong> {user?.email}</p>
      <p><strong>Postcode:</strong> {formData.postcode}</p>
      <p><strong>Skill Level:</strong> {formData.skillLevel}</p>
      <p><strong>Availability:</strong> {formData.availability.join(", ")}</p>
      <p><strong>Bio:</strong> {formData.bio}</p>
    </div>
  ) : (
    <>
      <div>
        <label className="block font-medium">Name:</label>
        <input name="name" type="text" value={formData.name} onChange={handleChange} className="w-full p-2 border rounded" />
      </div>
      <div>
        <label className="block font-medium">Email:</label>
        <input type="email" value={user?.email || ""} readOnly className="w-full p-2 border rounded bg-gray-100 cursor-not-allowed" />
      </div>
      <div>
        <label className="block font-medium">Postcode:</label>
        <input name="postcode" type="text" value={formData.postcode} onChange={handleChange} className="w-full p-2 border rounded" />
      </div>
      <div>
        <label className="block font-medium">Skill Level:</label>
        <select name="skillLevel" value={formData.skillLevel} onChange={handleChange} className="w-full p-2 border rounded">
          <option value="">Select skill level</option>
          <option value="Beginner">Beginner</option>
          <option value="Intermediate">Intermediate</option>
          <option value="Advanced">Advanced</option>
        </select>
      </div>
      <fieldset className="mb-2">
        <legend className="font-medium mb-1">Availability:</legend>
        {["Weekdays AM", "Weekdays PM", "Weekends AM", "Weekends PM"].map(slot => (
          <label key={slot} className="block text-sm">
            <input type="checkbox" value={slot} checked={formData.availability.includes(slot)} onChange={handleCheckbox} className="mr-2" />
            {slot}
          </label>
        ))}
      </fieldset>
      <div>
        <label className="block font-medium">Bio:</label>
        <textarea name="bio" value={formData.bio} onChange={handleChange} rows={4} className="w-full p-2 border rounded" />
      </div>

      <div className="flex items-center space-x-4">
        {previewURL && (
          <img src={previewURL} alt="Profile" className="w-20 h-20 object-cover rounded-full border" />
        )}
        <div className="flex flex-col space-y-2">
          <label htmlFor="profileUpload" className="cursor-pointer text-sm bg-blue-100 text-blue-800 px-3 py-1 rounded w-fit hover:bg-blue-200">
            Choose New Photo
          </label>
          <input
            id="profileUpload"
            type="file"
            accept="image/*"
            onChange={handleImageChange}
            className="hidden"
          />
          {previewURL && (
            <button type="button" onClick={handleDeleteImage} className="text-red-600 underline text-xs w-fit">
              Delete Photo
            </button>
          )}
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
          <div className="absolute bottom-2 left-2">
            <button type="button" className="bg-blue-500 text-white px-3 py-1 rounded" onClick={showCroppedImage}>Confirm Crop</button>
          </div>
        </div>
      )}

      <button type="submit" disabled={saving} className="bg-blue-600 text-white px-4 py-2 rounded disabled:opacity-50">
        {saving ? "Saving..." : "Save Profile"}
      </button>
    </>
  )}
  {status && <p className="text-sm mt-2">{status}</p>}
</form>
      )}
    </div>
  );
}
