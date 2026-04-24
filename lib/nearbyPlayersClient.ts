"use client";

import { httpsCallable } from "firebase/functions";
import { getFunctionsClient } from "@/lib/getFunctionsClient";

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

export async function getNearbyPlayers(
  request: GetNearbyPlayersRequest
): Promise<GetNearbyPlayersResponse> {
  const fn = httpsCallable<GetNearbyPlayersRequest, GetNearbyPlayersResponse>(
    getFunctionsClient(),
    "getNearbyPlayers"
  );
  const result = await fn(request);
  return result.data;
}
