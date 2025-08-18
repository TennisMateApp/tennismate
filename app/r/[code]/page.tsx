// app/r/[code]/route.ts
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

export async function GET(
  req: NextRequest,
  { params }: { params: { code: string } }
) {
  const raw = (params.code ?? "").toUpperCase().trim();
  const valid = /^[A-Z0-9]{5,12}$/.test(raw);

  // where to send them
  const dest = valid ? `/signup?rc=${raw}` : "/signup";
  const res = NextResponse.redirect(new URL(dest, req.url));

  // 30-day cookie so we can still read the code client-side
  if (valid) {
    res.cookies.set("referral_code", raw, {
      path: "/",
      sameSite: "lax",
      httpOnly: false,
      maxAge: 60 * 60 * 24 * 30,
    });
  }
  return res;
}
