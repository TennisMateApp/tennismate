"use client";

import { useEffect } from "react";
import { analytics } from "@/lib/firebaseConfig";
import { logEvent } from "firebase/analytics";

export default function AnalyticsSmokeTest() {
  useEffect(() => {
    if (!analytics) {
      console.log("[GA] analytics not ready (null) - skipping test event");
      return;
    }

    console.log("[GA] logging test event: tennismate_analytics_test");
    logEvent(analytics, "tennismate_analytics_test", {
      source: "web",
      ts: Date.now(),
    });
  }, []);

  return null;
}
