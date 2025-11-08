"use client";

import React, { useEffect, useState } from "react";

export default function ClientRuntime() {
  const [href, setHref] = useState<string>("");
  const [hasSW, setHasSW] = useState<string>("unknown");
  const [buildId, setBuildId] = useState<string>("loading…");
  const [safeTop, setSafeTop] = useState<string>("");
  const [safeBottom, setSafeBottom] = useState<string>("");
  const [headerPaddingTop, setHeaderPaddingTop] = useState<string>("");

  useEffect(() => {
    setHref(typeof location !== "undefined" ? location.href : "");
    (async () => {
      try {
        // Is a Service Worker controlling this page?
        const ctrl = (navigator as any)?.serviceWorker?.controller;
        setHasSW(ctrl ? "yes" : "no");
      } catch {
        setHasSW("unknown");
      }

      // Next.js build id via runtime fetch (works even if server fetch failed)
      try {
        const res = await fetch("/_next/static/BUILD_ID", { cache: "no-store" });
        setBuildId((await res.text()).trim());
      } catch {
        setBuildId("unknown");
      }

      // Safe area + header padding
      const cs = getComputedStyle(document.documentElement);
      setSafeTop(cs.getPropertyValue("--safe-top").trim() || "(empty)");
      setSafeBottom(cs.getPropertyValue("--safe-bottom").trim() || "(empty)");

      const h = document.querySelector("header");
      setHeaderPaddingTop(h ? getComputedStyle(h).paddingTop : "(no header)");
    })();
  }, []);

  return (
    <div className="rounded-lg border p-4 text-sm space-y-2">
      <div><span className="font-semibold">Location:</span> <code>{href}</code></div>
      <div><span className="font-semibold">Client BUILD_ID:</span> <code>{buildId}</code></div>
      <div><span className="font-semibold">Service Worker controlling page:</span> <code>{hasSW}</code></div>
      <div><span className="font-semibold">--safe-top:</span> <code>{safeTop}</code></div>
      <div><span className="font-semibold">--safe-bottom:</span> <code>{safeBottom}</code></div>
      <div><span className="font-semibold">computed header padding-top:</span> <code>{headerPaddingTop}</code></div>
    </div>
  );
}
