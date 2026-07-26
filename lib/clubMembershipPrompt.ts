import type { ClubStatus } from "@/lib/clubs";

export const CLUB_MEMBERSHIP_PROMPT_DISMISSAL_MS = 30 * 24 * 60 * 60 * 1000;

export function clubMembershipPromptDismissalKey(uid: string) {
  return `tennismate:club-membership-prompt-dismissed-at:${uid}`;
}

export function isClubMembershipPromptDismissalActive(
  storedValue: string | null,
  now = Date.now()
) {
  if (!storedValue) return false;

  const dismissedAt = Number(storedValue);
  if (!Number.isFinite(dismissedAt) || dismissedAt <= 0 || dismissedAt > now) return false;

  return now - dismissedAt < CLUB_MEMBERSHIP_PROMPT_DISMISSAL_MS;
}

export function shouldShowClubMembershipPrompt(input: {
  clubStatus: ClubStatus | null | undefined;
  storedDismissal: string | null;
  now?: number;
}) {
  if (input.clubStatus === "member" || input.clubStatus === "none") return false;
  return !isClubMembershipPromptDismissalActive(input.storedDismissal, input.now);
}

export function getClubMembershipPromptVisibility(input: {
  uid: string | null | undefined;
  clubStatus: ClubStatus | null | undefined;
  storageReady: boolean;
  storedDismissal: string | null;
  resolvedInSession?: boolean;
  now?: number;
}) {
  if (!input.uid) {
    return {ready: false, visible: false, blocksWelcome: false};
  }

  if (input.clubStatus === "member" || input.clubStatus === "none") {
    return {ready: true, visible: false, blocksWelcome: false};
  }

  if (!input.storageReady) {
    return {ready: false, visible: false, blocksWelcome: true};
  }

  const visible = !input.resolvedInSession && shouldShowClubMembershipPrompt({
    clubStatus: input.clubStatus,
    storedDismissal: input.storedDismissal,
    now: input.now,
  });

  return {ready: true, visible, blocksWelcome: visible};
}
