// ✅ UPDATE YOUR EXISTING: app/courts/page.tsx (or wherever CourtsPage lives)
// - Add the import
// - Add desktop detection
// - Render DesktopCourtsDirectory when desktop

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
import { useRouter } from "next/navigation";
import { GiTennisCourt } from "react-icons/gi";
import { MapPin, Search, SlidersHorizontal, X, ArrowLeft } from "lucide-react";

// ✅ NEW
import DesktopCourtsDirectory from "@/components/desktop_layout/DesktopCourtsDirectory";

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
async function logCourtClick(courtId: string, type: "map" | "booking" = "map") {
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
  const router = useRouter();

  // ✅ Desktop detection
  const [isDesktop, setIsDesktop] = useState(false);
  useEffect(() => {
    const check = () => setIsDesktop(window.innerWidth >= 1024);
    check();
    window.addEventListener("resize", check);
    return () => window.removeEventListener("resize", check);
  }, []);

  const [courts, setCourts] = useState<Court[]>([]);
  const [allCourts, setAllCourts] = useState<Court[] | null>(null);
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

  const [maxDistanceKm, setMaxDistanceKm] = useState<number>(0);
  const [stateFilter, setStateFilter] = useState<"VIC" | "NSW">("VIC");
  const [showFilters, setShowFilters] = useState(false);

  const qStr = searchTerm.trim().toLowerCase();

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
        if (firstDigit === "2") setStateFilter("NSW");
        else if (firstDigit === "3") setStateFilter("VIC");

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

  const withDistances = (list: Court[], coords: LatLng | null): Court[] => {
    if (!coords) return list.map((c) => ({ ...c, distanceKm: null }));

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
        distanceKm: haversineKm(coords, { lat: c.lat!, lng: c.lng! }),
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

  const filteredCourts = useMemo(() => {
    const source = allWithDistance ?? pagedWithDistance;

    let list = source.filter((c) => {
      const pc = (c.postcode || "").toString().trim();
      if (!pc) return false;
      const first = pc.charAt(0);
      if (stateFilter === "NSW") return first === "2";
      if (stateFilter === "VIC") return first === "3";
      return true;
    });

    if (qStr) {
      list = list.filter((c) => {
        const haystack = [c.name, c.suburb, c.postcode, c.address, c.surface]
          .filter(Boolean)
          .join(" ")
          .toLowerCase();
        return haystack.includes(qStr);
      });
    }

    if (userCoords && maxDistanceKm > 0) {
      list = list.filter(
        (c) => typeof c.distanceKm === "number" && c.distanceKm <= maxDistanceKm
      );
    }

    return list;
  }, [pagedWithDistance, allWithDistance, qStr, userCoords, maxDistanceKm, stateFilter]);

  const handleBack = () => {
    if (typeof window !== "undefined" && window.history.length > 1) {
      router.back();
    } else {
      router.push("/");
    }
  };

  // ✅ DESKTOP RENDER
  if (isDesktop) {
    return (
      <DesktopCourtsDirectory
        userPostcode={userPostcode}
        userCoords={userCoords}
        searchTerm={searchTerm}
        setSearchTerm={setSearchTerm}
        showFilters={showFilters}
        setShowFilters={setShowFilters}
        stateFilter={stateFilter}
        setStateFilter={setStateFilter}
        maxDistanceKm={maxDistanceKm}
        setMaxDistanceKm={setMaxDistanceKm}
        filteredCourts={filteredCourts}
        qStr={qStr}
        hasMore={hasMore}
        loadingMore={loadingMore}
        loadMore={loadMore}
        onCourtClick={(id, type) => logCourtClick(id, type)}
      />
    );
  }

// ✅ MOBILE
return (
  <div className="min-h-screen bg-[#F4F6F8] text-gray-900">
    <div className="mx-auto w-full max-w-[520px] px-4 pb-10 pt-4">
      {/* Top bar */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={handleBack}
            className="h-10 w-10 rounded-full bg-white ring-1 ring-gray-200 flex items-center justify-center hover:bg-gray-50"
            aria-label="Back"
            title="Back"
          >
            <ArrowLeft className="h-5 w-5 text-gray-700" />
          </button>

          <div className="flex items-center gap-2">
            <GiTennisCourt className="h-6 w-6 text-[#0B3D2E]" />
            <h1 className="text-2xl font-extrabold tracking-tight">Courts</h1>
          </div>
        </div>

        <button
          type="button"
          onClick={() => setShowFilters((v) => !v)}
          className="h-10 w-10 rounded-full bg-white ring-1 ring-gray-200 flex items-center justify-center hover:bg-gray-50"
          aria-label="Filters"
          title="Filters"
        >
          {showFilters ? (
            <X className="h-5 w-5 text-gray-700" />
          ) : (
            <SlidersHorizontal className="h-5 w-5 text-gray-700" />
          )}
        </button>
      </div>

      {/* Centered subtitle */}
      <div className="mt-2 text-center">
        <p className="text-sm text-gray-600">
          {userPostcode ? `Near ${userPostcode}` : "Find courts near you"}
        </p>
        <p className="text-xs text-gray-500 mt-0.5">
          {filteredCourts.length} result{filteredCourts.length === 1 ? "" : "s"}
        </p>
      </div>

      {/* Search */}
      <div className="mt-4">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
          <input
            type="text"
            placeholder="Search by name or suburb"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full rounded-2xl bg-white pl-9 pr-3 py-3 text-sm ring-1 ring-gray-200 focus:outline-none focus:ring-2 focus:ring-[#39FF14]"
          />
        </div>
      </div>

      {/* Filters panel (state + distance only) */}
      {showFilters && (
        <div className="mt-3 rounded-2xl bg-white ring-1 ring-gray-200 p-4">
          <div className="flex items-center justify-between">
            <div className="text-sm font-semibold text-gray-900">Filters</div>
            <button
              type="button"
              onClick={() => setShowFilters(false)}
              className="text-xs font-semibold text-gray-600 hover:text-gray-900"
            >
              Close
            </button>
          </div>

          <div className="mt-3 grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-semibold text-gray-700">
                State
              </label>
              <select
                value={stateFilter}
                onChange={(e) => setStateFilter(e.target.value as "NSW" | "VIC")}
                className="mt-1 w-full rounded-xl bg-white px-3 py-2 text-sm ring-1 ring-gray-200 focus:outline-none focus:ring-2 focus:ring-[#39FF14]"
              >
                <option value="VIC">VIC</option>
                <option value="NSW">NSW</option>
              </select>
            </div>

            <div>
              <label className="text-xs font-semibold text-gray-700">
                Distance
              </label>
              <div className="mt-1 rounded-xl bg-[#F4F6F8] px-3 py-2 text-sm ring-1 ring-gray-200">
                {userCoords ? (
                  <span className="font-semibold">
                    {maxDistanceKm === 0 ? "Any" : `${maxDistanceKm} km`}
                  </span>
                ) : (
                  <span className="text-gray-500">Set postcode</span>
                )}
              </div>
            </div>
          </div>

          {userCoords && (
            <div className="mt-3">
              <input
                type="range"
                min={0}
                max={50}
                step={5}
                value={maxDistanceKm}
                onChange={(e) => setMaxDistanceKm(Number(e.target.value))}
                className="w-full"
              />
              <div className="mt-1 text-[11px] text-gray-500">
                0 = any distance • 50 = within 50 km
              </div>
            </div>
          )}
        </div>
      )}

      {searchLoading && !allCourts && (
        <p className="mt-3 text-xs text-gray-500">Loading courts…</p>
      )}

      {/* ✅ LIST / STATES */}
      {loading ? (
        <div className="mt-5 space-y-4">
          {Array.from({ length: 5 }).map((_, i) => (
            <div
              key={i}
              className="rounded-3xl bg-white ring-1 ring-gray-200 p-4"
            >
              <div className="h-4 w-2/3 bg-gray-200 rounded animate-pulse mb-2" />
              <div className="h-3 w-1/2 bg-gray-200 rounded animate-pulse mb-4" />
              <div className="flex gap-2">
                <div className="h-10 w-28 bg-gray-200 rounded-xl animate-pulse" />
                <div className="h-10 w-28 bg-gray-200 rounded-xl animate-pulse" />
              </div>
            </div>
          ))}
        </div>
      ) : error ? (
        <div className="mt-6 rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          {error}
        </div>
      ) : filteredCourts.length === 0 ? (
        <div className="mt-6 rounded-3xl bg-white ring-1 ring-gray-200 p-8 text-center">
          <p className="text-gray-900 font-semibold">No courts found</p>
          <p className="text-gray-600 text-sm mt-1">Try a different search.</p>
        </div>
      ) : (
        <>
          {/* Court tiles */}
          <div className="mt-5 space-y-4">
            {filteredCourts.map((court) => {
              const distanceKm =
                typeof court.distanceKm === "number" ? court.distanceKm : null;

              const locationLabel =
                court.suburb && court.postcode
                  ? `${court.suburb}, ${court.postcode}`
                  : court.suburb || court.postcode || "Location unknown";

              return (
                <article
                  key={court.id}
                  className="rounded-3xl bg-white ring-1 ring-gray-200 p-4 shadow-sm"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="text-base font-extrabold text-gray-900 truncate">
                        {court.name}
                      </div>

                      <div className="mt-1 flex items-center gap-1 text-xs text-gray-600">
                        <MapPin className="h-3.5 w-3.5" />
                        <span className="truncate">{locationLabel}</span>
                      </div>

                      {court.address && (
                        <div className="mt-1 text-xs text-gray-500 line-clamp-2">
                          {court.address}
                        </div>
                      )}
                    </div>

                    {distanceKm != null && (
                      <div className="shrink-0 rounded-full bg-[#39FF14] px-3 py-1 text-[11px] font-extrabold text-[#0B3D2E]">
                        {distanceKm.toFixed(1)} KM
                      </div>
                    )}
                  </div>

                  <div className="mt-4 flex gap-2">
                    <a
                      href={court.bookingUrl || court.mapsUrl || "#"}
                      target="_blank"
                      rel="noopener noreferrer"
                      onClick={() =>
                        court.bookingUrl
                          ? logCourtClick(court.id, "booking")
                          : logCourtClick(court.id, "map")
                      }
                      className={[
                        "flex-1 rounded-xl px-4 py-3 text-sm font-extrabold text-center",
                        "bg-[#39FF14] text-[#0B3D2E] hover:brightness-95",
                        !(court.bookingUrl || court.mapsUrl)
                          ? "pointer-events-none opacity-60"
                          : "",
                      ].join(" ")}
                    >
                      Book Now
                    </a>

                    {court.mapsUrl && (
                      <a
                        href={court.mapsUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        onClick={() => logCourtClick(court.id, "map")}
                        className="flex-1 rounded-xl px-4 py-3 text-sm font-extrabold text-center bg-gray-100 text-gray-800 hover:bg-gray-200"
                        title="Open in Google Maps"
                      >
                        View on Map
                      </a>
                    )}
                  </div>

                  <div className="mt-3 flex flex-wrap gap-2 text-[11px]">
                    {court.surface && (
                      <span className="rounded-full bg-gray-100 px-2 py-1 font-semibold text-gray-700">
                        {court.surface}
                      </span>
                    )}
                    {typeof court.indoor === "boolean" && (
                      <span className="rounded-full bg-gray-100 px-2 py-1 font-semibold text-gray-700">
                        {court.indoor ? "Indoor" : "Outdoor"}
                      </span>
                    )}
                    {typeof court.lights === "boolean" && (
                      <span className="rounded-full bg-gray-100 px-2 py-1 font-semibold text-gray-700">
                        {court.lights ? "Lights" : "No lights"}
                      </span>
                    )}
                  </div>
                </article>
              );
            })}
          </div>

          {/* Load more (only when not searching) */}
          {!qStr && hasMore && (
            <div className="mt-6 flex justify-center">
              <button
                type="button"
                onClick={loadMore}
                disabled={loadingMore}
                className="rounded-2xl bg-white px-5 py-3 text-sm font-extrabold text-gray-900 ring-1 ring-gray-200 hover:bg-gray-50 disabled:opacity-60"
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
