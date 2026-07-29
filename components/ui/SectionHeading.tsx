import React, { type HTMLAttributes, type ReactNode } from "react";
import { cn } from "@/lib/utils";

export function SectionHeading({
  title,
  supportingText,
  action,
  className,
  ...props
}: HTMLAttributes<HTMLDivElement> & {
  title: ReactNode;
  supportingText?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className={cn("flex items-start justify-between gap-4", className)} {...props}>
      <div className="min-w-0">
        <h2 className="tm-type-section-heading text-[var(--tm-color-text-primary)]">{title}</h2>
        {supportingText ? (
          <p className="tm-type-supporting mt-1 text-[var(--tm-color-text-secondary)]">{supportingText}</p>
        ) : null}
      </div>
      {action}
    </div>
  );
}
