// app/r/[code]/route.ts
import { NextRequest, NextResponse } from "next/server";

export function GET(req: NextRequest) {
  const { pathname } = new URL(req.url);
  const segs = pathname.split("/");
  const code = (segs[segs.length - 1] || "").toUpperCase().trim();

  const url = new URL(`/signup?rc=${encodeURIComponent(code)}`, req.url);
  const res = NextResponse.redirect(url);

  // Preserve first-touch attribution instead of replacing it on later visits.
  if (!req.cookies.get("referral_code")?.value && code) {
    res.cookies.set({
      name: "referral_code",
      value: code,
      maxAge: 60 * 60 * 24 * 30,
      path: "/",
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
    });
  }

  return res;
}
