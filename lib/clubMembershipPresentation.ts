import type { ClubStatus } from "@/lib/clubs";

export type ClubMembershipPresentation = {
  label: "Member of";
  clubName: string;
};

export function getClubMembershipPresentation(input: {
  clubId?: string | null;
  clubName?: string | null;
  clubStatus?: ClubStatus | null;
}): ClubMembershipPresentation | null {
  if (input.clubStatus !== "member") return null;
  if (typeof input.clubId !== "string" || !input.clubId.trim()) return null;
  if (typeof input.clubName !== "string" || !input.clubName.trim()) return null;

  return {
    label: "Member of",
    clubName: input.clubName.trim(),
  };
}
