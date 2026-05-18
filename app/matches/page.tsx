import { Suspense } from "react";

import MatchesPageClient from "./MatchesPageClient";

export default function MatchesPage() {
  return (
    <Suspense fallback={null}>
      <MatchesPageClient />
    </Suspense>
  );
}
