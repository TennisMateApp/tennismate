import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

export async function GET(
  req: NextRequest,
  { params }: { params: { code: string } }
) {
  const code = (params.code || "").toUpperCase().trim();

  // Redirect to signup with the code in the query string
  const url = new URL(`/signup?rc=${encodeURIComponent(code)}`, req.url);
  const res = NextResponse.redirect(url);

  // Also drop a cookie for 30 days so we still have the code later
  res.cookies.set("referral_code", code, {
    path: "/",
    maxAge: 60 * 60 * 24 * 30,
    sameSite: "lax",
  });

  return res;
}
