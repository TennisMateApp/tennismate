"use client";

import { useEffect, useState } from "react";
import { X, ChevronLeft, ChevronRight, CheckCircle2 } from "lucide-react";

type Step = {
  title: string;
  body: string;
};

const DEFAULT_STEPS: Step[] = [
  {
    title: "Welcome to the new TennisMate",
    body: "We've refreshed the layout to make finding matches and events easier than ever. This quick tour will show you what's new.",
  },
  {
    title: "Find a Match",
    body: "Use Find a Match to connect directly with other players who share your skill level, availability, and nearby location. Matches are one-on-one that you set up instantly.",
  },
  {
    title: "Events",
    body: "Events are group-based activities designed for future play. You can browse open events, join existing ones, or create your own from the Events page. They can be singles, doubles, or larger social sessions — perfect for planning matches ahead.",
  },
  {
    title: "Creating an Event",
    body: "Tap the + Create Event button to set a title, location, date, and capacity. Once published, other players can view and join your event. You’ll receive notifications when players join.",
  },
  {
    title: "Event Group Chat",
    body: "Every event has its own built-in chat where attendees can coordinate timing, bring a friend, or chat before and after matches. Open it via the chat icon in the event view.",
  },
   {
    title: "Calendar",
    body: "Every time you create or join an event, it’s automatically added to your personal TennisMate calendar. Use the calendar to keep track of all your upcoming matches, events, and social games in one place — so you never miss a hit!",
  },
  {
    title: "Footer Navigation",
    body: "The footer menu changes depending on what you’re doing. On the Home page, you’ll see Home · Match Me · Events. When you’re setting up or viewing matches, it switches to Home · Match Me · Matches. And when you’re exploring upcoming events, it becomes Home · Calendar · Events.",
  },
  {
    title: "Header Tools",
    body: "Profile, Directory, Calendar, Messages, Notifications, and Settings live in the header for quick access anywhere in the app.",
  },
  {
    title: "All Set!",
    body: "That’s it! Explore the new layout, join a match or event, and meet your next TennisMate!",
  },
];


export default function OnboardingTour({
  open,
  onClose,
  onComplete,
  steps = DEFAULT_STEPS,
}: {
  open: boolean;
  onClose: () => void;
  onComplete: () => void;
  steps?: Step[];
}) {
  const [i, setI] = useState(0);

  useEffect(() => {
    if (open) setI(0);
  }, [open]);

  if (!open) return null;
  const last = i === steps.length - 1;

  return (
    <div className="fixed inset-0 z-[9999]">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />

      {/* Card / bottom sheet */}
      <div className="absolute inset-x-0 bottom-0 mx-auto w-full max-w-md rounded-t-2xl bg-white shadow-xl">
        <div className="flex items-center justify-between px-5 pt-4">
          <div className="h-1.5 w-24 rounded-full bg-gray-200" />
          <button
            aria-label="Close"
            onClick={onClose}
            className="rounded p-2 text-gray-500 hover:bg-gray-100"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="px-6 pb-5 pt-3">
          <h3 className="text-lg font-semibold">{steps[i].title}</h3>
          <p className="mt-2 text-sm text-gray-700">{steps[i].body}</p>

          <div className="mt-4 flex items-center gap-1.5">
            {steps.map((_, idx) => (
              <span
                key={idx}
                className={`h-1.5 w-6 rounded-full ${
                  idx <= i ? "bg-green-600" : "bg-gray-200"
                }`}
              />
            ))}
          </div>

          <div className="mt-5 flex items-center justify-between">
            <button
              onClick={() => setI((v) => Math.max(0, v - 1))}
              disabled={i === 0}
              className="inline-flex items-center gap-1 rounded-lg border px-3 py-2 text-sm text-gray-700 disabled:opacity-50"
            >
              <ChevronLeft className="h-4 w-4" />
              Back
            </button>

            {!last ? (
              <button
                onClick={() => setI((v) => Math.min(steps.length - 1, v + 1))}
                className="inline-flex items-center gap-1 rounded-lg bg-green-600 px-3 py-2 text-sm font-medium text-white hover:bg-green-700"
              >
                Next
                <ChevronRight className="h-4 w-4" />
              </button>
            ) : (
              <button
                onClick={onComplete}
                className="inline-flex items-center gap-1 rounded-lg bg-green-600 px-3 py-2 text-sm font-medium text-white hover:bg-green-700"
              >
                <CheckCircle2 className="h-4 w-4" />
                Got it
              </button>
            )}
          </div>

          <div className="mt-3 text-center">
            <p className="text-xs text-gray-500">
              You can view this again anytime from Settings → “What’s new”.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
