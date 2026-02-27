"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { doc, getDoc, addDoc, collection, serverTimestamp } from "firebase/firestore";
import { auth, db } from "@/lib/firebaseConfig";
import { Phone, MessageSquare, MapPin, ArrowLeft, X } from "lucide-react";
import TMDesktopSidebar from "@/components/desktop_layout/TMDesktopSidebar";
import TMDesktopCoachProfile from "@/components/coachProfile/TMDesktopCoachProfile";
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

function useIsDesktop(breakpointPx = 1024) {
  const [isDesktop, setIsDesktop] = useState(false);

  useEffect(() => {
    const mq = window.matchMedia(`(min-width: ${breakpointPx}px)`);

    const apply = () => setIsDesktop(mq.matches);
    apply();

    if (typeof mq.addEventListener === "function") {
      mq.addEventListener("change", apply);
      return () => mq.removeEventListener("change", apply);
    } else {
      // Safari fallback
      // @ts-ignore
      mq.addListener(apply);
      // @ts-ignore
      return () => mq.removeListener(apply);
    }
  }, [breakpointPx]);

  return isDesktop;
}


export default function PublicCoachProfilePage() {
  const router = useRouter();
  const params = useParams();
  const coachId = (params?.id as string) || "";

  const [loading, setLoading] = useState(true);
  const [coach, setCoach] = useState<CoachProfile | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [authedUid, setAuthedUid] = useState<string | null>(null);

  const isDesktop = useIsDesktop(1024);

const [sidebarPlayer, setSidebarPlayer] = useState<{
  name: string;
  skillLevel: string;
  avatarUrl: string | null;
}>({
  name: "Player",
  skillLevel: "",
  avatarUrl: null,
});


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

useEffect(() => {
  const unsub = onAuthStateChanged(auth, async (user) => {
    setAuthedUid(user?.uid ?? null);

    // ✅ Sidebar info (desktop)
    try {
      if (!user?.uid) return;

      const snap = await getDoc(doc(db, "players", user.uid));
      const p = (snap.data() as any) || {};

      setSidebarPlayer({
        name: (p.name ?? p.displayName ?? "Player").toString(),
        skillLevel: (p.skillLevel ?? p.skillBandLabel ?? "").toString(),
        avatarUrl: (p.photoThumbURL ?? p.photoURL ?? p.avatar ?? null) as string | null,
      });
    } catch (e) {
      // don’t block page if sidebar load fails
      console.warn("[CoachProfile] sidebar player load failed", e);
    }
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

      const mapsEmbedUrl =
  coach?.courtAddress?.trim()
    ? `https://www.google.com/maps?q=${encodeURIComponent(
        coach.courtAddress
      )}&output=embed`
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
  <div className="min-h-screen bg-[#F7FAF8]">


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
{/* Content */}
{!loading && !error && coach && (
  <>
    {isDesktop ? (
      // =========================
      // ✅ DESKTOP LAYOUT
      // =========================
      <div className="w-full px-8 2xl:px-12 py-8">
        <div className="grid gap-3 xl:grid-cols-[300px_1fr]">
          {/* LEFT: Sidebar */}
          <TMDesktopSidebar
            active="Search"
            player={{
              name: sidebarPlayer.name,
              skillLevel: sidebarPlayer.skillLevel,
              photoURL: sidebarPlayer.avatarUrl,
              photoThumbURL: sidebarPlayer.avatarUrl,
              avatar: sidebarPlayer.avatarUrl,
            }}
          />

          {/* RIGHT: Main */}
          <main className="min-w-0">
            <TMDesktopCoachProfile
              coach={coach}
              hasPhone={hasPhone}
              phoneForLink={phoneForLink}
              mapsUrl={mapsUrl}
              onCall={async () => {
                if (!hasPhone) return;
                await trackContactClick("call");
                window.location.href = `tel:${phoneForLink}`;
              }}
              onText={async () => {
                if (!hasPhone) return;
                await trackContactClick("text");
                window.location.href = `sms:${phoneForLink}`;
              }}
            />
          </main>
        </div>
      </div>
    ) : (
      // =========================
      // ✅ MOBILE LAYOUT (your existing UI)
      // =========================
        <div className="mx-auto max-w-md px-4 pb-24">

    {/* Top bar like screenshot */}
    <div className="mt-3 flex items-center justify-between">
      <button
        onClick={() => router.back()}
        className="inline-flex h-9 w-9 items-center justify-center rounded-full hover:bg-black/5"
        aria-label="Back"
      >
        <ArrowLeft size={18} />
      </button>

      <div className="text-sm font-semibold text-gray-900">Coach Profile</div>

      <div className="h-9 w-9" />
    </div>

    {/* Profile Card */}
    <div className="mt-3 rounded-2xl border bg-white p-4 shadow-sm">
      <div className="flex flex-col items-center text-center">
        {/* Avatar (rounded square like screenshot) */}
        <div
          className="relative aspect-square w-[110px] overflow-hidden rounded-2xl"
          style={{
            background: "rgba(0,0,0,0.04)",
            border: "1px solid rgba(0,0,0,0.10)",
          }}
        >
          <img
            src={coach.avatar || "/default-avatar.png"}
            alt={coach.name || "Coach"}
            className="h-full w-full object-cover object-center"
            onError={(e) => {
              (e.currentTarget as HTMLImageElement).src = "/default-avatar.png";
            }}
          />
        </div>

        <div className="mt-3 text-lg font-extrabold text-gray-900">
          {coach.name?.trim() ? coach.name : "Coach"}
        </div>

        <div className="mt-0.5 text-xs font-semibold text-gray-600">
          {coach.contactFirstForRate
            ? "Contact for rates"
            : coach.coachingExperience?.trim()
              ? `${coach.coachingExperience} years coaching`
              : "Coach"}
        </div>

        {/* Contact buttons near top ✅ (NO Book Lesson) */}
        <div className="mt-3 grid w-full grid-cols-2 gap-2">
          <button
            type="button"
            disabled={!hasPhone}
            className={[
              "inline-flex items-center justify-center gap-2 rounded-xl px-4 py-3 text-sm font-extrabold",
              hasPhone
                ? "bg-emerald-600 text-white hover:bg-emerald-700"
                : "bg-gray-200 text-gray-500 cursor-not-allowed",
            ].join(" ")}
            onClick={async () => {
              if (!hasPhone) return;
              await trackContactClick("call");
              window.location.href = `tel:${phoneForLink}`;
            }}
          >
            <Phone size={16} />
            Contact
          </button>

          <button
            type="button"
            disabled={!hasPhone}
            className={[
              "inline-flex items-center justify-center gap-2 rounded-xl px-4 py-3 text-sm font-extrabold border",
              hasPhone
                ? "bg-white hover:bg-black/5 border-black/10 text-gray-900"
                : "bg-gray-100 text-gray-400 cursor-not-allowed border-black/5",
            ].join(" ")}
            onClick={async () => {
              if (!hasPhone) return;
              await trackContactClick("text");
              window.location.href = `sms:${phoneForLink}`;
            }}
          >
            <MessageSquare size={16} />
            Text
          </button>
        </div>

        {!hasPhone && (
          <div className="mt-2 text-xs text-gray-500">
            This coach hasn’t provided a mobile number yet.
          </div>
        )}
      </div>
    </div>

    {/* Bio */}
    {bioText && (
      <div className="mt-4 rounded-2xl border bg-white p-4 shadow-sm">
        <div className="flex items-center justify-between">
          <div className="text-sm font-extrabold text-gray-900">Bio</div>
          {bioText.length > 220 && (
            <button
              type="button"
              onClick={() => setExpandBio((v) => !v)}
              className="text-xs font-semibold text-emerald-700 hover:underline"
            >
              {expandBio ? "Show less" : "Read more"}
            </button>
          )}
        </div>

        <div className="mt-2 text-sm leading-relaxed text-gray-700 whitespace-pre-wrap">
          {expandBio ? bioText : clampText(bioText, 260)}
        </div>
      </div>
    )}

    {/* Coaching Levels */}
    {coachingLevels.length > 0 && (
      <div className="mt-4 rounded-2xl border bg-white p-4 shadow-sm">
        <div className="text-sm font-extrabold text-gray-900">Coaching Levels</div>

        <div className="mt-3 flex flex-wrap gap-2">
          {coachingLevels.map((lvl) => (
            <span
              key={lvl}
              className="rounded-full px-3 py-1.5 text-xs font-extrabold"
              style={{
                background: "rgba(57,255,20,0.18)",
                color: "#0B3D2E",
                border: "1px solid rgba(11,61,46,0.12)",
              }}
            >
              {lvl}
            </span>
          ))}
        </div>
      </div>
    )}

    {/* Coaching Locations */}
    {coach.courtAddress?.trim() && (
      <div className="mt-4 rounded-2xl border bg-white p-4 shadow-sm">
        <div className="text-sm font-extrabold text-gray-900">Coaching Locations</div>

        <div
          className="mt-3 rounded-xl border p-3"
          style={{
            borderColor: "rgba(11,61,46,0.12)",
            background: "rgba(247,250,248,0.65)",
          }}
        >
          <div className="flex items-start gap-2">
            <MapPin size={18} className="mt-0.5 shrink-0 text-emerald-700" />
            <div className="min-w-0">
              <div className="text-sm font-semibold text-gray-900 line-clamp-2">
                {coach.courtAddress}
              </div>
              <div className="mt-0.5 text-xs text-gray-600">
                Tap below to open directions
              </div>
            </div>
          </div>

          {mapsEmbedUrl && (
  <div
    className="mt-3 overflow-hidden rounded-2xl border"
    style={{ borderColor: "rgba(11,61,46,0.12)" }}
  >
    <iframe
      src={mapsEmbedUrl}
      width="100%"
      height="260"
      loading="lazy"
      referrerPolicy="no-referrer-when-downgrade"
      className="block w-full"
    />
  </div>
)}


          {mapsUrl && (
            <a
              href={mapsUrl}
              target="_blank"
              rel="noreferrer"
              className="mt-3 inline-flex w-full items-center justify-center gap-2 rounded-xl border px-4 py-2.5 text-sm font-extrabold hover:bg-black/5"
              style={{
                borderColor: "rgba(11,61,46,0.12)",
                color: "#0B3D2E",
              }}
            >
              Open in Maps
            </a>
          )}
        </div>
      </div>
    )}

    {/* Playing Background */}
    {playingText && (
      <div className="mt-4 rounded-2xl border bg-white p-4 shadow-sm">
        <div className="flex items-center justify-between">
          <div className="text-sm font-extrabold text-gray-900">Playing Background</div>
          {playingText.length > 220 && (
            <button
              type="button"
              onClick={() => setExpandPlaying((v) => !v)}
              className="text-xs font-semibold text-emerald-700 hover:underline"
            >
              {expandPlaying ? "Show less" : "Read more"}
            </button>
          )}
        </div>

        <div className="mt-2 text-sm leading-relaxed text-gray-700 whitespace-pre-wrap">
          {expandPlaying ? playingText : clampText(playingText, 260)}
        </div>
      </div>
    )}

    {/* Gallery (optional) */}
    {heroImages.length > 0 && (
      <div className="mt-4 rounded-2xl border bg-white p-4 shadow-sm">
        <div className="text-sm font-extrabold text-gray-900">Gallery</div>

        <div className="mt-3 grid grid-cols-2 gap-3">
          {heroImages.slice(0, 6).map((url, idx) => (
            <button
              key={`${url}-${idx}`}
              type="button"
              className="relative aspect-[4/3] overflow-hidden rounded-xl border"
              style={{ borderColor: "rgba(0,0,0,0.10)", background: "rgba(0,0,0,0.04)" }}
              onClick={() => {
                setActivePhotoIdx(idx);
                setLightboxOpen(true);
              }}
            >
              <img src={url} alt="Gallery" className="h-full w-full object-cover" />
            </button>
          ))}
        </div>
      </div>
    )}

    {/* Lightbox (keep your existing one) */}
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
            <img
              src={activeHeroUrl || heroFallback}
              alt="Coach photo"
              className="max-h-[78vh] w-full object-contain bg-black"
            />
          </div>
        </div>
      </div>
    )}
       </div>
  )}
  </>
)}

  </div>
);
}