// app/r/[code]/route.ts
import { NextResponse } from "next/server";

export function GET(
  req: Request,
  { params }: { params: { code: string } }
) {
  const code = (params.code ?? "").toUpperCase().trim();

  // Redirect to signup carrying the code in the URL
  const url = new URL(`/signup?rc=${encodeURIComponent(code)}`, req.url);
  const res = NextResponse.redirect(url);

  // Also drop a 30-day cookie so signup can read it
  res.cookies.set({
    name: "referral_code",
    value: code,
    maxAge: 60 * 60 * 24 * 30,
    path: "/",
    sameSite: "lax",
  });

  return res;
}
