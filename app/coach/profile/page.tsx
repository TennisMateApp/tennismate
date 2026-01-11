"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { onAuthStateChanged } from "firebase/auth";
import {
  doc,
  getDoc,
  setDoc,
  updateDoc,
  serverTimestamp,
} from "firebase/firestore";
import { ref, uploadBytes, getDownloadURL, deleteObject } from "firebase/storage";

import { auth, db, storage } from "@/lib/firebaseConfig";
import Cropper from "react-easy-crop";
import getCroppedImg from "../../utils/cropImage";
import { httpsCallable } from "firebase/functions";
import { getFunctionsClient } from "@/lib/getFunctionsClient";


type GalleryPhoto = { url: string; path: string; createdAt: number };

type CoachProfile = {
  userId: string;
  name: string;
  avatar: string | null;

  mobile: string;
  contactFirstForRate: boolean;

  coachingExperience: string;
  bio: string;
  playingBackground: string;

  courtAddress: string;
  coachingSkillLevels: string[];

  galleryPhotos: GalleryPhoto[];

  createdAt?: any;
  updatedAt?: any;
};

const DEFAULT_SKILL_LEVELS = [
  "Beginner",
  "Intermediate",
  "Advanced",
  "Junior",
  "Adults",
  "Competition",
];

export default function CoachProfilePage() {
  const router = useRouter();

  const [uid, setUid] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [isCoach, setIsCoach] = useState(false);

  const [error, setError] = useState<string | null>(null);

  // Local edit fields
  const [name, setName] = useState("");
  const [mobile, setMobile] = useState("");
  const [contactFirstForRate, setContactFirstForRate] = useState(true);
  const [coachingExperience, setCoachingExperience] = useState("");
  const [bio, setBio] = useState("");
  const [playingBackground, setPlayingBackground] = useState("");
  const [courtAddress, setCourtAddress] = useState("Place where coaching takes place");
  const [coachingSkillLevels, setCoachingSkillLevels] = useState<string[]>([]);
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [galleryPhotos, setGalleryPhotos] = useState<GalleryPhoto[]>([]);
  const [success, setSuccess] = useState<string | null>(null);

  // --- Avatar cropping state ---
const [avatarPreview, setAvatarPreview] = useState<string | null>(null);
const [showAvatarCrop, setShowAvatarCrop] = useState(false);

const [crop, setCrop] = useState({ x: 0, y: 0 });
const [zoom, setZoom] = useState(1);
const [croppedAreaPixels, setCroppedAreaPixels] = useState<any>(null);

const onCropComplete = (_: any, croppedPixels: any) => {
  setCroppedAreaPixels(croppedPixels);
};

  const coachRef = useMemo(() => {
    if (!uid) return null;
    return doc(db, "coaches", uid);
  }, [uid]);

  useEffect(() => {
  const unsub = onAuthStateChanged(auth, async (user) => {
    try {
      if (!user) {
        router.replace("/login");
        return;
      }

      setUid(user.uid);

      // Check role
      const userRef = doc(db, "users", user.uid);
      const userSnap = await getDoc(userRef);
      const role = userSnap.exists() ? (userSnap.data() as any).role : "";

      const allowed = role === "coach" || role === "both";
      setIsCoach(allowed);

      // ✅ Hard block: if they aren't allowed, bounce them out
      if (!allowed) {
        router.replace("/profile?coach=forbidden");
        return;
      }
    } catch (e: any) {
      setError(e?.message ?? "Auth check failed");
      // safest fallback: send them back
      router.replace("/profile");
    } finally {
      setLoading(false);
    }
  });

  return () => unsub();
}, [router]);

async function getPlayerDefaults(uid: string) {
  const playerSnap = await getDoc(doc(db, "players", uid));
  const p = playerSnap.exists() ? (playerSnap.data() as any) : {};
  return {
    playerName: typeof p.name === "string" ? p.name : "",
    playerPhotoURL: typeof p.photoURL === "string" ? p.photoURL : null,
  };
}


  // Load/create coach doc only if coach
  useEffect(() => {
    if (!coachRef || !uid || !isCoach) return;

    (async () => {
      setError(null);
      try {
        const snap = await getDoc(coachRef);

        if (!snap.exists()) {
  const { playerName, playerPhotoURL } = await getPlayerDefaults(uid);

  const starter: CoachProfile = {
    userId: uid,

    // ✅ defaults from player profile
    name: playerName || "",
    avatar: playerPhotoURL || null,

    mobile: "",
    contactFirstForRate: true,

    coachingExperience: "",
    bio: "",
    playingBackground: "",

    courtAddress: "Place where coaching will take place",
    coachingSkillLevels: [],
    galleryPhotos: [],

    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  };

  await setDoc(coachRef, starter);

  // ✅ hydrate UI state from starter
  setName(starter.name);
  setAvatarUrl(starter.avatar);
  setMobile(starter.mobile);
  setContactFirstForRate(starter.contactFirstForRate);
  setCoachingExperience(starter.coachingExperience);
  setBio(starter.bio);
  setPlayingBackground(starter.playingBackground);
  setCourtAddress(starter.courtAddress);
  setCoachingSkillLevels(starter.coachingSkillLevels);
  setGalleryPhotos(starter.galleryPhotos);

  return;
}


        const data = snap.data() as CoachProfile;
        // ✅ Backfill from player profile ONLY if coach doc is missing name/avatar
if ((!data.name || !data.name.trim()) || !data.avatar) {
  const { playerName, playerPhotoURL } = await getPlayerDefaults(uid);

  const patch: any = {};
  if ((!data.name || !data.name.trim()) && playerName) patch.name = playerName;
  if (!data.avatar && playerPhotoURL) patch.avatar = playerPhotoURL;

  if (Object.keys(patch).length) {
    patch.updatedAt = serverTimestamp();
    await updateDoc(coachRef, patch);

    // Update local copy so UI shows immediately
    data.name = patch.name ?? data.name;
    data.avatar = patch.avatar ?? data.avatar;
  }
}

        setName(data.name ?? "");
        setAvatarUrl(data.avatar ?? null);
        setMobile(data.mobile ?? "");
        setContactFirstForRate(!!data.contactFirstForRate);
        setCoachingExperience(data.coachingExperience ?? "");
        setBio(data.bio ?? "");
        setPlayingBackground(data.playingBackground ?? "");
        setCourtAddress(data.courtAddress ?? "");
        setCoachingSkillLevels(Array.isArray(data.coachingSkillLevels) ? data.coachingSkillLevels : []);
        setGalleryPhotos(Array.isArray(data.galleryPhotos) ? data.galleryPhotos : []);
      } catch (e: any) {
        setError(e?.message ?? "Failed to load coach profile");
      }
    })();
  }, [coachRef, uid, isCoach]);

   async function deleteCoachProfile() {
  const ok = confirm(
    "Delete your coach profile? This will remove your coach listing and photos. This cannot be undone."
  );
  if (!ok) return;

  try {
    setSaving(true);
    setError(null);

    const functions = getFunctionsClient();
    const fn = httpsCallable(functions, "deleteMyCoachProfile");
    await fn();

    // Optional: you can also update their /users role if you want (NOT required)
    // e.g. set role back to "player" or remove "coach"

    alert("✅ Coach profile deleted.");
    router.replace("/profile"); // or /home
  } catch (e: any) {
    setError(e?.message ?? "Failed to delete coach profile.");
  } finally {
    setSaving(false);
  }
}

  async function saveProfile() {
  if (!coachRef || !uid) return;

  setSaving(true);
  setError(null);
  setSuccess(null);

  try {
    await updateDoc(coachRef, {
      name: name.trim(),
      mobile: mobile.trim(),
      contactFirstForRate,
      coachingExperience: coachingExperience.trim(),
      bio: bio.trim(),
      playingBackground: playingBackground.trim(),
      courtAddress: courtAddress.trim(),
      coachingSkillLevels,
      galleryPhotos,
      updatedAt: serverTimestamp(),
    } as any);

    // ✅ Show confirmation popup
    setSuccess("✅ Coach profile saved successfully!");

    // ✅ Navigate back to the main Profile page after a short moment
    setTimeout(() => {
      router.push("/profile");
    }, 900);
  } catch (e: any) {
    setError(e?.message ?? "Failed to save profile");
  } finally {
    setSaving(false);
  }
}


  async function uploadAvatar(file: File) {
    if (!uid || !coachRef) return;
    setError(null);

    try {
      const avatarPath = `coaches/${uid}/avatar.jpg`;
      const avatarRef = ref(storage, avatarPath);

      await uploadBytes(avatarRef, file, { contentType: file.type || "image/jpeg" });
      const url = await getDownloadURL(avatarRef);

      setAvatarUrl(url);
      await updateDoc(coachRef, { avatar: url, updatedAt: serverTimestamp() } as any);
    } catch (e: any) {
      setError(e?.message ?? "Avatar upload failed");
    }
  }

  async function removeAvatar() {
    if (!uid || !coachRef) return;
    setError(null);

    try {
      const avatarPath = `coaches/${uid}/avatar.jpg`;
      const avatarRef = ref(storage, avatarPath);
      try { await deleteObject(avatarRef); } catch {}

      setAvatarUrl(null);
      await updateDoc(coachRef, { avatar: null, updatedAt: serverTimestamp() } as any);
    } catch (e: any) {
      setError(e?.message ?? "Failed to remove avatar");
    }
  }

  async function saveCroppedAvatar() {
  if (!avatarPreview || !croppedAreaPixels) return;

  try {
    // getCroppedImg in your app likely returns a Blob or File
    const cropped = await getCroppedImg(avatarPreview, croppedAreaPixels);

    // Ensure we upload a File (Storage uploadBytes accepts Blob too, but File is cleaner)
    const fileToUpload =
      cropped instanceof File
        ? cropped
        : new File([cropped], "avatar.jpg", { type: "image/jpeg" });

    await uploadAvatar(fileToUpload);

    // cleanup
    if (avatarPreview) URL.revokeObjectURL(avatarPreview);
    setShowAvatarCrop(false);
    setAvatarPreview(null);
    setZoom(1);
    setCrop({ x: 0, y: 0 });
    setCroppedAreaPixels(null);
  } catch (e: any) {
    setError(e?.message ?? "Failed to crop avatar");
  }
}

function cancelAvatarCrop() {
  if (avatarPreview) URL.revokeObjectURL(avatarPreview);
  setShowAvatarCrop(false);
  setAvatarPreview(null);
  setZoom(1);
  setCrop({ x: 0, y: 0 });
  setCroppedAreaPixels(null);
}


  async function uploadGalleryPhotos(files: FileList | null) {
    if (!uid || !coachRef || !files?.length) return;
    setError(null);

    try {
      const newOnes: GalleryPhoto[] = [];

      for (const file of Array.from(files)) {
        const safeName = file.name.replace(/[^\w.\-]+/g, "_");
        const path = `coaches/${uid}/gallery/${Date.now()}_${safeName}`;
        const r = ref(storage, path);

        await uploadBytes(r, file, { contentType: file.type || "image/jpeg" });
        const url = await getDownloadURL(r);

        newOnes.push({ url, path, createdAt: Date.now() });
      }

      const merged = [...newOnes, ...galleryPhotos];
      setGalleryPhotos(merged);

      await updateDoc(coachRef, { galleryPhotos: merged, updatedAt: serverTimestamp() } as any);
    } catch (e: any) {
      setError(e?.message ?? "Gallery upload failed");
    }
  }

  async function removeGalleryPhoto(photo: GalleryPhoto) {
    if (!uid || !coachRef) return;
    setError(null);

    try {
      if (photo.path) {
        const r = ref(storage, photo.path);
        try { await deleteObject(r); } catch {}
      }

      const next = galleryPhotos.filter((p) => p.url !== photo.url);
      setGalleryPhotos(next);

      await updateDoc(coachRef, { galleryPhotos: next, updatedAt: serverTimestamp() } as any);
    } catch (e: any) {
      setError(e?.message ?? "Failed to remove gallery photo");
    }
  }

  function toggleSkillLevel(level: string) {
    setCoachingSkillLevels((prev) =>
      prev.includes(level) ? prev.filter((l) => l !== level) : [...prev, level]
    );
  }

  if (loading) {
    return (
      <div className="max-w-3xl mx-auto p-4">
        <div className="text-sm opacity-70">Loading…</div>
      </div>
    );
  }

  // Not a coach yet (no role set)
  if (!isCoach) {
    return (
      <div className="max-w-3xl mx-auto p-4">
        <h1 className="text-xl font-semibold">Coach Profile</h1>
        <p className="mt-2 text-sm opacity-80">
          This area is invite-only for coaches.
        </p>

        <div className="mt-4 rounded-2xl border p-4">
          <div className="text-sm">
            If you’re a coach and received an invite, you’ll be able to activate your coach profile soon.
          </div>

          <button
            className="mt-4 px-4 py-2 rounded-lg border hover:bg-gray-50"
            onClick={() => router.push("/profile")}
          >
            Back to Profile
          </button>
        </div>
      </div>
    );
  }


  return (
    <div className="max-w-3xl mx-auto p-4 pb-24">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">My Coach Profile</h1>
          <p className="text-sm opacity-70">Edit your coach details and photos.</p>
        </div>

        <button
          onClick={saveProfile}
          disabled={saving}
          className="px-4 py-2 rounded-lg bg-green-600 text-white hover:bg-green-700 disabled:opacity-60"
        >
          {saving ? "Saving…" : "Save"}
        </button>
      </div>

      {error && (
        <div className="mt-4 rounded-lg border border-red-300 bg-red-50 p-3 text-sm text-red-700">
          {error}
        </div>
      )}

      {success && (
  <div className="mt-4 rounded-lg border border-green-300 bg-green-50 p-3 text-sm text-green-800">
    {success}
  </div>
)}


      {/* Avatar */}
      <div className="mt-6 rounded-2xl border p-4">
        <h2 className="font-semibold">Profile picture</h2>

        <div className="mt-3 flex items-center gap-4">
          <div className="h-20 w-20 rounded-full overflow-hidden border bg-white">
            {avatarUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={avatarUrl} alt="Coach avatar" className="h-full w-full object-cover" />
            ) : (
              <div className="h-full w-full flex items-center justify-center text-xs opacity-60">
                No photo
              </div>
            )}
          </div>

          <div className="flex flex-col gap-2">
            <label className="inline-block">
              <input
                type="file"
                accept="image/*"
                className="hidden"
               onChange={(e) => {
  const f = e.target.files?.[0];
  if (!f) return;

  const previewUrl = URL.createObjectURL(f);
  setAvatarPreview(previewUrl);
  setShowAvatarCrop(true);

  e.currentTarget.value = "";
}}

              />
              <span className="inline-flex cursor-pointer items-center justify-center rounded-lg border px-3 py-2 text-sm hover:bg-gray-50">
                Upload new
              </span>
            </label>

            {avatarUrl && (
              <button onClick={removeAvatar} className="text-left text-sm text-red-600 hover:underline">
                Remove
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Details */}
      <div className="mt-6 rounded-2xl border p-4">
        <h2 className="font-semibold">Coach details</h2>

        <div className="mt-4 grid grid-cols-1 gap-4">
          <div>
            <label className="text-sm font-medium">Name</label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="mt-1 w-full rounded-lg border px-3 py-2"
              placeholder="e.g. Jethro Smith"
            />
          </div>

          <div>
            <label className="text-sm font-medium">Mobile</label>
            <input
              value={mobile}
              onChange={(e) => setMobile(e.target.value)}
              className="mt-1 w-full rounded-lg border px-3 py-2"
              placeholder="e.g. 04xx xxx xxx"
            />
          </div>

          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={contactFirstForRate}
              onChange={(e) => setContactFirstForRate(e.target.checked)}
            />
            Contact first for rates
          </label>

          <div>
            <label className="text-sm font-medium">Coaching experience</label>
            <input
              value={coachingExperience}
              onChange={(e) => setCoachingExperience(e.target.value)}
              className="mt-1 w-full rounded-lg border px-3 py-2"
              placeholder='e.g. "8 years" or "Coaching since 2016"'
            />
          </div>

          <div>
            <label className="text-sm font-medium">Playing background</label>
            <textarea
              value={playingBackground}
              onChange={(e) => setPlayingBackground(e.target.value)}
              className="mt-1 w-full rounded-lg border px-3 py-2"
              rows={3}
              placeholder="Former player details learners prefer (level, achievements, comps, etc.)"
            />
          </div>

          <div>
            <label className="text-sm font-medium">Bio</label>
            <textarea
              value={bio}
              onChange={(e) => setBio(e.target.value)}
              className="mt-1 w-full rounded-lg border px-3 py-2"
              rows={5}
              placeholder="Coaching style, who you coach, session focus…"
            />
          </div>
        </div>
      </div>

      {/* Location */}
      <div className="mt-6 rounded-2xl border p-4">
        <h2 className="font-semibold">Court location</h2>
        <div className="mt-3">
          <label className="text-sm font-medium">Address</label>
          <input
            value={courtAddress}
            onChange={(e) => setCourtAddress(e.target.value)}
            className="mt-1 w-full rounded-lg border px-3 py-2"
            placeholder="Place where coaching will take place"
          />
        </div>
      </div>

      {/* Skill levels */}
      <div className="mt-6 rounded-2xl border p-4">
        <h2 className="font-semibold">Coaching skill levels</h2>
        <p className="mt-1 text-sm opacity-70">Select all that apply.</p>

        <div className="mt-3 flex flex-wrap gap-2">
          {DEFAULT_SKILL_LEVELS.map((lvl) => {
            const active = coachingSkillLevels.includes(lvl);
            return (
              <button
                key={lvl}
                type="button"
                onClick={() => toggleSkillLevel(lvl)}
                className={[
                  "px-3 py-1.5 rounded-full text-sm border",
                  active ? "bg-green-600 text-white border-green-600" : "hover:bg-gray-50",
                ].join(" ")}
              >
                {lvl}
              </button>
            );
          })}
        </div>
      </div>

      {/* Gallery */}
      <div className="mt-6 rounded-2xl border p-4">
        <h2 className="font-semibold">Photos</h2>
        <p className="mt-1 text-sm opacity-70">Upload coaching/court/session photos.</p>

        <div className="mt-3">
          <label className="inline-block">
            <input
              type="file"
              accept="image/*"
              multiple
              className="hidden"
              onChange={(e) => {
                uploadGalleryPhotos(e.target.files);
                e.currentTarget.value = "";
              }}
            />
            <span className="inline-flex cursor-pointer items-center justify-center rounded-lg border px-3 py-2 text-sm hover:bg-gray-50">
              Upload photos
            </span>
          </label>
        </div>

        {galleryPhotos.length > 0 ? (
          <div className="mt-4 grid grid-cols-3 gap-2">
            {galleryPhotos.map((p) => (
              <div key={p.url} className="relative rounded-lg overflow-hidden border">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={p.url} alt="Coach photo" className="h-28 w-full object-cover" />
                <button
                  type="button"
                  onClick={() => removeGalleryPhoto(p)}
                  className="absolute top-2 right-2 rounded-md bg-white/90 px-2 py-1 text-xs border hover:bg-white"
                >
                  Remove
                </button>
              </div>
            ))}
          </div>
        ) : (
          <div className="mt-3 text-sm opacity-70">No photos yet.</div>
        )}
      </div>

      {/* Danger zone */}
<div className="mt-6 rounded-2xl border border-red-200 bg-red-50 p-4">
  <h2 className="font-semibold text-red-800">Danger zone</h2>
  <p className="mt-1 text-sm text-red-700">
    Permanently delete your coach profile and all coach photos. This cannot be undone.
  </p>

  <button
    type="button"
    onClick={deleteCoachProfile}
    disabled={saving}
    className="mt-3 rounded-lg border border-red-300 bg-white px-4 py-2 text-sm font-semibold text-red-700 hover:bg-red-100 disabled:opacity-60"
  >
    {saving ? "Working…" : "Delete coach profile"}
  </button>
</div>

      {showAvatarCrop && avatarPreview && (
  <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
    <div className="w-full max-w-lg rounded-2xl bg-white p-4">
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-semibold">Crop profile picture</h3>
        <button
          onClick={cancelAvatarCrop}
          className="rounded-lg border px-3 py-1.5 text-sm hover:bg-gray-50"
        >
          Cancel
        </button>
      </div>

      <div className="relative mt-4 h-[360px] w-full overflow-hidden rounded-xl bg-black">
        <Cropper
          image={avatarPreview}
          crop={crop}
          zoom={zoom}
          aspect={1}
          cropShape="round"
          showGrid={false}
          onCropChange={setCrop}
          onZoomChange={setZoom}
          onCropComplete={onCropComplete}
        />
      </div>

      <div className="mt-4">
        <label className="text-sm font-medium">Zoom</label>
        <input
          type="range"
          min={1}
          max={3}
          step={0.05}
          value={zoom}
          onChange={(e) => setZoom(Number(e.target.value))}
          className="mt-2 w-full"
        />
      </div>

      <div className="mt-4 flex justify-end gap-2">
        <button
          onClick={cancelAvatarCrop}
          className="rounded-lg border px-4 py-2 text-sm hover:bg-gray-50"
        >
          Cancel
        </button>
        <button
          onClick={saveCroppedAvatar}
          className="rounded-lg bg-green-600 px-4 py-2 text-sm text-white hover:bg-green-700"
        >
          Save
        </button>
      </div>
    </div>
  </div>
)}

    </div>
  );
}
