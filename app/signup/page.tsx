// app/signup/page.tsx
"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { auth, db, storage } from "@/lib/firebaseConfig";
import SignupErrorModal from "@/components/SignupErrorModal";
import { createUserWithEmailAndPassword } from "firebase/auth";
import { doc, serverTimestamp, getDoc, writeBatch } from "firebase/firestore";
import { ref, uploadBytes, getDownloadURL } from "firebase/storage";
import Cropper from "react-easy-crop";
import getCroppedImg from "../utils/cropImage";
import Link from "next/link";
import Image from "next/image";
import { CheckCircle2, CircleX, Loader2, Mail, Lock, User, MapPin, Camera } from "lucide-react";

import { clampUTR, SKILL_OPTIONS, skillFromUTR, type SkillBand } from "../../lib/skills";
import { geohashForLocation } from "geofire-common";
import { trackEvent } from "@/lib/analytics";
import {
  initializeOrRepairAccount,
  markUnsupportedPostcodeWaitlist,
  sendInitialVerificationIfClaimed,
} from "@/lib/accountLifecycle";
import { classifyPostcode } from "@/lib/postcodeEligibility";
import {
  collectReferralCandidates,
  referralCookieValue,
  REFERRAL_SESSION_KEY,
} from "@/lib/referralAttribution";
import { safeNextDestination } from "@/lib/verificationFlow";
import { platform as runtimePlatform } from "@/lib/runtime";
import {
  getSignupPasswordRequirements,
  isSignupPasswordValid,
  mapSignupAuthError,
  signupFailureDiagnostics,
  SIGNUP_PASSWORD_ERROR,
} from "@/lib/signupAccount";

const DEFAULT_AVATAR = "/images/default-avatar.jpg";
const RATING_LABEL = "TennisMate Rating (TMR)";

function toSkillLabel(value: string | null | undefined) {
  if (!value) return null;
  // Try to use SKILL_OPTIONS first (source of truth)
  const fromOptions = SKILL_OPTIONS.find((s) => s.value === value)?.label;
  if (fromOptions) return fromOptions;

  // Fallback: transform snake_case → Title Case
  return value
    .split("_")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

async function makeAvatarThumb(file: File, size = 160, quality = 0.72): Promise<File> {
  const bitmap = await createImageBitmap(file);

  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;

  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas not supported");

  // Center crop to square
  const srcW = bitmap.width;
  const srcH = bitmap.height;
  const srcSize = Math.min(srcW, srcH);
  const sx = Math.floor((srcW - srcSize) / 2);
  const sy = Math.floor((srcH - srcSize) / 2);

  ctx.drawImage(bitmap, sx, sy, srcSize, srcSize, 0, 0, size, size);

  const blob: Blob = await new Promise((resolve, reject) => {
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error("Failed to create thumbnail blob"))),
      "image/jpeg",
      quality
    );
  });

  return new File([blob], "avatar_thumb.jpg", { type: "image/jpeg" });
}


export default function SignupPage() {
  const [showEmailExistsModal, setShowEmailExistsModal] = useState(false);
  const [existingEmail, setExistingEmail] = useState<string>("");
  const router = useRouter();
  const searchParams = useSearchParams();
  const nextDestination = safeNextDestination(searchParams.get("next"), "/home");

  useEffect(() => {
    const candidates = collectReferralCandidates({
      stored: sessionStorage.getItem(REFERRAL_SESSION_KEY),
      ref: searchParams.get("ref"),
      rc: searchParams.get("rc"),
      cookie: referralCookieValue(document.cookie),
    });
    if (!sessionStorage.getItem(REFERRAL_SESSION_KEY) && candidates[0]) {
      sessionStorage.setItem(REFERRAL_SESSION_KEY, candidates[0].code);
    }
  }, [searchParams]);

const [formData, setFormData] = useState({
  name: "",
  email: "",
  password: "",
  postcode: "",
  gender: "" as "" | "Male" | "Female" | "Non-binary" | "Other",
  birthYear: "",
  skillBand: "" as SkillBand | "",
  rating: "" as number | "",
  availability: [] as string[],
  bio: "",
});


  const [showWaitlistModal, setShowWaitlistModal] = useState(false);
  const [status, setStatus] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const submissionRef = useRef(false);
  const [previewURL, setPreviewURL] = useState<string>(DEFAULT_AVATAR);

  // Cropper state
  const [showCropper, setShowCropper] = useState(false);
  const [imageSrc, setImageSrc] = useState<string | null>(null);
  const [croppedImage, setCroppedImage] = useState<File | null>(null);
  const [crop, setCrop] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [croppedAreaPixels, setCroppedAreaPixels] = useState<any>(null);

  const [errors, setErrors] = useState<{ [k: string]: string }>({});

  // Derived: a real photo is required (must be cropped/confirmed)
  const hasPhoto = !!croppedImage;

  const passwordCriteria = getSignupPasswordRequirements(formData.password);
  const isPasswordValid = isSignupPasswordValid(formData.password);

  const focusField = (name: string) => {
    requestAnimationFrame(() => {
      document.querySelector<HTMLElement>(`[name="${name}"]`)?.focus();
    });
  };

  const finishSubmission = () => {
    submissionRef.current = false;
    setIsSubmitting(false);
  };

  const handleChange = (
    e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>
  ) => {
    const { name, value } = e.target;

    if (name === "postcode") {
      const digits = value.replace(/\D/g, "").slice(0, 4);
      setFormData((prev) => ({ ...prev, postcode: digits }));
      setErrors((prev) => ({ ...prev, postcode: "" }));
      return;
    }

    if (name === "rating") {
      if (value === "") {
        setFormData((prev) => ({ ...prev, rating: "" }));
        setErrors((prev) => ({ ...prev, rating: "" }));
        return;
      }
      const n = Number(value);
      if (Number.isNaN(n)) {
        setFormData((prev) => ({ ...prev, rating: "" }));
        setErrors((prev) => ({ ...prev, rating: "Enter a number like 6.20" }));
        return;
      }
      const clamped = clampUTR(n);
      const derived = skillFromUTR(clamped);
      setFormData((prev) => ({
        ...prev,
        rating: clamped,
        skillBand: derived || prev.skillBand,
      }));
      setErrors((prev) => ({ ...prev, rating: "" }));
      return;
    }

if (name === "birthYear") {
  const digits = value.replace(/\D/g, "").slice(0, 4); // YYYY
  setFormData((prev) => ({ ...prev, birthYear: digits }));
  setErrors((prev) => ({ ...prev, birthYear: "" }));
  return;
}





    setFormData((prev) => ({ ...prev, [name]: value }));
    setErrors((prev) => {
      const becomesValid =
        name === "password"
          ? isSignupPasswordValid(value)
          : name === "email"
            ? /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim())
            : Boolean(value);
      return becomesValid ? { ...prev, [name]: "" } : prev;
    });
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
      setErrors((prev) => ({ ...prev, photo: "" }));
    } catch {
      setStatus("❌ Crop failed.");
    }
  };

const handleSubmit = async (e: React.FormEvent) => {
  e.preventDefault();
  if (submissionRef.current) return;

  const newErrors: { [k: string]: string } = {};
  if (!formData.name) newErrors.name = "Name is required.";
  if (!formData.email) newErrors.email = "Email is required.";
  else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(formData.email.trim())) {
    newErrors.email = "Enter a valid email address.";
  }
  if (!formData.password) newErrors.password = "Password is required.";
  else if (!isPasswordValid) newErrors.password = SIGNUP_PASSWORD_ERROR;
  if (!formData.postcode) newErrors.postcode = "Postcode is required.";
  if (!formData.skillBand) newErrors.skillBand = "Skill level is required.";
  if (formData.availability.length === 0) {
    newErrors.availability = "Pick at least one time slot.";
  }

  if (!hasPhoto) {
    newErrors.photo = "A profile photo is required. Please upload and confirm the crop.";
  }

  if (formData.rating !== "" && (formData.rating < 1 || formData.rating > 16.5)) {
    newErrors.rating = "TMR must be between 1.00 and 16.50.";
  }

  const currentYear = new Date().getFullYear();

  if (!formData.birthYear) {
    newErrors.birthYear = "Birth year is required (18+).";
  } else {
    const by = Number(formData.birthYear);
    const age = currentYear - by;

    if (!Number.isFinite(by) || by < 1900 || by > currentYear) {
      newErrors.birthYear = "Please enter a valid year (e.g. 1994).";
    } else if (age < 18) {
      newErrors.birthYear = "TennisMate is for adults only (18+).";
    } else if (age > 110) {
      newErrors.birthYear = "Please enter a valid year (e.g. 1994).";
    }
  }

  setErrors(newErrors);
  if (Object.keys(newErrors).length > 0) {
    setStatus("Please correct the highlighted fields.");
    const fieldOrder = ["name", "email", "password", "postcode", "birthYear", "skillBand", "availability", "photo", "rating"];
    const firstInvalid = fieldOrder.find((field) => newErrors[field]);
    if (firstInvalid) focusField(firstInvalid);
    return;
  }

  submissionRef.current = true;
  setIsSubmitting(true);

  setStatus("Checking your postcode...");

  const postcode = formData.postcode.trim();
  const firstDigit = postcode.charAt(0);
  let postcodeRecord: Record<string, unknown> | null = null;
  if (firstDigit === "2" || firstDigit === "3") {
    try {
      const postcodeSnapshot = await getDoc(doc(db, "postcodes", postcode));
      postcodeRecord = postcodeSnapshot.exists() ? postcodeSnapshot.data() : null;
    } catch {
      void trackEvent("postcode_validation_failed", { reason: "lookup_unavailable" });
      setErrors((current) => ({
        ...current,
        postcode: "We couldn't verify that postcode right now. Please try again.",
      }));
      setStatus("");
      finishSubmission();
      focusField("postcode");
      return;
    }
  }

  const postcodeEligibility = classifyPostcode(postcode, postcodeRecord);
  if (postcodeEligibility.kind === "invalid") {
    void trackEvent("postcode_validation_failed", { reason: "invalid_format" });
    setErrors((current) => ({ ...current, postcode: "Enter a valid 4-digit postcode." }));
    setStatus("");
    finishSubmission();
    focusField("postcode");
    return;
  }
  if (postcodeEligibility.kind === "unknown") {
    void trackEvent("postcode_validation_failed", { reason: "unknown_postcode" });
    setErrors((current) => ({
      ...current,
      postcode: "We don't recognise that postcode yet. Check it and try again.",
    }));
    setStatus("");
    finishSubmission();
    focusField("postcode");
    return;
  }

  let authUserCreated = false;
  try {
    setStatus("Creating your account...");
    void trackEvent("account_creation_started", {
      supported_region: postcodeEligibility.kind === "supported",
    });
    const email = formData.email.trim().toLowerCase();
    const { user } = await createUserWithEmailAndPassword(auth, email, formData.password);
    authUserCreated = true;
    const uid = user.uid;
    const authEmail = user.email?.trim().toLowerCase() || email;
    void trackEvent("auth_account_created");

    const referralCandidates = collectReferralCandidates({
      stored: sessionStorage.getItem(REFERRAL_SESSION_KEY),
      ref: searchParams.get("ref"),
      rc: searchParams.get("rc"),
      cookie: referralCookieValue(document.cookie),
    });
    const initialization = await initializeOrRepairAccount({
      user,
      displayName: formData.name,
      birthYear: Number(formData.birthYear),
      referralCandidates,
    });
    void trackEvent("account_initialization_completed", {
      repaired_document_count: initialization.repairedDocuments.length,
      referral_captured: initialization.referralCaptured,
    });
    if (initialization.referralCaptured) void trackEvent("referral_captured");
    const initialVerificationSent = await sendInitialVerificationIfClaimed({
      user,
      shouldSendVerification: initialization.shouldSendVerification,
      next: nextDestination,
    }).catch(() => false);
    if (initialVerificationSent) void trackEvent("verification_sent", { send_type: "initial" });

    if (postcodeEligibility.kind === "unsupported") {
      await markUnsupportedPostcodeWaitlist({ postcode, displayName: formData.name });
      void trackEvent("waitlist_signup_completed", { supported_region: false });
      setShowWaitlistModal(true);
      setStatus("");
      finishSubmission();
      return;
    }

    if (!croppedImage) {
      setErrors((current) => ({ ...current, photo: "Please add a profile photo." }));
      setStatus("");
      finishSubmission();
      return;
    }

    const fullRef = ref(storage, `profile_pictures/${uid}/avatar_full.jpg`);
    await uploadBytes(fullRef, croppedImage, { contentType: "image/jpeg" });
    const photoURL = await getDownloadURL(fullRef);
    const thumbFile = await makeAvatarThumb(croppedImage, 160, 0.72);
    const thumbRef = ref(storage, `profile_pictures/${uid}/avatar_thumb.jpg`);
    await uploadBytes(thumbRef, thumbFile, { contentType: "image/jpeg" });
    const photoThumbURL = await getDownloadURL(thumbRef);

    const userRef = doc(db, "users", uid);
    const playerRef = doc(db, "players", uid);
    const privatePlayerRef = doc(db, "players_private", uid);
    const [userSnap, playerSnap, privatePlayerSnap] = await Promise.all([
      getDoc(userRef),
      getDoc(playerRef),
      getDoc(privatePlayerRef),
    ]);
    const createdAt = userSnap.data()?.createdAt ?? serverTimestamp();
    const ratingOrNull = formData.rating === "" ? null : formData.rating;
    const skillBandValue = formData.skillBand || null;
    const batch = writeBatch(db);
    batch.set(userRef, {
      name: formData.name,
      email: authEmail,
      photoURL,
      photoThumbURL,
      requireVerification: true,
      ...(userSnap.exists() ? {} : { createdAt }),
    }, { merge: true });
    batch.set(playerRef, {
      name: formData.name,
      nameLower: formData.name.toLowerCase(),
      postcode,
      gender: formData.gender,
      isMatchable: true,
      skillRating: ratingOrNull,
      utr: ratingOrNull,
      skillBand: skillBandValue,
      skillBandLabel: toSkillLabel(skillBandValue),
      availability: formData.availability,
      bio: formData.bio,
      photoURL,
      photoThumbURL,
      profileComplete: true,
      updatedAt: serverTimestamp(),
      ...(playerSnap.exists() ? {} : { createdAt }),
    }, { merge: true });
    batch.set(privatePlayerRef, {
      email: authEmail,
      postcode,
      birthYear: Number(formData.birthYear),
      lat: postcodeEligibility.lat,
      lng: postcodeEligibility.lng,
      geohash: geohashForLocation([postcodeEligibility.lat, postcodeEligibility.lng]),
      updatedAt: serverTimestamp(),
      ...(privatePlayerSnap.exists() ? {} : { createdAt }),
    }, { merge: true });
    await batch.commit();

    void trackEvent("signup_completed", {
      skill_band: skillBandValue,
      has_rating: ratingOrNull !== null,
      availability_count: formData.availability.length,
      supported_region: true,
    });
    setStatus("");
    router.replace(`/verify-email?next=${encodeURIComponent(nextDestination)}`);
    return;
  } catch (error: any) {
    const code = error?.code || "unknown";
    const setupFailed = authUserCreated || Boolean(auth.currentUser);
    const diagnostics = signupFailureDiagnostics({
      code,
      route: "/signup",
      platform: runtimePlatform(),
      appVersion: process.env.NEXT_PUBLIC_APP_VERSION,
      clientValidationPassed: true,
      email: formData.email,
      stage: setupFailed ? "account_setup" : "authentication",
    });
    console.error("[signup_failed]", diagnostics);
    void trackEvent("signup_failed", diagnostics);

    if (setupFailed) {
      void trackEvent("onboarding_interrupted", { stage: "profile_initialization" });
      setStatus("Your account was created, but setup did not finish. Your progress is safe—sign in again to resume.");
      finishSubmission();
      return;
    }

    const mapped = mapSignupAuthError(code);
    if (mapped.field) {
      setErrors((current) => ({...current, [mapped.field!]: mapped.message}));
      focusField(mapped.field);
    }
    if (mapped.showAccountActions) {
      setExistingEmail(formData.email.trim().toLowerCase());
      setShowEmailExistsModal(true);
    }
    setStatus(mapped.field ? "" : mapped.message);
    finishSubmission();
    return;
  }
};

  return (
    <>
      {showEmailExistsModal && (
  <SignupErrorModal
    email={existingEmail}
    onClose={() => setShowEmailExistsModal(false)}
    onGoToLogin={() => {
      const next = searchParams.get("next");
      router.push(
        `/login?email=${encodeURIComponent(existingEmail)}${
          next ? `&next=${encodeURIComponent(next)}` : ""
        }`
      );
    }}
    onResetPassword={() => {
      router.push(`/forgot-password?email=${encodeURIComponent(existingEmail)}`);
    }}
  />
)}


      <div className="relative min-h-screen">
        <Image src="/images/login-tennis-court.jpg" alt="" fill priority className="object-cover" />
        <div className="absolute inset-0 bg-black/40" />

        <div className="relative z-10 min-h-screen flex flex-col items-center justify-center px-4">
          <div className="relative w-full max-w-xl bg-white/95 backdrop-blur-md p-8 rounded-2xl shadow-xl ring-1 ring-black/5">
            <Link
              href="/login"
              className="absolute top-4 left-4 text-sm bg-green-600 hover:bg-green-700 text-white py-1 px-3 rounded"
            >
              Login
            </Link>

            <div className="flex justify-center mb-6">
              <Image src="/logo.png" alt="TennisMate Logo" width={100} height={100} className="rounded-full" />
            </div>

            <h1 className="text-2xl font-bold mb-6 text-center">Join TennisMate and Get on Court</h1>

            <form onSubmit={handleSubmit} noValidate className="space-y-4 mt-2">
              {/* Name */}
              <label htmlFor="signup-name" className="block text-sm font-medium mb-1">
                Name <span className="text-red-600">*</span>
              </label>
              <div className="relative mb-1">
                <User className="absolute left-3 top-2.5 h-5 w-5 text-gray-400" />
                <input
                  id="signup-name"
                  type="text"
                  name="name"
                  value={formData.name}
                  onChange={handleChange}
                  placeholder="Your name"
                  required
                  autoComplete="name"
                  autoCapitalize="words"
                  aria-invalid={Boolean(errors.name)}
                  aria-describedby={errors.name ? "signup-name-error" : undefined}
                  className={`w-full pl-10 pr-3 py-2.5 border rounded-lg focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-green-500 ${errors.name ? "border-red-600" : "border-gray-300"}`}
                />
              </div>
              {errors.name && <p id="signup-name-error" role="alert" className="text-sm text-red-600 mb-2">{errors.name}</p>}

              {/* Email */}
              <label htmlFor="signup-email" className="block text-sm font-medium mb-1">
                Email address <span className="text-red-600">*</span>
              </label>
              <div className="relative mb-1">
                <Mail className="absolute left-3 top-2.5 h-5 w-5 text-gray-400" />
                <input
                  id="signup-email"
                  type="email"
                  name="email"
                  value={formData.email}
                  onChange={handleChange}
                  placeholder="you@example.com"
                  required
                  autoComplete="email"
                  autoCapitalize="none"
                  autoCorrect="off"
                  inputMode="email"
                  aria-invalid={Boolean(errors.email)}
                  aria-describedby={errors.email ? "signup-email-error" : undefined}
                  className={`w-full pl-10 pr-3 py-2.5 border rounded-lg focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-green-500 ${errors.email ? "border-red-600" : "border-gray-300"}`}
                />
              </div>
              {errors.email && <p id="signup-email-error" role="alert" className="text-sm text-red-600 mb-2">{errors.email}</p>}

              {/* Password */}
              <label htmlFor="signup-password" className="block text-sm font-medium mb-1">
                Password <span className="text-red-600">*</span>
              </label>
              <div className="relative mb-1">
                <Lock className="absolute left-3 top-2.5 h-5 w-5 text-gray-400" />
                <input
                  id="signup-password"
                  type="password"
                  name="password"
                  value={formData.password}
                  onChange={handleChange}
                  placeholder="Password"
                  required
                  autoComplete="new-password"
                  aria-invalid={Boolean(errors.password)}
                  aria-describedby={`signup-password-requirements${errors.password ? " signup-password-error" : ""}`}
                  className={`w-full pl-10 pr-3 py-2.5 border rounded-lg focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-green-500 ${errors.password ? "border-red-600" : "border-gray-300"}`}
                />
              </div>
              {errors.password && <p id="signup-password-error" role="alert" className="text-sm text-red-600 mb-2">{errors.password}</p>}

              <div id="signup-password-requirements" className="bg-gray-50 border border-gray-300 rounded px-3 py-2 mt-1 text-sm text-gray-800 shadow min-w-[220px]">
                  <strong>Password requirements:</strong>
                  <ul className="list-none mt-1 space-y-1">
                    {([
                      ["length", "At least 6 characters"],
                      ["number", "At least 1 number"],
                      ["special", "At least 1 special character"],
                    ] as const).map(([criterion, label]) => {
                      const valid = passwordCriteria[criterion];
                      return <li key={criterion} className="flex items-center gap-2">
                        {valid ? <CheckCircle2 className="h-4 w-4 text-green-700" aria-hidden="true" /> : <CircleX className="h-4 w-4 text-red-600" aria-hidden="true" />}
                        <span>{label}<span className="sr-only"> — {valid ? "requirement met" : "requirement not met"}</span></span>
                      </li>;
                    })}
                  </ul>
                </div>

              {/* Postcode */}
              <label className="block text-sm font-medium mb-1">
                Postcode <span className="text-red-600">*</span>
              </label>
              <div className="relative mb-1">
                <MapPin className="absolute left-3 top-2.5 h-5 w-5 text-gray-400" />
                <input
                  type="text"
                  name="postcode"
                  value={formData.postcode}
                  onChange={handleChange}
                  placeholder="e.g. 3000"
                  required
                  inputMode="numeric"
                  pattern="[0-9]{4}"
                  maxLength={4}
                  autoComplete="postal-code"
                  title="Enter a 4-digit postcode, e.g. 3058"
                  className="w-full pl-10 pr-3 py-2.5 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-green-500"
                />
              </div>
              {errors.postcode && <p className="text-sm text-red-600 mb-2">{errors.postcode}</p>}

              {/* Gender (optional) */}
<label className="block text-sm font-medium mb-1">
  Gender (optional)
</label>
<select
  name="gender"
  value={formData.gender}
  onChange={handleChange}
  className="w-full pl-3 pr-8 py-2.5 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-green-500 bg-white"
>
  <option value="">Prefer not to say</option>
  <option value="Male">Male</option>
  <option value="Female">Female</option>
  <option value="Non-binary">Non-binary</option>
  <option value="Other">Other</option>
</select>
{errors.gender && <p className="text-sm text-red-600 mt-1">{errors.gender}</p>}

{/* Birth Year (required) */}
<label className="block text-sm font-medium mb-1">
  Birth Year <span className="text-red-600">*</span>
</label>
<input
  type="text"
  name="birthYear"
  inputMode="numeric"
  placeholder="e.g. 1994"
  value={formData.birthYear}
  onChange={handleChange}
  maxLength={4}
  className="w-full px-3 py-2.5 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-green-500"
/>
{errors.birthYear && <p className="text-sm text-red-600 mt-1">{errors.birthYear}</p>}
<p className="text-xs text-gray-500">
  Used to confirm you’re 18+ and to improve matchmaking. Your birth year is not shown publicly.
</p>



              {/* TMR (optional) */}
              <div className="grid gap-2">
                <label className="block text-sm font-medium mb-1">
                  {RATING_LABEL} (optional)
                </label>
                <input
                  type="number"
                  name="rating"
                  step="0.01"
                  min={1}
                  max={16.5}
                  inputMode="decimal"
                  placeholder="e.g., 6.20"
                  value={formData.rating}
                  onChange={handleChange}
                  className="w-full px-3 py-2.5 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-green-500"
                />
                {errors.rating && <p className="text-sm text-red-600 mt-1">{errors.rating}</p>}
                {typeof formData.rating === "number" && (
                  <p className="text-xs text-gray-600">
                    Suggested level:{" "}
                    <strong>
                      {SKILL_OPTIONS.find((s) => s.value === (skillFromUTR(formData.rating as number) ?? ""))?.label}
                    </strong>
                    .
                  </p>
                )}
                <p className="text-xs text-gray-500">
                  1.00–16.50. Comparable to UTR® (TennisMate is not affiliated with Universal Tennis).
                </p>
              </div>

              {/* Skill level */}
              <label className="block text-sm font-medium mb-1">
                Skill level <span className="text-red-600">*</span>
              </label>
              <select
                name="skillBand"
                value={formData.skillBand}
                onChange={handleChange}
                required
                className="w-full pl-3 pr-8 py-2.5 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-green-500 bg-white"
              >
                <option value="" disabled>
                  Select your level…
                </option>
                {SKILL_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
              {errors.skillBand && <p className="text-sm text-red-600 mt-1">{errors.skillBand}</p>}

              {/* Availability */}
              <fieldset className="mt-2">
                <legend className="block text-sm font-medium mb-2">
                  Availability <span className="text-red-600">*</span>
                </legend>
                {["Weekdays AM", "Weekdays PM", "Weekends AM", "Weekends PM"].map((slot) => {
                  const checked = formData.availability.includes(slot);
                  return (
                    <label key={slot} className="flex items-center gap-2 mb-2">
                      <input
                        type="checkbox"
                        value={slot}
                        checked={checked}
                        onChange={handleCheckbox}
                        className="h-4 w-4 accent-green-600"
                      />
                      <span>{slot}</span>
                    </label>
                  );
                })}
                {errors.availability && <p className="text-sm text-red-600 mt-1">{errors.availability}</p>}
              </fieldset>

              {/* Bio */}
              <textarea
                name="bio"
                value={formData.bio}
                onChange={handleChange}
                placeholder="Short bio"
                rows={4}
                className="w-full p-2 border rounded"
              />

              {/* Profile picture (REQUIRED) */}
              <div className="flex flex-col items-start gap-2">
                <label className="text-sm font-medium">
                  Profile Picture <span className="text-red-600">*</span>
                </label>

                <div className={`w-20 h-20 rounded-full border bg-gray-100 overflow-hidden ${!hasPhoto ? "ring-2 ring-red-300" : ""}`}>
                  <img src={previewURL} alt="Profile preview" className="w-20 h-20 object-cover" />
                </div>

                {!hasPhoto && (
                  <p className="text-xs text-red-600">
                    Please upload a clear photo of yourself (required).
                  </p>
                )}

                <div className="flex items-center gap-2">
                  <label
                    htmlFor="upload"
                    className="cursor-pointer inline-flex items-center gap-2 bg-green-600 hover:bg-green-700 text-white text-sm px-3 py-2 rounded"
                  >
                    <Camera className="h-4 w-4" />
                    Choose Photo
                  </label>
               <input
  id="upload"
  type="file"
  accept="image/*"
  onChange={handleImageChange}
  className="hidden"
/>

                </div>

                {errors.photo && <p className="text-sm text-red-600">{errors.photo}</p>}
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
                className={`w-full bg-green-600 hover:bg-green-700 text-white px-4 py-2.5 rounded-lg transition ${
                  isSubmitting ? "opacity-60 cursor-not-allowed" : ""
                }`}
                disabled={isSubmitting}
              >
                {isSubmitting ? <span className="inline-flex items-center gap-2"><Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />Creating Account…</span> : "Create Account"}
              </button>

              {status && (
                <div role="alert" aria-live="assertive" className="mt-2 text-sm text-gray-800">
                  {status}
                </div>
              )}

              <div className="text-xs text-gray-600 text-center mt-4">
                By signing up, you agree to our{" "}
                <a href="/terms" className="text-blue-600 underline">
                  Terms
                </a>{" "}
                and{" "}
                <a href="/privacy" className="text-blue-600 underline">
                  Privacy Policy
                </a>
                .
              </div>
            </form>
          </div>

          {showWaitlistModal && (
            <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50">
              <div className="bg-white rounded-xl shadow-lg p-6 max-w-md text-center space-y-4">
                <h2 className="text-xl font-semibold">Thanks for signing up!</h2>
                <p className="text-gray-700 text-sm">
                 📍 TennisMate is currently only available in Victoria and New South Wales.<br />
We’ve saved your interest and will notify you when we launch
in your area.
                </p>
                <button
                  onClick={() => router.replace(`/verify-email?next=${encodeURIComponent(nextDestination)}`)}
                  className="mt-2 bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded"
                >
                  Got it
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </>
  );
}
