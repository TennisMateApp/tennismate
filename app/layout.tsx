// app/layout.tsx
import "./globals.css";
import { ReactNode } from "react";
import AuthLayoutWrapper from "@/components/AuthLayoutWrapper"; // ✅ we'll create this

export const metadata = {
  title: "TennisMate",
  description: "Find and match with tennis players near you.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <AuthLayoutWrapper>{children}</AuthLayoutWrapper>
      </body>
    </html>
  );
}
