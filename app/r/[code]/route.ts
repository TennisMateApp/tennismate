// app/r/[code]/route.ts
import { NextResponse } from "next/server";

export function GET(req: Request) {
  const { pathname } = new URL(req.url);
  const segs = pathname.split("/");
  const code = (segs[segs.length - 1] || "").toUpperCase().trim();

  const url = new URL(`/signup?rc=${encodeURIComponent(code)}`, req.url);
  const res = NextResponse.redirect(url);

  // 30-day cookie for signup to read
  res.cookies.set({
    name: "referral_code",
    value: code,
    maxAge: 60 * 60 * 24 * 30,
    path: "/",
    sameSite: "lax",
  });

  return res;
}
