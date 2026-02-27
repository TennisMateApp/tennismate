// ✅ UPDATE FILE: components/desktop_layout/DesktopCourtsDirectory.tsx
"use client";

import React from "react";
import TMDesktopSidebar from "@/components/desktop_layout/TMDesktopSidebar";
import { MapPin, Search, SlidersHorizontal, X } from "lucide-react";

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
  mapsUrl?: string;
  bookingUrl?: string | null;
  distanceKm?: number | null;
};

export default function DesktopCourtsDirectory(props: {
  userPostcode: string | null;
  userCoords: LatLng | null;

  searchTerm: string;
  setSearchTerm: (v: string) => void;

  showFilters: boolean;
  setShowFilters: (v: boolean) => void;

  stateFilter: "VIC" | "NSW";
  setStateFilter: (v: "VIC" | "NSW") => void;

  maxDistanceKm: number;
  setMaxDistanceKm: (v: number) => void;

  filteredCourts: Court[];

  qStr: string;
  hasMore: boolean;
  loadingMore: boolean;
  loadMore: () => void;

  onCourtClick: (courtId: string, type: "map" | "booking") => void;
}) {
  const {
    userPostcode,
    userCoords,
    searchTerm,
    setSearchTerm,
    showFilters,
    setShowFilters,
    stateFilter,
    setStateFilter,
    maxDistanceKm,
    setMaxDistanceKm,
    filteredCourts,
    qStr,
    hasMore,
    loadingMore,
    loadMore,
    onCourtClick,
  } = props;

  const TM = {
    bg: "#F7FAF8", // ✅ matches DesktopDashboardHome background
  };

  return (
    <div className="min-h-screen" style={{ background: TM.bg }}>
      {/* ✅ EXACT same outer padding as DesktopDashboardHome */}
      <div className="w-full px-8 2xl:px-12 py-8">
        {/* ✅ EXACT same grid columns + gap */}
        <div className="grid gap-8 2xl:gap-10 xl:grid-cols-[300px_1fr]">
          {/* ✅ Sidebar placement copied from DesktopDashboardHome */}
          <TMDesktopSidebar active="Search" />

          {/* Main */}
          <main className="min-w-0">
            <div className="rounded-3xl border border-black/10 bg-white p-7 2xl:p-8">
              {/* Header row */}
              <div className="flex items-start justify-between gap-6">
                <div>
                  <h1 className="text-2xl font-extrabold text-black/90">
                    Court Directory
                  </h1>
                  <div className="mt-1 text-sm text-black/55">
                    {userPostcode ? `Near ${userPostcode}` : "Find courts near you"} •{" "}
                    {filteredCourts.length} result
                    {filteredCourts.length === 1 ? "" : "s"}
                  </div>
                </div>

                <div className="flex items-center gap-3">
                  {/* Search */}
                  <div className="relative w-[360px]">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-black/35" />
                    <input
                      type="text"
                      placeholder="Search by court name"
                      value={searchTerm}
                      onChange={(e) => setSearchTerm(e.target.value)}
                      className="w-full rounded-2xl bg-[#F7FAF8] pl-9 pr-3 py-2.5 text-sm ring-1 ring-black/10 focus:outline-none focus:ring-2 focus:ring-[#39FF14]"
                    />
                  </div>

                  {/* Filters toggle */}
                  <button
                    type="button"
                    onClick={() => setShowFilters(!showFilters)}
                    className="h-11 w-11 rounded-2xl bg-[#F7FAF8] ring-1 ring-black/10 flex items-center justify-center hover:bg-black/[0.03]"
                    aria-label="Filters"
                    title="Filters"
                  >
                    {showFilters ? (
                      <X className="h-5 w-5 text-black/70" />
                    ) : (
                      <SlidersHorizontal className="h-5 w-5 text-black/70" />
                    )}
                  </button>
                </div>
              </div>

              {/* Filters panel */}
              {showFilters && (
                <div className="mt-6 rounded-3xl border border-black/10 bg-[#F7FAF8] p-5">
                  <div className="flex items-center justify-between">
                    <div className="text-sm font-extrabold text-black/80">
                      Filters
                    </div>
                    <button
                      type="button"
                      onClick={() => setShowFilters(false)}
                      className="text-xs font-extrabold tracking-wide text-black/55 hover:text-black/80"
                    >
                      CLOSE
                    </button>
                  </div>

                  <div className="mt-4 grid grid-cols-3 gap-5">
                    <div>
                      <label className="text-xs font-extrabold tracking-wide text-black/55">
                        STATE
                      </label>
                      <select
                        value={stateFilter}
                        onChange={(e) =>
                          setStateFilter(e.target.value as "NSW" | "VIC")
                        }
                        className="mt-2 w-full rounded-2xl bg-white px-3 py-2.5 text-sm ring-1 ring-black/10 focus:outline-none focus:ring-2 focus:ring-[#39FF14]"
                      >
                        <option value="VIC">VIC</option>
                        <option value="NSW">NSW</option>
                      </select>
                    </div>

                    <div className="col-span-2">
                      <label className="text-xs font-extrabold tracking-wide text-black/55">
                        DISTANCE
                      </label>

                      <div className="mt-2 flex items-center gap-4">
                        <div className="rounded-2xl bg-white px-3 py-2.5 text-sm ring-1 ring-black/10 min-w-[140px]">
                          {userCoords ? (
                            <span className="font-extrabold text-black/80">
                              {maxDistanceKm === 0 ? "Any" : `${maxDistanceKm} km`}
                            </span>
                          ) : (
                            <span className="text-black/45">Set postcode</span>
                          )}
                        </div>

                        {userCoords && (
                          <div className="flex-1">
                            <input
                              type="range"
                              min={0}
                              max={50}
                              step={5}
                              value={maxDistanceKm}
                              onChange={(e) =>
                                setMaxDistanceKm(Number(e.target.value))
                              }
                              className="w-full"
                            />
                            <div className="mt-1 text-[11px] text-black/45">
                              0 = any distance • 50 = within 50 km
                            </div>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* Court grid */}
              <div className="mt-7 grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
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
                      className="rounded-3xl border border-black/10 bg-white p-6 shadow-sm"
                    >
                      <div className="flex items-start justify-between gap-4">
                        <div className="min-w-0">
                          <div className="text-lg font-extrabold text-black/90 truncate">
                            {court.name}
                          </div>

                          <div className="mt-2 flex items-center gap-2 text-sm text-black/55">
                            <MapPin className="h-4 w-4" />
                            <span className="truncate">{locationLabel}</span>
                          </div>

                          {court.address && (
                            <div className="mt-2 text-sm text-black/45 line-clamp-2">
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

                      <div className="mt-6 flex gap-3">
                        <a
                          href={court.bookingUrl || court.mapsUrl || "#"}
                          target="_blank"
                          rel="noopener noreferrer"
                          onClick={() =>
                            onCourtClick(
                              court.id,
                              court.bookingUrl ? "booking" : "map"
                            )
                          }
                          className={[
                            "flex-1 rounded-2xl px-4 py-3 text-sm font-extrabold text-center",
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
                            onClick={() => onCourtClick(court.id, "map")}
                            className="flex-1 rounded-2xl px-4 py-3 text-sm font-extrabold text-center bg-[#F7FAF8] text-black/75 hover:bg-black/[0.03] ring-1 ring-black/10"
                          >
                            View Map
                          </a>
                        )}
                      </div>
                    </article>
                  );
                })}
              </div>

              {!qStr && hasMore && (
                <div className="mt-8 flex justify-center">
                  <button
                    type="button"
                    onClick={loadMore}
                    disabled={loadingMore}
                    className="rounded-2xl bg-[#F7FAF8] px-6 py-3 text-sm font-extrabold text-black/85 ring-1 ring-black/10 hover:bg-black/[0.03] disabled:opacity-60"
                  >
                    {loadingMore ? "Loading…" : "Load more courts"}
                  </button>
                </div>
              )}
            </div>
          </main>
        </div>
      </div>
    </div>
  );
}
