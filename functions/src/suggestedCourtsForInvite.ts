import * as admin from "firebase-admin";
import { HttpsError } from "firebase-functions/v2/https";

const db = admin.firestore();

export type GetSuggestedCourtsForInviteRequest = {
  conversationId?: string;
  maxResults?: number;
  searchRadiusKm?: number;
};

export type SuggestedCourtResult = {
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

function toFiniteNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function clampMaxResults(value: unknown): number {
  const n = toFiniteNumber(value);
  if (n == null) return 3;
  return Math.max(1, Math.min(10, Math.floor(n)));
}

function normalizeSearchRadiusKm(value: unknown): number | null {
  const n = toFiniteNumber(value);
  if (n == null) return null;
  return Math.max(1, Math.min(100, n));
}

function calculateDistanceKm(
  a: { lat: number; lng: number },
  b: { lat: number; lng: number }
): number {
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const lat1 = (a.lat * Math.PI) / 180;
  const lat2 = (b.lat * Math.PI) / 180;

  const x =
    Math.sin(dLat / 2) ** 2 +
    Math.sin(dLng / 2) ** 2 * Math.cos(lat1) * Math.cos(lat2);

  return 6371 * 2 * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x));
}

export async function fetchSuggestedCourtsForInvite(
  uid: string,
  requestData: GetSuggestedCourtsForInviteRequest
): Promise<{ courts: SuggestedCourtResult[] }> {
  const conversationId =
    typeof requestData.conversationId === "string" ? requestData.conversationId.trim() : "";
  if (!conversationId) {
    throw new HttpsError("invalid-argument", "conversationId is required.");
  }

  const maxResults = clampMaxResults(requestData.maxResults);
  const searchRadiusKm = normalizeSearchRadiusKm(requestData.searchRadiusKm);

  const conversationSnap = await db.collection("conversations").doc(conversationId).get();
  if (!conversationSnap.exists) {
    throw new HttpsError("not-found", "Conversation not found.");
  }

  const conversation = conversationSnap.data() || {};
  const participants = Array.isArray(conversation.participants)
    ? Array.from(
        new Set(
          conversation.participants
            .filter((value): value is string => typeof value === "string" && value.trim() !== "")
            .map((value) => value.trim())
        )
      )
    : [];

  if (!participants.includes(uid)) {
    throw new HttpsError("permission-denied", "You are not a participant in this conversation.");
  }

  if (participants.length !== 2) {
    throw new HttpsError(
      "failed-precondition",
      "Court suggestions are only available for 1:1 conversations."
    );
  }

  const privateRefs = participants.map((participantUid) =>
    db.collection("players_private").doc(participantUid)
  );
  const [firstPrivateSnap, secondPrivateSnap] = await db.getAll(...privateRefs);

  const firstPrivate = firstPrivateSnap.exists ? firstPrivateSnap.data() || {} : null;
  const secondPrivate = secondPrivateSnap.exists ? secondPrivateSnap.data() || {} : null;

  const firstLat = toFiniteNumber(firstPrivate?.lat);
  const firstLng = toFiniteNumber(firstPrivate?.lng);
  const secondLat = toFiniteNumber(secondPrivate?.lat);
  const secondLng = toFiniteNumber(secondPrivate?.lng);

  if (firstLat == null || firstLng == null || secondLat == null || secondLng == null) {
    throw new HttpsError("failed-precondition", "Missing player location.");
  }

  const midpoint = {
    lat: (firstLat + secondLat) / 2,
    lng: (firstLng + secondLng) / 2,
  };

  const courtsSnap = await db.collection("courts").get();
  const courts: SuggestedCourtResult[] = [];

  courtsSnap.forEach((docSnap) => {
    const data = docSnap.data() || {};
    const lat =
      toFiniteNumber(data.lat) ?? toFiniteNumber((data.location as { lat?: unknown } | undefined)?.lat);
    const lng =
      toFiniteNumber(data.lng) ?? toFiniteNumber((data.location as { lng?: unknown } | undefined)?.lng);

    if (lat == null || lng == null) return;

    const distanceKm = calculateDistanceKm(midpoint, { lat, lng });
    if (searchRadiusKm != null && distanceKm > searchRadiusKm) return;

    courts.push({
      id: docSnap.id,
      name: typeof data.name === "string" ? data.name : undefined,
      address: typeof data.address === "string" ? data.address : null,
      suburb: typeof data.suburb === "string" ? data.suburb : null,
      state: typeof data.state === "string" ? data.state : null,
      postcode: typeof data.postcode === "string" ? data.postcode : null,
      bookingUrl: typeof data.bookingUrl === "string" ? data.bookingUrl : null,
      lat,
      lng,
      distanceKm: Math.round(distanceKm * 10) / 10,
    });
  });

  courts.sort((a, b) => a.distanceKm - b.distanceKm);

  return { courts: courts.slice(0, maxResults) };
}
