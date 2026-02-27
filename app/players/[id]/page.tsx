"use client";

import { useParams } from "next/navigation";
import withAuth from "@/components/withAuth";
import PlayerProfileView from "@/components/players/PlayerProfileView";

function PublicProfilePage() {
  const { id } = useParams();
  if (!id) return null;

  return <PlayerProfileView playerId={id as string} />;
}

export default withAuth(PublicProfilePage);
