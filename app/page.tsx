"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { onAuthStateChanged } from "firebase/auth";
import { auth } from "@/lib/firebaseConfig";

export default function HomeRedirect() {
  const router = useRouter();
  const [authReady, setAuthReady] = useState(false);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (user) => {
      setAuthReady(true);
      router.replace(user ? "/home" : "/login");
    });

    return () => unsub();
  }, [router]);

  return (
    <div className="flex h-dvh items-center justify-center">
      <div className="text-sm opacity-70">
        {authReady ? "Redirecting..." : "Loading..."}
      </div>
    </div>
  );
}
