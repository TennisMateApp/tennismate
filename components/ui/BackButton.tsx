"use client";

import { ArrowLeft } from "lucide-react";
import React from "react";
import { useRouter } from "next/navigation";
import { IconButton } from "./IconButton";

export type BackButtonProps = {
  fallbackHref: string;
  onBack?: () => void;
  className?: string;
};

export function BackButton({ fallbackHref, onBack, className }: BackButtonProps) {
  const router = useRouter();

  const goBack = () => {
    if (onBack) {
      onBack();
      return;
    }
    if (typeof window !== "undefined" && window.history.length > 1) {
      router.back();
      return;
    }
    router.push(fallbackHref);
  };

  return (
    <IconButton
      label="Back"
      onClick={goBack}
      className={className ?? "rounded-full border border-emerald-950/10 bg-white/80"}
    >
      <ArrowLeft className="h-[22px] w-[22px]" strokeWidth={3} aria-hidden="true" />
    </IconButton>
  );
}
