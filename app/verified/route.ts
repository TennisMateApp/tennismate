import { NextRequest, NextResponse } from "next/server";

/** Compatibility endpoint for verification emails sent before /verify-complete became canonical. */
export function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get("oobCode");
  if (code) {
    const destination = new URL("/verify-complete", request.url);
    request.nextUrl.searchParams.forEach((value, key) => {
      destination.searchParams.append(key, value);
    });
    return NextResponse.redirect(destination, 308);
  }

  return new NextResponse(
    `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
    <title>Email verification complete | TennisMate</title>
    <style>
      *{box-sizing:border-box}body{margin:0;min-height:100dvh;display:grid;place-items:center;padding:20px;background:#f5f5f0;color:#0f172a;font-family:Arial,sans-serif}.card{width:100%;max-width:448px;padding:28px;border-radius:16px;background:#fff;text-align:center;box-shadow:0 1px 8px rgba(15,23,42,.08)}.brand{display:flex;align-items:center;justify-content:center;gap:8px;color:#0b3d2e;font-size:18px;font-weight:700}.brand img{width:36px;height:36px;border-radius:999px}.icon{display:grid;place-items:center;width:56px;height:56px;margin:28px auto 0;border-radius:999px;background:#d1fae5;color:#047857;font-size:28px}h1{margin:20px 0 0;font-size:24px;line-height:1.25}p{margin:8px 0 0;color:#475569;font-size:14px;line-height:1.65}.action{display:flex;min-height:44px;margin-top:24px;align-items:center;justify-content:center;border-radius:12px;background:#0b3d2e;color:#fff;font-size:14px;font-weight:700;text-decoration:none}
    </style>
  </head>
  <body>
    <main class="card">
      <div class="brand"><img src="/logo.png" alt=""><span>TennisMate</span></div>
      <div class="icon" aria-hidden="true">✓</div>
      <h1>Email verification complete</h1>
      <p>Return to the TennisMate app to continue. If you still see the verification screen, select “I’ve verified my email”.</p>
      <a class="action" href="/login">Open TennisMate</a>
    </main>
  </body>
</html>`,
    {
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "no-store",
      },
    }
  );
}

