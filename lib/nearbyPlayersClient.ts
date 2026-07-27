"use client";

import { httpsCallable } from "firebase/functions";
import { auth } from "@/lib/firebaseConfig";
import { getFunctionsClient } from "@/lib/getFunctionsClient";
import {
  ensureVerifiedAuthSession,
  type VerifiedAuthUser,
} from "@/lib/verifiedAuthSession";

export type NearbyPlayerResponseItem = {
  uid: string;
  name?: string;
  photoURL?: string;
  photoThumbURL?: string;
  skillLevel?: string;
  skillBand?: string;
  skillRating?: number;
  skillBandLabel?: string;
  bio?: string;
  availability?: unknown;
  postcode?: string;
  lastActiveAt?: unknown;
  profileComplete?: boolean;
  isMatchable?: boolean;
  clubId?: string;
  clubName?: string;
  clubStatus?: "member" | "none";
  distanceKm: number;
};

export type GetNearbyPlayersRequest = {
  radiusKm?: number;
  activeWithinHours?: number | null;
  limit?: number;
};

export type GetNearbyPlayersResponse = {
  players: NearbyPlayerResponseItem[];
};

export type NearbyPlayersErrorKind =
  | "unauthenticated"
  | "verified_email_required"
  | "profile_not_ready"
  | "permission_denied"
  | "request_failed";

export class NearbyPlayersLoadError extends Error {
  constructor(public readonly kind: NearbyPlayersErrorKind, options?: {cause?: unknown}) {
    super(kind, options);
    this.name = "NearbyPlayersLoadError";
  }
}

type CallableErrorLike = {code?: unknown; message?: unknown};

function callableErrorCode(error: unknown): string {
  return typeof (error as CallableErrorLike)?.code === "string"
    ? String((error as CallableErrorLike).code)
    : "";
}

function isStaleVerifiedEmailClaim(error: unknown): boolean {
  const code = callableErrorCode(error);
  const message = typeof (error as CallableErrorLike)?.message === "string"
    ? String((error as CallableErrorLike).message)
    : "";
  return code === "functions/permission-denied" &&
    message.includes("Verify your email before finding players.");
}

function classifyNearbyPlayersError(error: unknown): NearbyPlayersLoadError {
  if (error instanceof NearbyPlayersLoadError) return error;
  const code = callableErrorCode(error);
  if (code === "functions/unauthenticated") {
    return new NearbyPlayersLoadError("unauthenticated", {cause: error});
  }
  if (isStaleVerifiedEmailClaim(error)) {
    return new NearbyPlayersLoadError("verified_email_required", {cause: error});
  }
  if (code === "functions/failed-precondition") {
    return new NearbyPlayersLoadError("profile_not_ready", {cause: error});
  }
  if (code === "functions/permission-denied") {
    return new NearbyPlayersLoadError("permission_denied", {cause: error});
  }
  return new NearbyPlayersLoadError("request_failed", {cause: error});
}

export async function invokeNearbyPlayersWithVerifiedTokenRecovery(
  request: GetNearbyPlayersRequest,
  dependencies: {
    invoke: (value: GetNearbyPlayersRequest) => Promise<GetNearbyPlayersResponse>;
    currentUser: () => VerifiedAuthUser | null;
    refreshVerifiedSession?: typeof ensureVerifiedAuthSession;
  }
): Promise<GetNearbyPlayersResponse> {
  try {
    return await dependencies.invoke(request);
  } catch (error) {
    if (!isStaleVerifiedEmailClaim(error)) throw classifyNearbyPlayersError(error);

    const user = dependencies.currentUser();
    if (!user) throw new NearbyPlayersLoadError("unauthenticated", {cause: error});

    const refreshed = await (dependencies.refreshVerifiedSession ?? ensureVerifiedAuthSession)(
      user,
      {force: true}
    ).catch((refreshError) => {
      throw new NearbyPlayersLoadError("request_failed", {cause: refreshError});
    });
    if (!refreshed.verified || !refreshed.tokenReady) {
      throw new NearbyPlayersLoadError("verified_email_required", {cause: error});
    }

    try {
      return await dependencies.invoke(request);
    } catch (retryError) {
      throw classifyNearbyPlayersError(retryError);
    }
  }
}

export async function getNearbyPlayers(
  request: GetNearbyPlayersRequest
): Promise<GetNearbyPlayersResponse> {
  const fn = httpsCallable<GetNearbyPlayersRequest, GetNearbyPlayersResponse>(
    getFunctionsClient(),
    "getNearbyPlayers"
  );
  return invokeNearbyPlayersWithVerifiedTokenRecovery(request, {
    invoke: async (value) => (await fn(value)).data,
    currentUser: () => auth.currentUser,
  });
}
