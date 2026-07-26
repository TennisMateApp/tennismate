"use client";

import {ArrowRight, House} from "lucide-react";

export default function HomeWelcomeCard({
  busy,
  onFindPlayers,
  onDismiss,
}: {
  busy?: boolean;
  onFindPlayers: () => void;
  onDismiss: () => void;
}) {
  return (
    <section
      aria-labelledby="onboarding-v2-home-welcome-title"
      className="rounded-3xl border border-emerald-950/10 bg-white p-5 shadow-sm"
    >
      <div className="flex items-start gap-3">
        <div className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-emerald-950 text-white">
          <House size={20} aria-hidden="true" />
        </div>
        <div className="min-w-0">
          <h2 id="onboarding-v2-home-welcome-title" className="text-base font-black text-emerald-950">
            Welcome to your TennisMate home
          </h2>
          <p className="mt-1.5 text-sm font-medium leading-6 text-emerald-950/65">
            See upcoming matches, messages, events and player activity here.
          </p>
        </div>
      </div>
      <div className="mt-4 flex flex-wrap gap-3">
        <button
          type="button"
          onClick={onFindPlayers}
          disabled={busy}
          className="inline-flex min-h-11 items-center justify-center gap-2 rounded-2xl bg-[#0B3D2E] px-4 py-2.5 text-sm font-extrabold text-white disabled:opacity-60 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-700"
        >
          Find players
          <ArrowRight size={17} aria-hidden="true" />
        </button>
        <button
          type="button"
          onClick={onDismiss}
          disabled={busy}
          className="min-h-11 rounded-2xl border border-emerald-950/15 bg-white px-4 py-2.5 text-sm font-extrabold text-emerald-950 disabled:opacity-60 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-700"
        >
          Dismiss
        </button>
      </div>
    </section>
  );
}
