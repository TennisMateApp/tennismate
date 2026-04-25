"use client";

import { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { onAuthStateChanged, User } from "firebase/auth";
import { auth } from "@/lib/firebase";

const PUBLIC_ROUTES = new Set<string>([
  "/login",
  "/signup",
  "/forgot-password",
  "/privacy",
  "/terms",
  "/verify-email",
]);

export default function AuthGate({ children }: { children: React.ReactNode }) {
  const [authReady, setAuthReady] = useState(false);
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const pathname = usePathname() || "/";
  const router = useRouter();

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (u) => {
      setCurrentUser(u);
      setAuthReady(true);
    });

    return () => unsub();
  }, []);

  useEffect(() => {
    if (!authReady) return;

    if (!currentUser) {
      if (!PUBLIC_ROUTES.has(pathname) && pathname !== "/") {
        router.replace(`/login?next=${encodeURIComponent(pathname)}`);
      }
      return;
    }

    if (!currentUser.emailVerified) {
      if (pathname !== "/verify-email") {
        router.replace("/verify-email");
      }
      return;
    }

    const isAuthScreen =
      pathname === "/" || pathname === "/login" || pathname === "/signup";

    if (isAuthScreen) {
      router.replace("/home");
    }
  }, [authReady, currentUser, pathname, router]);

  if (!authReady) {
    return (
      <div className="flex h-dvh items-center justify-center">
        <div className="text-sm opacity-70">Loading...</div>
      </div>
    );
  }

  return <>{children}</>;
}
