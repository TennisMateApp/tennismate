// app/forgot-password/page.tsx
"use client";

import { useState } from "react";
// ✅ Use the SAME auth export used across the rest of your app:
import { auth } from "@/lib/firebaseConfig"; // or "@/lib/firebase" — but be consistent!
import { sendPasswordResetEmail } from "firebase/auth";
import { useRouter } from "next/navigation";

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [error, setError] = useState("");
  const router = useRouter();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");

    // Build a redirect URL on the current origin (must be in Authorized domains)
    const origin =
      typeof window !== "undefined" ? window.location.origin : "https://tennis-mate.com.au";

    const actionCodeSettings = {
      url: `${origin}/login`,         // where Google will send users after they complete the reset flow
      handleCodeInApp: false,         // standard for password resets
    };

    try {
      await sendPasswordResetEmail(auth, email.trim(), actionCodeSettings);
      setSent(true);
    } catch (err: any) {
      // Keep message generic for users, but log details in dev
      if (process.env.NODE_ENV !== "production") {
        console.error("sendPasswordResetEmail error:", err?.code, err?.message);
      }
      // Common codes you might see:
      // auth/user-not-found, auth/invalid-email, auth/too-many-requests, auth/unauthorized-continue-uri
      setError("We couldn’t send the reset email. Please try again.");
    }
  };

  return (
    <div className="relative">
      {/* Full-bleed background */}
      <div aria-hidden className="fixed inset-0 z-0">
        <img
          src="/images/login-tennis-court.jpg"
          alt=""
          className="h-full w-full object-cover object-[50%_55%]"
        />
        <div className="absolute inset-0 bg-black/40" />
      </div>

      {/* Centered card (fixed so no scroll, no white border) */}
      <div className="fixed inset-0 z-10 flex items-center justify-center p-4">
        <div className="w-full max-w-md rounded-2xl bg-white/95 p-6 shadow-xl ring-1 ring-black/5 backdrop-blur">
          <h1 className="text-center text-2xl font-bold text-gray-900">
            Forgot Password
          </h1>
          <p className="mt-2 text-center text-sm text-gray-600">
            Enter the email associated with your account and we’ll send a reset link.
          </p>

          {sent ? (
            <p className="mt-4 text-center text-emerald-700 text-sm" aria-live="polite">
              If an account exists for <span className="font-medium">{email}</span>, a reset link has been sent.
            </p>
          ) : (
            <form onSubmit={handleSubmit} className="mt-5 space-y-4">
              <div>
                <label htmlFor="email" className="mb-1 block text-sm font-medium text-gray-800">
                  Email
                </label>
                <input
                  id="email"
                  type="email"
                  inputMode="email"
                  autoComplete="email"
                  placeholder="you@example.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  className="w-full rounded-xl border border-gray-300 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-emerald-600"
                />
              </div>

              {error && (
                <p className="text-center text-sm text-red-600" aria-live="polite">
                  {error}
                </p>
              )}

              <button
                type="submit"
                disabled={!/^\S+@\S+\.\S+$/.test(email)}
                className="w-full rounded-xl bg-emerald-600 px-4 py-2 text-sm font-semibold text-white shadow hover:bg-emerald-700 disabled:opacity-50"
              >
                Send Reset Email
              </button>
            </form>
          )}

          <div className="mt-4 text-center">
            <button
              type="button"
              onClick={() => router.push("/login")}
              className="text-sm font-medium text-emerald-700 hover:underline"
            >
              Back to Login
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
