"use client";

import {useCallback, useEffect, useMemo, useState} from "react";

import {
  clubMembershipPromptDismissalKey,
  getClubMembershipPromptVisibility,
} from "@/lib/clubMembershipPrompt";
import type {ClubStatus} from "@/lib/clubs";

export type ClubMembershipPromptVisibilityController = {
  ready: boolean;
  visible: boolean;
  blocksWelcome: boolean;
  dismiss: () => void;
  resolve: () => void;
};

export function useClubMembershipPromptVisibility(
  uid: string | null | undefined,
  clubStatus: ClubStatus | null | undefined,
): ClubMembershipPromptVisibilityController {
  const [storageReadyForUid, setStorageReadyForUid] = useState<string | null>(null);
  const [storedDismissal, setStoredDismissal] = useState<string | null>(null);
  const [resolvedForUid, setResolvedForUid] = useState<string | null>(null);

  useEffect(() => {
    setStorageReadyForUid(null);
    setStoredDismissal(null);
    setResolvedForUid(null);
    if (!uid) return;

    const key = clubMembershipPromptDismissalKey(uid);
    const readStoredDismissal = () => {
      try {
        setStoredDismissal(window.localStorage.getItem(key));
      } catch {
        setStoredDismissal(null);
      } finally {
        setStorageReadyForUid(uid);
      }
    };

    readStoredDismissal();
    const onStorage = (event: StorageEvent) => {
      if (event.key === key) readStoredDismissal();
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, [uid]);

  const state = useMemo(() => getClubMembershipPromptVisibility({
    uid,
    clubStatus,
    storageReady: Boolean(uid && storageReadyForUid === uid),
    storedDismissal,
    resolvedInSession: Boolean(uid && resolvedForUid === uid),
  }), [clubStatus, resolvedForUid, storageReadyForUid, storedDismissal, uid]);

  const dismiss = useCallback(() => {
    if (!uid) return;
    const dismissedAt = String(Date.now());
    try {
      window.localStorage.setItem(clubMembershipPromptDismissalKey(uid), dismissedAt);
    } catch {
      // The session state still resolves the prompt when storage is restricted.
    }
    setStoredDismissal(dismissedAt);
    setResolvedForUid(uid);
  }, [uid]);

  const resolve = useCallback(() => {
    if (uid) setResolvedForUid(uid);
  }, [uid]);

  return {...state, dismiss, resolve};
}
