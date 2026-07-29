import React, { forwardRef, type InputHTMLAttributes, type ReactNode } from "react";
import { cn } from "@/lib/utils";

export type FormFieldProps = InputHTMLAttributes<HTMLInputElement> & {
  id: string;
  label: string;
  hint?: ReactNode;
  error?: string;
};

export const FormField = forwardRef<HTMLInputElement, FormFieldProps>(function FormField(
  { id, label, hint, error, className, ...props },
  ref
) {
  const hintId = hint ? `${id}-hint` : undefined;
  const errorId = error ? `${id}-error` : undefined;
  const describedBy = [hintId, errorId].filter(Boolean).join(" ") || undefined;

  return (
    <div>
      <label htmlFor={id} className="tm-type-field-label block text-[var(--tm-color-text-primary)]">
        {label}
      </label>
      <input
        ref={ref}
        id={id}
        aria-invalid={Boolean(error) || undefined}
        aria-describedby={describedBy}
        className={cn(
          "mt-2 min-h-11 w-full rounded-[var(--tm-radius-input)] border border-[var(--tm-color-border)] bg-[var(--tm-color-surface)] px-3 py-2.5 text-base text-[var(--tm-color-text-primary)] outline-none",
          "focus:border-[var(--tm-color-brand-primary)] focus:ring-2 focus:ring-[var(--tm-color-focus)] disabled:bg-[var(--tm-color-disabled)]",
          error && "border-[var(--tm-color-error)]",
          className
        )}
        {...props}
      />
      {hint ? <div id={hintId} className="mt-1 text-sm text-[var(--tm-color-text-muted)]">{hint}</div> : null}
      {error ? <div id={errorId} className="tm-type-field-error mt-1 text-[var(--tm-color-error)]">{error}</div> : null}
    </div>
  );
});
