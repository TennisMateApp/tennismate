import Image from "next/image";
import {CheckCircle2} from "lucide-react";

export default function VerifyCompletePage() {
  return (
    <main className="grid min-h-dvh place-items-center bg-[#f5f5f0] px-5 py-[max(2rem,env(safe-area-inset-top))]">
      <section
        className="w-full max-w-md rounded-2xl bg-white p-7 text-center shadow-sm ring-1 ring-black/5"
        aria-labelledby="verification-complete-heading"
      >
        <div className="flex items-center justify-center gap-2">
          <Image src="/logo.png" alt="" width={36} height={36} className="rounded-full" priority />
          <span className="text-lg font-semibold text-[#0B3D2E]">TennisMate</span>
        </div>
        <div className="mx-auto mt-7 grid h-14 w-14 place-items-center rounded-full bg-emerald-100 text-emerald-700">
          <CheckCircle2 className="h-7 w-7" aria-hidden="true" />
        </div>
        <h1 id="verification-complete-heading" className="mt-5 text-2xl font-semibold text-slate-950">
          Email verified
        </h1>
        <p className="mt-2 text-sm leading-6 text-slate-600">
          Your account has been verified successfully.
        </p>
        <p className="mt-2 text-sm leading-6 text-slate-600">
          Please return to the TennisMate app to continue.
        </p>
      </section>
    </main>
  );
}
