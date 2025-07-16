"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { auth, db, storage } from "@/lib/firebaseConfig";
import SignupErrorModal from "@/components/SignupErrorModal";
import { createUserWithEmailAndPassword } from "firebase/auth";
import { doc, setDoc, serverTimestamp } from "firebase/firestore";
import { ref, uploadBytes, getDownloadURL } from "firebase/storage";

import Link from "next/link";
import Image from "next/image";
import Cropper from "react-easy-crop";
import getCroppedImg from "../utils/cropImage";

export default function SignupPage() {
  const [showEmailExistsModal, setShowEmailExistsModal] = useState(false);
  const router = useRouter();

  const [formData, setFormData] = useState({
    name: "",
    email: "",
    password: "",
    postcode: "",
    skillLevel: "",
    availability: [] as string[],
    bio: "",
  });

  const [status, setStatus] = useState("");
  const [imageSrc, setImageSrc] = useState<string | null>(null);
  const [croppedAreaPixels, setCroppedAreaPixels] = useState(null);
  const [previewURL, setPreviewURL] = useState<string | null>(null);
  const [croppedBlob, setCroppedBlob] = useState<Blob | null>(null);
  const [crop, setCrop] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [showCropper, setShowCropper] = useState(false);

  const handleChange = (
    e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>
  ) => {
    const { name, value } = e.target;
    setFormData((prev) => ({ ...prev, [name]: value }));
  };

  const handleCheckbox = (e: React.ChangeEvent<HTMLInputElement>) => {
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
      setImageSrc(reader.result as string);
      setShowCropper(true);
    };
    reader.readAsDataURL(file);
  };

  const handleCropComplete = (_: any, croppedPixels: any) => {
    setCroppedAreaPixels(croppedPixels);
  };

  const confirmCrop = async () => {
    if (!imageSrc || !croppedAreaPixels) return;
    const blob = await getCroppedImg(imageSrc, croppedAreaPixels);
    setCroppedBlob(blob);
    setPreviewURL(URL.createObjectURL(blob));
    setShowCropper(false);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setStatus("Submitting...");

    try {
      const userCredential = await createUserWithEmailAndPassword(
        auth,
        formData.email,
        formData.password
      );
      const user = userCredential.user;

      let photoURL = "";
      if (croppedBlob) {
        const imageRef = ref(storage, `profile_pictures/${user.uid}/profile.jpg`);
        await uploadBytes(imageRef, croppedBlob);
        photoURL = await getDownloadURL(imageRef);
      }

     const now = new Date();
const mvpStart = new Date("2025-07-16");
const mvpEnd = new Date("2025-08-01");
const badges = (now >= mvpStart && now <= mvpEnd) ? ["mvpLaunch"] : [];

await setDoc(doc(db, "players", user.uid), {
  name: formData.name,
  email: formData.email,
  postcode: formData.postcode,
  skillLevel: formData.skillLevel,
  availability: formData.availability,
  bio: formData.bio,
  photoURL,
  profileComplete: true,
  timestamp: serverTimestamp(),
  badges, // <-- ✅ this is now dynamic
});

      await setDoc(doc(db, "users", user.uid), {
        name: formData.name,
        email: formData.email,
      });

      setStatus("✅ Signup successful!");
      router.replace("/profile");
    } catch (error: any) {
      if (error.code === "auth/email-already-in-use") {
        setShowEmailExistsModal(true);
      } else if (error.code === "auth/weak-password") {
        setStatus("⚠️ Password must be at least 6 characters.");
      } else {
        console.error("Signup error:", error);
        setStatus("❌ Something went wrong. Please try again.");
      }
    }
  };

  return (
    <>
      {showEmailExistsModal && (
        <SignupErrorModal onClose={() => setShowEmailExistsModal(false)} />
      )}

      <div className="relative max-w-xl mx-auto p-6">
        <Link
          href="/login"
          className="absolute top-4 left-4 text-sm bg-green-600 hover:bg-green-700 text-white py-1 px-3 rounded"
        >
          Login
        </Link>

        <div className="flex justify-center mb-6">
          <Image
            src="/logo.png"
            alt="TennisMate Logo"
            width={100}
            height={100}
            className="rounded-full"
          />
        </div>

        <h1 className="text-2xl font-bold mb-6 text-center">Join TennisMate and Get on Court</h1>

        <form onSubmit={handleSubmit} className="space-y-4 mt-2">
          <input type="text" name="name" value={formData.name} onChange={handleChange} placeholder="Your name" required className="w-full p-2 border rounded" />
          <input type="email" name="email" value={formData.email} onChange={handleChange} placeholder="Email address" required className="w-full p-2 border rounded" />
          <input type="password" name="password" value={formData.password} onChange={handleChange} placeholder="Password" required className="w-full p-2 border rounded" />
          <input type="text" name="postcode" value={formData.postcode} onChange={handleChange} placeholder="Postcode" required className="w-full p-2 border rounded" />

          <select name="skillLevel" value={formData.skillLevel} onChange={handleChange} required className="w-full p-2 border rounded">
            <option value="">Select skill level</option>
            <option value="Beginner">Beginner</option>
            <option value="Intermediate">Intermediate</option>
            <option value="Advanced">Advanced</option>
          </select>

          <fieldset>
            <legend className="font-medium mb-2">Availability</legend>
            {[
              "Weekdays AM",
              "Weekdays PM",
              "Weekends AM",
              "Weekends PM",
            ].map((slot) => (
              <label key={slot} className="block">
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

          <textarea
            name="bio"
            value={formData.bio}
            onChange={handleChange}
            placeholder="Short bio"
            rows={4}
            className="w-full p-2 border rounded"
          />

          <div className="flex flex-col items-start gap-2">
            <label className="text-sm font-medium">Profile Picture:</label>
            {previewURL && (
              <img
                src={previewURL}
                alt="Preview"
                className="w-20 h-20 object-cover rounded-full border"
              />
            )}
            <label
              htmlFor="upload"
              className="cursor-pointer inline-block bg-green-600 hover:bg-green-700 text-white text-sm px-4 py-2 rounded"
            >
              Choose Profile Picture
            </label>
            <input
              id="upload"
              type="file"
              accept="image/*"
              onChange={handleImageChange}
              className="hidden"
            />
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
                <button
                  type="button"
                  className="bg-blue-500 text-white px-3 py-1 rounded"
                  onClick={confirmCrop}
                >
                  Confirm Crop
                </button>
              </div>
            </div>
          )}

          <button type="submit" className="bg-blue-600 text-white px-4 py-2 rounded">
            Submit
          </button>

          {status && <p className="mt-2 text-sm">{status}</p>}
        </form>
      </div>
      <div className="text-xs text-gray-600 text-center mt-4">
  By signing up, you agree to our{" "}
  <a href="/terms" className="text-blue-600 underline">Terms</a> and{" "}
  <a href="/privacy" className="text-blue-600 underline">Privacy Policy</a>.
</div>
    </>
  );
}
