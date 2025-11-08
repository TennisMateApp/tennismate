"use client";

import React, { useEffect, useState } from "react";

export default function ClientRuntime() {
  const [href, setHref] = useState("");
  const [hasSW, setHasSW] = useState("unknown");
  const [buildId, setBuildId] = useState("loading…");
  const [safeTop, setSafeTop] = useState("");
  const [safeBottom, setSafeBottom] = useState("");
  const [headerPaddingTop, setHeaderPaddingTop] = useState("");

  useEffect(() => {
    setHref(typeof location !== "undefined" ? location.href : "");

    (async () => {
      try {
        setHasSW(navigator.serviceWorker?.controller ? "yes" : "no");
      } catch {
        setHasSW("unknown");
      }

      try {
        const res = await fetch("/_next/static/BUILD_ID", { cache: "no-store" });
        setBuildId((await res.text()).trim());
      } catch {
        setBuildId("unknown");
      }

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
      <div><span className="font-semibold">Header padding-top:</span> <code>{headerPaddingTop}</code></div>
    </div>
  );
}
