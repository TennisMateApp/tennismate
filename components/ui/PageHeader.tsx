"use client";

import React, { type ReactNode } from "react";
import { usePathname } from "next/navigation";
import { getRouteNavigation } from "@/lib/routeNavigation";
import { cn } from "@/lib/utils";
import { BackButton } from "./BackButton";

export type PageHeaderProps = {
  title?: string;
  subtitle?: ReactNode;
  showBackButton?: boolean;
  fallbackHref?: string;
  onBack?: () => void;
  action?: ReactNode;
  sticky?: boolean;
  className?: string;
};

export function PageHeader({
  title,
  subtitle,
  showBackButton,
  fallbackHref,
  onBack,
  action,
  sticky = false,
  className,
}: PageHeaderProps) {
  const pathname = usePathname() || "/";
  const route = getRouteNavigation(pathname);
  const shouldShowBack = showBackButton ?? route.showBackButton;

  return (
    <header
      className={cn(
        "grid min-h-16 grid-cols-[minmax(44px,1fr)_minmax(0,auto)_minmax(44px,1fr)] items-center gap-3 bg-[var(--tm-color-page-background)] py-2",
        sticky && "sticky top-[var(--safe-top)] z-30",
        className
      )}
    >
      {shouldShowBack ? (
        <BackButton fallbackHref={fallbackHref ?? route.fallbackRoute} onBack={onBack} />
      ) : (
        <span aria-hidden="true" />
      )}
      <div className="min-w-0 text-center">
        <h1 className="tm-type-page-title text-balance text-[var(--tm-color-text-primary)]">
          {title ?? route.screenTitle}
        </h1>
        {subtitle ? (
          <div className="tm-type-supporting mt-1 truncate text-[var(--tm-color-text-secondary)]">{subtitle}</div>
        ) : null}
      </div>
      <div className="flex min-h-11 min-w-11 items-center justify-end">{action}</div>
    </header>
  );
}
