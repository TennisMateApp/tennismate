"use client";

import { useEffect, useState, useMemo } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { auth, db, storage } from "@/lib/firebaseConfig";
import { getFunctionsClient } from "@/lib/getFunctionsClient";
import { onAuthStateChanged, updateProfile } from "firebase/auth";
import {
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  setDoc,
  serverTimestamp,
  where,
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
import { geohashForLocation } from "geofire-common";
import TMDesktopSidebar from "@/components/desktop_layout/TMDesktopSidebar";
import { useIsDesktop } from "@/lib/useIsDesktop";
import {
  PROFILE_FULL_PATH,
  PROFILE_THUMB_PATH,
  cleanupLegacyProfilePhotos,
  resolveProfilePhoto,
} from "@/lib/profilePhoto";


const TM = {
  forest: "#0B3D2E",
  forestDark: "#071B15",
  neon: "#39FF14",
  ink: "#0B3D2E",
  cream: "#F5F5F0",
  tile: "#FFFFFF",
  softRing: "rgba(57,255,20,0.35)",
};



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

const normalizeBadges = (raw: any): string[] => {
  if (Array.isArray(raw)) {
    return raw.filter((b): b is string => typeof b === "string" && b.trim().length > 0);
  }

  // Support old object format like { firstWin: true, loveHold: true }
  if (raw && typeof raw === "object") {
    return Object.entries(raw)
      .filter(([_, value]) => value === true)
      .map(([key]) => key);
  }

  return [];
};

const arraysEqualUnordered = (a: string[], b: string[]) => {
  if (a.length !== b.length) return false;
  const as = [...a].sort();
  const bs = [...b].sort();
  return as.every((v, i) => v === bs[i]);
};

async function logFirestoreCall<T>(label: string, operation: () => Promise<T>): Promise<T> {
  console.info(`[ProfileContent][Firestore] START ${label}`);
  try {
    const result = await operation();
    console.info(`[ProfileContent][Firestore] OK ${label}`);
    return result;
  } catch (error) {
    console.error(`[ProfileContent][Firestore] FAIL ${label}`, error);
    throw error;
  }
}

const legacyToBand = (level?: string): SkillBand | "" => {
  if (!level) return "";
  const norm = level.toLowerCase();
  if (norm.includes("beginner")) return "beginner";
  if (norm.includes("intermediate")) return "intermediate";
  if (norm.includes("advanced") || norm.includes("advance")) return "advanced";
  return "";
};

export default function ProfileContent() {
  const router = useRouter();
  const isDesktop = useIsDesktop();
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

  const originalPostcodeRef = React.useRef<string>("");

const [formData, setFormData] = useState({
  name: "",
  postcode: "",
  skillBand: "" as SkillBand | "",
  rating: "" as number | "",
  availability: [] as string[],
  isMatchable: true,
  bio: "",
  photoURL: "",
  photoThumbURL: "",
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
    const userSnap = await logFirestoreCall(`getDoc users/${currentUser.uid}`, () =>
      getDoc(userRef)
    );
    const u = userSnap.exists() ? (userSnap.data() as any) : {};

    setUserRole(typeof u.role === "string" ? u.role : "");
    setCoachInvited(u.coachInvited === true);


    const playerRef = doc(db, "players", currentUser.uid);
    const privatePlayerRef = doc(db, "players_private", currentUser.uid);
    const [snap, privateSnap] = await Promise.all([
      logFirestoreCall(`getDoc players/${currentUser.uid}`, () => getDoc(playerRef)),
      logFirestoreCall(`getDoc players_private/${currentUser.uid}`, () =>
        getDoc(privatePlayerRef)
      ),
    ]);
    const data = snap.data() || {};
    const privateData = privateSnap.data() || {};

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
  postcode: privateData.postcode || data.postcode || "",
  skillBand: derivedBand || "",
  rating: typeof ratingNumber === "number" ? ratingNumber : "",
  availability: data.availability || [],
  isMatchable: typeof data.isMatchable === "boolean" ? data.isMatchable : true,
  bio: data.bio || "",
  photoURL: typeof data.photoURL === "string" ? data.photoURL : "",
  photoThumbURL: resolveProfilePhoto(data) || "",
  badges: normalizeBadges(data.badges),
  birthYear: typeof privateData.birthYear === "number" ? privateData.birthYear : "",
  gender: typeof data.gender === "string" ? data.gender : "",
  timestamp: data.timestamp || null,
});

originalPostcodeRef.current = String(privateData.postcode || data.postcode || "").trim();

    const currentPhoto = resolveProfilePhoto(data);
    if (currentPhoto) setPreviewURL(currentPhoto);

    // ✅ Matches = accepted OR confirmed match requests (sent or received)
   const requestStatusesToCount = ["accepted", "confirmed", "completed"];

    const requestSnaps = await Promise.all(
      requestStatusesToCount.flatMap((status) => [
        logFirestoreCall(
          `getDocs match_requests fromUserId=${currentUser.uid} status=${status}`,
          () =>
            getDocs(
              query(
                collection(db, "match_requests"),
                where("fromUserId", "==", currentUser.uid),
                where("status", "==", status)
              )
            )
        ),
        logFirestoreCall(
          `getDocs match_requests toUserId=${currentUser.uid} status=${status}`,
          () =>
            getDocs(
              query(
                collection(db, "match_requests"),
                where("toUserId", "==", currentUser.uid),
                where("status", "==", status)
              )
            )
        ),
      ])
    );

    // Deduplicate in case the same request is seen more than once
    const acceptedRequestIds = new Set<string>();
    requestSnaps.forEach((snap) => {
      snap.forEach((docSnap) => acceptedRequestIds.add(docSnap.id));
    });

    const acceptedMatches = acceptedRequestIds.size;

    // ✅ Completed + Wins = from match_history
    const historyQ = query(
      collection(db, "match_history"),
      where("players", "array-contains", currentUser.uid)
    );

    const historySnap = await logFirestoreCall(
      `getDocs match_history players array-contains ${currentUser.uid}`,
      () => getDocs(historyQ)
    );

    let completed = 0;
    let wins = 0;
    let hasLoveHold = false;

    historySnap.forEach((d) => {
      const m = d.data() as any;

      const isCompleted =
        m.completed === true ||
        m.status === "completed";

      if (isCompleted) {
        completed++;
      }

      // Win detection
      const isWin =
        m.winnerId === currentUser.uid ||
        (Array.isArray(m.winnerIds) && m.winnerIds.includes(currentUser.uid)) ||
        (Array.isArray(m.completedByWinner) && m.completedByWinner.includes(currentUser.uid));

      if (isWin) {
        wins++;
      }

      // Love Hold badge: user must be the winner and one set must be 6-0
      if (isWin && Array.isArray(m.sets)) {
        const wonWithBagel = m.sets.some((s: any) => {
          const a = typeof s?.A === "number" ? s.A : null;
          const b = typeof s?.B === "number" ? s.B : null;
          if (a == null || b == null) return false;
          return (a === 6 && b === 0) || (a === 0 && b === 6);
        });

        if (wonWithBagel) {
          hasLoveHold = true;
        }
      }
    });

    setMatchStats({
      matches: acceptedMatches,
      completed,
      wins,
    });

    // ✅ Derive badges from real stats/history
    const existingBadges = normalizeBadges(data.badges);
    const earnedBadges: string[] = [];

    if (acceptedMatches >= 1) earnedBadges.push("firstMatch");
    if (completed >= 1) earnedBadges.push("firstMatchComplete");
    if (wins >= 1) earnedBadges.push("firstWin");
    if (hasLoveHold) earnedBadges.push("loveHold");

    const mergedBadges = Array.from(new Set([...existingBadges, ...earnedBadges]));

    // If badges were in old object format, or any new ones were earned, normalize/write back
    if (!arraysEqualUnordered(existingBadges, mergedBadges)) {
      await logFirestoreCall(`setDoc players/${currentUser.uid} badges merge`, () =>
        setDoc(doc(db, "players", currentUser.uid), { badges: mergedBadges }, { merge: true })
      );
    }

    setFormData((prev) => ({
      ...prev,
      badges: mergedBadges,
    }));

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
    setFormData((p) => ({ ...p, photoURL: "", photoThumbURL: "" }));

    if (user) {
      await deleteObject(ref(storage, PROFILE_FULL_PATH(user.uid))).catch(() => {});
      await deleteObject(ref(storage, PROFILE_THUMB_PATH(user.uid))).catch(() => {});
      await cleanupLegacyProfilePhotos(storage, user.uid);
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
    const playerSnap = await logFirestoreCall(`getDoc players/${uid} (coach activation)`, () =>
      getDoc(doc(db, "players", uid))
    );
    const nextRole = playerSnap.exists() ? "both" : "coach";

    // 1) Update users doc to grant coach access
    await logFirestoreCall(`setDoc users/${uid} coach activation merge`, () =>
      setDoc(
        doc(db, "users", uid),
        {
          role: nextRole,
          coachInvited: false, // consume invite
          coachActivatedAt: serverTimestamp(),
        },
        { merge: true }
      )
    );

    // 2) Ensure coaches/{uid} exists (create starter doc if missing)
    const coachRef = doc(db, "coaches", uid);
    const coachSnap = await logFirestoreCall(`getDoc coaches/${uid}`, () => getDoc(coachRef));

    if (!coachSnap.exists()) {
      await logFirestoreCall(`setDoc coaches/${uid} bootstrap merge`, () =>
        setDoc(
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
        )
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

const getLatLngForPostcode = async (postcode: string): Promise<{ lat: number; lng: number }> => {
  const pc = postcode.trim();
  const pcRef = doc(db, "postcodes", pc);
  const pcSnap = await logFirestoreCall(`getDoc postcodes/${pc}`, () => getDoc(pcRef));

  if (!pcSnap.exists()) {
    throw new Error("POSTCODE_NOT_FOUND");
  }

  const data = pcSnap.data() as any;
  const lat = typeof data.lat === "number" ? data.lat : null;
  const lng = typeof data.lng === "number" ? data.lng : null;

  if (lat == null || lng == null) {
    throw new Error("POSTCODE_BAD_COORDS");
  }

  return { lat, lng };
};

const saveProfile = async (): Promise<boolean> => {
  if (!user) return false;

  // Require a profile photo to save
if (!hasPhoto) {
  setStatus("Please add a profile photo to continue.");
  return false;
}

  // basic client-side validation
if (!formData.name.trim()) {
  setStatus("Please enter your name.");
  return false;
}
if (!formData.skillBand) {
  setStatus("Please choose a skill level.");
  return false;
}
if (!formData.availability || formData.availability.length === 0) {
  setStatus("Please select at least one availability option.");
  return false;
}

  // Birth Year validation (18+)
  const currentYear = new Date().getFullYear();
  const by = typeof formData.birthYear === "number" ? formData.birthYear : null;

if (!by) {
  setStatus("Please enter your birth year.");
  return false;
}

  const age = currentYear - by;

if (!Number.isFinite(by) || by < 1900 || by > currentYear) {
  setStatus("Please enter a valid birth year (e.g. 1994).");
  return false;
}

  if (age < 18) {
  setStatus("TennisMate is for adults only (18+).");
  return false;
}

if (age > 110) {
  setStatus("Please enter a valid birth year (e.g. 1994).");
  return false;
}

  // AU postcode (4 digits), VIC + NSW only for now
  const trimmedPostcode = formData.postcode.trim();

if (!/^\d{4}$/.test(trimmedPostcode)) {
  setStatus("Enter a valid 4-digit postcode.");
  return false;
}

  const firstDigit = trimmedPostcode.charAt(0);
if (firstDigit !== "2" && firstDigit !== "3") {
  setStatus(
    "For now TennisMate is only available in VIC and NSW (postcodes starting with 2 or 3)."
  );
  return false;
}
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
      try {
        const { lat, lng } = await getLatLngForPostcode(newPostcode);
        nextLat = lat;
        nextLng = lng;
        nextGeohash = geohashForLocation([lat, lng]);
      } catch (err) {
        console.error("[Profile] postcode lookup failed", err);
        setStatus("❌ Could not find coordinates for that postcode. Please check it and try again.");
     setSaving(false);
return false;
      }
    }

let photoURL = formData.photoURL;
let photoThumbURL = formData.photoThumbURL || formData.photoURL;

if (croppedImage) {
  const fullRef = ref(storage, PROFILE_FULL_PATH(user.uid));
  const thumbRef = ref(storage, PROFILE_THUMB_PATH(user.uid));
  await uploadBytes(fullRef, croppedImage, { contentType: "image/jpeg" });
  await uploadBytes(thumbRef, croppedImage, { contentType: "image/jpeg" });
  photoURL = await getDownloadURL(fullRef);

  // For now use the same image for both until you generate real thumbnails
  photoThumbURL = await getDownloadURL(thumbRef);
  await cleanupLegacyProfilePhotos(storage, user.uid);
}

const badges = Array.isArray(formData.badges) ? formData.badges : [];

const playerPayload = {
  postcode: newPostcode,
  badges,
  gender: formData.gender || null,
  skillBand: formData.skillBand || null,
  skillBandLabel: toSkillLabel(formData.skillBand),
  skillRating: formData.rating === "" ? null : formData.rating,
  utr: formData.rating === "" ? null : formData.rating,
  skillLevel: coarseFromBand(formData.skillBand),
  photoURL,
  photoThumbURL,
  name: formData.name || "",
  nameLower: (formData.name || "").toLowerCase(),
  bio: formData.bio || "",
  availability: formData.availability || [],
  timestamp: serverTimestamp(),
  profileComplete: true,
  isMatchable: !!formData.isMatchable,
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
  logFirestoreCall(`setDoc players/${user.uid} profile merge`, () =>
    setDoc(
      doc(db, "players", user.uid),
      {
        ...playerPayload,
        avatar: photoThumbURL || photoURL || null,
        photoUpdatedAt: serverTimestamp(),
      },
      { merge: true }
    )
  ),
  logFirestoreCall(`setDoc players_private/${user.uid} profile merge`, () =>
    setDoc(doc(db, "players_private", user.uid), privatePlayerPayload, { merge: true })
  ),
  logFirestoreCall(`setDoc users/${user.uid} profile merge`, () =>
    setDoc(doc(db, "users", user.uid), userPayload, { merge: true })
  ),
]);

if (auth.currentUser) {
  await updateProfile(auth.currentUser, {
    photoURL: photoThumbURL || photoURL || null,
    displayName: formData.name || auth.currentUser.displayName || null,
  }).catch((error) => {
    console.warn("[Profile] auth profile sync skipped", error);
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

    setStatus("✅ Profile saved successfully!");
    return true;
  } catch (e) {
    console.error(e);
    setStatus("❌ Error saving profile.");
    return false;
  } finally {
    setSaving(false);
  }
};

const handleSubmit = async (e: React.FormEvent) => {
  e.preventDefault();

  const ok = await saveProfile();

  if (ok) {
    router.replace("/profile");
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
      ref(storage, PROFILE_FULL_PATH(uid))
    ).catch((e) =>
      console.warn("[Profile] storage delete skipped", e)
    );
    await deleteObject(ref(storage, PROFILE_THUMB_PATH(uid))).catch((e) =>
      console.warn("[Profile] thumb storage delete skipped", e)
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

  if (isDesktop) {
  return (
    <div className="min-h-screen" style={{ background: TM.cream }}>
      <div className="mx-auto max-w-7xl px-6 py-6">
        <div className="grid grid-cols-[300px_1fr] gap-8 items-start">
          <TMDesktopSidebar active="Profile" />
          <div className="min-w-0">
            {/* ✅ Put your DESKTOP profile UI here */}
          </div>
        </div>
      </div>
    </div>
  );
}

return (
  <div className="min-h-screen w-full" style={{ background: TM.cream }}>
    <div className="relative mx-auto max-w-[520px] px-4 pt-4 pb-40 overflow-x-hidden">

{!editMode ? (
  <>
    {/* TOP BAR */}
    <div className="flex items-center justify-between pt-2">
      <button
  type="button"
  onClick={() => router.push("/home")}
  className="h-10 w-10 rounded-full grid place-items-center"
  style={{ background: "rgba(0,0,0,0.04)" }}
  aria-label="Back"
>
  <span className="text-xl" style={{ color: TM.forest }}>‹</span>
</button>

      <div className="text-base font-extrabold" style={{ color: TM.forest }}>
        My Profile
      </div>

      <button
        type="button"
        onClick={() => router.push("/profile?edit=true")}
        className="h-10 w-10 rounded-full grid place-items-center"
        style={{ background: "rgba(0,0,0,0.04)" }}
        aria-label="Edit profile"
      >
        <span className="text-lg" style={{ color: TM.forest }}>⚙️</span>
      </button>
    </div>

    {/* AVATAR + NAME + BADGE */}
    <div className="mt-6 flex flex-col items-center text-center">
      <div className="relative">
        <img
          src={previewURL || "/default-avatar.png"}
          alt={`${formData.name || "User"} avatar`}
          className="h-[120px] w-[120px] rounded-full object-cover"
          style={{ boxShadow: `0 0 0 6px ${TM.neon}` }}
          onError={() => {
            setPreviewURL(null);
            setFormData((p) => ({ ...p, photoURL: "" }));
          }}
        />

        {/* Pencil edit */}
        <button
          type="button"
          onClick={() => router.push("/profile?edit=true")}
          className="absolute bottom-1 right-1 h-10 w-10 rounded-full grid place-items-center shadow"
          style={{ background: TM.neon, color: TM.forest }}
          aria-label="Edit profile"
        >
          <Edit2 size={18} />
        </button>
      </div>

      <h1 className="mt-4 text-[34px] font-black leading-tight" style={{ color: TM.forest }}>
        {formData.name || "Your Name"}
      </h1>

      <div className="mt-2">
        <span
          className="inline-flex items-center rounded-full px-5 py-2 text-sm font-extrabold"
          style={{ background: TM.neon, color: TM.forest }}
        >
          {typeof formData.rating === "number"
            ? `TMR ${formData.rating.toFixed(1)}`
            : "TMR"}
        </span>
      </div>
    </div>

    {/* 2x2 INFO TILES */}
    <div className="mt-6 grid grid-cols-2 gap-4">
      <div className="rounded-2xl p-4 flex items-center gap-3 shadow-sm" style={{ background: TM.tile }}>
        <div className="h-10 w-10 rounded-full grid place-items-center" style={{ background: "rgba(57,255,20,0.18)" }}>
          ★
        </div>
        <div className="min-w-0">
          <div className="text-xs font-bold text-gray-500">Skill Level</div>
          <div className="text-lg font-black" style={{ color: TM.forest }}>
            {getSkillLabel(formData.skillBand)}
          </div>
        </div>
      </div>

      <div className="rounded-2xl p-4 flex items-center gap-3 shadow-sm" style={{ background: TM.tile }}>
        <div className="h-10 w-10 rounded-full grid place-items-center" style={{ background: "rgba(57,255,20,0.18)" }}>
          📍
        </div>
        <div className="min-w-0">
          <div className="text-xs font-bold text-gray-500">Postcode</div>
          <div className="text-lg font-black" style={{ color: TM.forest }}>
            {formData.postcode || "—"}
          </div>
        </div>
      </div>

      <div className="rounded-2xl p-4 flex items-center gap-3 shadow-sm" style={{ background: TM.tile }}>
        <div className="h-10 w-10 rounded-full grid place-items-center" style={{ background: "rgba(57,255,20,0.18)" }}>
          👤
        </div>
        <div className="min-w-0">
          <div className="text-xs font-bold text-gray-500">Age</div>
          <div className="text-lg font-black" style={{ color: TM.forest }}>
            {typeof derivedAge === "number" ? `${derivedAge} Years` : "—"}
          </div>
        </div>
      </div>

      <div className="rounded-2xl p-4 flex items-center gap-3 shadow-sm" style={{ background: TM.tile }}>
        <div className="h-10 w-10 rounded-full grid place-items-center" style={{ background: "rgba(57,255,20,0.18)" }}>
          ⚥
        </div>
        <div className="min-w-0">
          <div className="text-xs font-bold text-gray-500">Gender</div>
          <div className="text-lg font-black" style={{ color: TM.forest }}>
            {formData.gender || "—"}
          </div>
        </div>
      </div>
    </div>

    {/* PERFORMANCE STATS */}
    <div className="mt-8 flex items-center gap-2">
      <div className="h-6 w-6 rounded-md grid place-items-center" style={{ background: "rgba(57,255,20,0.18)", color: TM.forest }}>
        📊
      </div>
      <div className="text-lg font-black" style={{ color: TM.forest }}>
        Performance Stats
      </div>
    </div>

    <div
      className="mt-3 rounded-[28px] px-5 py-4 shadow-sm"
      style={{
        background: "linear-gradient(180deg, rgba(11,61,46,0.98) 0%, rgba(7,27,21,0.98) 100%)",
        color: "white",
      }}
    >
    <div className="grid grid-cols-3 text-center divide-x divide-white/20">
  <div className="px-2">
    <div className="text-4xl font-black tabular-nums">{matchStats.matches ?? 0}</div>
    <div className="mt-1 text-[11px] font-extrabold tracking-widest text-white/80">
      ACCEPTED
    </div>
  </div>

  <div className="px-2">
    <div className="text-4xl font-black tabular-nums">{matchStats.completed ?? 0}</div>
    <div className="mt-1 text-[11px] font-extrabold tracking-widest text-white/80">
      COMPLETED
    </div>
  </div>

  <div className="px-2">
    <div className="text-4xl font-black tabular-nums" style={{ color: TM.neon }}>
      {matchStats.wins ?? 0}
    </div>
    <div className="mt-1 text-[11px] font-extrabold tracking-widest text-white/80">
      WINS
    </div>
  </div>
</div>

    </div>

    {/* ABOUT ME */}
    <div className="mt-8 flex items-center justify-between">
      <div className="text-xl font-black" style={{ color: TM.forest }}>
        About Me
      </div>
      <button
        type="button"
        onClick={() => router.push("/profile?edit=true")}
        className="h-9 w-9 rounded-full grid place-items-center"
        style={{ background: "rgba(0,0,0,0.04)", color: TM.forest }}
        aria-label="Edit about me"
      >
        ✎
      </button>
    </div>

    <div className="mt-3 rounded-3xl p-5 shadow-sm" style={{ background: TM.tile }}>
      <p className="text-[15px] leading-relaxed text-gray-700">
        {formData.bio || "Add a short bio so other players know your style and what you're looking for."}
      </p>
    </div>

    {/* AVAILABILITY */}
    <div className="mt-8 text-xl font-black" style={{ color: TM.forest }}>
      Availability
    </div>

    <div className="mt-3 flex flex-wrap gap-3">
      {(formData.availability || []).map((slot) => (
        <span
          key={slot}
          className="rounded-full px-4 py-2 text-sm font-extrabold"
          style={{ background: TM.neon, color: TM.forest }}
        >
          {slot}
        </span>
      ))}

      <button
        type="button"
        onClick={() => router.push("/profile?edit=true")}
        className="rounded-full px-4 py-2 text-sm font-extrabold"
        style={{ background: "rgba(0,0,0,0.06)", color: "rgba(11,61,46,0.75)" }}
      >
        + Add Slot
      </button>
    </div>

    {/* BADGES */}
    <div className="mt-10 flex items-center justify-between">
      <div className="text-xl font-black" style={{ color: TM.forest }}>
        Badges & Achievements
      </div>

      <button
        type="button"
        onClick={() => router.push("/badges")}
        className="text-sm font-extrabold"
        style={{ color: TM.neon }}
      >
        View All
      </button>
    </div>

    {/* Keep your existing badge logic, but make it horizontal scroll */}
    <div className="mt-3 flex gap-4 overflow-x-auto pb-2">
      <div className="shrink-0 rounded-xl border border-gray-200 bg-white p-3 text-center">
        <img src="/badges/mvp-badge.svg" width={56} height={56} alt="MVP Launch" className="mx-auto" />
        <div className="text-[11px] font-semibold mt-1">MVP</div>
      </div>

      <div className="shrink-0 rounded-xl border border-gray-200 bg-white p-3 text-center">
        <img
          src={safeBadges.includes("firstMatch") ? "/badges/first-match.svg" : "/badges/first-match-locked.svg"}
          width={56}
          height={56}
          alt="First Match"
          className={`mx-auto ${safeBadges.includes("firstMatch") ? "" : "opacity-40"}`}
        />
        <div className="text-[11px] font-semibold mt-1">First Match</div>
      </div>

      <div className="shrink-0 rounded-xl border border-gray-200 bg-white p-3 text-center">
        <img
          src={safeBadges.includes("firstMatchComplete") ? "/badges/first-match-complete.svg" : "/badges/first-match-complete-locked.svg"}
          width={56}
          height={56}
          alt="Complete"
          className={`mx-auto ${safeBadges.includes("firstMatchComplete") ? "" : "opacity-40"}`}
        />
        <div className="text-[11px] font-semibold mt-1">Complete</div>
      </div>

      <div className="shrink-0 rounded-xl border border-gray-200 bg-white p-3 text-center">
        <img
          src={safeBadges.includes("firstWin") ? "/badges/first-win.svg" : "/badges/first-win-locked.svg"}
          width={56}
          height={56}
          alt="First Win"
          className={`mx-auto ${safeBadges.includes("firstWin") ? "" : "opacity-40"}`}
        />
        <div className="text-[11px] font-semibold mt-1">First Win</div>
      </div>

    </div>

{/* BOTTOM CTA */}
<div className="fixed left-0 right-0 bottom-0 p-4" style={{ background: TM.cream }}>
  {status && (
    <div className="mb-2 text-center text-xs font-semibold" style={{ color: TM.forest }}>
      {status}
    </div>
  )}

  <button
    type="button"
    onClick={saveProfile}
    disabled={saving}
    className="touch-manipulation w-full rounded-[26px] py-4 text-base font-black shadow disabled:opacity-50 disabled:cursor-not-allowed"
    style={{ background: TM.neon, color: TM.forest }}
  >
    {saving ? "Saving…" : "Save Changes"}
  </button>
</div>

  </>
) : (
  <>
    {/* EDIT TOP BAR (like screenshot) */}
    <div className="flex items-center justify-between pt-2">
      <button
        type="button"
        onClick={() => router.push("/profile")}
        className="h-10 w-10 rounded-full grid place-items-center"
        style={{ background: "rgba(0,0,0,0.04)" }}
        aria-label="Back"
      >
        <span className="text-xl" style={{ color: TM.forest }}>‹</span>
      </button>

      <div className="text-base font-extrabold" style={{ color: TM.forest }}>
        Edit Profile
      </div>

      <button
        type="button"
        onClick={() => router.push("/profile")}
        className="text-sm font-extrabold"
        style={{ color: TM.neon }}
      >
        Cancel
      </button>
    </div>

    {/* AVATAR PICKER */}
    <div className="mt-6 flex flex-col items-center text-center">
      <div className="relative">
        <img
          src={previewURL || formData.photoURL || "/default-avatar.png"}
          alt="Profile"
          className="h-[120px] w-[120px] rounded-full object-cover"
          style={{
            boxShadow: `0 0 0 6px ${TM.neon}`,
            background: "white",
          }}
          onError={() => {
            setPreviewURL(null);
            setFormData((p) => ({ ...p, photoURL: "" }));
          }}
        />

        {/* Camera button */}
        <label
          htmlFor="upload"
          className="absolute bottom-1 right-1 h-11 w-11 rounded-full grid place-items-center shadow cursor-pointer"
          style={{ background: TM.neon, color: TM.forest }}
          aria-label="Change photo"
          title="Change photo"
        >
          📷
        </label>

        <input
          id="upload"
          type="file"
          accept="image/*"
          onChange={handleImageChange}
          className="hidden"
        />
      </div>

      <button
        type="button"
        onClick={() => document.getElementById("upload")?.click()}
        className="mt-3 text-sm font-extrabold"
        style={{ color: TM.neon }}
      >
        Change Photo
      </button>

      {!hasPhoto && (
        <div className="mt-2 text-xs text-red-700 bg-red-50 border border-red-200 rounded px-2 py-1">
          A profile photo is required to save.
        </div>
      )}

      {previewURL && (
        <button
          type="button"
          onClick={handleRemovePhoto}
          className="mt-3 text-xs font-semibold underline"
          style={{ color: "rgba(11,61,46,0.75)" }}
        >
          Remove photo
        </button>
      )}
    </div>

    {/* FORM CARD */}
    <section className="mt-6 rounded-3xl bg-white p-5 shadow-sm">
      <form id="editProfile" onSubmit={handleSubmit} className="space-y-5">
        {/* Full Name */}
        <div>
          <label className="block text-sm font-extrabold" style={{ color: TM.forest }}>
            Full Name <span className="text-red-600">*</span>
          </label>
          <input
            name="name"
            required
            value={formData.name}
            onChange={handleChange}
            className="mt-2 w-full rounded-2xl border px-4 py-3 text-[16px] outline-none"
            style={{ borderColor: "rgba(11,61,46,0.18)" }}
          />
        </div>

        {/* Skill + Rating (2 col like screenshot) */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-extrabold" style={{ color: TM.forest }}>
              Skill Level <span className="text-red-600">*</span>
            </label>
            <select
              name="skillBand"
              required
              value={formData.skillBand}
              onChange={(e) =>
                setFormData((prev) => ({ ...prev, skillBand: e.target.value as SkillBand }))
              }
              className="mt-2 w-full rounded-2xl border px-4 py-3 text-[16px] outline-none bg-white"
              style={{ borderColor: "rgba(11,61,46,0.18)" }}
            >
              <option value="" disabled>Select your level…</option>
              {SKILL_OPTIONS_SAFE.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-sm font-extrabold" style={{ color: TM.forest }}>
              TMR Rating
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
              className="mt-2 w-full rounded-2xl border px-4 py-3 text-[16px] outline-none bg-white"
              style={{ borderColor: "rgba(11,61,46,0.18)" }}
            />
            <p className="mt-1 text-[11px]" style={{ color: "rgba(11,61,46,0.65)" }}>
              Optional. 1.00–16.50 (UTR-like).
            </p>
          </div>
        </div>

        {/* Postcode + Gender (2 col like screenshot) */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-extrabold" style={{ color: TM.forest }}>
              Postcode <span className="text-red-600">*</span>
            </label>
            <input
              name="postcode"
              inputMode="numeric"
              pattern="[0-9]{4}"
              placeholder="e.g. 3000"
              value={formData.postcode}
              onChange={handleChange}
              className="mt-2 w-full rounded-2xl border px-4 py-3 text-[16px] outline-none"
              style={{ borderColor: "rgba(11,61,46,0.18)" }}
            />
            <p className="mt-1 text-[11px]" style={{ color: "rgba(11,61,46,0.65)" }}>
              VIC & NSW only (2xxx/3xxx).
            </p>
          </div>

          <div>
            <label className="block text-sm font-extrabold" style={{ color: TM.forest }}>
              Gender
            </label>

            {/* pill-style toggle */}
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
                    aria-pressed={active}
                  >
                    {g}
                  </button>
                );
              })}
            </div>

            <button
              type="button"
              onClick={() => setFormData((p) => ({ ...p, gender: "" }))}
              className="mt-1 text-[11px] underline"
              style={{ color: "rgba(11,61,46,0.55)" }}
            >
              Clear
            </button>
          </div>
        </div>

        {/* Birth year (still required in your validation) */}
        <div>
          <label className="block text-sm font-extrabold" style={{ color: TM.forest }}>
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
            className="mt-2 w-full rounded-2xl border px-4 py-3 text-[16px] outline-none"
            style={{ borderColor: "rgba(11,61,46,0.18)" }}
          />
          <p className="mt-1 text-[11px]" style={{ color: "rgba(11,61,46,0.65)" }}>
            Used only to confirm 18+ and improve matching.
          </p>
        </div>

        {/* Bio */}
        <div>
          <label className="block text-sm font-extrabold" style={{ color: TM.forest }}>
            Bio
          </label>
          <textarea
            name="bio"
            rows={4}
            maxLength={300}
            placeholder="Tell others about your game, favorite courts, preferred times…"
            value={formData.bio}
            onChange={handleChange}
            className="mt-2 w-full rounded-2xl border px-4 py-3 text-[16px] outline-none"
            style={{ borderColor: "rgba(11,61,46,0.18)" }}
          />
          <div className="mt-1 text-[11px]" style={{ color: "rgba(11,61,46,0.55)" }}>
            {formData.bio.length}/300
          </div>
        </div>

        {/* Availability header (like screenshot) */}
        <div className="pt-2">
          <div className="flex items-center gap-2">
            <span style={{ color: TM.neon }}>📅</span>
            <div className="text-sm font-extrabold" style={{ color: TM.forest }}>
              Availability <span className="text-red-600">*</span>
            </div>
          </div>

          <div className="mt-2 grid grid-cols-1 sm:grid-cols-2 gap-2">
            {["Weekdays AM", "Weekdays PM", "Weekends AM", "Weekends PM"].map((slot) => (
              <label
                key={slot}
                className="flex items-center gap-2 rounded-2xl border px-3 py-3 text-sm"
                style={{ borderColor: "rgba(11,61,46,0.18)" }}
              >
                <input
                  type="checkbox"
                  value={slot}
                  checked={formData.availability.includes(slot)}
                  onChange={handleCheckbox}
                  className="h-4 w-4"
                />
                <span className="font-semibold" style={{ color: TM.forest }}>
                  {slot}
                </span>
              </label>
            ))}
          </div>
        </div>

        {/* Matchable toggle (keep yours, slightly styled) */}
        <div className="rounded-2xl border p-4" style={{ borderColor: "rgba(11,61,46,0.18)" }}>
          <div className="flex items-start justify-between gap-4">
            <div>
              <div className="text-sm font-extrabold" style={{ color: TM.forest }}>
                Match Me visibility
              </div>
              <p className="mt-1 text-[11px]" style={{ color: "rgba(11,61,46,0.65)" }}>
                Turn off to hide your profile from Match Me suggestions.
              </p>
            </div>

            <button
              type="button"
              onClick={() => setFormData((p) => ({ ...p, isMatchable: !p.isMatchable }))}
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

          <div className="mt-2 text-[11px]">
            Status:{" "}
            <span
              className={formData.isMatchable ? "text-green-700 font-semibold" : "text-gray-700 font-semibold"}
            >
              {formData.isMatchable ? "Visible in Match Me" : "Hidden from Match Me"}
            </span>
          </div>
        </div>
      </form>
    </section>

    {/* Cropper modal (keep) */}
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

    {/* Danger Zone (Delete) */}
    <section className="mt-4 rounded-3xl bg-white p-5 shadow-sm">
      <div className="text-xs font-extrabold text-red-700">Danger zone</div>
      <p className="mt-1 text-[11px]" style={{ color: "rgba(11,61,46,0.65)" }}>
        Permanently delete your profile and data.
      </p>

      <button
        type="button"
        onClick={handleDeleteProfile}
        className="mt-3 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-extrabold text-red-700 hover:bg-red-100 w-full"
      >
        Delete Profile
      </button>
    </section>

  <div
  className="fixed left-0 right-0 bottom-0 z-[9999] p-4"
  style={{
    background: TM.cream,
    paddingBottom: "calc(env(safe-area-inset-bottom) + 16px)",
  }}
>

      <button
        form="editProfile"
        type="submit"
        disabled={
          saving ||
          !hasPhoto ||
          formData.availability.length === 0 ||
          formData.birthYear === "" ||
          !formData.name.trim() ||
          !formData.skillBand
        }
        className="touch-manipulation w-full rounded-[26px] py-4 text-base font-black shadow disabled:opacity-50 disabled:cursor-not-allowed"
        style={{ background: TM.neon, color: TM.forest }}
      >
        {saving ? "Saving…" : "Save Changes"}
      </button>
    </div>
  </>
)}

    </div>
  </div>
);
}
