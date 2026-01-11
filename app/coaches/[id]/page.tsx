"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { doc, getDoc, addDoc, collection, serverTimestamp } from "firebase/firestore";
import { auth, db } from "@/lib/firebaseConfig";
import { Phone, MessageSquare, MapPin, ArrowLeft, X } from "lucide-react";
import { onAuthStateChanged } from "firebase/auth";

type GalleryPhoto = { url: string; path?: string; createdAt?: number };

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
};

function normalizePhoneForLink(phone: string) {
  return phone.replace(/[^\d+]/g, "");
}

function uniq(arr: string[]) {
  return Array.from(new Set(arr.filter(Boolean)));
}

export default function PublicCoachProfilePage() {
  const router = useRouter();
  const params = useParams();
  const coachId = (params?.id as string) || "";

  const [loading, setLoading] = useState(true);
  const [coach, setCoach] = useState<CoachProfile | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [authedUid, setAuthedUid] = useState<string | null>(null);

  // UI state
  const [activePhotoIdx, setActivePhotoIdx] = useState(0);
  const [lightboxOpen, setLightboxOpen] = useState(false);
  const [expandBio, setExpandBio] = useState(false);
  const [expandPlaying, setExpandPlaying] = useState(false);

  const coachRef = useMemo(() => {
    if (!coachId) return null;
    return doc(db, "coaches", coachId);
  }, [coachId]);

  // Derivations MUST be hooks-safe (work even when coach is null)
  const galleryUrls = useMemo(() => {
    if (!coach) return [];
    return Array.isArray(coach.galleryPhotos)
      ? coach.galleryPhotos.map((p) => p.url).filter(Boolean)
      : [];
  }, [coach]);

  const heroImages = useMemo(() => {
  return uniq(galleryUrls);
}, [galleryUrls]);

  const heroFallback = coach?.avatar || "/default-avatar.png";

  const safeActiveIdx = useMemo(() => {
    const max = Math.max(0, heroImages.length - 1);
    return Math.min(activePhotoIdx, max);
  }, [activePhotoIdx, heroImages.length]);

  const activeHeroUrl = useMemo(() => {
    if (heroImages.length > 0) return heroImages[safeActiveIdx];
    return heroFallback;
  }, [heroImages, safeActiveIdx, heroFallback]);

  // Load coach doc
  useEffect(() => {
    if (!coachRef) return;

    (async () => {
      setLoading(true);
      setError(null);

      try {
        const snap = await getDoc(coachRef);
        if (!snap.exists()) {
          setCoach(null);
          setError("Coach profile not found.");
          return;
        }
        setCoach(snap.data() as CoachProfile);
      } catch (e: any) {
        setError(e?.message ?? "Failed to load coach profile");
        setCoach(null);
      } finally {
        setLoading(false);
      }
    })();
  }, [coachRef]);

  // Auth UID (owner controls)
  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (user) => {
      setAuthedUid(user?.uid ?? null);
    });
    return () => unsub();
  }, []);

  // ✅ Lightbox keyboard navigation — always defined, guarded inside
  useEffect(() => {
    if (!lightboxOpen) return;

    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setLightboxOpen(false);
      if (e.key === "ArrowRight") {
        setActivePhotoIdx((i) => Math.min(i + 1, Math.max(0, heroImages.length - 1)));
      }
      if (e.key === "ArrowLeft") {
        setActivePhotoIdx((i) => Math.max(i - 1, 0));
      }
    };

    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [lightboxOpen, heroImages.length]);

  // ✅ If gallery count changes, keep active index in bounds
useEffect(() => {
  setActivePhotoIdx((i) => {
    const max = Math.max(0, heroImages.length - 1);
    return Math.min(i, max);
  });
}, [heroImages.length]);


  // Derived UI values (non-hooks)
  const isOwner = authedUid && coachId ? authedUid === coachId : false;
  const phoneForLink = normalizePhoneForLink(coach?.mobile || "");
  const hasPhone = !!phoneForLink;

  const mapsUrl =
    coach?.courtAddress?.trim()
      ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(
          coach.courtAddress
        )}`
      : null;

  const coachingLevels =
    Array.isArray(coach?.coachingSkillLevels) && coach!.coachingSkillLevels.length > 0
      ? coach!.coachingSkillLevels
      : [];

  const trustBits: string[] = [];
  if (coach?.coachingExperience?.trim()) trustBits.push(`${coach.coachingExperience} years coaching`);
  if (mapsUrl) trustBits.push("Location listed");
  const trustLine = trustBits.join(" · ");

  const clampText = (txt: string, maxChars: number) =>
    txt.length > maxChars ? txt.slice(0, maxChars).trimEnd() + "…" : txt;

  const bioText = (coach?.bio || "").trim();
  const playingText = (coach?.playingBackground || "").trim();

    // Track "Call" / "Text" clicks
  const trackContactClick = async (action: "call" | "text") => {
    try {
      // If you only want logged-in tracking, keep this guard:
      const viewerUid = auth.currentUser?.uid ?? null;
      if (!viewerUid) return;

      await addDoc(collection(db, "coach_contact_events"), {
        action,                 // "call" | "text"
        coachId,                // profile being viewed
        viewerUid,              // who clicked
        phoneProvided: hasPhone,
        createdAt: serverTimestamp(),
        source: "public_coach_profile",
      });
    } catch (err) {
      // Never block the user from calling/texting if tracking fails
      console.warn("[CoachProfile] trackContactClick failed", err);
    }
  };


  // ✅ Single return to avoid hook-order issues
  return (
    <div className="max-w-3xl mx-auto p-4 pb-20">
      <button
        onClick={() => router.back()}
        className="inline-flex items-center gap-2 rounded-lg border px-3 py-2 text-sm hover:bg-gray-50"
      >
        <ArrowLeft size={16} />
        Back
      </button>

      {/* Loading */}
      {loading && (
        <div className="mt-4 rounded-2xl border p-4">
          <div className="text-sm opacity-70">Loading coach…</div>
        </div>
      )}

      {/* Error */}
      {!loading && (error || !coach) && (
        <div className="mt-4 rounded-2xl border p-4">
          <div className="text-sm text-red-700">{error ?? "Coach profile not found."}</div>
        </div>
      )}

      {/* Content */}
      {!loading && !error && coach && (
        <>
          {/* HERO / CAROUSEL */}
          <div className="mt-4 relative">
           <div className="relative rounded-2xl border bg-gray-100 overflow-visible">
  {/* Inner wrapper clips ONLY the image */}
  <div className="relative overflow-hidden rounded-2xl">
    {/* eslint-disable-next-line @next/next/no-img-element */}
    <img
      src={activeHeroUrl || heroFallback}
      alt="Coach photo"
      className="h-56 sm:h-72 w-full object-cover cursor-pointer"
      onClick={() => setLightboxOpen(true)}
      onError={(e) => {
        (e.currentTarget as HTMLImageElement).src = heroFallback;
      }}
    />

    <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/40 via-black/0 to-black/0" />

    {/* your arrows + dots stay inside this inner wrapper */}
    {heroImages.length > 1 && (
      <>
        <button
          type="button"
          onClick={() => setActivePhotoIdx((i) => Math.max(i - 1, 0))}
          disabled={safeActiveIdx === 0}
          className="absolute left-3 top-1/2 -translate-y-1/2 rounded-full bg-white/90 px-3 py-2 text-sm border hover:bg-white disabled:opacity-50"
          aria-label="Previous photo"
        >
          ‹
        </button>

        <button
          type="button"
          onClick={() => setActivePhotoIdx((i) => Math.min(i + 1, heroImages.length - 1))}
          disabled={safeActiveIdx === heroImages.length - 1}
          className="absolute right-3 top-1/2 -translate-y-1/2 rounded-full bg-white/90 px-3 py-2 text-sm border hover:bg-white disabled:opacity-50"
          aria-label="Next photo"
        >
          ›
        </button>

        <div className="absolute bottom-3 left-1/2 -translate-x-1/2 flex gap-1.5">
          {heroImages.map((_, idx) => (
            <button
              key={idx}
              type="button"
              onClick={() => setActivePhotoIdx(idx)}
              className={[
                "h-2 w-2 rounded-full border",
                idx === safeActiveIdx ? "bg-white border-white" : "bg-white/40 border-white/60",
              ].join(" ")}
              aria-label={`Go to photo ${idx + 1}`}
            />
          ))}
        </div>
      </>
    )}
  </div>

  {/* Floating avatar now NOT clipped */}
  <div className="absolute -bottom-8 left-4 sm:left-6">
    <div className="h-20 w-20 rounded-full overflow-hidden ring-4 ring-white bg-white border">
      {coach.avatar ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={coach.avatar}
          alt={`${coach.name || "Coach"} avatar`}
          className="h-full w-full object-cover"
          onError={(e) => {
            (e.currentTarget as HTMLImageElement).src = "/default-avatar.png";
          }}
        />
      ) : (
        <div className="h-full w-full flex items-center justify-center text-xs opacity-60">
          No photo
        </div>
      )}
    </div>
  </div>
</div>


            {/* Name + chips under hero */}
            <div className="mt-10 sm:mt-12 rounded-2xl border bg-white p-4 sm:p-5 shadow-sm">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <h1 className="text-xl sm:text-2xl font-semibold">
                      {coach.name?.trim() ? coach.name : "Coach"}
                    </h1>

                    {coach.contactFirstForRate && (
                      <span className="rounded-full border border-emerald-200 bg-emerald-50 text-emerald-800 px-3 py-1 text-xs font-medium">
                        Contact for rates
                      </span>
                    )}
                  </div>

                  {trustLine && <div className="mt-1 text-sm text-gray-600">{trustLine}</div>}

                </div>

                {isOwner && (
                  <button
                    onClick={() => router.push("/coach/profile")}
                    className="shrink-0 inline-flex items-center justify-center rounded-lg border px-3 py-2 text-sm hover:bg-gray-50"
                  >
                    Edit profile
                  </button>
                )}
              </div>

        {/* Who I coach (no icons) */}
{coachingLevels.length > 0 && (
  <div className="mt-4">
    <div className="text-sm font-semibold text-gray-900">Who I coach</div>
    <div className="mt-2 flex flex-wrap gap-2">
      {coachingLevels.map((lvl) => (
        <span
          key={lvl}
          className="rounded-full border border-gray-200 bg-gray-50 px-3 py-1.5 text-xs font-medium text-gray-800"
        >
          {lvl}
        </span>
      ))}
    </div>
  </div>
)}

{/* Contact buttons (under the coach info card) */}
<div className="mt-4">
  <div className="text-sm font-semibold text-gray-900">Contact</div>

  <div className="mt-2 flex flex-wrap gap-2">
 <a
  href={hasPhone ? `tel:${phoneForLink}` : undefined}
  className={[
    "flex-1 inline-flex items-center justify-center gap-2 rounded-xl px-4 py-3 text-sm font-semibold",
    hasPhone
      ? "bg-emerald-600 text-white hover:bg-emerald-700"
      : "bg-gray-200 text-gray-500 cursor-not-allowed",
  ].join(" ")}
  onClick={async (e) => {
    if (!hasPhone) {
      e.preventDefault();
      return;
    }

    // ensure tracking logs before leaving the page
    e.preventDefault();
    await trackContactClick("call");
    window.location.href = `tel:${phoneForLink}`;
  }}
>
  <Phone size={16} />
  Call
</a>


 <a
  href={hasPhone ? `sms:${phoneForLink}` : undefined}
  className={[
    "flex-1 inline-flex items-center justify-center gap-2 rounded-xl px-4 py-3 text-sm font-semibold border",
    hasPhone ? "hover:bg-gray-50" : "bg-gray-100 text-gray-400 cursor-not-allowed",
  ].join(" ")}
  onClick={async (e) => {
    if (!hasPhone) {
      e.preventDefault();
      return;
    }

    e.preventDefault();
    await trackContactClick("text");
    window.location.href = `sms:${phoneForLink}`;
  }}
>
  <MessageSquare size={16} />
  Text
</a>

  </div>

  {!hasPhone && (
    <div className="mt-2 text-xs text-gray-500">Phone not provided by this coach.</div>
  )}
</div>

            </div>
          </div>

          {/* Court location (standalone) */}
{coach.courtAddress?.trim() && (
  <div className="mt-6 rounded-2xl border bg-white p-4 sm:p-5 shadow-sm">
    <div className="flex items-start justify-between gap-3">
      <div className="min-w-0">
        <div className="text-sm font-semibold text-gray-900">Court location</div>

        <div className="mt-2 flex items-start gap-2 text-sm text-gray-800">
          <MapPin size={18} className="mt-0.5 shrink-0 text-emerald-700" />
          <span className="break-words whitespace-pre-wrap">{coach.courtAddress}</span>
        </div>

        <div className="mt-2 text-xs text-gray-500">
          Tip: Confirm exact court/meeting point when you reach out.
        </div>
      </div>

      {mapsUrl && (
        <a
          href={mapsUrl}
          target="_blank"
          rel="noreferrer"
          className="shrink-0 inline-flex items-center justify-center rounded-xl bg-emerald-600 px-3 py-2 text-xs font-semibold text-white hover:bg-emerald-700"
        >
          Open in Maps
        </a>
      )}
    </div>
  </div>
)}


          {/* Playing background */}
          {playingText && (
            <div className="mt-6 rounded-2xl border bg-white p-4 sm:p-5 shadow-sm">
              <div className="flex items-start justify-between gap-3">
                <h2 className="font-semibold">Playing background</h2>
                {playingText.length > 220 && (
                  <button
                    type="button"
                    onClick={() => setExpandPlaying((v) => !v)}
                    className="text-sm text-emerald-700 hover:underline"
                  >
                    {expandPlaying ? "Show less" : "Read more"}
                  </button>
                )}
              </div>

              <p className="mt-2 text-sm whitespace-pre-wrap text-gray-800 leading-relaxed">
                {expandPlaying ? playingText : clampText(playingText, 260)}
              </p>
            </div>
          )}

          {/* About */}
          {bioText && (
            <div className="mt-6 rounded-2xl border bg-white p-4 sm:p-5 shadow-sm">
              <div className="flex items-start justify-between gap-3">
                <h2 className="font-semibold">About</h2>
                {bioText.length > 220 && (
                  <button
                    type="button"
                    onClick={() => setExpandBio((v) => !v)}
                    className="text-sm text-emerald-700 hover:underline"
                  >
                    {expandBio ? "Show less" : "Read more"}
                  </button>
                )}
              </div>

              <p className="mt-2 text-sm whitespace-pre-wrap text-gray-800 leading-relaxed">
                {expandBio ? bioText : clampText(bioText, 260)}
              </p>
            </div>
          )}


          {/* Lightbox */}
          {lightboxOpen && (
            <div
              className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4"
              onClick={() => setLightboxOpen(false)}
              role="dialog"
              aria-modal="true"
            >
              <div className="relative w-full max-w-4xl" onClick={(e) => e.stopPropagation()}>
                <button
                  type="button"
                  onClick={() => setLightboxOpen(false)}
                  className="absolute -top-12 right-0 inline-flex items-center gap-2 rounded-lg bg-white/90 px-3 py-2 text-sm border hover:bg-white"
                >
                  <X size={16} />
                  Close
                </button>

                <div className="relative overflow-hidden rounded-2xl bg-black">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={activeHeroUrl || heroFallback}
                    alt="Coach photo"
                    className="max-h-[78vh] w-full object-contain bg-black"
                  />
                </div>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
