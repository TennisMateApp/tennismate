// app/r/[code]/route.ts
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

export async function GET(
  req: NextRequest,
  { params }: { params: { code: string } }
) {
  const normalized = (params.code ?? "").toUpperCase().trim();

  const url = new URL(`/signup?rc=${encodeURIComponent(normalized)}`, req.url);
  const res = NextResponse.redirect(url);

  res.cookies.set({
    name: "referral_code",
    value: normalized,
    maxAge: 60 * 60 * 24 * 30,
    path: "/",
    sameSite: "lax",
  });

  return res;
}
