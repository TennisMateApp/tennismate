// app/r/[code]/page.tsx
import { cookies } from "next/headers";
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

export default async function ReferralPage({
  params,
}: {
  params: Promise<{ code: string }>;
}) {
  const { code } = await params;

  const normalized = (code || "").toUpperCase().trim();

  cookies().set("referral_code", normalized, {
    path: "/",
    maxAge: 60 * 60 * 24 * 30, // 30 days
    sameSite: "lax",
  });

  redirect(`/signup?rc=${encodeURIComponent(normalized)}`);
}
