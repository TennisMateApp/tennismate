// /app/profile/page.tsx
"use client";

import dynamic from "next/dynamic";
import { Suspense } from "react";

// Dynamically load the profile content component
const ProfileContent = dynamic(() => import("./ProfileContent"), { ssr: false });

export default function ProfilePageWrapper() {
  return (
    <Suspense fallback={<div className="p-6">Loading profile...</div>}>
      <ProfileContent />
    </Suspense>
  );
}
