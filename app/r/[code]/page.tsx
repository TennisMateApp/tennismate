// app/r/[code]/page.tsx
import { cookies } from "next/headers";
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic"; // ensure this is always handled on the server

export default function ReferralPage({ params }: { params: { code: string } }) {
  const code = (params.code || "").toUpperCase().trim();

  // 30 days cookie for referral tracking
  cookies().set("referral_code", code, {
    path: "/",
    maxAge: 60 * 60 * 24 * 30,
    sameSite: "lax",
  });

  // Prefer rc= for your signup reader
  redirect(`/signup?rc=${encodeURIComponent(code)}`);
}
