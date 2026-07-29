"use client";

import React, { forwardRef, type ButtonHTMLAttributes } from "react";
import { cn } from "@/lib/utils";

export type IconButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  label: string;
};

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { label, type = "button", className, children, ...props },
  ref
) {
  return (
    <button
      ref={ref}
      type={type}
      aria-label={label}
      className={cn(
        "inline-grid min-h-11 min-w-11 place-items-center rounded-[var(--tm-radius-button)] text-[var(--tm-color-brand-primary)] transition-colors",
        "hover:bg-emerald-950/[0.06] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--tm-color-focus)] focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:text-slate-400",
        className
      )}
      {...props}
    >
      {children}
    </button>
  );
});
