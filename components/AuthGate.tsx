"use client";

import { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { onAuthStateChanged, User } from "firebase/auth";
import { doc, getDoc } from "firebase/firestore";
import { auth } from "@/lib/firebase";
import { db } from "@/lib/firebaseConfig";
import { isOnboardingV2Destination, onboardingV2Href, ONBOARDING_V2_PATH } from "@/lib/onboardingV2";

const PUBLIC_ROUTES = new Set<string>([
  "/login",
  "/signup",
  "/forgot-password",
  "/privacy",
  "/terms",
  "/verify-email",
  "/verify-complete",
  "/verified",
  ONBOARDING_V2_PATH,
]);

const ONBOARDING_GATE_EXEMPT_ROUTES = new Set<string>([
  "/login",
  "/forgot-password",
  "/privacy",
  "/terms",
  "/verify-email",
  "/verify-complete",
  "/verified",
  "/waitlist",
  ONBOARDING_V2_PATH,
]);

export default function AuthGate({ children }: { children: React.ReactNode }) {
  const [authReady, setAuthReady] = useState(false);
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [onboardingComplete, setOnboardingComplete] = useState<boolean | null>(null);
  const [onboardingCheckedUid, setOnboardingCheckedUid] = useState<string | null>(null);
  const pathname = usePathname() || "/";
  const router = useRouter();
  const isStandaloneVerificationRoute =
    pathname === "/verify-complete" || pathname === "/verified";

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (u) => {
      setCurrentUser(u);
      setAuthReady(true);
    });

    return () => unsub();
  }, []);

  useEffect(() => {
    let cancelled = false;
    if (!authReady || !currentUser?.emailVerified || ONBOARDING_GATE_EXEMPT_ROUTES.has(pathname)) {
      setOnboardingComplete(null);
      setOnboardingCheckedUid(null);
      return;
    }

    setOnboardingComplete(null);
    setOnboardingCheckedUid(null);
    void getDoc(doc(db, "players", currentUser.uid))
      .then((snapshot) => {
        if (cancelled) return;
        const complete = snapshot.exists() && snapshot.data().profileComplete === true;
        setOnboardingComplete(complete);
        setOnboardingCheckedUid(currentUser.uid);
        if (!complete) {
          const next = pathname === "/" || pathname === "/signup" ? "/home" : pathname;
          router.replace(onboardingV2Href({next}));
        }
      })
      .catch(() => {
        if (!cancelled) {
          setOnboardingComplete(false);
          setOnboardingCheckedUid(currentUser.uid);
          const next = pathname === "/" || pathname === "/signup" ? "/home" : pathname;
          router.replace(onboardingV2Href({next}));
        }
      });

    return () => { cancelled = true; };
  }, [authReady, currentUser, pathname, router]);

  useEffect(() => {
    if (!authReady) return;

    if (!currentUser) {
      if (!PUBLIC_ROUTES.has(pathname) && pathname !== "/") {
        router.replace(`/login?next=${encodeURIComponent(pathname)}`);
      }
      return;
    }

    if (!currentUser.emailVerified) {
      const canFinishAuthAction = pathname === "/verify-complete";
      const canFinishSignupInitialization = pathname === "/signup";
      const loginResumeDestination =
        pathname === "/login" && typeof window !== "undefined"
          ? new URL(window.location.href).searchParams.get("next")
          : null;
      const canUseOnboardingV2 =
        pathname === ONBOARDING_V2_PATH ||
        isOnboardingV2Destination(loginResumeDestination);
      if (!canFinishAuthAction && !canFinishSignupInitialization && !canUseOnboardingV2 && pathname !== "/verify-email") {
        router.replace(`/verify-email?next=${encodeURIComponent(pathname)}`);
      }
      return;
    }

    const isAuthScreen = pathname === "/" || pathname === "/signup";

    if (isAuthScreen && onboardingCheckedUid === currentUser.uid && onboardingComplete === true) {
      router.replace("/home");
    }
  }, [authReady, currentUser, onboardingCheckedUid, onboardingComplete, pathname, router]);

  if (isStandaloneVerificationRoute) return <>{children}</>;

  if (!authReady) {
    return (
      <div className="flex h-dvh items-center justify-center">
        <div className="text-sm opacity-70">Loading...</div>
      </div>
    );
  }

  const mustResolveOnboarding = Boolean(
    currentUser?.emailVerified &&
    !ONBOARDING_GATE_EXEMPT_ROUTES.has(pathname) &&
    (onboardingCheckedUid !== currentUser.uid || onboardingComplete !== true)
  );
  if (mustResolveOnboarding) {
    return (
      <div className="flex h-dvh items-center justify-center">
        <div className="text-sm opacity-70">Loading...</div>
      </div>
    );
  }

  return <>{children}</>;
}
