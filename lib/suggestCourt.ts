// lib/suggestCourt.ts
import { db } from "./firebaseConfig"; // keep your path
import { getDoc, doc, collection, getDocs } from "firebase/firestore";

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

function toRad(x: number) { return (x * Math.PI) / 180; }
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
  player1Postcode: string,
  player2Postcode: string,
  opts: SuggestOpts = {}
): Promise<{
  midpoint: { lat: number; lng: number };
  results: Array<Court & { distanceKm: number }>;
}> {
  const { maxResults = 1, searchRadiusKm } = opts;

  const [snap1, snap2] = await Promise.all([
    getDoc(doc(db, "postcodes", player1Postcode)),
    getDoc(doc(db, "postcodes", player2Postcode)),
  ]);
  if (!snap1.exists() || !snap2.exists()) throw new Error("Invalid postcode");

  const coord1 = snap1.data() as { lat: number; lng: number };
  const coord2 = snap2.data() as { lat: number; lng: number };

  const midLat = (coord1.lat + coord2.lat) / 2;
  const midLng = (coord1.lng + coord2.lng) / 2;

  const courtsSnap = await getDocs(collection(db, "courts"));
  const courts = courtsSnap.docs.map((d) => ({ id: d.id, ...(d.data() as any) })) as Court[];

  const scored = courts
    .map((c) => ({
      ...c,
      distanceKm: haversineKm(midLat, midLng, c.lat, c.lng),
    }))
    .filter((c) => (typeof searchRadiusKm === "number" ? c.distanceKm <= searchRadiusKm : true))
    .sort((a, b) => a.distanceKm - b.distanceKm)
    .slice(0, Math.max(1, maxResults));

  return {
    midpoint: { lat: midLat, lng: midLng },
    results: scored,
  };
}
