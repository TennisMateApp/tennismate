"use client";

import Image from "next/image";
import { MapPin, Phone, MessageSquare } from "lucide-react";

type GalleryPhoto = { url: string; path?: string; createdAt?: number };

export type CoachProfile = {
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

const TM = {
  forest: "#0B3D2E",
  neon: "#39FF14",
  bg: "#F7FAF8",
};

function uniq(arr: string[]) {
  return Array.from(new Set(arr.filter(Boolean)));
}

function mapsEmbedUrlFromAddress(addr: string) {
  return `https://www.google.com/maps?q=${encodeURIComponent(addr)}&output=embed`;
}

export default function TMDesktopCoachProfile(props: {
  coach: CoachProfile;

  // viewer actions
  hasPhone: boolean;
  phoneForLink: string;
  onCall: () => Promise<void> | void;
  onText: () => Promise<void> | void;

  // location
  mapsUrl: string | null;

  // optional (for header subtext)
  totalGallery?: number;
}) {
  const { coach, hasPhone, phoneForLink, onCall, onText, mapsUrl } = props;

  const galleryUrls = Array.isArray(coach.galleryPhotos)
    ? coach.galleryPhotos.map((p) => p.url).filter(Boolean)
    : [];

  const heroImages = uniq(galleryUrls);
  const avatarSrc = coach.avatar || "/default-avatar.png";

  const levels =
    Array.isArray(coach.coachingSkillLevels) && coach.coachingSkillLevels.length > 0
      ? coach.coachingSkillLevels
      : [];

  const bio = (coach.bio || "").trim();
  const playing = (coach.playingBackground || "").trim();

  return (
    <div className="min-w-0">
      {/* Header strip (name + actions) */}
      <div className="rounded-2xl border bg-white p-5 shadow-sm"
        style={{ borderColor: "rgba(11,61,46,0.10)" }}
      >
        <div className="flex items-start justify-between gap-5">
          <div className="flex items-center gap-4 min-w-0">
            {/* avatar */}
            <div
              className="relative h-12 w-12 overflow-hidden rounded-full"
              style={{ border: "1px solid rgba(0,0,0,0.10)", background: "rgba(0,0,0,0.04)" }}
            >
              <Image src={avatarSrc} alt={coach.name || "Coach"} fill sizes="48px" className="object-cover" />
            </div>

            {/* name + sub */}
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="truncate text-[18px] font-extrabold" style={{ color: TM.forest }}>
                  {coach.name || "Coach"}
                </h1>

                {coach.contactFirstForRate && (
                  <span
                    className="rounded-full px-2.5 py-1 text-[10px] font-extrabold uppercase"
                    style={{
                      background: "rgba(57,255,20,0.18)",
                      color: TM.forest,
                      border: "1px solid rgba(11,61,46,0.12)",
                    }}
                  >
                    Contact for rates
                  </span>
                )}
              </div>

              <div className="mt-0.5 flex flex-wrap items-center gap-2 text-[12px]"
                style={{ color: "rgba(11,61,46,0.60)" }}
              >
                {coach.coachingExperience?.trim() ? (
                  <span>{coach.coachingExperience} yrs experience</span>
                ) : (
                  <span>Coach</span>
                )}
                {coach.courtAddress?.trim() ? (
                  <>
                    <span>•</span>
                    <span className="truncate max-w-[420px]">{coach.courtAddress}</span>
                  </>
                ) : null}
              </div>
            </div>
          </div>

          {/* actions (NO book lesson, NO availability, NO responds-in-time) */}
          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              disabled={!hasPhone}
              onClick={() => {
                if (!hasPhone) return;
                onCall();
                // keep actual navigation outside if you do it in onCall; otherwise uncomment:
                // window.location.href = `tel:${phoneForLink}`;
              }}
              className="inline-flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-extrabold disabled:opacity-60"
              style={{
                background: hasPhone ? TM.neon : "rgba(0,0,0,0.06)",
                color: TM.forest,
                border: "1px solid rgba(11,61,46,0.12)",
              }}
            >
              <Phone size={16} />
              Contact
            </button>

            <button
              type="button"
              disabled={!hasPhone}
              onClick={() => {
                if (!hasPhone) return;
                onText();
                // window.location.href = `sms:${phoneForLink}`;
              }}
              className="inline-flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-extrabold disabled:opacity-60"
              style={{
                background: "rgba(11,61,46,0.06)",
                color: TM.forest,
                border: "1px solid rgba(11,61,46,0.12)",
              }}
            >
              <MessageSquare size={16} />
              Text
            </button>
          </div>
        </div>
      </div>

      {/* Two-column layout like your screenshot */}
      <div className="mt-4 grid gap-4 xl:grid-cols-[1fr_380px]">
        {/* LEFT column */}
        <div className="min-w-0 space-y-4">
          {/* About / Bio */}
          <div className="rounded-2xl border bg-white p-5 shadow-sm"
            style={{ borderColor: "rgba(11,61,46,0.10)" }}
          >
            <div className="text-sm font-extrabold" style={{ color: TM.forest }}>
              About
            </div>

            {bio ? (
              <div className="mt-2 text-sm leading-relaxed" style={{ color: "rgba(11,61,46,0.75)" }}>
                {bio}
              </div>
            ) : (
              <div className="mt-2 text-sm" style={{ color: "rgba(11,61,46,0.55)" }}>
                No bio provided yet.
              </div>
            )}
          </div>

          {/* Coaching Locations + map */}
          {coach.courtAddress?.trim() && (
            <div className="rounded-2xl border bg-white p-5 shadow-sm"
              style={{ borderColor: "rgba(11,61,46,0.10)" }}
            >
              <div className="flex items-center justify-between gap-3">
                <div className="text-sm font-extrabold" style={{ color: TM.forest }}>
                  Coaching Locations
                </div>

                {mapsUrl && (
                  <a
                    href={mapsUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-2 rounded-xl px-3 py-2 text-xs font-extrabold hover:bg-black/5"
                    style={{
                      border: "1px solid rgba(11,61,46,0.12)",
                      color: TM.forest,
                      background: "transparent",
                    }}
                  >
                    <MapPin size={14} />
                    Open in Maps
                  </a>
                )}
              </div>

              <div className="mt-2 text-sm" style={{ color: "rgba(11,61,46,0.70)" }}>
                {coach.courtAddress}
              </div>

              <div
                className="mt-3 overflow-hidden rounded-2xl"
                style={{ border: "1px solid rgba(0,0,0,0.10)", background: "rgba(0,0,0,0.04)" }}
              >
                <iframe
                  title="Coach location"
                  src={mapsEmbedUrlFromAddress(coach.courtAddress)}
                  className="h-[220px] w-full"
                  loading="lazy"
                />
              </div>
            </div>
          )}
        </div>

        {/* RIGHT column */}
        <aside className="min-w-0 space-y-4">
          {/* Expertise & Skills */}
          <div className="rounded-2xl border bg-white p-5 shadow-sm"
            style={{ borderColor: "rgba(11,61,46,0.10)" }}
          >
            <div className="text-sm font-extrabold" style={{ color: TM.forest }}>
              Expertise & Skills
            </div>

            {levels.length > 0 ? (
              <div className="mt-3 flex flex-wrap gap-2">
                {levels.map((lvl) => (
                  <span
                    key={lvl}
                    className="rounded-full px-3 py-1.5 text-[11px] font-extrabold"
                    style={{
                      background: "rgba(57,255,20,0.18)",
                      color: TM.forest,
                      border: "1px solid rgba(11,61,46,0.12)",
                    }}
                  >
                    {lvl}
                  </span>
                ))}
              </div>
            ) : (
              <div className="mt-2 text-sm" style={{ color: "rgba(11,61,46,0.55)" }}>
                No coaching levels listed yet.
              </div>
            )}
          </div>

          {/* Photo Gallery */}
          <div className="rounded-2xl border bg-white p-5 shadow-sm"
            style={{ borderColor: "rgba(11,61,46,0.10)" }}
          >
            <div className="flex items-center justify-between">
              <div className="text-sm font-extrabold" style={{ color: TM.forest }}>
                Photo Gallery
              </div>

              <div className="text-xs" style={{ color: "rgba(11,61,46,0.45)" }}>
                {heroImages.length > 0 ? `${heroImages.length} photos` : "—"}
              </div>
            </div>

            {heroImages.length === 0 ? (
              <div className="mt-3 text-sm" style={{ color: "rgba(11,61,46,0.55)" }}>
                No gallery photos yet.
              </div>
            ) : (
              <div className="mt-3 grid grid-cols-2 gap-3">
                {heroImages.slice(0, 4).map((url, idx) => (
                  <div
                    key={`${url}-${idx}`}
                    className="relative aspect-[4/3] overflow-hidden rounded-2xl"
                    style={{
                      border: "1px solid rgba(0,0,0,0.10)",
                      background: "rgba(0,0,0,0.04)",
                    }}
                  >
                    <Image src={url} alt="Gallery" fill sizes="300px" className="object-cover" />
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Optional Playing Background (right side fits well on big screens) */}
          {playing?.trim() && (
            <div className="rounded-2xl border bg-white p-5 shadow-sm"
              style={{ borderColor: "rgba(11,61,46,0.10)" }}
            >
              <div className="text-sm font-extrabold" style={{ color: TM.forest }}>
                Playing Background
              </div>
              <div className="mt-2 text-sm leading-relaxed" style={{ color: "rgba(11,61,46,0.75)" }}>
                {playing}
              </div>
            </div>
          )}
        </aside>
      </div>
    </div>
  );
}
