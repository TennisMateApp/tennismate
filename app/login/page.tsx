"use client";

import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Image from "next/image";
import Link from "next/link";
import { Mail, Lock, Eye, EyeOff } from "lucide-react";

import {
  signInWithEmailAndPassword,
  onAuthStateChanged,
  GoogleAuthProvider,
  signInWithCredential,
  signInWithPopup,
} from "firebase/auth";

import { auth, db } from "@/lib/firebaseConfig";

import { Capacitor } from "@capacitor/core";
import { GoogleAuth } from "@codetrix-studio/capacitor-google-auth";
import { doc, setDoc, serverTimestamp } from "firebase/firestore";
import dynamic from "next/dynamic";

const DesktopSignIn = dynamic(
  () => import("../../components/signIn/DesktopSignIn").then((m) => m.default),
  { ssr: false }
);


export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);

  const [isDesktop, setIsDesktop] = useState(false);

useEffect(() => {
  // Tailwind "lg" breakpoint (desktop)
  const mq = window.matchMedia("(min-width: 1024px)");

  const apply = () => setIsDesktop(mq.matches);
  apply();

  mq.addEventListener?.("change", apply);
  return () => mq.removeEventListener?.("change", apply);
}, []);

useEffect(() => {
  const prevBodyOverflow = document.body.style.overflow;
  const prevHtmlOverflow = document.documentElement.style.overflow;

  document.body.style.overflow = "hidden";
  document.documentElement.style.overflow = "hidden";

  return () => {
    document.body.style.overflow = prevBodyOverflow;
    document.documentElement.style.overflow = prevHtmlOverflow;
  };
}, []);

  const router = useRouter();
  const searchParams = useSearchParams();
  const next = searchParams?.get("next") || "/home";
  const isNative = Capacitor.isNativePlatform();

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

  // Kept (functionality preserved), but NOT rendered in UI per your request
  const handleGoogleSignIn = async () => {
    setError("");
    setLoading(true);

    try {
      if (Capacitor.isNativePlatform()) {
        const res = await GoogleAuth.signIn();
        const idToken = res.authentication?.idToken;
        if (!idToken) throw new Error("Missing Google idToken");

        const credential = GoogleAuthProvider.credential(idToken);
        await signInWithCredential(auth, credential);
      } else {
        const provider = new GoogleAuthProvider();
        provider.setCustomParameters({ prompt: "select_account" });
        await signInWithPopup(auth, provider);
      }

      await auth.currentUser?.reload();

      const u = auth.currentUser;
      if (!u) throw new Error("No Firebase user after Google sign-in");

      const rawPhoto =
        u.providerData?.find((p) => p.providerId === "google.com")?.photoURL ||
        u.photoURL ||
        "";

      const fixedPhotoURL = rawPhoto
        ? rawPhoto.replace(/=s\d+(-c)?$/, "=s256-c")
        : "";

      await setDoc(
        doc(db, "players", u.uid),
        {
          name: u.displayName || "",
          googlePhotoURL: fixedPhotoURL,
          photoURL: "",
          profileComplete: false,
          timestamp: serverTimestamp(),
        },
        { merge: true }
      );

      await setDoc(
        doc(db, "players_private", u.uid),
        {
          email: u.email || "",
          updatedAt: serverTimestamp(),
        },
        { merge: true }
      );

      console.log("[PROFILE REDIRECT DEBUG]", {
        source: "LoginPage",
        reason: "google sign-in created or merged player shell with profileComplete false",
        pathname: "/login",
        uid: u.uid,
        playerExists: true,
        profileComplete: false,
        birthYear: null,
      });
      console.trace("[PROFILE REDIRECT TRACE]", {
        source: "LoginPage",
        pathname: "/login",
        target: "/profile?edit=true",
        uid: u.uid,
        profileGateReady: null,
        playerExists: true,
        profileComplete: false,
        usableProfile: false,
        playerData: null,
        authReady: true,
        loadingState: "google-sign-in-onboarding",
        timestamp: new Date().toISOString(),
      });
      router.replace("/profile?edit=true");
    } catch (err: any) {
      console.error("Google sign-in failed:", err);

      const msg =
        err?.message ||
        err?.errorMessage ||
        (typeof err === "string" ? err : "") ||
        JSON.stringify(err);

      setError(`Google sign-in failed: ${msg}`);
    } finally {
      setLoading(false);
    }
  };

  const forgotHref = "/forgot-password";
const signupHref = `/signup${next ? `?next=${encodeURIComponent(next)}` : ""}`;


if (isDesktop) {
  return (
    <DesktopSignIn
      email={email}
      setEmail={setEmail}
      password={password}
      setPassword={setPassword}
      showPassword={showPassword}
      setShowPassword={setShowPassword}
      loading={loading}
      error={error}
      onSubmit={handleSubmit}
      forgotHref={forgotHref}
      signupHref={signupHref}
    />
  );
}

return (
    <div className="fixed inset-0 overflow-hidden bg-black">
    {/* Background */}
    <div className="absolute inset-0 z-0">
      <Image
        src="/images/login-tennis-court.jpg"
        alt=""
        fill
        priority
        className="object-cover"
      />
      <div className="absolute inset-0 bg-black/55" />
    </div>

    {/* Content */}
    <div className="relative z-10 h-full w-full flex items-center justify-center px-4">
      <div className="w-full max-w-sm">
        {/* Logo */}
        <div className="flex justify-center mb-8">
          <div className="h-28 w-28 rounded-full bg-white/20 ring-8 ring-white/30 backdrop-blur-md shadow-lg flex items-center justify-center">
            <div className="relative h-24 w-24 rounded-full overflow-hidden bg-white">
              <Image
                src="/logo.png"
                alt="TennisMate"
                fill
                priority
                className="object-cover"
              />
            </div>
          </div>
        </div>

        {/* Headings */}
        <h1 className="text-center text-2xl font-semibold text-white">
          TennisMate
        </h1>
        <h2 className="text-center text-2xl font-semibold text-white mt-4">
          Welcome Back
        </h2>
        <p className="text-center text-sm text-gray-200 mt-2">
          Sign in to find your next match
        </p>

        {/* Card */}
        <div className="mt-6 rounded-2xl bg-white/95 backdrop-blur-md border border-white/20 shadow-2xl p-5">
          <form onSubmit={handleSubmit} className="space-y-4">
            {/* Email */}
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">
                Email
              </label>
              <div className="relative">
                <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
                <input
                  type="email"
                  inputMode="email"
                  autoComplete="email"
                  placeholder="Enter your email"
                  className="w-full h-11 rounded-xl border border-gray-200 bg-white pl-10 pr-3 text-sm text-gray-900 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-[#39FF14]/40 focus:border-[#39FF14]"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                />
              </div>
            </div>

            {/* Password */}
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">
                Password
              </label>
              <div className="relative">
                <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
                <input
                  type={showPassword ? "text" : "password"}
                  autoComplete="current-password"
                  placeholder="Enter your password"
                  className="w-full h-11 rounded-xl border border-gray-200 bg-white pl-10 pr-10 text-sm text-gray-900 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-[#39FF14]/40 focus:border-[#39FF14]"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((s) => !s)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 p-1 text-gray-400 hover:text-gray-600"
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
                  href="/forgot-password"
                  className="text-xs font-medium text-[#39FF14] hover:underline"
                >
                  Forgot Password?
                </Link>
              </div>
            </div>

            {error && (
              <div className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-xl px-3 py-2">
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full h-11 rounded-xl bg-[#39FF14] text-gray-900 font-semibold shadow-md hover:brightness-95 active:brightness-90 disabled:opacity-70 disabled:cursor-not-allowed transition"
            >
              {loading ? "Signing in…" : "Sign In"}
            </button>

            <p className="text-center text-xs text-gray-500 pt-2">
              Don&apos;t have an account?{" "}
              <Link
                href={`/signup${next ? `?next=${encodeURIComponent(next)}` : ""}`}
                className="font-semibold text-[#39FF14] hover:underline"
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
