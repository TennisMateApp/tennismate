"use client";

import dynamic from "next/dynamic";

const PushPermissionPrompt = dynamic(() => import("./PushPermissionPrompt"), {
  ssr: false,
});

export default function PushClientOnly() {
  return <PushPermissionPrompt />;
}
