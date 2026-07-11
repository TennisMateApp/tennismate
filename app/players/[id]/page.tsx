"use client";

import { useParams } from "next/navigation";
import { useEffect } from "react";
import withAuth from "@/components/withAuth";
import PlayerProfileView from "@/components/players/PlayerProfileView";
import { trackEvent } from "@/lib/mixpanel";
import { trackEvent as trackAnalyticsEvent } from "@/lib/analytics";
import { ANALYTICS_EVENTS } from "@/lib/analyticsEvents";

function PublicProfilePage() {
  const { id } = useParams();

  useEffect(() => {
    if (!id) return;

    trackEvent("player_profile_viewed", {
      viewedUserId: id,
    });
    void trackAnalyticsEvent(ANALYTICS_EVENTS.PLAYER_PROFILE_VIEWED, {
      profile_source: "player_profile_route",
      distance_band: "unknown",
      skill_difference_band: "unknown",
      availability_overlap: false,
    });
  }, [id]);

  if (!id) return null;

  return <PlayerProfileView playerId={id as string} />;
}

export default withAuth(PublicProfilePage);
