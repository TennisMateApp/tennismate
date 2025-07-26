"use client";

import { usePathname } from "next/navigation";
import ClientLayoutWrapper from "./ClientLayoutWrapper";

export default function AuthLayoutWrapper({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const noLayout = pathname === "/login" || pathname === "/signup";

  return noLayout ? <>{children}</> : <ClientLayoutWrapper>{children}</ClientLayoutWrapper>;
}
