"use client";

export function shouldTrackRematchInviteAccepted(inviteId: string): boolean {
  if (typeof window === "undefined") return true;

  const key = `tm_rematch_invite_accepted_${inviteId}`;
  if (sessionStorage.getItem(key)) {
    return false;
  }

  sessionStorage.setItem(key, "1");
  return true;
}
