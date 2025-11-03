"use client";

import { useEffect, useState } from "react";
import { signInWithEmailAndPassword, onAuthStateChanged } from "firebase/auth";
import { auth } from "@/lib/firebase";
import { useRouter, useSearchParams } from "next/navigation";
import Image from "next/image";
import Link from "next/link";
import { Mail, Lock, Eye, EyeOff } from "lucide-react";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);

  const router = useRouter();
  const searchParams = useSearchParams();
  const next = searchParams?.get("next") || "/home";

  // If already signed in, go to /home (or next) immediately
  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (u) => {
      if (u) router.replace(next);
    });
    return () => unsub();
  }, [router, next]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      await signInWithEmailAndPassword(auth, email, password);
      router.replace(next);
    } catch (err: any) {
      // Friendlier Firebase auth error messages
      const code = err?.code || "";
      if (code.includes("user-not-found") || code.includes("wrong-password")) {
        setError("Invalid email or password.");
      } else if (code.includes("too-many-requests")) {
        setError("Too many attempts. Please try again later.");
      } else if (code.includes("network-request-failed")) {
        setError("Network error. Check your connection and try again.");
      } else {
        setError("Unable to sign in. Please try again.");
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="relative min-h-[100dvh] overflow-hidden">
  {/* Background */}
<div className="fixed inset-0 z-0">
  <div className="relative h-full w-full">
    <Image
      src="/images/login-tennis-court.jpg"
      alt=""
      fill
      priority
      className="object-cover"
    />
  </div>
  <div className="absolute inset-0 bg-black/40" />
</div>

      {/* Content */}
      <div className="relative z-10 min-h-screen flex items-center justify-center px-4">
        <div className="w-full max-w-md bg-white/95 backdrop-blur-md p-8 rounded-2xl shadow-xl ring-1 ring-black/5">
          <div className="flex justify-center mb-5">
            <Image
              src="/logo.png"
              alt="TennisMate"
              width={96}
              height={96}
              className="rounded-full border p-1"
            />
          </div>

          <h1 className="text-3xl font-semibold tracking-tight mb-2 text-center">
            Find your TennisMate
          </h1>
          <p className="text-sm text-gray-600 mb-6 text-center">
            Match by <strong>availability</strong>, <strong>skill</strong>, and <strong>location</strong>.
          </p>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="relative">
              <Mail className="absolute left-3 top-2.5 h-5 w-5 text-gray-400" aria-hidden />
              <input
                type="email"
                inputMode="email"
                autoComplete="email"
                placeholder="Email"
                className="w-full pl-10 pr-3 py-2.5 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-green-500"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                aria-label="Email"
              />
            </div>

            <div className="relative">
              <Lock className="absolute left-3 top-2.5 h-5 w-5 text-gray-400" aria-hidden />
              <input
                type={showPassword ? "text" : "password"}
                autoComplete="current-password"
                placeholder="Password"
                className="w-full pl-10 pr-10 py-2.5 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-green-500"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                aria-label="Password"
              />
              <button
                type="button"
                onClick={() => setShowPassword((s) => !s)}
                className="absolute right-3 top-2.5 p-1 text-gray-400 hover:text-gray-600"
                aria-label={showPassword ? "Hide password" : "Show password"}
              >
                {showPassword ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}
              </button>
            </div>

            {error && (
              <div className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full inline-flex items-center justify-center bg-green-600 text-white py-2.5 rounded-lg hover:bg-green-700 disabled:opacity-70 disabled:cursor-not-allowed transition"
            >
              {loading ? "Logging in…" : "Log In"}
            </button>
          </form>

          <div className="mt-4 flex flex-col items-center gap-3">
            <Link
              href="/forgot-password"
              className="text-sm text-green-700 hover:underline"
            >
              Forgot Password?
            </Link>

            {/* Preserve ?next= for signup path too */}
            <Link href={`/signup${next ? `?next=${encodeURIComponent(next)}` : ""}`} className="w-full">
              <button
                type="button"
                className="w-full border border-gray-300 text-gray-800 py-2.5 rounded-lg hover:bg-gray-50 transition"
              >
                Create an account
              </button>
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
