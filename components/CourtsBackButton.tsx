"use client";

import Link from "next/link";
import type { MouseEventHandler } from "react";
import { ArrowLeft } from "lucide-react";
import { appPageHeaderButtonClass } from "@/components/AppPageHeader";

type CourtsBackButtonProps = {
  href?: string;
  onClick?: MouseEventHandler<HTMLButtonElement>;
  label?: string;
  title?: string;
};

/** Exact shared implementation of the Courts page back button. */
export default function CourtsBackButton({
  href,
  onClick,
  label = "Back",
  title = "Back",
}: CourtsBackButtonProps) {
  const icon = <ArrowLeft className="h-5 w-5 text-gray-700" aria-hidden="true" />;

  if (href) {
    return (
      <Link href={href} className={appPageHeaderButtonClass} aria-label={label} title={title}>
        {icon}
      </Link>
    );
  }

  return (
    <button
      type="button"
      onClick={onClick}
      className={appPageHeaderButtonClass}
      aria-label={label}
      title={title}
    >
      {icon}
    </button>
  );
}
