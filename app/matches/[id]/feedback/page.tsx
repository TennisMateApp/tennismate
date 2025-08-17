// app/matches/[id]/feedback/page.tsx
"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { db, auth } from "@/lib/firebase";
import {
  doc,
  setDoc,
  getDoc,
  serverTimestamp,
} from "firebase/firestore";
import { onAuthStateChanged } from "firebase/auth";
import { GiTennisBall } from "react-icons/gi";

type FormState = {
  enjoyment: string;         // 1..5
  skillMatch: "Too easy" | "Evenly matched" | "Too challenging" | "";
  wouldPlayAgain: "Yes" | "No" | "";
  punctual: "Yes" | "No" | "N/A" | "";
  comments: string;
};

export default function MatchFeedbackPage() {
  const { id: rawMatchId } = useParams();
  const matchId = Array.isArray(rawMatchId) ? rawMatchId[0] : (rawMatchId as string | undefined);
  const router = useRouter();

  const [userId, setUserId] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [saving, setSaving] = useState<"idle" | "saving" | "saved">("idle");
  const [opponentName, setOpponentName] = useState<string>("");
  const [opponentPhoto, setOpponentPhoto] = useState<string | null>(null);
  const [score, setScore] = useState<string>("");

  // sensible defaults (faster completion)
  const [form, setForm] = useState<FormState>({
    enjoyment: "",
    skillMatch: "Evenly matched",
    wouldPlayAgain: "",
    punctual: "",
    comments: "",
  });

  // ---- auth ----
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (user) => {
      if (user) setUserId(user.uid);
    });
    return () => unsubscribe();
  }, []);

  // ---- load lightweight match context (names/score) ----
  useEffect(() => {
    const run = async () => {
      if (!matchId) return;
      try {
        const mRef = doc(db, "match_requests", matchId);
        const snap = await getDoc(mRef);
        if (!snap.exists()) return;
        const m = snap.data() as any;

        // names are stored on the match doc already
        setScore(m?.score || "");
        // pick opponent based on current user once we know it
        if (userId) {
          const name =
            userId === m?.fromUserId ? m?.toName ?? "" : m?.fromName ?? "";
          setOpponentName(name);
        } else {
          // fallback: show "Opponent" until we know who I am
          setOpponentName(m?.toName || m?.fromName || "Opponent");
        }
        // optional: if you store player photos on match doc later, use them here
        setOpponentPhoto(null);
      } catch {
        // ignore; show minimal UI
      }
    };
    run();
  }, [db, matchId, userId]);

  // ---- helpers ----
  const feedbackDocId = useMemo(
    () => (userId && matchId ? `${matchId}_${userId}` : null),
    [matchId, userId]
  );

  const setField = <K extends keyof FormState>(key: K, value: FormState[K]) => {
    setForm((prev) => ({ ...prev, [key]: value }));
  };

  // ---- autosave (debounced) whenever user changes something ----
  useEffect(() => {
    if (!feedbackDocId || !userId || !matchId) return;
    // don't autosave until at least one field has content
    const hasContent =
      form.enjoyment || form.wouldPlayAgain || form.punctual || form.comments || form.skillMatch;
    if (!hasContent) return;

    setSaving("saving");
    const t = setTimeout(async () => {
      try {
        await setDoc(
          doc(db, "match_feedback", feedbackDocId),
          {
            ...form,
            matchId,
            userId,
            updatedAt: serverTimestamp(),
            // create timestamp if first time
            createdAt: serverTimestamp(),
          },
          { merge: true }
        );
        setSaving("saved");
        setTimeout(() => setSaving("idle"), 1200);
      } catch {
        setSaving("idle");
      }
    }, 600);

    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form, feedbackDocId]);

  // ---- submit ----
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!userId || !matchId || !feedbackDocId) return;

    // client-side required fields
    if (!form.enjoyment || !form.skillMatch || !form.wouldPlayAgain) {
      alert("Please complete Enjoyment, Skill Match, and Play Again.");
      return;
    }

    setSubmitting(true);
    try {
      await setDoc(
        doc(db, "match_feedback", feedbackDocId),
        {
          ...form,
          matchId,
          userId,
          submittedAt: serverTimestamp(),
        },
        { merge: true }
      );

      // go back to Matches list (change if you prefer /directory)
      router.push("/matches");
    } catch (error) {
      console.error("Error submitting feedback:", error);
      setSubmitting(false);
    }
  };

  return (
    <div className="mx-auto max-w-2xl px-4 sm:px-6 py-5 sm:py-6 pb-24 sm:pb-12 overflow-x-hidden">
      {/* Header */}
      <div className="mb-4">
        <div className="flex items-center gap-3">
          <GiTennisBall className="h-6 w-6 text-green-600" aria-hidden="true" />
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight">Match Feedback</h1>
        </div>
        <p className="mt-1 ml-9 text-[15px] sm:text-base text-gray-700">
          Takes ~20 seconds. Your opponent won’t see your comments.
        </p>
      </div>

      {/* Context card */}
      <div className="mb-4 rounded-xl border bg-white p-3 shadow-sm">
        <div className="flex items-center gap-3">
          <div className="h-10 w-10 rounded-full ring-2 ring-gray-200 overflow-hidden">
            <img
              src={opponentPhoto || "/images/default-avatar.png"}
              alt={opponentName || "Opponent"}
              className="h-10 w-10 object-cover"
            />
          </div>
          <div className="flex-1">
            <div className="text-sm font-medium text-gray-900 break-words">{opponentName || "Opponent"}</div>
            {score ? (
              <div className="text-xs text-gray-500">Score: {score}</div>
            ) : (
              <div className="text-xs text-gray-400">No score recorded</div>
            )}
          </div>
          {saving === "saving" && (
            <span className="text-xs text-gray-500">Saving…</span>
          )}
          {saving === "saved" && (
            <span className="text-xs text-green-600">Saved ✓</span>
          )}
        </div>
      </div>

      {/* Form */}
      <form onSubmit={handleSubmit} className="space-y-4">
        {/* Enjoyment */}
        <fieldset className="rounded-2xl border bg-white p-4 sm:p-6 shadow-sm">
          <legend className="text-base sm:text-lg font-semibold text-gray-900 leading-6">How fun was this match?</legend>
          <div className="mt-3 grid grid-cols-5 gap-2" role="radiogroup" aria-label="Enjoyment">

            {[1, 2, 3, 4, 5].map((n) => {
              const selected = form.enjoyment === String(n);
              return (
<button
  key={n}
  type="button"
  onClick={() => setField("enjoyment", String(n))}
  role="radio"
  aria-checked={selected}
  className={`flex items-center justify-center w-full min-w-0 rounded-lg border h-10 sm:h-11 px-0 text-base sm:text-lg leading-none
    ${selected ? "border-green-600 bg-green-50 font-semibold" : "hover:bg-gray-50"}`}
>
  {n}
</button>

              );
            })}
          </div>
          <div className="mt-3 text-sm sm:text-base text-gray-600">1 = Poor · 5 = Great</div>
        </fieldset>

        {/* Skill Match */}
        <fieldset className="rounded-2xl border bg-white p-4 sm:p-6 shadow-sm">
          <legend className="text-base sm:text-lg font-semibold text-gray-900 leading-6">How evenly matched did it feel?</legend>
          <div className="mt-3 grid grid-cols-3 gap-2" role="radiogroup" aria-label="Skill match">
            {["Too easy", "Evenly matched", "Too challenging"].map((opt) => {
              const selected = form.skillMatch === opt;
              return (
                <button
                  key={opt}
                  type="button"
                  onClick={() => setField("skillMatch", opt as FormState["skillMatch"])}
                  role="radio"
                  aria-checked={selected}
                  className={`w-full min-w-0 rounded-lg border px-3 py-2 text-[13px] sm:text-base text-center leading-tight whitespace-normal break-normal
  ${selected ? "border-green-600 bg-green-50 font-semibold" : "hover:bg-gray-50"}`}

                >
                  {opt}
                </button>
              );
            })}
          </div>
        </fieldset>

        {/* Play again */}
        <fieldset className="rounded-2xl border bg-white p-4 sm:p-6 shadow-sm">
          <legend className="text-base sm:text-lg font-semibold text-gray-900 leading-6">Play with this player again?</legend>
          <div className="mt-3 grid grid-cols-2 gap-2" role="radiogroup" aria-label="Play again">
            {(["Yes", "No"] as const).map((opt) => {
              const selected = form.wouldPlayAgain === opt;
              return (
                <button
                  key={opt}
                  type="button"
                  onClick={() => setField("wouldPlayAgain", opt)}
                  role="radio"
                  aria-checked={selected}
                  className={`w-full min-w-0 rounded-lg border px-3 py-2 text-sm sm:px-4 sm:py-3 sm:text-base text-center leading-tight
                    ${selected ? "border-green-600 bg-green-50 font-semibold" : "hover:bg-gray-50"}`}
                >
                  {opt}
                </button>
              );
            })}
          </div>
        </fieldset>

        {/* Punctual */}
        <fieldset className="rounded-2xl border bg-white p-4 sm:p-6 shadow-sm">
          <legend className="text-base sm:text-lg font-semibold text-gray-900 leading-6">
  Were they on time?
  <span className="ml-2 text-gray-600 font-normal text-sm sm:text-base">(optional)</span>
</legend>
          <div className="mt-3 grid grid-cols-3 gap-2" role="radiogroup" aria-label="Punctual">
            {(["Yes", "No", "N/A"] as const).map((opt) => {
              const selected = form.punctual === opt;
              return (
                <button
                  key={opt}
                  type="button"
                  onClick={() => setField("punctual", opt)}
                  role="radio"
                  aria-checked={selected}
                  className={`w-full min-w-0 rounded-lg border px-3 py-2 text-sm sm:px-4 sm:py-3 sm:text-base text-center leading-tight
                    ${selected ? "border-green-600 bg-green-50 font-semibold" : "hover:bg-gray-50"}`}
                >
                  {opt}
                </button>
              );
            })}
          </div>
        </fieldset>

        {/* Comments */}
        <fieldset className="rounded-2xl border bg-white p-4 sm:p-6 shadow-sm">
          <legend className="text-base sm:text-lg font-semibold text-gray-900 leading-6">
  Anything else to share?
  <span className="ml-2 text-gray-600 font-normal text-sm sm:text-base">(optional)</span>
</legend>
          <textarea
            name="comments"
            rows={3}
            placeholder="e.g., Great rallies, friendly match, court lighting was dim…"
            className="mt-3 w-full resize-y rounded-lg border px-4 py-3 text-base outline-none focus:ring-2 focus:ring-green-600"
            onChange={(e) => setField("comments", e.target.value)}
            maxLength={300}
          />
          <div className="mt-2 text-sm text-gray-500">{form.comments.length}/300</div>
          <div className="mt-2 flex flex-wrap gap-2">
            {["Sportsmanship", "Punctual", "Good rally", "Scheduling issues"].map((chip) => (
              <button
                type="button"
                key={chip}
                onClick={() =>
                  setField(
                    "comments",
                    form.comments ? `${form.comments.trim()} ${chip}` : chip
                  )
                }
                className="rounded-full border px-3 py-1.5 text-sm hover:bg-gray-50"
              >
                {chip}
              </button>
            ))}
          </div>
          <p className="mt-2 text-xs text-gray-500">
            Shared privately with TennisMate to improve matching; not shown publicly.
          </p>
        </fieldset>

        {/* Spacer to avoid overlap with sticky bar */}
        <div className="h-10 sm:h-12" />
      </form>

      {/* Sticky action bar */}
<div
  className="fixed left-0 right-0 px-4 z-[70]"
  style={{ bottom: "max(env(safe-area-inset-bottom), 8px)" }}
>
        <div className="mx-auto max-w-2xl rounded-2xl bg-white shadow-lg border p-3 flex items-center justify-between">
          <button
            type="button"
            onClick={() => router.push("/matches")}
            className="text-sm text-gray-600 underline hover:text-gray-900"
          >
            Skip for now
          </button>

          <button
            onClick={handleSubmit}
            disabled={submitting}
            className="rounded-xl bg-green-600 px-4 py-2 text-white text-sm font-semibold shadow hover:bg-green-700 disabled:opacity-50"
          >
            {submitting ? "Submitting…" : "Submit Feedback"}
          </button>
        </div>
      </div>
    </div>
  );
}
