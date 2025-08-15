"use client";

import { useEffect, useRef, useState } from "react";
import withAuth from "@/components/withAuth";
import { auth, db } from "@/lib/firebaseConfig";
import { onAuthStateChanged } from "firebase/auth";
import { addDoc, collection, doc, getDoc, serverTimestamp } from "firebase/firestore";

function SupportPage() {
  const [topic, setTopic] = useState("");
  const [feedback, setFeedback] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [honeypot, setHoneypot] = useState(""); // anti-bot

  // current user details (for reply + audit)
  const [me, setMe] = useState<{ uid: string; email: string | null; name: string } | null>(null);

  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Pull the signed-in user's email + name
  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (u) => {
      if (!u) {
        setMe(null);
        return;
      }
      let name = "";
      try {
        const snap = await getDoc(doc(db, "players", u.uid));
        if (snap.exists()) name = (snap.data() as any).name || "";
      } catch {
        /* ignore */
      }
      setMe({ uid: u.uid, email: u.email, name });
    });
    return () => unsub();
  }, []);

  // Autosize textarea
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "0px";
    el.style.height = Math.min(el.scrollHeight, 240) + "px";
  }, [feedback]);

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (honeypot) return; // bot trap

    setError(null);
    setSubmitted(false);
    setSubmitting(true);

    const payload = {
      topic,
      message: feedback.trim(),
      email: me?.email ?? undefined, // Formspree Reply-To
      name: me?.name ?? undefined,
      uid: me?.uid ?? undefined,
      userAgent: typeof navigator !== "undefined" ? navigator.userAgent : null,
      page: "/support",
    };

    try {
      // 1) Send to Formspree
      const res = await fetch("https://formspree.io/f/xwpbgqna", {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify(payload),
      });

      // 2) Log to Firestore (optional)
      try {
        await addDoc(collection(db, "support_feedback"), {
          ...payload,
          createdAt: serverTimestamp(),
        });
      } catch {
        /* don't block UX */
      }

      let data: any = {};
      try {
        data = await res.json();
      } catch {
        /* ignore */
      }

      if (res.ok || data?.ok) {
        setSubmitted(true);
        setFeedback("");
        setTopic("");
      } else {
        setError(data?.errors?.[0]?.message || "Something went wrong. Please try again.");
      }
    } catch {
      setError("Failed to submit. Please check your connection.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="mx-auto max-w-3xl p-4 sm:p-6">
      {/* Need Help? (top) */}
      <h1 className="text-2xl sm:text-3xl font-bold tracking-tight">Need Help?</h1>
      <section className="mt-3 rounded-2xl border bg-white p-5 sm:p-6 shadow-sm">
        <p className="text-sm text-gray-600">
          If you’re stuck or found a bug, message us below or email support. We’ll include your account
          email <span className="font-medium">{me?.email || "(unknown)"}</span> so we can reply.
        </p>

        <div className="mt-3 flex items-center gap-3">
          <span className="inline-flex h-9 w-9 items-center justify-center rounded-full bg-emerald-50 text-emerald-700">
            📧
          </span>
          <a
            href="mailto:support@tennis-mate.com.au"
            className="rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-sm text-emerald-700 hover:bg-emerald-100"
          >
            support@tennis-mate.com.au
          </a>
        </div>
      </section>

      {/* Send Feedback (below) */}
      <section className="mt-5 rounded-2xl border bg-white p-5 sm:p-6 shadow-sm">
        <h2 className="text-lg font-semibold">Send Feedback</h2>

        {submitted && (
          <div
            className="mt-3 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700"
            aria-live="polite"
          >
            ✅ Thanks! Your feedback has been sent.
          </div>
        )}
        {error && (
          <div
            className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700"
            aria-live="polite"
          >
            ❌ {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="mt-3 space-y-3">
          {/* Honeypot (hidden) */}
          <input
            type="text"
            value={honeypot}
            onChange={(e) => setHoneypot(e.target.value)}
            className="hidden"
            tabIndex={-1}
            aria-hidden="true"
            autoComplete="off"
          />

          <div>
            <label className="block text-sm font-medium text-gray-800">
              Topic<span className="text-red-600"> *</span>
            </label>
            <select
              value={topic}
              onChange={(e) => setTopic(e.target.value)}
              className="mt-1 w-full rounded-xl border px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-green-600 bg-white"
              required
            >
              <option value="">Choose a topic</option>
              <option value="bug">Bug report</option>
              <option value="feature">Feature request</option>
              <option value="account">Account / login</option>
              <option value="matchmaking">Matchmaking</option>
              <option value="other">Other</option>
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-800">
              Message<span className="text-red-600"> *</span>
            </label>
            <textarea
              ref={textareaRef}
              value={feedback}
              onChange={(e) => setFeedback(e.target.value)}
              placeholder="Let us know your thoughts…"
              className="mt-1 w-full min-h-[180px] resize-y rounded-xl border px-3 py-2 text-sm leading-6 outline-none focus:ring-2 focus:ring-green-600"
              rows={6}
              maxLength={1000}
              required
            />
            <div className="mt-1 text-xs text-gray-500">{feedback.length}/1000</div>
          </div>

          <button
            type="submit"
            disabled={submitting || !topic || feedback.trim().length < 10}
            className="rounded-xl bg-green-600 px-4 py-2 text-white text-sm font-semibold shadow hover:bg-green-700 disabled:opacity-50"
          >
            {submitting ? "Submitting…" : "Submit Feedback"}
          </button>

          <p className="text-xs text-gray-500">
            View our{" "}
            <a href="/terms" className="underline">
              Terms &amp; Conditions
            </a>{" "}
            and{" "}
            <a href="/privacy" className="underline">
              Privacy Policy
            </a>
            .
          </p>
        </form>
      </section>
    </div>
  );
}

export default withAuth(SupportPage);
