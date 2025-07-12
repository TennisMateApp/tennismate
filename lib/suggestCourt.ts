import { db } from "./firebaseConfig";
import { getDoc, doc, collection, getDocs } from "firebase/firestore";

function haversineDistance(lat1: number, lng1: number, lat2: number, lng2: number) {
  const toRad = (x: number) => (x * Math.PI) / 180;
  const R = 6371; // Radius of Earth in km
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

export async function suggestCourt(player1Postcode: string, player2Postcode: string) {
  const [snap1, snap2] = await Promise.all([
    getDoc(doc(db, "postcodes", player1Postcode)),
    getDoc(doc(db, "postcodes", player2Postcode)),
  ]);

  if (!snap1.exists() || !snap2.exists()) throw new Error("Invalid postcode");

  const coord1 = snap1.data();
  const coord2 = snap2.data();

  const midLat = (coord1.lat + coord2.lat) / 2;
  const midLng = (coord1.lng + coord2.lng) / 2;

  const courtsSnap = await getDocs(collection(db, "courts"));
  const courts = courtsSnap.docs.map(doc => ({ id: doc.id, ...doc.data() })) as any[];

  let closestCourt = null;
  let minDistance = Infinity;

  for (const court of courts) {
    const dist = haversineDistance(midLat, midLng, court.lat, court.lng);
    if (dist < minDistance) {
      minDistance = dist;
      closestCourt = court;
    }
  }

  return closestCourt;
}
