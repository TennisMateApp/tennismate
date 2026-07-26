"use client";

import { useParams } from "next/navigation";
import withAuth from "@/components/withAuth";
import ClubMembersPage from "@/components/clubs/ClubMembersPage";

function ClubMembersRoute() {
  const params = useParams<{ id: string }>();
  const courtId = typeof params?.id === "string" ? params.id : "";
  return courtId ? <ClubMembersPage courtId={courtId} /> : null;
}

export default withAuth(ClubMembersRoute);
