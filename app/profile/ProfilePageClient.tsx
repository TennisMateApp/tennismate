"use client";

import { useState } from "react";
import { useSearchParams } from "next/navigation";
import ProfileContent from "./ProfileContent";
import { useIsDesktop } from "@/lib/useIsDesktop";
import DesktopProfilePage, { type ProfileData } from "@/components/profile/DesktopProfilePage";
import DesktopProfileEditPage from "./DesktopProfileEditPage";

export default function ProfilePage() {
  const searchParams = useSearchParams();
  const isDesktop = useIsDesktop();
  const editMode = searchParams.get("edit") === "true";
  const [savedDesktopProfile, setSavedDesktopProfile] = useState<ProfileData | null>(null);

  console.log("[ProfilePage] render start", {
    isDesktop,
    editMode,
    search: searchParams.toString(),
  });

  if (isDesktop && editMode) {
    return <DesktopProfileEditPage onProfileSaved={setSavedDesktopProfile} />;
  }
  if (isDesktop && !editMode) {
    return <DesktopProfilePage initialProfile={savedDesktopProfile} />;
  }

  return <ProfileContent />;
}
