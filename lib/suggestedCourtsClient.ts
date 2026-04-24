"use client";

import { httpsCallable } from "firebase/functions";
import { getFunctionsClient } from "@/lib/getFunctionsClient";

export type SuggestedCourtResponseItem = {
  id: string;
  name?: string;
  address?: string | null;
  suburb?: string | null;
  state?: string | null;
  postcode?: string | null;
  bookingUrl?: string | null;
  lat: number;
  lng: number;
  distanceKm: number;
};

export type GetSuggestedCourtsForInviteRequest = {
  conversationId: string;
  maxResults?: number;
  searchRadiusKm?: number;
};

export type GetSuggestedCourtsForInviteResponse = {
  courts: SuggestedCourtResponseItem[];
};

export async function getSuggestedCourtsForInvite(
  request: GetSuggestedCourtsForInviteRequest
): Promise<GetSuggestedCourtsForInviteResponse> {
  const fn = httpsCallable<
    GetSuggestedCourtsForInviteRequest,
    GetSuggestedCourtsForInviteResponse
  >(getFunctionsClient(), "getSuggestedCourtsForInvite");
  const result = await fn(request);
  return result.data;
}
