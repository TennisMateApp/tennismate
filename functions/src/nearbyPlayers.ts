import * as admin from "firebase-admin";
import { HttpsError } from "firebase-functions/v2/https";
import { geohashQueryBounds } from "geofire-common";

const db = admin.firestore();

type NearbyPlayersRequest = {
  radiusKm?: number;
  activeWithinHours?: number | null;
  limit?: number;
};

type NearbyPlayerResult = {
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
  lastActiveAt?: number;
  profileComplete?: boolean;
  isMatchable?: boolean;
  distanceKm: number;
};

const DEFAULT_RADIUS_KM = 50;
const DEFAULT_LIMIT = 100;
const MAX_LIMIT = 200;
const QUERY_LIMIT_MULTIPLIER = 5;
const MAX_QUERY_LIMIT_PER_BOUND = 400;

function toFiniteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function toTimestampMillis(value: unknown): number | undefined {
  if (!value) return undefined;
  if (value instanceof admin.firestore.Timestamp) return value.toMillis();

  const maybeDate =
    value instanceof Date
      ? value
      : typeof (value as { toDate?: () => Date }).toDate === "function"
      ? (value as { toDate: () => Date }).toDate()
      : null;

  if (maybeDate && !Number.isNaN(maybeDate.getTime())) {
    return maybeDate.getTime();
  }

  return undefined;
}

function clampRadiusKm(value: unknown): number {
  const n = toFiniteNumber(value);
  if (n == null) return DEFAULT_RADIUS_KM;
  return Math.max(1, Math.min(200, n));
}

function clampLimit(value: unknown): number {
  const n = toFiniteNumber(value);
  if (n == null) return DEFAULT_LIMIT;
  return Math.max(1, Math.min(MAX_LIMIT, Math.floor(n)));
}

function normalizeActiveWithinHours(value: unknown): number | null {
  if (value == null) return null;
  const n = toFiniteNumber(value);
  if (n == null) return null;
  return Math.max(1, Math.min(24 * 30, n));
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

  return Math.round(6371 * 2 * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x)));
}

export async function fetchNearbyPlayersForUser(
  uid: string,
  requestData: NearbyPlayersRequest
): Promise<{ players: NearbyPlayerResult[] }> {
  const radiusKm = clampRadiusKm(requestData.radiusKm);
  const activeWithinHours = normalizeActiveWithinHours(requestData.activeWithinHours);
  const limit = clampLimit(requestData.limit);
  const perBoundLimit = Math.min(
    MAX_QUERY_LIMIT_PER_BOUND,
    Math.max(limit * QUERY_LIMIT_MULTIPLIER, limit)
  );

  const callerPrivateSnap = await db.collection("players_private").doc(uid).get();
  if (!callerPrivateSnap.exists) {
    throw new HttpsError("failed-precondition", "Private profile not found.");
  }

  const callerPrivate = callerPrivateSnap.data() || {};
  const callerLat = toFiniteNumber(callerPrivate.lat);
  const callerLng = toFiniteNumber(callerPrivate.lng);

  if (callerLat == null || callerLng == null) {
    throw new HttpsError("failed-precondition", "Location is missing from private profile.");
  }

  const bounds = geohashQueryBounds([callerLat, callerLng], radiusKm * 1000);
  const candidatePrivateByUid = new Map<string, FirebaseFirestore.DocumentData>();

  await Promise.all(
    bounds.map(async ([start, end]) => {
      const snap = await db
        .collection("players_private")
        .orderBy("geohash")
        .startAt(start)
        .endAt(end)
        .limit(perBoundLimit)
        .get();

      snap.forEach((docSnap) => {
        if (docSnap.id === uid) return;
        if (!candidatePrivateByUid.has(docSnap.id)) {
          candidatePrivateByUid.set(docSnap.id, docSnap.data());
        }
      });
    })
  );

  const candidateIds = Array.from(candidatePrivateByUid.keys());
  if (candidateIds.length === 0) {
    return {players: []};
  }

  const publicRefs = candidateIds.map((candidateUid) => db.collection("players").doc(candidateUid));
  const publicSnaps = await db.getAll(...publicRefs);
  const nowMs = Date.now();

  const players: NearbyPlayerResult[] = [];

  for (const publicSnap of publicSnaps) {
    if (!publicSnap.exists) continue;

    const publicData = publicSnap.data() || {};
    const privateData = candidatePrivateByUid.get(publicSnap.id) || {};

    const lat = toFiniteNumber(privateData.lat);
    const lng = toFiniteNumber(privateData.lng);
    const geohash = typeof privateData.geohash === "string" ? privateData.geohash : null;
    if (lat == null || lng == null || !geohash) continue;

    if (publicData.profileComplete !== true) continue;
    if (publicData.isMatchable === false) continue;

    const lastActiveAt = toTimestampMillis(publicData.lastActiveAt);
    if (activeWithinHours != null) {
      if (lastActiveAt == null) continue;
      if (nowMs - lastActiveAt > activeWithinHours * 60 * 60 * 1000) continue;
    }

    const distanceKm = calculateDistanceKm(
      {lat: callerLat, lng: callerLng},
      {lat, lng}
    );
    if (distanceKm > radiusKm) continue;

    const skillRating =
      toFiniteNumber(publicData.skillRating) ?? toFiniteNumber(publicData.utr) ?? undefined;

    players.push({
      uid: publicSnap.id,
      name: typeof publicData.name === "string" ? publicData.name : undefined,
      photoURL: typeof publicData.photoURL === "string" ? publicData.photoURL : undefined,
      photoThumbURL:
        typeof publicData.photoThumbURL === "string" ? publicData.photoThumbURL : undefined,
      skillLevel: typeof publicData.skillLevel === "string" ? publicData.skillLevel : undefined,
      skillBand: typeof publicData.skillBand === "string" ? publicData.skillBand : undefined,
      skillRating,
      skillBandLabel:
        typeof publicData.skillBandLabel === "string" ? publicData.skillBandLabel : undefined,
      bio: typeof publicData.bio === "string" ? publicData.bio : undefined,
      availability: publicData.availability,
      postcode: typeof publicData.postcode === "string" ? publicData.postcode : undefined,
      lastActiveAt,
      profileComplete: publicData.profileComplete === true,
      isMatchable: publicData.isMatchable !== false,
      distanceKm,
    });
  }

  players.sort((a, b) => a.distanceKm - b.distanceKm);

  return {players: players.slice(0, limit)};
}
