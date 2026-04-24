"use client";

import { useSearchParams } from "next/navigation";
import ProfileContent from "./ProfileContent";
import { useIsDesktop } from "@/lib/useIsDesktop";
import DesktopProfilePage from "@/components/profile/DesktopProfilePage";
import DesktopProfileEditPage from "./DesktopProfileEditPage";

export default function ProfilePage() {
  const searchParams = useSearchParams();
  const isDesktop = useIsDesktop();
  const editMode = searchParams.get("edit") === "true";

  console.log("[ProfilePage] render start", {
    isDesktop,
    editMode,
    search: searchParams.toString(),
  });

  if (isDesktop && editMode) return <DesktopProfileEditPage />;
  if (isDesktop && !editMode) return <DesktopProfilePage />;

  return <ProfileContent />;
}
