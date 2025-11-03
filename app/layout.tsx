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
        <meta name="theme-color" content="#2563eb" />
        <meta name="mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta
          name="viewport"
          content="width=device-width, initial-scale=1, viewport-fit=cover"
        />
        <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
        <meta name="format-detection" content="telephone=no" />
      </head>
      <body className="m-0 min-h-[100dvh] overflow-x-hidden">
        {/* ✅ Global client wrapper + auth gate */}
        <AuthGate>
          <ClientLayoutWrapper>{children}</ClientLayoutWrapper>
        </AuthGate>
      </body>
    </html>
  );
}
