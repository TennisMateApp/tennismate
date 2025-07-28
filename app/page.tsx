// app/page.tsx
"use client";
import { useEffect } from "react";
import { useRouter } from "next/navigation";

export default function HomeRedirect() {
  const router = useRouter();

  useEffect(() => {
    router.replace("/directory"); // 👈 default route if app loads at "/"
  }, [router]);

  return null;
}
