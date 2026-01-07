"use client";

import { useEffect } from "react";
import { getAnalyticsIfSupported } from "@/lib/firebaseConfig";
import { logEvent } from "firebase/analytics";

export default function AnalyticsSmokeTest() {
  useEffect(() => {
    (async () => {
      const analytics = await getAnalyticsIfSupported();
      if (!analytics) return;

      logEvent(analytics, "analytics_smoke_test");
    })();
  }, []);

  return null;
}
