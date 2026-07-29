import React, { type HTMLAttributes } from "react";
import { cn } from "@/lib/utils";

export function Badge({ className, ...props }: HTMLAttributes<HTMLSpanElement>) {
  return (
    <span
      className={cn(
        "inline-flex min-h-6 items-center rounded-[var(--tm-radius-chip)] bg-emerald-950/10 px-2.5 py-1 text-xs font-semibold text-[var(--tm-color-brand-primary)]",
        className
      )}
      {...props}
    />
  );
}
