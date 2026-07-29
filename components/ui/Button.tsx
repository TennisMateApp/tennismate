"use client";

import React, { forwardRef, type ButtonHTMLAttributes, type ReactNode } from "react";
import { Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

export type ButtonVariant = "primary" | "secondary" | "outline" | "ghost" | "destructive";

const variants: Record<ButtonVariant, string> = {
  primary: "bg-[var(--tm-color-brand-primary)] text-white hover:bg-[#125540]",
  secondary: "bg-[var(--tm-color-brand-accent)] text-[var(--tm-color-brand-primary)] hover:brightness-95",
  outline: "border border-[var(--tm-color-border)] bg-[var(--tm-color-surface)] text-[var(--tm-color-brand-primary)] hover:bg-emerald-50",
  ghost: "bg-transparent text-[var(--tm-color-brand-primary)] hover:bg-emerald-950/[0.06]",
  destructive: "bg-[var(--tm-color-error)] text-white hover:brightness-90",
};

export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  loading?: boolean;
  loadingLabel?: string;
  iconBefore?: ReactNode;
  iconAfter?: ReactNode;
  fullWidth?: boolean;
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  {
    variant = "primary",
    type = "button",
    loading = false,
    loadingLabel = "Loading",
    iconBefore,
    iconAfter,
    fullWidth = false,
    disabled,
    className,
    children,
    ...props
  },
  ref
) {
  return (
    <button
      ref={ref}
      type={type}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={cn(
        "tm-type-button inline-flex min-h-11 items-center justify-center gap-2 rounded-[var(--tm-radius-button)] px-4 py-2.5 shadow-[var(--tm-shadow-button)] transition-colors",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--tm-color-focus)] focus-visible:ring-offset-2",
        "disabled:cursor-not-allowed disabled:bg-[var(--tm-color-disabled)] disabled:text-slate-600 disabled:shadow-none",
        variants[variant],
        fullWidth && "w-full",
        className
      )}
      {...props}
    >
      {loading ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : iconBefore}
      <span>{loading ? loadingLabel : children}</span>
      {!loading && iconAfter}
    </button>
  );
});
