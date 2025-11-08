// app/version/page.tsx
import React from "react";

// Server component: read the Next.js BUILD_ID by HTTP (works on Vercel)
async function getBuildId(): Promise<string> {
  try {
    const res = await fetch(`${process.env.NEXT_PUBLIC_SITE_ORIGIN ?? ""}/_next/static/BUILD_ID`, {
      // In case you didn't set NEXT_PUBLIC_SITE_ORIGIN, the relative path still works at runtime.
      // At build-time this may be empty; that's fine—the client widget below also shows it.
      cache: "no-store",
    });
    const txt = await res.text();
    return txt.trim();
  } catch {
    return "unknown";
  }
}

// Vercel injects these at build time (expose commit via NEXT_PUBLIC if you want it in the client too)
const COMMIT = process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) || "unknown";
const DEPLOYMENT = process.env.VERCEL_DEPLOYMENT_ID || "unknown";
const BRANCH = process.env.VERCEL_GIT_COMMIT_REF || "unknown";

export default async function VersionPage() {
  const buildId = await getBuildId();
  return (
    <div className="mx-auto max-w-xl p-6 space-y-6">
      <h1 className="text-2xl font-bold">TennisMate Version</h1>

      <div className="rounded-lg border p-4 text-sm">
        <div><span className="font-semibold">Next BUILD_ID:</span> <code>{buildId}</code></div>
        <div><span className="font-semibold">Commit:</span> <code>{COMMIT}</code></div>
        <div><span className="font-semibold">Branch:</span> <code>{BRANCH}</code></div>
        <div><span className="font-semibold">Deployment:</span> <code>{DEPLOYMENT}</code></div>
      </div>

      {/* Client-side runtime info */}
      <RuntimeDiagnostics />
    </div>
  );
}

// Inline client widget (kept in this file for speed)
function RuntimeDiagnostics() {
  // mark as client
  // @ts-expect-error - next compiles this file as a server component; we inline a small client widget below
  return <ClientRuntime />;
}
