"use client";

import { useRouter } from "next/navigation";
import { MapPin } from "lucide-react";
import { signOut } from "firebase/auth";

import { auth } from "@/lib/firebaseConfig";

export default function WaitlistPage() {
  const router = useRouter();
  return (
    <main className="min-h-screen grid place-items-center bg-[#f5f5f0] p-5">
      <section className="w-full max-w-md rounded-2xl bg-white p-7 text-center shadow-sm ring-1 ring-black/5">
        <div className="mx-auto grid h-14 w-14 place-items-center rounded-full bg-green-100 text-green-800">
          <MapPin className="h-7 w-7" />
        </div>
        <h1 className="mt-5 text-2xl font-semibold text-gray-950">You're on the TennisMate waitlist</h1>
        <p className="mt-3 text-sm leading-relaxed text-gray-600">
          TennisMate currently supports Victoria and New South Wales. We saved your interest and will let you know when your area is available.
        </p>
        <button
          onClick={async () => { await signOut(auth); router.replace("/login"); }}
          className="mt-6 min-h-11 rounded-xl border border-gray-200 px-4 py-2.5 text-sm font-semibold text-gray-700"
        >
          Sign out
        </button>
      </section>
    </main>
  );
}
