"use client";

import { useState } from "react";
import withAuth from "@/components/withAuth";

function SupportPage() {
  const [feedback, setFeedback] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState("");

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");

    try {
      const res = await fetch("https://formspree.io/f/xwpbgqna", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify({ message: feedback }),
      });

      const data = await res.json();
      if (data.ok) {
        setSubmitted(true);
        setFeedback("");
      } else {
        setError("Something went wrong. Please try again.");
      }
    } catch (err) {
      setError("Failed to submit. Please check your connection.");
    }
  };

  return (
    <div className="max-w-xl mx-auto px-6 py-12 text-gray-800">
      <h1 className="text-2xl font-bold mb-4">Need Help?</h1>
      <p className="mb-4">
        If you’re having trouble or need support, feel free to contact us. We're here to help!
      </p>
      <p className="text-blue-600 font-medium mb-8">
        📧{" "}
        <a href="mailto:support@tennis-mate.com.au" className="underline">
          support@tennis-mate.com.au
        </a>
      </p>

      <h2 className="text-xl font-semibold mb-2">Send Feedback</h2>
      <form onSubmit={handleSubmit} className="space-y-4">
        <textarea
          value={feedback}
          onChange={(e) => setFeedback(e.target.value)}
          placeholder="Let us know your thoughts..."
          className="w-full border border-gray-300 rounded p-3 text-sm min-h-[120px] resize-none"
          required
        />

        <button
          type="submit"
          className="bg-blue-600 text-white px-4 py-2 rounded hover:bg-blue-700"
        >
          Submit Feedback
        </button>

        {submitted && (
          <p className="text-green-600 text-sm mt-2">
            ✅ Thank you! Your feedback has been sent.
          </p>
        )}
        {error && (
          <p className="text-red-600 text-sm mt-2">
            ❌ {error}
          </p>
        )}
      </form>

      {/* Terms & Privacy Links */}
      <div className="text-sm mt-6">
        <p>
          View our{" "}
          <a href="/terms" className="text-blue-600 underline">
            Terms & Conditions
          </a>{" "}
          and{" "}
          <a href="/privacy" className="text-blue-600 underline">
            Privacy Policy
          </a>
          .
        </p>
      </div>
    </div>
  );
}

export default withAuth(SupportPage);
