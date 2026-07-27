import Image from "next/image";
import React, {useState} from "react";
import {ActivityLeaderboardRow, rowTone, tiedRanks} from "@/lib/activityLeaderboardModel";

const toneClasses: Record<string, string> = {
  gold: "border-amber-300 bg-amber-50/80",
  silver: "border-slate-300 bg-slate-50",
  bronze: "border-orange-300 bg-orange-50/70",
  "current-user": "border-emerald-500 bg-emerald-50 ring-2 ring-emerald-200",
  standard: "border-black/10 bg-white",
};

export function shouldShowLeaderboardAvatar(
  avatarUrl: string | null | undefined,
  failedUrl: string | null,
): boolean {
  return typeof avatarUrl === "string" && avatarUrl.trim().length > 0 && avatarUrl !== failedUrl;
}

export function LeaderboardAvatar({
  avatarUrl,
  displayName,
}: {
  avatarUrl: string | null;
  displayName: string;
}) {
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  const initial = displayName.charAt(0).toUpperCase();
  const showImage = shouldShowLeaderboardAvatar(avatarUrl, failedUrl);

  return (
    <div className="relative h-11 w-11 shrink-0 overflow-hidden rounded-full border border-black/10 bg-emerald-100">
      {showImage ? (
        <Image
          src={avatarUrl as string}
          alt=""
          fill
          sizes="44px"
          className="object-cover"
          onError={() => setFailedUrl(avatarUrl)}
        />
      ) : (
        <div className="grid h-full w-full place-items-center text-sm font-black text-emerald-900" aria-hidden="true">
          {initial}
        </div>
      )}
    </div>
  );
}

export function LeaderboardRow({
  currentUserId,
  isTied,
  row,
}: {
  currentUserId: string | null;
  isTied: boolean;
  row: ActivityLeaderboardRow;
}) {
  const tone = rowTone(row, currentUserId);
  const isCurrentUser = row.playerId === currentUserId;
  return (
    <li
      data-current-user={row.playerId === currentUserId ? "true" : "false"}
      data-rank={row.rank}
      data-tied={isTied ? "true" : "false"}
      data-tone={tone}
      className={`grid min-w-0 grid-cols-[42px_1fr_auto] items-center gap-3 rounded-2xl border px-3 py-3 sm:grid-cols-[52px_1fr_auto] sm:px-4 ${toneClasses[tone]} ${isCurrentUser && tone !== "current-user" ? "ring-2 ring-emerald-500 ring-offset-1" : ""}`}
    >
      <div className="text-center">
        <div className="text-lg font-black tabular-nums text-slate-900">{row.rank}</div>
        {isTied && <div className="text-[9px] font-bold uppercase tracking-wide text-slate-500">Tied</div>}
      </div>
      <div className="flex min-w-0 items-center gap-3">
        <LeaderboardAvatar avatarUrl={row.avatarUrl} displayName={row.displayName} />
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="truncate text-sm font-extrabold text-slate-900 sm:text-base">{row.displayName}</span>
            {row.playerId === currentUserId && (
              <span className="shrink-0 rounded-full bg-emerald-900 px-2 py-0.5 text-[9px] font-black uppercase tracking-wide text-white">You</span>
            )}
          </div>
          <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] font-semibold text-slate-500 sm:text-xs">
            <span>{row.eligibleActivityCount} {row.eligibleActivityCount === 1 ? "activity" : "activities"}</span>
            <span>{row.distinctOpponentCount} {row.distinctOpponentCount === 1 ? "opponent" : "opponents"}</span>
          </div>
        </div>
      </div>
      <div className="pl-1 text-right">
        <div className="text-xl font-black tabular-nums text-emerald-900">{row.points}</div>
        <div className="text-[9px] font-bold uppercase tracking-widest text-slate-500">points</div>
      </div>
    </li>
  );
}

export default function LeaderboardRows({
  currentUserId,
  rows,
}: {
  currentUserId: string | null;
  rows: ActivityLeaderboardRow[];
}) {
  const ties = tiedRanks(rows);
  return (
    <ol className="space-y-2" aria-label="Activity leaderboard rankings">
      {rows.map((row) => (
        <LeaderboardRow
          key={row.playerId}
          currentUserId={currentUserId}
          isTied={ties.has(row.rank)}
          row={row}
        />
      ))}
    </ol>
  );
}
