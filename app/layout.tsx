// app/layout.tsx
import "./globals.css";
import type { ReactNode } from "react";
import ClientLayoutWrapper from "@/components/ClientLayoutWrapper";
import AuthGate from "@/components/AuthGate";

export const metadata = {
  title: "TennisMate",
  description: "Find and match with tennis players near you.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <head>
        <link rel="manifest" href="/manifest.json" />
        <link rel="icon" href="/icon-192x192.png" />
        <link rel="apple-touch-icon" href="/apple-touch-icon.png" />

        {/* Theme + PWA */}
        <meta name="theme-color" content="#2563eb" />
        <meta name="mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta
          name="viewport"
          content="width=device-width, initial-scale=1, viewport-fit=cover"
        />
        <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
        <meta name="format-detection" content="telephone=no" />

        {/* Safe-area CSS variables (iOS), harmless on Android/PWA */}
        <style>{`
          :root {
            --safe-top: env(safe-area-inset-top, 0px);
            --safe-bottom: env(safe-area-inset-bottom, 0px);
          }
          @supports (padding-top: constant(safe-area-inset-top)) {
            :root {
              --safe-top: constant(safe-area-inset-top);
              --safe-bottom: constant(safe-area-inset-bottom);
            }
          }
        `}</style>
      </head>

      {/* Do NOT add global padding here to avoid double-spacing on Android.
          Let ClientLayoutWrapper/Header/Nav use var(--safe-top/bottom) locally. */}
      <body className="m-0 min-h-[100dvh] overflow-x-hidden">
        <AuthGate>
          <ClientLayoutWrapper>{children}</ClientLayoutWrapper>
        </AuthGate>
      </body>
    </html>
  );
}
