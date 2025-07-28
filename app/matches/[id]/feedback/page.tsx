// pages/matches/[id]/feedback/page.tsx
"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { db, auth } from "@/lib/firebase";
import {
  doc,
  setDoc,
  serverTimestamp,
  collection,
} from "firebase/firestore";
import { onAuthStateChanged } from "firebase/auth";

export default function MatchFeedbackPage() {
  const { id: matchId } = useParams();
  const router = useRouter();
  const [userId, setUserId] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [form, setForm] = useState({
    enjoyment: "",
    skillMatch: "",
    wouldPlayAgain: "",
    punctual: "",
    comments: "",
  });

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (user) => {
      if (user) setUserId(user.uid);
    });
    return () => unsubscribe();
  }, []);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    const { name, value } = e.target;
    setForm(prev => ({ ...prev, [name]: value }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!userId || !matchId) return;

    setSubmitting(true);
    try {
    const docId = `${matchId}_${userId}`;
const feedbackRef = doc(db, "match_feedback", docId);
await setDoc(feedbackRef, {
  ...form,
  matchId,
  userId,
  timestamp: serverTimestamp(),
});
      router.push("/directory");
    } catch (error) {
      console.error("Error submitting feedback:", error);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="max-w-xl mx-auto p-6">
      <h1 className="text-2xl font-bold mb-4 text-center">🎾 Match Feedback</h1>
      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className="block font-medium">Enjoyment:</label>
          <div className="flex gap-2">
            {["1", "2", "3", "4", "5"].map((v) => (
              <label key={v}>
                <input
                  type="radio"
                  name="enjoyment"
                  value={v}
                  checked={form.enjoyment === v}
                  onChange={handleChange}
                  required
                /> {v}
              </label>
            ))}
          </div>
        </div>

        <div>
          <label className="block font-medium">Skill Match:</label>
          {["Too easy", "Evenly matched", "Too challenging"].map((option) => (
            <label key={option} className="block">
              <input
                type="radio"
                name="skillMatch"
                value={option}
                checked={form.skillMatch === option}
                onChange={handleChange}
                required
              /> {option}
            </label>
          ))}
        </div>

        <div>
          <label className="block font-medium">Would you play with this player again?</label>
          {["Yes", "No"].map((v) => (
            <label key={v} className="block">
              <input
                type="radio"
                name="wouldPlayAgain"
                value={v}
                checked={form.wouldPlayAgain === v}
                onChange={handleChange}
                required
              /> {v}
            </label>
          ))}
        </div>

        <div>
          <label className="block font-medium">Was your opponent on time?</label>
          {["Yes", "No", "N/A"].map((v) => (
            <label key={v} className="block">
              <input
                type="radio"
                name="punctual"
                value={v}
                checked={form.punctual === v}
                onChange={handleChange}
                required
              /> {v}
            </label>
          ))}
        </div>

        <div>
          <label className="block font-medium">Any other feedback?</label>
          <textarea
            name="comments"
            rows={3}
            className="w-full border rounded p-2"
            value={form.comments}
            onChange={handleChange}
          />
        </div>

        <button
          type="submit"
          className="bg-green-600 text-white px-4 py-2 rounded disabled:opacity-50"
          disabled={submitting}
        >
          {submitting ? "Submitting..." : "Submit Feedback"}
        </button>

        <div className="flex justify-end">
          <button
            type="button"
            onClick={() => router.push("/directory")}
            className="mt-2 text-sm text-gray-500 underline hover:text-gray-800"
          >
            Skip Feedback
          </button>
        </div>
      </form>
    </div>
  );
}
