"use client";

import Link from "next/link";
import { Building2 } from "lucide-react";
import { clubProfileHref, getCompleteClubMembership, stopClubLinkPropagation } from "@/lib/matchClubDiscovery";

export default function MatchClubAffiliation({ player }: { player: {
  clubStatus?: unknown;
  clubId?: unknown;
  clubName?: unknown;
} }) {
  const membership = getCompleteClubMembership(player);
  const href = clubProfileHref(player);
  if (!membership || !href) return null;

  return (
    <Link
      href={href}
      onClick={stopClubLinkPropagation}
      className="mt-1.5 flex min-w-0 w-fit max-w-full items-center gap-1.5 rounded-md text-[11px] font-bold text-emerald-950/60 outline-none transition-colors hover:text-emerald-950 focus-visible:ring-2 focus-visible:ring-[#39FF14] focus-visible:ring-offset-2"
      aria-label={`View ${membership.clubName} club profile`}
    >
      <Building2 size={13} className="shrink-0" aria-hidden="true" />
      <span className="truncate">{membership.clubName}</span>
    </Link>
  );
}
