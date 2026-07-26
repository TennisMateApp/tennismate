import Image from "next/image";
import { Suspense, type ReactNode } from "react";

function VerificationCheckingFallback() {
  return (
    <main className="grid min-h-dvh place-items-center bg-[#f5f5f0] px-5 py-[max(2rem,env(safe-area-inset-top))]">
      <section className="w-full max-w-md rounded-2xl bg-white p-7 text-center shadow-sm ring-1 ring-black/5" role="status">
        <div className="flex items-center justify-center gap-2">
          <Image src="/logo.png" alt="" width={36} height={36} className="rounded-full" priority />
          <span className="text-lg font-semibold text-[#0B3D2E]">TennisMate</span>
        </div>
        <div className="mx-auto mt-7 h-14 w-14 animate-pulse rounded-full bg-slate-100" aria-hidden="true" />
        <h1 className="mt-5 text-2xl font-semibold text-slate-950">Verifying your email…</h1>
        <p className="mt-2 text-sm leading-6 text-slate-600">This should only take a moment.</p>
      </section>
    </main>
  );
}

export default function VerifyCompleteLayout({ children }: { children: ReactNode }) {
  return <Suspense fallback={<VerificationCheckingFallback />}>{children}</Suspense>;
}

