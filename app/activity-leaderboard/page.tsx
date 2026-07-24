import {Suspense} from "react";
import ActivityLeaderboardClient from "./ActivityLeaderboardClient";

export const metadata = {
  title: "Activity Leaderboard | TennisMate",
  description: "Monthly TennisMate activity rankings.",
};

export default function ActivityLeaderboardPage() {
  return <Suspense fallback={null}><ActivityLeaderboardClient /></Suspense>;
}
