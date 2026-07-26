"use client";

import Image from "next/image";
import Link from "next/link";
import { CalendarDays } from "lucide-react";
import type { ClubMember } from "@/lib/clubProfile";

export default function ClubMemberCard({ member }: { member: ClubMember }) {
  return (
    <Link
      href={`/players/${encodeURIComponent(member.id)}`}
      className="group rounded-2xl border border-emerald-950/10 bg-white p-4 shadow-sm transition hover:-translate-y-0.5 hover:shadow-md focus:outline-none focus:ring-2 focus:ring-[#39FF14]"
      aria-label={`View ${member.name}'s profile`}
    >
      <div className="flex items-center gap-4 sm:flex-col sm:text-center">
        <div className="relative h-20 w-20 shrink-0 overflow-hidden rounded-2xl border border-emerald-950/10 bg-emerald-950/[0.04] sm:h-28 sm:w-28">
          <Image
            src={member.photoUrl || "/default-avatar.png"}
            alt={member.name}
            fill
            sizes="(min-width: 640px) 112px, 80px"
            className="object-cover"
          />
        </div>
        <div className="min-w-0 flex-1">
          <div className="break-words text-base font-black text-emerald-950">{member.name}</div>
          <div className="mt-2 inline-flex rounded-full border border-[#39FF14]/35 bg-[#39FF14]/15 px-3 py-1 text-xs font-extrabold text-emerald-950">{member.skill}</div>
          {member.availability.length ? (
            <div className="mt-4 flex items-start gap-1.5 text-left text-xs font-semibold text-emerald-950/60 sm:justify-center">
              <CalendarDays className="mt-0.5 shrink-0" size={14} aria-hidden="true" />
              <span className="line-clamp-2">{member.availability.slice(0, 2).join(" · ")}</span>
            </div>
          ) : null}
        </div>
      </div>
    </Link>
  );
}
