"use client";

import { useEffect, useMemo, useState } from "react";
import {
  collection,
  getDocs,
  query,
  orderBy,
  DocumentData,
  doc,
  getDoc,
  setDoc,
  increment,
  serverTimestamp,
  limit,
  startAfter,
  QueryDocumentSnapshot,
} from "firebase/firestore";
import { auth, db } from "@/lib/firebaseConfig";
import { onAuthStateChanged } from "firebase/auth";
import withAuth from "@/components/withAuth";
import { GiTennisCourt } from "react-icons/gi";
import { MapPin, Search, ExternalLink } from "lucide-react";

type LatLng = { lat: number; lng: number };

type Court = {
  id: string;
  name: string;
  suburb?: string;
  postcode?: string;
  address?: string;
  surface?: string;
  lights?: boolean;
  indoor?: boolean;
  lat?: number;
  lng?: number;
  mapsUrl?: string;
  bookingUrl?: string | null;
  distanceKm?: number | null;
};

// 🔹 Track when a user clicks Map / Book for a court
async function logCourtClick(
  courtId: string,
  type: "map" | "booking" = "map"
) {
  const user = auth.currentUser;
  if (!user || !courtId) return;

  const ref = doc(db, "court_clicks", `${user.uid}_${courtId}`);

  await setDoc(
    ref,
    {
      userId: user.uid,
      courtId,
      updatedAt: serverTimestamp(),
      totalClicks: increment(1),
      ...(type === "map"
        ? { mapClicks: increment(1) }
        : { bookingClicks: increment(1) }),
    },
    { merge: true }
  );
}

const PAGE_SIZE = 20;

// 🔗 Normalise external URLs
const normalizeUrl = (u?: string | null): string | null => {
  if (!u) return null;
  const s = String(u).trim();
  if (!s) return null;
  const href = /^https?:\/\//i.test(s) ? s : `https://${s}`;
  try {
    return new URL(href).toString();
  } catch {
    return null;
  }
};

const toRad = (deg: number) => (deg * Math.PI) / 180;

// Haversine distance in km
const haversineKm = (a: LatLng, b: LatLng): number => {
  const R = 6371; // km
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);

  const sinDLat = Math.sin(dLat / 2);
  const sinDLng = Math.sin(dLng / 2);

  const h =
    sinDLat * sinDLat +
    Math.cos(lat1) * Math.cos(lat2) * sinDLng * sinDLng;

  const c = 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
  return R * c;
};

// 🔁 shared mapper so pagination + full search use the same logic
const mapCourtDoc = (d: QueryDocumentSnapshot<DocumentData>): Court => {
  const v = d.data() as DocumentData;

  const lat =
    typeof v.lat === "number"
      ? v.lat
      : v.lat != null
      ? Number(v.lat)
      : undefined;

  const lng =
    typeof v.lng === "number"
      ? v.lng
      : v.lng != null
      ? Number(v.lng)
      : undefined;

  const name = v.name ?? "Unnamed court";
  const address: string | undefined =
    typeof v.address === "string"
      ? v.address
      : typeof v.streetAddress === "string"
      ? v.streetAddress
      : undefined;

  // Use name + address for Maps query
  const q = address ? `${name}, ${address}` : name;
  const mapsUrl = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(
    q
  )}`;

  const rawBooking =
    v.bookingUrl ??
    v.bookingURL ??
    v.bookingLink ??
    v.booking_link ??
    v.website ??
    v.url ??
    null;
  const bookingUrl = normalizeUrl(rawBooking);

  return {
    id: d.id,
    name,
    suburb: v.suburb ?? v.city ?? undefined,
    postcode: v.postcode ?? v.post_code ?? undefined,
    address,
    surface: v.surface ?? v.courtSurface ?? undefined,
    lights: typeof v.lights === "boolean" ? v.lights : undefined,
    indoor: typeof v.indoor === "boolean" ? v.indoor : undefined,
    lat,
    lng,
    mapsUrl,
    bookingUrl,
    distanceKm: null,
  };
};

function CourtsPage() {
  const [courts, setCourts] = useState<Court[]>([]);
  const [allCourts, setAllCourts] = useState<Court[] | null>(null); // full list
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [searchLoading, setSearchLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState("");

  const [userCoords, setUserCoords] = useState<LatLng | null>(null);
  const [userPostcode, setUserPostcode] = useState<string | null>(null);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);

  const [lastDoc, setLastDoc] =
    useState<QueryDocumentSnapshot<DocumentData> | null>(null);
  const [hasMore, setHasMore] = useState(true);

  // 0 = no distance filter (show any distance)
  const [maxDistanceKm, setMaxDistanceKm] = useState<number>(0);

  // VIC/NSW state filter
  const [stateFilter, setStateFilter] = useState<"VIC" | "NSW">("VIC");

  const qStr = searchTerm.trim().toLowerCase();

  // 1️⃣ Load user postcode + coords and default stateFilter
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (currentUser) => {
      if (!currentUser) {
        setCurrentUserId(null);
        return;
      }

      setCurrentUserId(currentUser.uid);

      try {
        const playerRef = doc(db, "players", currentUser.uid);
        const playerSnap = await getDoc(playerRef);
        const pdata = playerSnap.data() as any | undefined;

        const pc = pdata?.postcode;
        if (!pc) return;

        const pcStr = String(pc).trim();
        setUserPostcode(pcStr);

        const firstDigit = pcStr.charAt(0);
        if (firstDigit === "2") {
          setStateFilter("NSW");
        } else if (firstDigit === "3") {
          setStateFilter("VIC");
        }

        // Lookup lat/lng from postcodes collection
        const pcRef = doc(db, "postcodes", String(pc));
        const pcSnap = await getDoc(pcRef);
        if (pcSnap.exists()) {
          const loc = pcSnap.data() as any;
          if (typeof loc.lat === "number" && typeof loc.lng === "number") {
            setUserCoords({ lat: loc.lat, lng: loc.lng });
          }
        }
      } catch (e) {
        console.error("Error loading user location:", e);
      }
    });

    return () => unsubscribe();
  }, []);

  // 2️⃣ Initial page of courts (first 20)
  useEffect(() => {
    const loadFirstPage = async () => {
      try {
        setLoading(true);
        setError(null);

        const baseQuery = query(
          collection(db, "courts"),
          orderBy("name"),
          limit(PAGE_SIZE)
        );

        const snap = await getDocs(baseQuery);
        const items = snap.docs.map(mapCourtDoc);

        setCourts(items);

        if (snap.docs.length < PAGE_SIZE) {
          setHasMore(false);
          setLastDoc(null);
        } else {
          setHasMore(true);
          setLastDoc(snap.docs[snap.docs.length - 1]);
        }
      } catch (err) {
        console.error("Error loading courts:", err);
        setError("Could not load courts. Please try again later.");
      } finally {
        setLoading(false);
      }
    };

    loadFirstPage();
  }, []);

  // 3️⃣ Load ALL courts once for global filtering (state + search)
  useEffect(() => {
    const loadAllCourts = async () => {
      if (allCourts !== null) return;
      try {
        setSearchLoading(true);
        const qy = query(collection(db, "courts"), orderBy("name"));
        const snap = await getDocs(qy);
        const items = snap.docs.map(mapCourtDoc);
        setAllCourts(items);
      } catch (e) {
        console.error("Error loading all courts:", e);
      } finally {
        setSearchLoading(false);
      }
    };

    loadAllCourts();
  }, [allCourts]);

  // 4️⃣ Load more paginated courts (used mainly for initial experience, but filters use allCourts once loaded)
  const loadMore = async () => {
    if (!hasMore || !lastDoc || loadingMore) return;

    try {
      setLoadingMore(true);
      const baseQuery = query(
        collection(db, "courts"),
        orderBy("name"),
        startAfter(lastDoc),
        limit(PAGE_SIZE)
      );
      const snap = await getDocs(baseQuery);
      const items = snap.docs.map(mapCourtDoc);

      setCourts((prev) => [...prev, ...items]);

      if (snap.docs.length < PAGE_SIZE) {
        setHasMore(false);
        setLastDoc(null);
      } else {
        setLastDoc(snap.docs[snap.docs.length - 1]);
      }
    } catch (err) {
      console.error("Error loading more courts:", err);
    } finally {
      setLoadingMore(false);
    }
  };

  // Helper: add distance
  const withDistances = (list: Court[], coords: LatLng | null): Court[] => {
    if (!coords) {
      return list.map((c) => ({ ...c, distanceKm: null }));
    }

    return list.map((c) => {
      if (
        typeof c.lat !== "number" ||
        typeof c.lng !== "number" ||
        Number.isNaN(c.lat) ||
        Number.isNaN(c.lng)
      ) {
        return { ...c, distanceKm: null };
      }

      return {
        ...c,
        distanceKm: haversineKm(coords, { lat: c.lat, lng: c.lng }),
      };
    });
  };

  const pagedWithDistance = useMemo(
    () => withDistances(courts, userCoords),
    [courts, userCoords]
  );

  const allWithDistance = useMemo(
    () => (allCourts ? withDistances(allCourts, userCoords) : null),
    [allCourts, userCoords]
  );

  // 5️⃣ Apply state filter + search + distance filter
  const filteredCourts = useMemo(() => {
    // Once allCourts is loaded, always use it as the source; otherwise fall back to paged list
    const source = allWithDistance ?? pagedWithDistance;

    // State filter (NSW: postcodes starting with 2, VIC: 3)
    let list = source.filter((c) => {
      const pc = (c.postcode || "").toString().trim();
      if (!pc) return false; // no postcode → can't place state
      const first = pc.charAt(0);
      if (stateFilter === "NSW") return first === "2";
      if (stateFilter === "VIC") return first === "3";
      return true;
    });

    // Text search
    if (qStr) {
      list = list.filter((c) => {
        const haystack = [
          c.name,
          c.suburb,
          c.postcode,
          c.address,
          c.surface,
        ]
          .filter(Boolean)
          .join(" ")
          .toLowerCase();
        return haystack.includes(qStr);
      });
    }

    // Distance filter (0 = any distance)
    if (userCoords && maxDistanceKm > 0) {
      list = list.filter(
        (c) => typeof c.distanceKm === "number" && c.distanceKm <= maxDistanceKm
      );
    }

    return list;
  }, [pagedWithDistance, allWithDistance, qStr, userCoords, maxDistanceKm, stateFilter]);

  return (
    <div className="min-h-screen bg-gray-50 text-gray-900">
      <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
        {/* Heading */}
        <div className="mb-3">
          <h1 className="text-2xl font-bold tracking-tight text-gray-900 flex items-center gap-2">
            <GiTennisCourt className="h-6 w-6 text-green-600" />
            Courts
          </h1>
          <p className="text-sm text-gray-600">
            All courts available in TennisMate
            {userPostcode ? ` (from your postcode ${userPostcode})` : ""}.
          </p>
        </div>

        {/* Search + State filter */}
        <div className="mb-3 rounded-xl border bg-white px-3 py-2.5 flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-3">
          <div className="relative flex-1">
            <input
              type="text"
              placeholder="Search by name, suburb, postcode, or surface…"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full pl-9 pr-3 py-2.5 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
            />
            <Search
              className="absolute left-2.5 top-2.5 h-4 w-4 text-gray-400"
              aria-hidden="true"
            />
          </div>

          {/* State filter */}
          <div className="flex items-center gap-2">
            <label
              className="text-xs font-medium text-gray-700"
              htmlFor="state-filter"
            >
              State
            </label>
            <select
              id="state-filter"
              value={stateFilter}
              onChange={(e) =>
                setStateFilter(e.target.value as "NSW" | "VIC")
              }
              className="rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-green-500"
            >
              <option value="VIC">VIC</option>
              <option value="NSW">NSW</option>
            </select>
          </div>

          <span className="hidden sm:inline text-xs text-gray-500 min-w-[80px] text-right">
            {filteredCourts.length} court
            {filteredCourts.length === 1 ? "" : "s"}
          </span>
        </div>

        {/* Distance slider */}
        {userCoords && (
          <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div className="text-xs text-gray-600">
              <span className="font-medium">Distance filter: </span>
              {maxDistanceKm === 0
                ? "Showing courts at any distance"
                : `Showing courts within ${maxDistanceKm} km`}
            </div>
            <div className="flex items-center gap-3 w-full sm:w-auto">
              <input
                type="range"
                min={0}
                max={50}
                step={5}
                value={maxDistanceKm}
                onChange={(e) => setMaxDistanceKm(Number(e.target.value))}
                className="w-full sm:w-64"
              />
              <span className="text-xs text-gray-500 whitespace-nowrap">
                {maxDistanceKm === 0 ? "Any" : `${maxDistanceKm} km`}
              </span>
            </div>
          </div>
        )}

        {searchLoading && !allCourts && (
          <p className="mb-2 text-xs text-gray-500">
            Loading courts…
          </p>
        )}

        {loading ? (
          <div className="mt-6 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {Array.from({ length: 6 }).map((_, i) => (
              <div
                key={i}
                className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm"
              >
                <div className="h-4 w-1/2 bg-gray-200 rounded animate-pulse mb-2" />
                <div className="h-3 w-2/3 bg-gray-200 rounded animate-pulse mb-1" />
                <div className="h-3 w-1/3 bg-gray-200 rounded animate-pulse mb-4" />
                <div className="h-7 w-20 bg-gray-200 rounded animate-pulse" />
              </div>
            ))}
          </div>
        ) : error ? (
          <div className="mt-6 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
            {error}
          </div>
        ) : filteredCourts.length === 0 ? (
          <div className="mt-8 rounded-xl border border-dashed border-gray-300 bg-white p-10 text-center">
            <p className="text-gray-800 font-medium">No courts found</p>
            <p className="text-gray-600 text-sm mt-1">
              Try a different search, or add more courts to the{" "}
              <code>courts</code> collection.
            </p>
          </div>
        ) : (
          <>
            {/* Courts grid */}
            <div className="mt-5 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {filteredCourts.map((court) => {
                const distanceKm =
                  typeof court.distanceKm === "number"
                    ? court.distanceKm
                    : null;

                const locationLabel =
                  court.suburb && court.postcode
                    ? `${court.suburb} ${court.postcode}`
                    : court.suburb || court.postcode || "Location unknown";

                return (
                  <article key={court.id} className="w-full">
                    {/* mini-header */}
                    <div className="flex items-center justify_between text-[11px] font-semibold tracking-wide text-green-800/80 uppercase px-1">
                      <div className="flex items-center gap-1.5 min-w-0">
                        <MapPin className="h-3.5 w-3.5" />
                        <span className="truncate">{locationLabel}</span>
                      </div>
                      {distanceKm != null && (
                        <span className="ml-2 whitespace-nowrap">
                          ~{distanceKm.toFixed(1)} km
                        </span>
                      )}
                    </div>

                    {/* card */}
                    <div className="mt-1 rounded-xl bg-green-50 ring-1 ring-green-200/80 shadow-sm px-3 py-2.5">
                      <div className="flex items-start gap-3">
                        <div className="min-w-0 flex-1">
                          <div className="font-semibold text-green-900 truncate">
                            {court.name}
                          </div>

                          {court.address && (
                            <div className="text-xs text-green-900/80 line-clamp-2">
                              {court.address}
                            </div>
                          )}

                          <div className="mt-2 flex flex-wrap gap-1.5 text-[11px] text-green-900/90">
                            {court.surface && (
                              <span className="rounded-full bg-white/70 px-2 py-0.5">
                                Surface: {court.surface}
                              </span>
                            )}
                            {typeof court.lights === "boolean" && (
                              <span className="rounded-full bg-white/70 px-2 py-0.5">
                                {court.lights ? "Lights available" : "No lights"}
                              </span>
                            )}
                            {typeof court.indoor === "boolean" && (
                              <span className="rounded-full bg_white/70 px-2 py-0.5">
                                {court.indoor ? "Indoor" : "Outdoor"}
                              </span>
                            )}
                          </div>
                        </div>

                        <div className="flex flex-row items-center gap-1.5">
                          {court.mapsUrl && (
                            <a
                              href={court.mapsUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              onClick={() => logCourtClick(court.id, "map")}
                              className="inline-flex items-center gap-1 rounded-lg bg-white px-2.5 py-1.5 text-xs font-medium text-green-800 ring-1 ring-green-200 hover:bg-green-100"
                              title="Open in Google Maps"
                            >
                              Map
                            </a>
                          )}

                          {court.bookingUrl && (
                            <a
                              href={court.bookingUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              onClick={() => logCourtClick(court.id, "booking")}
                              className="inline-flex items-center gap-1 rounded-lg bg-green-600 px-2.5 py-1.5 text-xs font-semibold text-white hover:bg-green-700"
                              title="Open booking page"
                            >
                              Book <ExternalLink className="h-3.5 w-3.5" />
                            </a>
                          )}
                        </div>
                      </div>
                    </div>
                  </article>
                );
              })}
            </div>

            {/* Load more (still useful if you want paging for initial render, but not needed for filters once allCourts is loaded) */}
            {!qStr && hasMore && (
              <div className="mt-6 flex justify-center">
                <button
                  type="button"
                  onClick={loadMore}
                  disabled={loadingMore}
                  className="inline-flex items-center rounded-lg bg-white px-4 py-2 text-sm font-medium text-gray-800 ring-1 ring-gray-200 hover:bg-gray-50 disabled:opacity-60"
                >
                  {loadingMore ? "Loading…" : "Load more courts"}
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

export default withAuth(CourtsPage);
