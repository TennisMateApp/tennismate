"use client";

import { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { onAuthStateChanged, User } from "firebase/auth";
import { auth } from "@/lib/firebase"; // or "@/lib/firebaseConfig"

const PUBLIC_ROUTES = new Set<string>([
  "/login",
  "/signup",
  "/forgot-password",
  "/privacy",
  "/terms",
  "/verify-email", // 👈 treat verify page as public
]);

export default function AuthGate({ children }: { children: React.ReactNode }) {
  const [ready, setReady] = useState(false);
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const pathname = usePathname() || "/";
  const router = useRouter();

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (u) => {
      setCurrentUser(u);
      setReady(true);

      // 🔓 1) Not signed in → force to /login unless already on a public route
      if (!u) {
        if (!PUBLIC_ROUTES.has(pathname)) {
          const next = pathname === "/" ? "/home" : pathname; // where to go after login
          router.replace(`/login?next=${encodeURIComponent(next)}`);
        }
        return;
      }

      // 🔐 2) Signed in but NOT email-verified → always send to /verify-email
      // (matches your LayoutWrapper logic so unverified users never see /home)
      if (!u.emailVerified) {
        if (pathname !== "/verify-email") {
          router.replace("/verify-email");
        }
        return;
      }

      // ✅ 3) Signed in + verified:
      // If they're on auth screens, send to /home instead
      const isAuthScreen =
        pathname === "/" || pathname === "/login" || pathname === "/signup";

      if (isAuthScreen) {
        router.replace("/home");
      }
    });

    return () => unsub();
  }, [pathname, router]);

  // Minimal splash to prevent UI flicker before we know the auth state
  if (!ready) {
    return (
      <div className="flex h-dvh items-center justify-center">
        <div className="text-sm opacity-70">Loading…</div>
      </div>
    );
  }

  return <>{children}</>;
}
