export type ClubFilter =
  | { mode: "any"; clubId: null; clubName: null }
  | { mode: "my"; clubId: null; clubName: null }
  | { mode: "selected"; clubId: string; clubName: string };

export type ClubMembershipLike = {
  clubStatus?: unknown;
  clubId?: unknown;
  clubName?: unknown;
};

export const ANY_CLUB_FILTER: ClubFilter = {
  mode: "any",
  clubId: null,
  clubName: null,
};

export function getCompleteClubMembership(value: ClubMembershipLike | null | undefined) {
  if (value?.clubStatus !== "member") return null;
  const clubId = typeof value.clubId === "string" ? value.clubId.trim() : "";
  const clubName = typeof value.clubName === "string" ? value.clubName.trim() : "";
  return clubId && clubName ? { clubId, clubName } : null;
}

export function isMyClubFilterAvailable(currentPlayer: ClubMembershipLike | null | undefined) {
  return getCompleteClubMembership(currentPlayer) !== null;
}

export function filterCandidatesByClub<T extends ClubMembershipLike>(
  candidates: T[],
  currentPlayer: ClubMembershipLike | null | undefined,
  filter: ClubFilter
): T[] {
  if (filter.mode === "any") return candidates;

  const targetClubId = filter.mode === "my"
    ? getCompleteClubMembership(currentPlayer)?.clubId
    : filter.clubId.trim();
  if (!targetClubId) return [];

  return candidates.filter((candidate) => {
    const membership = getCompleteClubMembership(candidate);
    return membership?.clubId === targetClubId;
  });
}

export function clubFilterUrlValue(filter: ClubFilter) {
  if (filter.mode === "my") return { club: "my", clubId: null };
  if (filter.mode === "selected") return { club: null, clubId: filter.clubId };
  return { club: null, clubId: null };
}

export function selectedClubFilter(club: { id: string; canonicalName: string }): ClubFilter {
  return {
    mode: "selected",
    clubId: club.id,
    clubName: club.canonicalName.trim(),
  };
}

export function resolveClubFilterFromUrl(
  query: { club?: string | null; clubId?: string | null },
  clubs: Array<{ id: string; canonicalName: string }>
): ClubFilter {
  if (query.club === "my") return { mode: "my", clubId: null, clubName: null };
  if (!query.clubId) return ANY_CLUB_FILTER;
  const club = clubs.find((item) => item.id === query.clubId);
  return club ? selectedClubFilter(club) : ANY_CLUB_FILTER;
}

export function clubFilterEmptyState(filter: ClubFilter) {
  if (filter.mode === "my") {
    return {
      title: "No other TennisMate players from your club match these filters yet.",
      body: "Try adjusting your filters or invite another club member to join TennisMate.",
    };
  }
  if (filter.mode === "selected") {
    return {
      title: `No players from ${filter.clubName} match these filters yet.`,
      body: "Try adjusting your filters.",
    };
  }
  return null;
}

export function clubProfileHref(value: ClubMembershipLike) {
  const membership = getCompleteClubMembership(value);
  return membership ? `/clubs/${encodeURIComponent(membership.clubId)}` : null;
}

export function stopClubLinkPropagation(event: { stopPropagation: () => void }) {
  event.stopPropagation();
}
