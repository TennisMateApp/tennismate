"use client";

import { useParams } from "next/navigation";
import withAuth from "@/components/withAuth";
import ClubProfilePage from "@/components/clubs/ClubProfilePage";

function ClubProfileRoute() {
  const params = useParams<{ id: string }>();
  const courtId = typeof params?.id === "string" ? params.id : "";
  return courtId ? <ClubProfilePage courtId={courtId} /> : null;
}

export default withAuth(ClubProfileRoute);
