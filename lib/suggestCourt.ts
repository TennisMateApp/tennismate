// lib/suggestCourt.ts
import { db } from "./firebaseConfig";
import { collection, getDocs } from "firebase/firestore";

type Court = {
  id: string;
  name: string;
  address?: string | null;
  suburb?: string | null;
  postcode?: string | null;
  lat: number;
  lng: number;
  bookingUrl?: string | null;
};

type SuggestOpts = {
  maxResults?: number;       // default 1
  searchRadiusKm?: number;   // optional soft filter
};

type LatLng = { lat: number; lng: number };

const COURTS_CACHE_KEY = "tm_courts_v1";
const COURTS_CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

async function loadCourtsCached(): Promise<Court[]> {
  // 1) session cache
  if (typeof window !== "undefined") {
    const cachedRaw = sessionStorage.getItem(COURTS_CACHE_KEY);
    if (cachedRaw) {
      try {
        const cached = JSON.parse(cachedRaw);
        if (
          cached &&
          typeof cached.ts === "number" &&
          Array.isArray(cached.courts) &&
          Date.now() - cached.ts < COURTS_CACHE_TTL_MS
        ) {
          return cached.courts as Court[];
        }
      } catch {
        // ignore cache parse errors
      }
    }
  }

  // 2) fetch once
  const courtsSnap = await getDocs(collection(db, "courts"));
  const courts = courtsSnap.docs.map((d) => ({
    id: d.id,
    ...(d.data() as any),
  })) as Court[];

  // 3) store
  if (typeof window !== "undefined") {
    sessionStorage.setItem(
      COURTS_CACHE_KEY,
      JSON.stringify({ ts: Date.now(), courts })
    );
  }

  return courts;
}

function toRad(x: number) {
  return (x * Math.PI) / 180;
}

function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number) {
  const R = 6371;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

export async function suggestCourt(
  p1: LatLng,
  p2: LatLng,
  opts: SuggestOpts = {}
): Promise<{
  midpoint: LatLng;
  results: Array<Court & { distanceKm: number }>;
}> {
  const { maxResults = 1, searchRadiusKm } = opts;

  const midLat = (p1.lat + p2.lat) / 2;
  const midLng = (p1.lng + p2.lng) / 2;

  const courts = await loadCourtsCached();

  const scored = courts
    .map((c) => ({
      ...c,
      distanceKm: haversineKm(midLat, midLng, c.lat, c.lng),
    }))
    .filter((c) =>
      typeof searchRadiusKm === "number" ? c.distanceKm <= searchRadiusKm : true
    )
    .sort((a, b) => a.distanceKm - b.distanceKm)
    .slice(0, Math.max(1, maxResults));

  return {
    midpoint: { lat: midLat, lng: midLng },
    results: scored,
  };
}
