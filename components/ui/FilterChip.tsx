"use client";

import React, { type ButtonHTMLAttributes } from "react";
import { cn } from "@/lib/utils";

export type FilterChipProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, "type"> & {
  selected: boolean;
};

export function FilterChip({ selected, className, children, ...props }: FilterChipProps) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      className={cn(
        "inline-flex min-h-11 items-center justify-center rounded-[var(--tm-radius-chip)] border px-3 py-2 text-sm font-semibold transition-colors",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--tm-color-focus)] focus-visible:ring-offset-2",
        selected
          ? "border-[var(--tm-color-brand-primary)] bg-[var(--tm-color-brand-primary)] text-white"
          : "border-[var(--tm-color-border)] bg-[var(--tm-color-surface)] text-[var(--tm-color-text-secondary)] hover:bg-emerald-50",
        className
      )}
      {...props}
    >
      {children}
    </button>
  );
}
