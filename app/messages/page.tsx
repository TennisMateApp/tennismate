import { Suspense } from "react";

import MessagesClient from "./MessagesClient";

export default function MessagesPage() {
  return (
    <Suspense fallback={null}>
      <MessagesClient />
    </Suspense>
  );
}
