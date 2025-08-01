"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { auth, db, storage } from "@/lib/firebaseConfig";
import SignupErrorModal from "@/components/SignupErrorModal";
import { createUserWithEmailAndPassword } from "firebase/auth";
import { doc, setDoc, serverTimestamp } from "firebase/firestore";
import { ref, uploadBytes, getDownloadURL } from "firebase/storage";
import Cropper from "react-easy-crop";
import getCroppedImg from "../utils/cropImage";
import Link from "next/link";
import Image from "next/image";

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

  const [showWaitlistModal, setShowWaitlistModal] = useState(false);
  const [postcodeError, setPostcodeError] = useState("");
  const [isPasswordFocused, setIsPasswordFocused] = useState(false);
  const [status, setStatus] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [previewURL, setPreviewURL] = useState<string | null>(null);

  // Cropper state
  const [showCropper, setShowCropper] = useState(false);
  const [imageSrc, setImageSrc] = useState<string | null>(null);
  const [croppedImage, setCroppedImage] = useState<File | null>(null);
  const [crop, setCrop] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [croppedAreaPixels, setCroppedAreaPixels] = useState<any>(null);

  // Password criteria helper function
  function getPasswordCriteria(password: string) {
    return {
      length: password.length >= 6,
      uppercase: /[A-Z]/.test(password),
      special: /[!@#$%^&*(),.?":{}|<>]/.test(password),
    };
  }

  // Calculate criteria state
  const passwordCriteria = getPasswordCriteria(formData.password);
const isPasswordValid = Object.values(passwordCriteria).every(Boolean);
const isFormComplete =
  formData.name &&
  formData.email &&
  formData.password &&
  formData.postcode &&
  formData.skillLevel;
const canSubmit = isFormComplete && isPasswordValid;
  const handleChange = (
    e: React.ChangeEvent<
      HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement
    >
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

  // Start cropping UI
  const handleImageChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selected = e.target.files?.[0];
    if (!selected) return;
    const reader = new FileReader();
    reader.onload = () => {
      setImageSrc(reader.result as string);
      setShowCropper(true);
    };
    reader.readAsDataURL(selected);
  };

  // Cropper handlers
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

  if (!isPasswordValid) {
    setStatus("⚠️ Please meet all password requirements.");
    return;
  }

  setStatus("Submitting...");

  const isVictorian = formData.postcode.startsWith("3");

  try {
    const userCredential = await createUserWithEmailAndPassword(
      auth,
      formData.email,
      formData.password
    );
    const user = userCredential.user;

    let photoURL = "";
    if (croppedImage) {
      const imageRef = ref(
        storage,
        `profile_pictures/${user.uid}/profile.jpg`
      );
      await uploadBytes(imageRef, croppedImage);
      photoURL = await getDownloadURL(imageRef);
    }

    const now = new Date();
    const mvpStart = new Date("2025-07-16");
    const mvpEnd = new Date("2025-08-01");
    const badges = now >= mvpStart && now <= mvpEnd ? ["mvpLaunch"] : [];

    if (isVictorian) {
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
        badges,
      });

      await setDoc(doc(db, "users", user.uid), {
        name: formData.name,
        email: formData.email,
      });

      setStatus("✅ Signup successful!");
      router.replace("/profile");
    } else {
      await setDoc(doc(db, "waitlist_users", user.uid), {
        name: formData.name,
        email: formData.email,
        postcode: formData.postcode,
        timestamp: serverTimestamp(),
        source: "signupForm",
      });

      setShowWaitlistModal(true);

    }
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
        <SignupErrorModal
          onClose={() => setShowEmailExistsModal(false)}
        />
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

        <h1 className="text-2xl font-bold mb-6 text-center">
          Join TennisMate and Get on Court
        </h1>

        <form onSubmit={handleSubmit} className="space-y-4 mt-2">
          <input
            type="text"
            name="name"
            value={formData.name}
            onChange={handleChange}
            placeholder="Your name"
            required
            className="w-full p-2 border rounded"
          />
          <input
            type="email"
            name="email"
            value={formData.email}
            onChange={handleChange}
            placeholder="Email address"
            required
            className="w-full p-2 border rounded"
          />
<input
  type="password"
  name="password"
  value={formData.password}
  onChange={handleChange}
  placeholder="Password"
  required
  className="w-full p-2 border rounded"
  onFocus={() => setIsPasswordFocused(true)}
  onBlur={() => setIsPasswordFocused(false)}
/>
{isPasswordFocused && (
  <div className="bg-gray-50 border border-gray-300 rounded px-3 py-2 mt-1 text-sm text-gray-800 shadow min-w-[220px]">
    <strong>Password requirements:</strong>
    <ul className="list-none mt-1 space-y-1">
      <li className="flex items-center gap-2">
        {passwordCriteria.length ? (
          <span className="text-green-600 font-bold">✔</span>
        ) : (
          <span className="text-red-500 font-bold">✘</span>
        )}
        At least 6 characters
      </li>
      <li className="flex items-center gap-2">
        {passwordCriteria.uppercase ? (
          <span className="text-green-600 font-bold">✔</span>
        ) : (
          <span className="text-red-500 font-bold">✘</span>
        )}
        1 uppercase letter
      </li>
      <li className="flex items-center gap-2">
        {passwordCriteria.special ? (
          <span className="text-green-600 font-bold">✔</span>
        ) : (
          <span className="text-red-500 font-bold">✘</span>
        )}
        1 special character (e.g. !@#$%)
      </li>
    </ul>
  </div>
)}

          <input
            type="text"
            name="postcode"
            value={formData.postcode}
            onChange={handleChange}
            placeholder="Postcode"
            required
            className="w-full p-2 border rounded"
          />
{postcodeError && (
  <p className="text-red-600 text-sm mt-1">{postcodeError}</p>
)}

          <select
            name="skillLevel"
            value={formData.skillLevel}
            onChange={handleChange}
            required
            className="w-full p-2 border rounded"
          >
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

          {/* Cropper Overlay */}
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
                <button
                  onClick={showCroppedImage}
                  type="button"
                  className="mt-4 bg-green-600 text-white px-4 py-2 rounded font-semibold"
                >
                  Confirm Crop
                </button>
                <button
                  onClick={() => setShowCropper(false)}
                  type="button"
                  className="mt-2 text-xs text-gray-600 underline"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}

         <button
  type="submit"
  className={`bg-blue-600 text-white px-4 py-2 rounded ${!canSubmit ? "opacity-50 cursor-not-allowed" : ""}`}
  disabled={!canSubmit}
>
  Submit
</button>

          {status && <p className="mt-2 text-sm">{status}</p>}
        </form>
      </div>
      <div className="text-xs text-gray-600 text-center mt-4">
        By signing up, you agree to our{' '}
        <a href="/terms" className="text-blue-600 underline">
          Terms
        </a>{' '}and{' '}
        <a href="/privacy" className="text-blue-600 underline">
          Privacy Policy
        </a>.
        {showWaitlistModal && (
  <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50">
    <div className="bg-white rounded-xl shadow-lg p-6 max-w-md text-center space-y-4">
      <h2 className="text-xl font-semibold">Thanks for signing up!</h2>
      <p className="text-gray-700 text-sm">
        📍 TennisMate is currently only available in Victoria.<br />
        We’ve saved your interest and will notify you when we launch in your area.
      </p>
      <button
        onClick={() => setShowWaitlistModal(false)}
        className="mt-2 bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded"
      >
        Got it
      </button>
    </div>
  </div>
)}
      </div>
    </>
  );
}
