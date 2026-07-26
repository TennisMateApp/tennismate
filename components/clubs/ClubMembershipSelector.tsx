"use client";

import { useEffect, useState } from "react";
import { MapPin, Search, X } from "lucide-react";
import {
  ClubRequestDuplicateError,
  clubSelectionFromCourt,
  loadUniqueClubs,
  searchClubs,
  submitClubRequest,
  type ClubSearchResult,
  type ClubSelection,
  type ClubStatus,
} from "@/lib/clubs";
import { getClubMembershipPresentation } from "@/lib/clubMembershipPresentation";

export type ClubMembershipValue = {
  clubId: string | null;
  clubName: string | null;
  clubStatus: ClubStatus | null;
};

export default function ClubMembershipSelector({
  value,
  onChange,
  submittedBy,
  disabled = false,
}: {
  value: ClubMembershipValue;
  onChange: (selection: ClubSelection) => void;
  submittedBy: string;
  disabled?: boolean;
}) {
  const [clubs, setClubs] = useState<ClubSearchResult[]>([]);
  const [queryText, setQueryText] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [requestOpen, setRequestOpen] = useState(false);
  const [requestClubName, setRequestClubName] = useState("");
  const [requestSuburb, setRequestSuburb] = useState("");
  const [requestError, setRequestError] = useState("");
  const [requestSuccess, setRequestSuccess] = useState("");
  const [submittingRequest, setSubmittingRequest] = useState(false);
  const [changingClub, setChangingClub] = useState(false);

  useEffect(() => {
    let active = true;
    setLoading(true);
    loadUniqueClubs()
      .then((items) => {
        if (!active) return;
        setClubs(items);
        setLoadError("");
      })
      .catch((error) => {
        console.error("[ClubMembership] failed to load courts", error);
        if (active) setLoadError("Club search is unavailable right now. Please try again.");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    const timeout = window.setTimeout(() => setDebouncedQuery(queryText.trim()), 300);
    return () => window.clearTimeout(timeout);
  }, [queryText]);

  const results = debouncedQuery ? searchClubs(clubs, debouncedQuery) : [];
  const isWaitingForDebounce = queryText.trim() !== debouncedQuery;
  const membership = getClubMembershipPresentation(value);
  const showSelectedClub = Boolean(membership && !changingClub);

  const selectClub = (club: ClubSearchResult) => {
    onChange(clubSelectionFromCourt(club));
    setQueryText("");
    setDebouncedQuery("");
    setChangingClub(false);
  };

  const selectNoClub = () => {
    onChange({ clubId: null, clubName: null, clubStatus: "none" });
    setQueryText("");
    setDebouncedQuery("");
  };

  const openRequest = () => {
    setRequestClubName(queryText.trim());
    setRequestSuburb("");
    setRequestError("");
    setRequestSuccess("");
    setRequestOpen(true);
  };

  const closeRequest = () => {
    if (submittingRequest) return;
    setRequestOpen(false);
  };

  const handleRequestSubmit = async () => {
    setRequestError("");
    setRequestSuccess("");
    setSubmittingRequest(true);
    try {
      await submitClubRequest({
        clubName: requestClubName,
        suburb: requestSuburb,
        submittedBy,
      });
      setRequestSuccess("Club request submitted.");
    } catch (error) {
      if (error instanceof ClubRequestDuplicateError) {
        setRequestError("This club has already been requested.");
      } else {
        console.error("[ClubMembership] request failed", error);
        setRequestError(error instanceof Error ? error.message : "Unable to submit the request.");
      }
    } finally {
      setSubmittingRequest(false);
    }
  };

  return (
    <div className="space-y-3">
      {showSelectedClub && membership ? (
        <div className="flex items-start justify-between gap-4 rounded-2xl border border-emerald-900/15 bg-emerald-950/[0.04] px-4 py-3 text-emerald-950">
          <div className="min-w-0">
            <div className="text-xs font-bold text-emerald-950/55">{membership.label}</div>
            <div className="mt-0.5 break-words text-sm font-extrabold">{membership.clubName}</div>
          </div>
          <button type="button" onClick={() => setChangingClub(true)} disabled={disabled} className="shrink-0 text-xs font-extrabold underline decoration-emerald-950/30 underline-offset-4 disabled:opacity-60">
            Change club
          </button>
        </div>
      ) : null}

      {!showSelectedClub ? (
        <>
      {value.clubStatus === "none" ? (
        <div className="rounded-2xl border border-emerald-900/10 bg-emerald-950/[0.03] px-4 py-3 text-sm font-bold text-emerald-950/65">
          I&apos;m not a club member
        </div>
      ) : null}

      <div className="relative">
        <Search aria-hidden="true" className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-emerald-950/45" size={18} />
        <input
          type="search"
          value={queryText}
          onChange={(event) => setQueryText(event.target.value)}
          placeholder="Search for your tennis club..."
          disabled={disabled}
          aria-label="Search for your tennis club"
          aria-controls="club-search-results"
          aria-expanded={Boolean(queryText.trim())}
          className="w-full rounded-2xl border border-emerald-950/15 bg-white py-3 pl-11 pr-4 text-sm font-semibold text-emerald-950 outline-none focus:border-emerald-950/35 focus:ring-2 focus:ring-[#39FF14]/30 disabled:opacity-60"
        />
      </div>

      {loadError ? <p className="text-xs font-semibold text-red-700" role="alert">{loadError}</p> : null}

      {queryText.trim() ? (
        <div id="club-search-results" role="listbox" className="overflow-hidden rounded-2xl border border-emerald-950/10 bg-white">
          {loading || isWaitingForDebounce ? (
            <div className="space-y-2 p-3" aria-label="Loading club results">
              <div className="h-11 animate-pulse rounded-xl bg-emerald-950/[0.05]" />
              <div className="h-11 animate-pulse rounded-xl bg-emerald-950/[0.05]" />
            </div>
          ) : results.length ? (
            results.map((club) => (
              <button
                key={club.id}
                type="button"
                role="option"
                aria-selected={value.clubId === club.id}
                onClick={() => selectClub(club)}
                disabled={disabled}
                className="flex w-full items-start gap-3 border-b border-emerald-950/[0.07] px-4 py-3 text-left last:border-b-0 hover:bg-emerald-950/[0.03] focus:bg-emerald-950/[0.03] disabled:opacity-60"
              >
                <MapPin aria-hidden="true" className="mt-0.5 shrink-0 text-emerald-950/45" size={17} />
                <span className="min-w-0">
                  <span className="block text-sm font-extrabold text-emerald-950">{club.name}</span>
                  {club.suburb || club.postcode ? (
                    <span className="mt-0.5 block text-xs font-semibold text-emerald-950/55">
                      {[club.suburb, club.postcode].filter(Boolean).join(" · ")}
                    </span>
                  ) : null}
                </span>
              </button>
            ))
          ) : !loadError ? (
            <div className="p-4">
              <div className="text-sm font-extrabold text-emerald-950">Can&apos;t find your club?</div>
              <p className="mt-1 text-xs font-semibold text-emerald-950/55">Request it and we&apos;ll review it.</p>
              <button type="button" onClick={openRequest} className="mt-3 rounded-xl bg-emerald-950 px-4 py-2 text-sm font-extrabold text-white">
                Request Club
              </button>
            </div>
          ) : null}
        </div>
      ) : null}

      <button
        type="button"
        onClick={selectNoClub}
        disabled={disabled}
        className="text-sm font-extrabold text-emerald-950 underline decoration-emerald-950/30 underline-offset-4 disabled:opacity-60"
      >
        I&apos;m not a club member
      </button>
        </>
      ) : null}

      {requestOpen ? (
        <div className="fixed inset-0 z-[200] grid place-items-center bg-black/50 p-4" role="dialog" aria-modal="true" aria-labelledby="request-club-title" onMouseDown={(event) => event.target === event.currentTarget && closeRequest()}>
          <div className="w-full max-w-md rounded-3xl bg-white p-5 shadow-2xl">
            <div className="flex items-center justify-between gap-4">
              <div id="request-club-title" className="text-lg font-black text-emerald-950">Request Club</div>
              <button type="button" onClick={closeRequest} aria-label="Close request club dialog" className="grid h-9 w-9 place-items-center rounded-xl bg-emerald-950/[0.05] text-emerald-950"><X size={18} /></button>
            </div>
            <label className="mt-5 block text-xs font-extrabold text-emerald-950/65">Club Name</label>
            <input autoFocus maxLength={100} value={requestClubName} onChange={(event) => setRequestClubName(event.target.value)} className="mt-2 w-full rounded-2xl border border-emerald-950/15 px-4 py-3 text-sm font-semibold outline-none focus:ring-2 focus:ring-[#39FF14]/30" />
            <label className="mt-4 block text-xs font-extrabold text-emerald-950/65">Suburb</label>
            <input maxLength={80} value={requestSuburb} onChange={(event) => setRequestSuburb(event.target.value)} className="mt-2 w-full rounded-2xl border border-emerald-950/15 px-4 py-3 text-sm font-semibold outline-none focus:ring-2 focus:ring-[#39FF14]/30" />
            {requestError ? <div className="mt-3 rounded-xl bg-red-50 px-3 py-2 text-sm font-semibold text-red-700" role="alert">{requestError}</div> : null}
            {requestSuccess ? <div className="mt-3 rounded-xl bg-emerald-50 px-3 py-2 text-sm font-semibold text-emerald-800" role="status">{requestSuccess}</div> : null}
            <div className="mt-5 flex justify-end gap-3">
              <button type="button" onClick={closeRequest} disabled={submittingRequest} className="rounded-2xl border border-emerald-950/15 px-4 py-2.5 text-sm font-extrabold text-emerald-950">Cancel</button>
              <button type="button" onClick={() => void handleRequestSubmit()} disabled={submittingRequest || !requestClubName.trim() || !requestSuburb.trim() || Boolean(requestSuccess)} className="rounded-2xl bg-[#39FF14] px-4 py-2.5 text-sm font-extrabold text-emerald-950 disabled:opacity-50">{submittingRequest ? "Submitting..." : "Submit"}</button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
