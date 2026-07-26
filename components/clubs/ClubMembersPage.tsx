"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import TMDesktopSidebar from "@/components/desktop_layout/TMDesktopSidebar";
import ClubMemberCard from "@/components/clubs/ClubMemberCard";
import { useIsDesktop } from "@/lib/useIsDesktop";
import { getClubMemberCount, getClubMembersPage, getClubProfile, type ClubMember, type ClubProfile } from "@/lib/clubProfile";

const PAGE_SIZE = 12;

export default function ClubMembersPage({ courtId }: { courtId: string }) {
  const isDesktop = useIsDesktop();
  const [club, setClub] = useState<ClubProfile | null>(null);
  const [members, setMembers] = useState<ClubMember[]>([]);
  const [memberCount, setMemberCount] = useState(0);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    setLoading(true);
    Promise.all([getClubProfile(courtId), getClubMemberCount(courtId), getClubMembersPage({ courtId, pageSize: PAGE_SIZE })])
      .then(([nextClub, count, page]) => {
        if (!active) return;
        setClub(nextClub);
        setMemberCount(count);
        setMembers(page.members);
        setCursor(page.nextCursor);
      })
      .catch((cause) => {
        console.error("[ClubMembers] failed to load", cause);
        if (active) setError("Unable to load club members right now.");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => { active = false; };
  }, [courtId]);

  const loadMore = async () => {
    if (!cursor || loadingMore) return;
    setLoadingMore(true);
    try {
      const page = await getClubMembersPage({ courtId, pageSize: PAGE_SIZE, afterId: cursor });
      setMembers((current) => [...current, ...page.members]);
      setCursor(page.nextCursor);
    } catch (cause) {
      console.error("[ClubMembers] failed to load more", cause);
      setError("Unable to load more members right now.");
    } finally {
      setLoadingMore(false);
    }
  };

  const content = (
    <div className="min-w-0">
      <Link href={`/clubs/${encodeURIComponent(courtId)}`} className="inline-flex items-center gap-2 text-sm font-extrabold text-emerald-950/65 hover:text-emerald-950"><ArrowLeft size={17} aria-hidden="true" /> Back to club</Link>
      <div className="mt-5">
        <h1 className="break-words text-3xl font-black tracking-tight text-emerald-950">{club ? `${club.name} Members` : "Club Members"}</h1>
        {!loading && club ? <p className="mt-2 text-sm font-semibold text-emerald-950/55">{memberCount} TennisMate {memberCount === 1 ? "member" : "members"}</p> : null}
      </div>

      {error ? <div className="mt-5 rounded-2xl bg-red-50 px-4 py-3 text-sm font-semibold text-red-700" role="alert">{error}</div> : null}
      {loading ? (
        <div className="mt-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-3">{Array.from({ length: 6 }).map((_, index) => <div key={index} className="h-40 animate-pulse rounded-2xl bg-emerald-950/[0.07]" />)}</div>
      ) : !club ? (
        <div className="mt-6 rounded-3xl border border-emerald-950/10 bg-white p-8 text-center font-black text-emerald-950">Club not found</div>
      ) : members.length === 0 ? (
        <div className="mt-6 rounded-3xl border border-dashed border-emerald-950/20 bg-white px-5 py-10 text-center"><p className="text-sm font-extrabold text-emerald-950">No TennisMate members have selected this club yet.</p><p className="mt-2 text-sm font-semibold text-emerald-950/55">Be the first member.</p></div>
      ) : (
        <>
          <div className="mt-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-3">{members.map((member) => <ClubMemberCard key={member.id} member={member} />)}</div>
          {cursor ? <div className="mt-7 flex justify-center"><button type="button" onClick={() => void loadMore()} disabled={loadingMore} className="rounded-2xl bg-emerald-950 px-5 py-3 text-sm font-extrabold text-white disabled:opacity-50">{loadingMore ? "Loading..." : "Load more members"}</button></div> : null}
        </>
      )}
    </div>
  );

  if (!isDesktop) return <div className="min-h-screen bg-[#F7FAF8] px-4 py-5 pb-24">{content}</div>;
  return <div className="min-h-screen bg-[#F7FAF8] px-8 py-7 2xl:px-12"><div className="grid grid-cols-[280px_minmax(0,1fr)] items-start gap-8"><aside className="sticky top-6"><TMDesktopSidebar /></aside><main className="min-w-0 max-w-6xl">{content}</main></div></div>;
}
