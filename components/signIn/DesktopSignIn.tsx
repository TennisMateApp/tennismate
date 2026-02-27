"use client";

import Image from "next/image";
import Link from "next/link";
import { Mail, Lock, Eye, EyeOff } from "lucide-react";

type DesktopSignInProps = {
  email: string;
  setEmail: (v: string) => void;
  password: string;
  setPassword: (v: string) => void;
  showPassword: boolean;
  setShowPassword: (v: boolean | ((prev: boolean) => boolean)) => void;
  loading: boolean;
  error: string;
  onSubmit: (e: React.FormEvent) => void;
  forgotHref: string;
  signupHref: string;
};

export default function DesktopSignIn({
  email,
  setEmail,
  password,
  setPassword,
  showPassword,
  setShowPassword,
  loading,
  error,
  onSubmit,
  forgotHref,
  signupHref,
}: DesktopSignInProps) {
  return (
    <div className="h-[100dvh] w-full overflow-hidden bg-[#F6F6F4]">
      <div className="grid h-full grid-cols-2">
        {/* LEFT: image panel */}
        <div className="relative">
          <Image
            src="/images/login-tennis-court.jpg"
            alt=""
            fill
            priority
            className="object-cover"
          />
          <div className="absolute inset-0 bg-black/35" />

          <div className="absolute bottom-10 left-10 right-10">
            <h2 className="text-white text-4xl font-extrabold tracking-tight">
              Elevate your game.
            </h2>
            <p className="mt-3 max-w-md text-white/90 text-sm leading-6">
              Join the community of tennis enthusiasts and find your perfect hitting partner today.
            </p>
          </div>
        </div>

        {/* RIGHT: form panel */}
        <div className="flex items-center justify-center px-10">
          <div className="w-full max-w-md">
            {/* brand row */}
            <div className="flex items-center gap-3">
              <div className="relative h-10 w-10 rounded-xl overflow-hidden bg-white shadow-sm">
                <Image
                  src="/logo.png"
                  alt="TennisMate"
                  fill
                  priority
                  className="object-cover"
                />
              </div>

              <div>
                <div className="font-semibold text-gray-900">TennisMate</div>
                <div className="text-xs text-gray-500">
                  Find your next match and play better together.
                </div>
              </div>
            </div>

            <h1 className="mt-10 text-3xl font-extrabold text-gray-900">
              Welcome Back
            </h1>
            <p className="mt-2 text-sm text-gray-500">
              Please enter your details to sign in.
            </p>

            <form onSubmit={onSubmit} className="mt-8 space-y-5">
              {/* Email */}
              <div>
                <label className="block text-xs font-semibold text-gray-800 mb-2">
                  Email
                </label>
                <div className="relative">
                  <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
                  <input
                    type="email"
                    inputMode="email"
                    autoComplete="email"
                    placeholder="name@example.com"
                    className="w-full h-11 rounded-xl border border-gray-200 bg-white pl-10 pr-3 text-sm text-gray-900 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-[#39FF14]/40 focus:border-[#39FF14]"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    required
                  />
                </div>
              </div>

              {/* Password */}
              <div>
                <label className="block text-xs font-semibold text-gray-800 mb-2">
                  Password
                </label>
                <div className="relative">
                  <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
                  <input
                    type={showPassword ? "text" : "password"}
                    autoComplete="current-password"
                    placeholder="••••••••"
                    className="w-full h-11 rounded-xl border border-gray-200 bg-white pl-10 pr-10 text-sm text-gray-900 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-[#39FF14]/40 focus:border-[#39FF14]"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((s) => !s)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 p-1 text-gray-400 hover:text-gray-600"
                    aria-label={showPassword ? "Hide password" : "Show password"}
                  >
                    {showPassword ? (
                      <EyeOff className="h-4 w-4" />
                    ) : (
                      <Eye className="h-4 w-4" />
                    )}
                  </button>
                </div>

                <div className="mt-2 flex justify-end">
                  <Link
                    href={forgotHref}
                    className="text-xs font-semibold text-gray-900 hover:underline"
                  >
                    Forgot Password?
                  </Link>
                </div>
              </div>

              {/* Error */}
              {error && (
                <div className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-xl px-3 py-2">
                  {error}
                </div>
              )}

              {/* Sign in button */}
              <button
                type="submit"
                disabled={loading}
                className="w-full h-11 rounded-xl bg-[#39FF14] text-gray-900 font-semibold shadow-md hover:brightness-95 active:brightness-90 disabled:opacity-70 disabled:cursor-not-allowed transition"
              >
                {loading ? "Signing in…" : "Sign In"}
              </button>

              {/* Footer */}
              <p className="text-center text-xs text-gray-500 pt-1">
                Don&apos;t have an account?{" "}
                <Link
                  href={signupHref}
                  className="font-semibold text-gray-900 hover:underline"
                >
                  Sign Up
                </Link>
              </p>
            </form>
          </div>
        </div>
      </div>
    </div>
  );
}