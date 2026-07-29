import React, { type HTMLAttributes } from "react";
import { cn } from "@/lib/utils";

export function Card({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        "rounded-[var(--tm-radius-card)] border border-[var(--tm-color-border)] bg-[var(--tm-color-surface)] shadow-[var(--tm-shadow-card)]",
        className
      )}
      {...props}
    />
  );
}
