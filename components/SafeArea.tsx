"use client";
import React from "react";

type Props = { extra?: number };

/**
 * Reserves space for iOS Dynamic Island / Home Indicator using CSS env() insets.
 * `extra` lets you add a few extra pixels of padding if desired.
 */
export function SafeAreaTop({ extra = 0 }: Props) {
  return (
    <div
      aria-hidden
      style={{
        height: `calc(env(safe-area-inset-top, 0px) + ${extra}px)`,
        paddingLeft: "max(0px, env(safe-area-inset-left, 0px))",
        paddingRight: "max(0px, env(safe-area-inset-right, 0px))",
      }}
    />
  );
}

export function SafeAreaBottom({ extra = 0 }: Props) {
  return (
    <div
      aria-hidden
      style={{
        height: `calc(env(safe-area-inset-bottom, 0px) + ${extra}px)`,
        paddingLeft: "max(0px, env(safe-area-inset-left, 0px))",
        paddingRight: "max(0px, env(safe-area-inset-right, 0px))",
      }}
    />
  );
}
