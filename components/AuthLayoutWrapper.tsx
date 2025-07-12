"use client";

import { usePathname } from "next/navigation";
import LayoutWrapper from "./LayoutWrapper";

export default function AuthLayoutWrapper({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const noLayout = pathname === "/login" || pathname === "/signup";

  return noLayout ? <>{children}</> : <LayoutWrapper>{children}</LayoutWrapper>;
}
