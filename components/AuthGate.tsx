"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { onAuthStateChanged, type User } from "firebase/auth";
import { auth } from "@/lib/firebase"; // or "@/lib/firebaseConfig"

const PUBLIC_ROUTES = new Set<string>([
  "/login",
  "/signup",
  "/reset-password",
  "/privacy",
  "/terms",
  "/", // treat root as public so we can decide where to send the user
]);

// Optional: allowlist check so we don't redirect to external URLs via ?next=
function isSafeInternalPath(p?: string | null) {
  return !!p && p.startsWith("/") && !p.startsWith("//");
}

export default function AuthGate({ children }: { children: React.ReactNode }) {
  const [ready, setReady] = useState(false);
  const [currentUser, setCurrentUser] = useState<User | null>(null);

  const pathname = usePathname() || "/";
  const searchParams = useSearchParams();
  const router = useRouter();

  // Prevent multiple router.replace calls on the same render cycle
  const redirected = useRef(false);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (u) => {
      setCurrentUser(u);
      setReady(true);
    });
    return () => unsub();
  }, []);

  useEffect(() => {
    if (!ready || redirected.current) return;

    const user = currentUser;
    const isPublic = PUBLIC_ROUTES.has(pathname);
    const nextParam = searchParams?.get("next");
    const safeNext = isSafeInternalPath(nextParam) ? nextParam! : null;

    // 1) NOT signed in → always send to /login (with next=… if coming from a non-public page)
    if (!user) {
      if (!isPublic) {
        redirected.current = true;
        router.replace(`/login?next=${encodeURIComponent(pathname)}`);
        return;
      }
      // If they’re on "/" and not signed in, also push to /login
      if (pathname === "/") {
        redirected.current = true;
        router.replace("/login");
        return;
      }
      return; // already on a public route like /login, /signup, etc.
    }

    // 2) Signed in → if sitting on a public route (/, /login, /signup, /reset-password)
    //    send them to next (if provided) else /home.
    if (user && isPublic) {
      redirected.current = true;
      router.replace(safeNext || "/home");
      return;
    }
  }, [ready, currentUser, pathname, searchParams, router]);

  // Minimal splash to prevent flicker
  if (!ready) {
    return (
      <div className="flex h-dvh items-center justify-center">
        <div className="text-sm opacity-70">Loading…</div>
      </div>
    );
  }

  return <>{children}</>;
}
