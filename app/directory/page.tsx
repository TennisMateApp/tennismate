"use client";
export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";

import nextDynamic from "next/dynamic";

// ✅ Import the wrapped component instead of wrapping here
const ProtectedDirectoryPage = nextDynamic(
  () => import("@/components/ProtectedDirectoryPage").then((mod) => ({ default: mod.default })),
  { ssr: false }
);

export default ProtectedDirectoryPage;
