"use client";

import Image from "next/image";
import {Camera, CheckCircle2, Loader2, RotateCcw, X} from "lucide-react";
import {useEffect, useRef, useState} from "react";
import Cropper, {type Area} from "react-easy-crop";
import {doc, serverTimestamp, updateDoc} from "firebase/firestore";
import {getDownloadURL, ref, uploadBytes} from "firebase/storage";

import getCroppedImg from "@/app/utils/cropImage";
import {db, storage} from "@/lib/firebaseConfig";
import {PROFILE_FULL_PATH, PROFILE_THUMB_PATH} from "@/lib/profilePhoto";

type UploadStatus = "idle" | "preparing" | "uploading" | "success" | "error";

const primaryButton =
  "inline-flex min-h-11 w-full items-center justify-center rounded-xl bg-[#0B3D2E] px-5 py-3 text-sm font-semibold text-white shadow-sm hover:bg-[#125540] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-700 disabled:cursor-not-allowed disabled:opacity-60";
const secondaryButton =
  "inline-flex min-h-11 w-full items-center justify-center rounded-xl border border-emerald-200 bg-white px-5 py-3 text-sm font-semibold text-[#0B3D2E] hover:bg-emerald-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-700 disabled:opacity-60";

async function squareVariant(blob: Blob, maxSize: number, quality: number, name: string) {
  const bitmap = await createImageBitmap(blob, {imageOrientation: "from-image"});
  const size = Math.min(maxSize, bitmap.width, bitmap.height);
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("canvas_unavailable");
  context.drawImage(bitmap, 0, 0, bitmap.width, bitmap.height, 0, 0, size, size);
  bitmap.close();
  const output = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (value) => value ? resolve(value) : reject(new Error("image_processing_failed")),
      "image/jpeg",
      quality
    );
  });
  return new File([output], name, {type: "image/jpeg"});
}

export default function OnboardingProfilePhotoStep({
  uid,
  photoURL,
  photoThumbURL,
  onStarted,
  onComplete,
}: {
  uid: string;
  photoURL: string;
  photoThumbURL: string;
  onStarted: () => void;
  onComplete: (value: {photoURL: string; photoThumbURL: string}) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);
  const [imageSource, setImageSource] = useState("");
  const [crop, setCrop] = useState({x: 0, y: 0});
  const [zoom, setZoom] = useState(1);
  const [cropArea, setCropArea] = useState<Area | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [status, setStatus] = useState<UploadStatus>(photoURL && photoThumbURL ? "success" : "idle");
  const [error, setError] = useState("");
  const currentPhoto = photoThumbURL || photoURL;
  const busy = status === "preparing" || status === "uploading";

  useEffect(() => {
    if (!dialogOpen) return;
    const dialog = dialogRef.current;
    const first = dialog?.querySelector<HTMLElement>("button, input, [tabindex]:not([tabindex='-1'])");
    first?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        closeDialog();
        return;
      }
      if (event.key !== "Tab" || !dialog) return;
      const focusable = Array.from(dialog.querySelectorAll<HTMLElement>(
        "button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex='-1'])"
      ));
      if (!focusable.length) return;
      const firstItem = focusable[0];
      const lastItem = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === firstItem) {
        event.preventDefault();
        lastItem.focus();
      } else if (!event.shiftKey && document.activeElement === lastItem) {
        event.preventDefault();
        firstItem.focus();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [dialogOpen]);

  function closeDialog() {
    if (busy) return;
    setDialogOpen(false);
    window.requestAnimationFrame(() => returnFocusRef.current?.focus());
  }

  function choosePhoto() {
    returnFocusRef.current = document.activeElement as HTMLElement | null;
    inputRef.current?.click();
  }

  function handleFile(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      setError("Choose an image file and try again.");
      setStatus("error");
      return;
    }
    onStarted();
    setError("");
    setStatus("preparing");
    const reader = new FileReader();
    reader.onload = () => {
      setImageSource(String(reader.result || ""));
      setCrop({x: 0, y: 0});
      setZoom(1);
      setCropArea(null);
      setStatus("idle");
      setDialogOpen(true);
    };
    reader.onerror = () => {
      setError("We couldn’t prepare that photo. Choose another image and try again.");
      setStatus("error");
    };
    reader.readAsDataURL(file);
  }

  async function confirmAndUpload() {
    if (!imageSource || !cropArea || busy) return;
    setError("");
    setStatus("preparing");
    try {
      const cropped = await getCroppedImg(imageSource, cropArea);
      const [fullFile, thumbFile] = await Promise.all([
        squareVariant(cropped, 1024, 0.84, "avatar_full.jpg"),
        squareVariant(cropped, 160, 0.72, "avatar_thumb.jpg"),
      ]);
      setStatus("uploading");
      const fullRef = ref(storage, PROFILE_FULL_PATH(uid));
      const thumbRef = ref(storage, PROFILE_THUMB_PATH(uid));
      await Promise.all([
        uploadBytes(fullRef, fullFile, {contentType: "image/jpeg"}),
        uploadBytes(thumbRef, thumbFile, {contentType: "image/jpeg"}),
      ]);
      const [nextPhotoURL, nextPhotoThumbURL] = await Promise.all([
        getDownloadURL(fullRef),
        getDownloadURL(thumbRef),
      ]);
      await updateDoc(doc(db, "players", uid), {
        photoURL: nextPhotoURL,
        photoThumbURL: nextPhotoThumbURL,
        avatar: nextPhotoThumbURL,
        updatedAt: serverTimestamp(),
      });
      setDialogOpen(false);
      setStatus("success");
      onComplete({photoURL: nextPhotoURL, photoThumbURL: nextPhotoThumbURL});
      window.requestAnimationFrame(() => returnFocusRef.current?.focus());
    } catch (uploadError) {
      console.error("[OnboardingV2Photo] upload failed", uploadError);
      setStatus("error");
      setError("We couldn’t save your photo. Your earlier progress is safe—please try again.");
    }
  }

  return (
    <div>
      <div className="flex flex-col items-center rounded-2xl border border-slate-200 bg-slate-50 p-5 text-center">
        <div className="relative h-28 w-28 overflow-hidden rounded-full border-4 border-white bg-slate-200 shadow-sm">
          {currentPhoto ? (
            <Image src={currentPhoto} alt="Your profile photo" fill sizes="112px" className="object-cover" unoptimized />
          ) : (
            <div className="grid h-full w-full place-items-center text-slate-500">
              <Camera className="h-8 w-8" aria-hidden="true" />
              <span className="sr-only">No profile photo selected</span>
            </div>
          )}
        </div>
        {status === "success" && currentPhoto ? (
          <p className="mt-3 inline-flex items-center gap-2 text-sm font-semibold text-emerald-800">
            <CheckCircle2 className="h-4 w-4" aria-hidden="true" /> Photo saved
          </p>
        ) : null}
        <button type="button" className={`${currentPhoto ? secondaryButton : primaryButton} mt-4 max-w-xs`} onClick={choosePhoto} disabled={busy}>
          <Camera className="mr-2 h-4 w-4" aria-hidden="true" />
          {currentPhoto ? "Change photo" : "Choose photo"}
        </button>
        <input ref={inputRef} type="file" accept="image/*" className="sr-only" onChange={handleFile} aria-label="Choose a profile photo" />
      </div>

      <div className="mt-4 min-h-6 text-sm" aria-live="polite" aria-atomic="true">
        {status === "preparing" ? <span className="inline-flex items-center gap-2 text-slate-600"><Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />Preparing photo…</span> : null}
        {status === "uploading" ? <span className="inline-flex items-center gap-2 text-slate-600"><Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />Uploading photo…</span> : null}
        {error ? <p role="alert" className="font-medium text-red-700">{error}</p> : null}
      </div>

      {dialogOpen && imageSource ? (
        <div className="fixed inset-0 z-[250] grid place-items-center bg-black/60 p-4" role="presentation">
          <div ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby="onboarding-photo-crop-title" className="w-full max-w-md rounded-3xl bg-white p-5 shadow-2xl">
            <div className="flex items-center justify-between gap-4">
              <h2 id="onboarding-photo-crop-title" className="text-lg font-semibold text-slate-950">Crop your photo</h2>
              <button type="button" onClick={closeDialog} disabled={busy} aria-label="Close photo crop dialog" className="grid h-11 w-11 place-items-center rounded-xl text-slate-600 hover:bg-slate-100"><X className="h-5 w-5" /></button>
            </div>
            <div className="relative mt-4 h-[min(70vw,340px)] min-h-64 w-full overflow-hidden rounded-2xl bg-slate-950">
              <Cropper image={imageSource} crop={crop} zoom={zoom} aspect={1} cropShape="round" showGrid onCropChange={setCrop} onZoomChange={setZoom} onCropComplete={(_, pixels) => setCropArea(pixels)} />
            </div>
            <label htmlFor="onboarding-photo-zoom" className="mt-4 block text-sm font-semibold text-slate-800">Zoom</label>
            <input id="onboarding-photo-zoom" type="range" min={1} max={3} step={0.1} value={zoom} onChange={(event) => setZoom(Number(event.target.value))} className="mt-2 w-full accent-emerald-700" />
            <div className="mt-5 grid gap-3 sm:grid-cols-2">
              <button type="button" className={secondaryButton} onClick={() => { setCrop({x: 0, y: 0}); setZoom(1); }} disabled={busy}><RotateCcw className="mr-2 h-4 w-4" aria-hidden="true" />Reset</button>
              <button type="button" className={primaryButton} onClick={() => void confirmAndUpload()} disabled={busy || !cropArea}>{busy ? <Loader2 className="h-4 w-4 animate-spin" aria-label="Saving photo" /> : "Use this crop"}</button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
