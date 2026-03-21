"use client";

import { useParams } from "next/navigation";
import { useEffect } from "react";
import withAuth from "@/components/withAuth";
import PlayerProfileView from "@/components/players/PlayerProfileView";
import { trackEvent } from "@/lib/mixpanel";

function PublicProfilePage() {
  const { id } = useParams();

  useEffect(() => {
    if (!id) return;

    trackEvent("player_profile_viewed", {
      viewedUserId: id,
    });
  }, [id]);

  if (!id) return null;

  return <PlayerProfileView playerId={id as string} />;
}

export default withAuth(PublicProfilePage);