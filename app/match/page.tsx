import { Suspense } from "react";

import MatchClient from "./MatchClient";

export default function MatchPage() {
  return (
    <Suspense fallback={null}>
      <MatchClient />
    </Suspense>
  );
}
