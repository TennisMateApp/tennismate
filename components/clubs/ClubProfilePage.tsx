"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Building2, CalendarDays, ExternalLink, MapPin, Users } from "lucide-react";
import TMDesktopSidebar from "@/components/desktop_layout/TMDesktopSidebar";
import ClubMemberCard from "@/components/clubs/ClubMemberCard";
import { useIsDesktop } from "@/lib/useIsDesktop";
import {
  getClubMemberCount,
  getClubMembersPage,
  getClubProfile,
  type ClubMember,
  type ClubProfile,
} from "@/lib/clubProfile";

export default function ClubProfilePage({ courtId }: { courtId: string }) {
  const isDesktop = useIsDesktop();
  const [club, setClub] = useState<ClubProfile | null>(null);
  const [members, setMembers] = useState<ClubMember[]>([]);
  const [memberCount, setMemberCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError("");

    Promise.all([
      getClubProfile(courtId),
      getClubMemberCount(courtId),
      getClubMembersPage({ courtId, pageSize: 6 }),
    ])
      .then(([nextClub, count, page]) => {
        if (!active) return;
        setClub(nextClub);
        setMemberCount(count);
        setMembers(page.members);
      })
      .catch((cause) => {
        console.error("[ClubProfile] failed to load", cause);
        if (active) setError("Unable to load this club right now.");
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [courtId]);

  const content = loading ? (
    <ClubProfileSkeleton />
  ) : error ? (
    <StateCard title={error} body="Please try again shortly." />
  ) : !club ? (
    <StateCard title="Club not found" body="This court is no longer available in TennisMate." />
  ) : (
    <div className="min-w-0">
      <Link href="/courts" className="inline-flex items-center gap-2 text-sm font-extrabold text-emerald-950/65 hover:text-emerald-950">
        <ArrowLeft size={17} aria-hidden="true" /> Courts
      </Link>

      <header className="relative -mx-4 mt-4 overflow-hidden rounded-2xl bg-[linear-gradient(135deg,#0B3D2E_0%,#07523B_55%,#0B3D2E_100%)] py-3.5 text-white shadow-md lg:mx-0 lg:rounded-[24px] lg:p-5">
        <svg
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 h-full w-full text-white opacity-[0.09]"
          viewBox="0 0 800 280"
          preserveAspectRatio="xMidYMid slice"
        >
          <g fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M470 -25 820 80 680 330 330 225Z" />
            <path d="m575 6-70 250M715 48l-70 250M400 96l350 105M365 158l350 105" />
            <path d="m610 38-70 250M540 128l140 42" />
          </g>
        </svg>
        <div className="pointer-events-none absolute inset-0 bg-gradient-to-r from-emerald-950/35 via-transparent to-emerald-950/10" />
        <div className="relative pl-[max(1.25rem,var(--safe-left))] pr-[max(1.25rem,var(--safe-right))] lg:px-0">
          <div className="grid h-7 w-7 place-items-center rounded-lg border border-white/10 bg-white/[0.08] text-[#39FF14]">
            <Building2 size={18} aria-hidden="true" />
          </div>
          <h1 className="mt-1.5 max-w-3xl break-words text-[1.75rem] font-black leading-[1.12] tracking-tight lg:text-3xl">{club.name}</h1>
          <p className="mt-1 text-sm font-bold text-white/70">Community Tennis Club</p>
          {(club.suburb || club.postcode) ? (
            <div className="mt-1.5 flex items-center gap-1.5 text-sm font-semibold text-white/85">
              <MapPin size={16} className="shrink-0 text-[#39FF14]" aria-hidden="true" />
              <span>{[club.suburb, club.postcode].filter(Boolean).join(" ")}</span>
            </div>
          ) : null}
          {(club.officialWebsiteUrl || club.bookingUrl) ? (
            <div className="mb-2.5 mt-2.5 flex flex-wrap gap-2.5">
              {club.officialWebsiteUrl ? (
                <a href={club.officialWebsiteUrl} target="_blank" rel="noreferrer" className="inline-flex min-h-10 items-center justify-center gap-2 rounded-xl border border-white/20 bg-white/10 px-3.5 py-2 text-sm font-extrabold text-white shadow-sm">
                  Club Website <ExternalLink size={15} aria-hidden="true" />
                </a>
              ) : null}
              {club.bookingUrl ? (
                <a href={club.bookingUrl} target="_blank" rel="noreferrer" className="inline-flex min-h-10 items-center justify-center gap-2 rounded-xl bg-[#39FF14] px-3.5 py-2 text-sm font-extrabold text-emerald-950 shadow-sm">
                  Book a Court <CalendarDays size={15} aria-hidden="true" />
                </a>
              ) : null}
            </div>
          ) : null}
        </div>
      </header>

      <section className="mt-6 grid gap-4 lg:grid-cols-[240px_1fr]">
        <div className="rounded-3xl border border-emerald-950/10 bg-white p-5 shadow-sm">
          <div className="grid h-10 w-10 place-items-center rounded-2xl bg-[#39FF14]/20 text-emerald-950"><Users size={20} aria-hidden="true" /></div>
          <div className="mt-4 text-4xl font-black leading-none tabular-nums text-emerald-950">{memberCount}</div>
          <div className="mt-1 text-sm font-extrabold text-emerald-950/60">TennisMate {memberCount === 1 ? "Member" : "Members"}</div>
        </div>

        <div className="rounded-3xl border border-emerald-950/10 bg-white p-5 shadow-sm sm:p-6">
          <h2 className="text-lg font-black text-emerald-950">About</h2>
          <p className="mt-3 text-sm font-semibold leading-6 text-emerald-950/65">
            {club.description || (club.suburb ? `Community tennis club located in ${club.suburb}.` : "A tennis club represented in the TennisMate community.")}
          </p>
        </div>
      </section>

      <section className="mt-8">
        <div className="flex flex-col items-start justify-between gap-3 sm:flex-row sm:items-end sm:gap-4">
          <div>
            <h2 className="text-2xl font-black text-emerald-950">Club Members on TennisMate</h2>
            <p className="mt-1 text-sm font-semibold text-emerald-950/55">Players representing this club on TennisMate.</p>
          </div>
          {memberCount > 6 ? (
            <Link href={`/clubs/${encodeURIComponent(club.id)}/members`} className="shrink-0 text-sm font-extrabold text-emerald-950 underline decoration-[#39FF14] decoration-2 underline-offset-4">
              View all {memberCount} members
            </Link>
          ) : null}
        </div>

        {memberCount === 0 ? (
          <div className="mt-4 rounded-3xl border border-dashed border-emerald-950/20 bg-white px-5 py-10 text-center">
            <p className="text-sm font-extrabold text-emerald-950">No TennisMate members have selected this club yet.</p>
            <p className="mt-2 text-sm font-semibold text-emerald-950/55">Be the first member.</p>
          </div>
        ) : (
          <div className="mt-4 grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {members.map((member) => <ClubMemberCard key={member.id} member={member} />)}
          </div>
        )}
      </section>
    </div>
  );

  if (!isDesktop) {
    return <div className="min-h-screen bg-[#F7FAF8] px-4 py-5 pb-24">{content}</div>;
  }

  return (
    <div className="min-h-screen bg-[#F7FAF8] px-8 py-7 2xl:px-12">
      <div className="grid grid-cols-[280px_minmax(0,1fr)] items-start gap-8">
        <aside className="sticky top-6"><TMDesktopSidebar /></aside>
        <main className="min-w-0 max-w-6xl">{content}</main>
      </div>
    </div>
  );
}

function StateCard({ title, body }: { title: string; body: string }) {
  return <div className="rounded-3xl border border-emerald-950/10 bg-white p-8 text-center"><div className="font-black text-emerald-950">{title}</div><p className="mt-2 text-sm font-semibold text-emerald-950/55">{body}</p></div>;
}

function ClubProfileSkeleton() {
  return <div className="animate-pulse"><div className="h-5 w-24 rounded bg-emerald-950/10" /><div className="-mx-4 mt-4 h-48 rounded-2xl bg-emerald-950/10 lg:mx-0 lg:rounded-[24px]" /><div className="mt-6 grid gap-4 lg:grid-cols-[240px_1fr]"><div className="h-40 rounded-3xl bg-emerald-950/[0.07]" /><div className="h-40 rounded-3xl bg-emerald-950/[0.07]" /></div><div className="mt-8 h-7 w-36 rounded bg-emerald-950/10" /><div className="mt-4 grid gap-4 sm:grid-cols-2 xl:grid-cols-3">{Array.from({ length: 6 }).map((_, index) => <div key={index} className="h-40 rounded-2xl bg-emerald-950/[0.07]" />)}</div></div>;
}
