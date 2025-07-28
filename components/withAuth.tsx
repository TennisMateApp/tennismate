"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { onAuthStateChanged } from "firebase/auth";
import { auth } from "@/lib/firebase";
import type { ComponentType } from "react";

// This wrapper ensures lazy/dynamic components work properly
export default function withAuth<T extends object>(WrappedComponent: ComponentType<T>) {
  const ProtectedComponent = (props: T) => {
    const router = useRouter();
    const [loading, setLoading] = useState(true);
    const [isAuthenticated, setIsAuthenticated] = useState(false);

    useEffect(() => {
      const unsubscribe = onAuthStateChanged(auth, (user) => {
        if (user) {
          setIsAuthenticated(true);
          setLoading(false);
        } else {
          router.push("/login");
        }
      });

      return () => unsubscribe();
    }, [router]);

    if (loading) {
      return <p>Loading...</p>; // You can replace this with a spinner later
    }

    if (!isAuthenticated) {
      return null; // Don’t render anything until auth is confirmed
    }

    return <WrappedComponent {...props} />;
  };

  // Preserve display name for better dev tools/debugging
  ProtectedComponent.displayName = `withAuth(${
    WrappedComponent.displayName || WrappedComponent.name || "Component"
  })`;

  return ProtectedComponent;
}
