// app/version/page.tsx
import dynamic from "next/dynamic";

// ✅ Lazy-load the client widget only on the client
const ClientRuntime = dynamic(() => import("./ClientRuntime"), { ssr: false });

async function getBuildId(): Promise<string> {
  try {
    const res = await fetch(`${process.env.NEXT_PUBLIC_SITE_ORIGIN ?? ""}/_next/static/BUILD_ID`, {
      cache: "no-store",
    });
    return (await res.text()).trim();
  } catch {
    return "unknown";
  }
}

const COMMIT = process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) || "unknown";
const DEPLOYMENT = process.env.VERCEL_DEPLOYMENT_ID || "unknown";
const BRANCH = process.env.VERCEL_GIT_COMMIT_REF || "unknown";

export default async function VersionPage() {
  const buildId = await getBuildId();

  return (
    <div className="mx-auto max-w-xl p-6 space-y-6">
      <h1 className="text-2xl font-bold">TennisMate Version</h1>

      <div className="rounded-lg border p-4 text-sm space-y-1">
        <div><span className="font-semibold">Next BUILD_ID:</span> <code>{buildId}</code></div>
        <div><span className="font-semibold">Commit:</span> <code>{COMMIT}</code></div>
        <div><span className="font-semibold">Branch:</span> <code>{BRANCH}</code></div>
        <div><span className="font-semibold">Deployment:</span> <code>{DEPLOYMENT}</code></div>
      </div>

      <ClientRuntime />
    </div>
  );
}
