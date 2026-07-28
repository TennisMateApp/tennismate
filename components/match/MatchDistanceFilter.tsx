"use client";

import React from "react";
import {
  MATCH_DISTANCE_OPTIONS_KM,
  type MatchDistanceKm,
} from "@/lib/matchDistance";

export default function MatchDistanceFilter({
  value,
  onChange,
  disabled = false,
  tone = "light",
}: {
  value: MatchDistanceKm;
  onChange: (value: MatchDistanceKm) => void;
  disabled?: boolean;
  tone?: "light" | "dark";
}) {
  const dark = tone === "dark";

  return (
    <fieldset disabled={disabled} aria-busy={disabled}>
      <legend className={`mb-2 text-xs font-semibold ${dark ? "text-white/80" : "text-gray-700"}`}>
        Distance <span className={dark ? "text-white" : "text-emerald-950"}>({value} km)</span>
      </legend>
      <div className="grid grid-cols-3 gap-1.5" role="radiogroup" aria-label="Maximum match distance">
        {MATCH_DISTANCE_OPTIONS_KM.map((distance) => {
          const selected = value === distance;
          return (
            <button
              key={distance}
              type="button"
              role="radio"
              aria-checked={selected}
              disabled={disabled}
              onClick={() => onChange(distance)}
              className={`min-h-10 rounded-lg border px-2 py-2 text-xs font-extrabold outline-none transition focus-visible:ring-2 focus-visible:ring-[#39FF14] disabled:cursor-wait disabled:opacity-55 ${selected
                ? "border-[#39FF14]/60 bg-[#39FF14]/15"
                : dark
                  ? "border-white/15 bg-white/[0.06] text-white hover:bg-white/[0.10]"
                  : "border-emerald-950/15 bg-white text-emerald-950 hover:bg-emerald-950/[0.03]"
              }`}
            >
              {distance} km
            </button>
          );
        })}
      </div>
    </fieldset>
  );
}
