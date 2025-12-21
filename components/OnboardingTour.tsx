"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { X, ChevronLeft, ChevronRight, CheckCircle2 } from "lucide-react";

type TourStep = {
  key: string;
  title: string;
  body: string;
  target?: string;
  placement?: "top" | "bottom" | "left" | "right" | "auto";
  waitForTarget?: boolean; // ✅ ADD


  requireRoute?: string;
  requireClickSelector?: string;
  requireEvent?: string; // ✅ ADD THIS (you use it below)

  autoAdvanceOnClick?: boolean;
  allowClickThrough?: boolean;
};



const STEPS: TourStep[] = [
  {
    key: "welcome",
    title: "Welcome to TennisMate 🎾",
    body: "Quick tour: we’ll show you where the key features live so you can start matching fast.",
    // no target for welcome
  },
  {
    key: "profile",
    title: "Your Profile",
    body: "Tap here to edit your profile, skill level, postcode, and availability. This is how players find you.",
    target: '[data-tour="profile"]',
    placement: "bottom",
  },
  {
    key: "directory",
    title: "Find players in the Directory",
    body: "Search for players nearby and view their profiles before sending a request.",
    target: '[data-tour="directory"]',
    placement: "bottom",
  },
  {
  key: "courts-intro",
  title: "Courts near you",
  body: "Browse courts in your area, see how far they are from your postcode, and use quick links to book a court.",
  target: '[data-tour="courts-link"]',
  placement: "top",
  waitForTarget: true,
},

  {
    key: "notifications",
    title: "Notifications",
    body: "This is where notifications will appear (match updates, reminders, and more).",
    target: '[data-tour="notifications"]',
    placement: "bottom",
  },
  {
    key: "match-me",
    title: "Match Me",
    body: "Use Match Me to send a match request and get on court quickly.",
    target: '[data-tour="match-me"]',
    placement: "top",
  },
  {
    key: "matches",
    title: "Pending & Accepted Matches",
    body: "Go here to see pending requests, accepted matches, and match history.",
    target: '[data-tour="matches"]',
    placement: "top",
  },
{
  key: "first-request-intro",
  title: "Now let’s send your first match request 👇",
  body: "You’re set up! Tap Match Me to see recommended players.",
  target: '[data-tour="match-me"]',
  placement: "top",

  // ✅ user must click Match Me, but we auto-continue
  requireClickSelector: '[data-tour="match-me"]',
  autoAdvanceOnClick: true,
  allowClickThrough: true,
},
{
  key: "top-match",
  title: "Your best match",
  body: "This is your highest rated matches based on distance, availability overlap, and skill. If you like, tap Send Request to start organising your next hit.",
  target: '[data-tour="top-match"]',
  placement: "bottom",
  requireRoute: "/match",
  waitForTarget: true, // ✅ ADD THIS
},



];

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
}

export default function OnboardingTour({
  open,
  onClose,
  onComplete,
}: {
  open: boolean;
  onClose: () => void;
  onComplete: () => void;
}) {
  const [i, setI] = useState(0);
  const [mounted, setMounted] = useState(false);

  const [rect, setRect] = useState<DOMRect | null>(null);
  const [targetMissing, setTargetMissing] = useState(false);

  const cardRef = useRef<HTMLDivElement>(null);
  const [cardHeight, setCardHeight] = useState(200);


  const steps = STEPS;
  const step = steps[i];
  const pathname = usePathname() || "";
const allowInteraction = !!step.requireClickSelector || !!step.requireEvent;


  const last = i === steps.length - 1;

  const [positionMode, setPositionMode] = useState<"center" | "anchored">("center");

  const [requireSatisfied, setRequireSatisfied] = useState(true);


  // Mount animation + reset
  useEffect(() => {
    if (!open) {
      setMounted(false);
      return;
    }
    setI(0);
    const t = setTimeout(() => setMounted(true), 10);
    return () => clearTimeout(t);
  }, [open]);

  // Escape / arrows
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if (e.key === "ArrowLeft") setI((v) => Math.max(0, v - 1));
      if (e.key === "ArrowRight") setI((v) => Math.min(steps.length - 1, v + 1));
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, onClose, steps.length]);

  useLayoutEffect(() => {
  if (!open) return;
  const h = cardRef.current?.getBoundingClientRect().height;
  if (h) setCardHeight(h);
}, [open, i]);


const measure = () => {
  if (!step.target) {
    setRect(null);
    setTargetMissing(false);
    setPositionMode("center");
    return;
  }

  const el = document.querySelector(step.target) as HTMLElement | null;

  // ✅ Found immediately
  if (el) {
    setTargetMissing(false);
    setRect(el.getBoundingClientRect());
    setPositionMode("anchored");
    return;
  }

  // ✅ If we are NOT waiting for the target, behave like before (center fallback)
  if (!step.waitForTarget) {
    setRect(null);
    setTargetMissing(true);
    setPositionMode("center");
    return;
  }

  // ✅ We ARE waiting for the target (eg Match page data still loading)
  setTargetMissing(true);
  setRect(null);
  setPositionMode("center");
};



useEffect(() => {
  // ✅ Determine what must be satisfied for THIS step
  const needsRoute = !!step.requireRoute;
  const onRequiredRoute = !needsRoute || pathname.startsWith(step.requireRoute!);

  // click + event get satisfied by listeners below
  const needsClick = !!step.requireClickSelector;
  const needsEvent = !!step.requireEvent;

  // ✅ If the step requires route and we're not there yet → Next disabled.
  // ✅ If we're on the correct route, allow Next unless click/event are required.
  if (!onRequiredRoute) {
    setRequireSatisfied(false);
    return;
  }

  // If click/event required, start disabled until satisfied
  if (needsClick || needsEvent) {
    setRequireSatisfied(false);
    return;
  }

  // Otherwise it's a normal step
  setRequireSatisfied(true);
}, [i, pathname, step.requireRoute, step.requireClickSelector, step.requireEvent]);


useEffect(() => {
  if (!open) return;
  if (!step.requireClickSelector) return;

  let detached = false;
  let currentEl: HTMLElement | null = null;

  const attach = () => {
    if (detached) return;

    const el = document.querySelector(step.requireClickSelector!) as HTMLElement | null;
    if (!el) return;

    // avoid double-binding
    if (currentEl === el) return;
    currentEl = el;

    const onClick = () => {
      setRequireSatisfied(true);

      // ✅ auto-advance right after required click
      if (step.autoAdvanceOnClick) {
        setPositionMode("center");
        setI((v) => Math.min(steps.length - 1, v + 1));
      }
    };

    el.addEventListener("click", onClick, { once: true });

    // cleanup for this specific element
    return () => el.removeEventListener("click", onClick);
  };

  // Try immediately (in case it's already there)
  let cleanupClick = attach();

  // If not there yet, observe DOM until it appears
  const observer = new MutationObserver(() => {
    if (cleanupClick) return; // already attached
    cleanupClick = attach();
  });

  observer.observe(document.body, { childList: true, subtree: true });

  return () => {
    detached = true;
    observer.disconnect();
    if (cleanupClick) cleanupClick();
  };
}, [open, i, step.requireClickSelector, step.autoAdvanceOnClick, steps.length]);



useEffect(() => {
  if (!open || !step.requireEvent) return;

  const onEvt = () => {
    setI((prev) => prev + 1);
  };

  window.addEventListener(step.requireEvent, onEvt as EventListener);

  return () => {
    window.removeEventListener(step.requireEvent as string, onEvt as EventListener);
  };
}, [open, step.requireEvent]);



useLayoutEffect(() => {
  if (!open) return;
  measure();

  const onResize = () => measure();
  window.addEventListener("resize", onResize);
  window.addEventListener("scroll", onResize, { passive: true });

  return () => {
    window.removeEventListener("resize", onResize);
    window.removeEventListener("scroll", onResize as any);
  };
  // eslint-disable-next-line react-hooks/exhaustive-deps
}, [open, i]);


  // Spotlight geometry
  const spotlight = useMemo(() => {
    if (!rect) return null;

    const pad = 10; // padding around the element
    const r = 16; // rounded corners
    const x = rect.left - pad;
    const y = rect.top - pad;
    const w = rect.width + pad * 2;
    const h = rect.height + pad * 2;

    return { x, y, w, h, r };
  }, [rect]);

  // Card position (simple + robust)
const cardStyle = useMemo(() => {
  // ✅ Center mode (welcome + during transitions)
  if (!spotlight || positionMode === "center") {
    return {
      left: "50%",
      top: "50%",
      transform: "translate(-50%, -50%)",
      bottom: "auto",
    } as const;
  }

  // ✅ Anchored mode (real positioning)
  const vw = window.innerWidth || 375;
  const vh = window.innerHeight || 700;

  const margin = 12;
  const cardW = 320;
  const cardH = Math.max(160, cardHeight);

  const safeTopPad = 80;
  const isFooterStep = step.key === "match-me" || step.key === "matches";
  const safeBottomPad = isFooterStep ? 150 : 24;

  const aboveTop = spotlight.y - margin;
  const belowTop = spotlight.y + spotlight.h + margin;

  const centerKeys = new Set(["notifications", "matches"]);
const forceCenterX = centerKeys.has(step.key);


  let top: number | null = null;
  let bottom: number | null = null;

  const canPlaceAbove = aboveTop - cardH > margin;
  const canPlaceBelow = belowTop + cardH < (vh - safeBottomPad);

  if (step.placement === "top" && canPlaceAbove) {
    top = aboveTop - cardH;
  } else if (step.placement === "bottom" && canPlaceBelow) {
    top = belowTop;
  } else if (canPlaceBelow) {
    top = belowTop;
  } else if (canPlaceAbove) {
    top = aboveTop - cardH;
  } else {
    bottom = safeBottomPad;
  }

  // ✅ Clamp so card never goes off-screen
  if (top !== null) {
    const minTop = safeTopPad;
    const maxTop = Math.max(minTop, vh - safeBottomPad - cardH);
    top = clamp(top, minTop, maxTop);
  }

  // ✅ Clamp left so card stays on-screen
// ✅ X positioning
let leftCss: string;

if (forceCenterX) {
  // keep card centered horizontally (no sliding under the icon)
  leftCss = "50%";
} else {
  // slide card under the icon, but keep on-screen
  const centerX = spotlight.x + spotlight.w / 2;
  const leftPx = clamp(centerX - cardW / 2, margin, vw - cardW - margin);
  leftCss = `${leftPx}px`;
}


// ✅ Force vertical placement for specific steps
if (step.key === "notifications") {
  top = safeTopPad;     // top center
  bottom = null;
}

if (step.key === "matches") {
  top = null;
  bottom = safeBottomPad; // bottom center (above footer)
}

return {
  left: leftCss,
  // when centered, we need translateX(-50%) in transform
  transform: forceCenterX ? "translateX(-50%)" : undefined,
  top: top !== null ? `${top}px` : "auto",
  bottom: bottom !== null ? `${bottom}px` : "auto",
} as const;

}, [spotlight, step.key, step.placement, cardHeight, positionMode]);



  if (!open) return null;

  return (
  <div
    className={[
      "fixed inset-0 z-[9999]",
      allowInteraction ? "pointer-events-none" : "pointer-events-auto",
    ].join(" ")}
    role="dialog"
    aria-modal="true"
  >

      
{/* Backdrop */}
<div
  className={[
    "absolute inset-0 bg-black/20 transition-opacity duration-200 pointer-events-none",
    mounted ? "opacity-100" : "opacity-0",
  ].join(" ")}
/>

      {/* Spotlight cutout */}
      {spotlight && (
  <svg className="absolute inset-0 h-full w-full pointer-events-none">
          <defs>
            <mask id="spotlight-mask">
              <rect x="0" y="0" width="100%" height="100%" fill="white" />
              <rect
                x={spotlight.x}
                y={spotlight.y}
                width={spotlight.w}
                height={spotlight.h}
                rx={spotlight.r}
                ry={spotlight.r}
                fill="black"
              />
            </mask>
          </defs>

          <rect x="0" y="0" width="100%" height="100%" fill="rgba(0,0,0,0.40)" mask="url(#spotlight-mask)" />
          <rect
            x={spotlight.x}
            y={spotlight.y}
            width={spotlight.w}
            height={spotlight.h}
            rx={spotlight.r}
            ry={spotlight.r}
            fill="transparent"
            stroke="rgba(255,255,255,0.65)"
            strokeWidth="2"
          />
        </svg>
      )}

      {/* Click-catcher (prevents interacting with app during tour) */}
{/* Click-catcher (prevents interacting with app during tour) */}
{!allowInteraction && !step.allowClickThrough && (
  <button
    aria-label="Close tour"
    onClick={onClose}
    className="absolute inset-0 h-full w-full cursor-default"
    style={{ background: "transparent" }}
  />
)}


      {/* Card */}
      <div
        ref={cardRef}
   className={[
  "absolute z-[10000] w-[min(92vw,360px)] pointer-events-auto",
  "rounded-2xl bg-white shadow-2xl border",
  "transition-[top,left,bottom,transform] duration-200 ease-out",
  mounted ? "translate-y-0" : "translate-y-2",
].join(" ")}


        style={cardStyle as any}
      >
        <div className="flex items-start justify-between gap-3 p-4">
          <div>
            <div className="text-xs text-gray-500">
              Step {i + 1} of {steps.length}
            </div>
            <h3 className="mt-1 text-base font-semibold tracking-tight">{step.title}</h3>
          </div>

          <button onClick={onClose} className="rounded-lg p-2 text-gray-500 hover:bg-gray-100 active:scale-[0.98]">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="px-4 pb-4">
          <p className="text-sm leading-6 text-gray-700">{step.body}</p>

    {/* Only warn when the step requires a click, AND the target isn't found */}
{step.requireClickSelector && targetMissing && (
  <p className="mt-2 text-xs text-amber-600">
    That button isn’t visible on this screen — tap Next and we’ll keep going.
  </p>
)}


          <div className="mt-4 flex items-center justify-between">

          <button
  onClick={onClose}
  className="text-sm text-gray-500 underline underline-offset-2 hover:text-gray-700"
>
  Skip tutorial
</button>
 
           
            <button
onClick={() => setI((v) => Math.max(0, v - 1))}


              disabled={i === 0}
              className="inline-flex items-center gap-1 rounded-xl border px-3 py-2 text-sm text-gray-700 disabled:opacity-50 active:scale-[0.98]"
            >
              <ChevronLeft className="h-4 w-4" />
              Back
            </button>

            {!last ? (
<button
  disabled={!requireSatisfied}
  onClick={() => setI((v) => Math.min(steps.length - 1, v + 1))}
  className="inline-flex items-center gap-2 rounded-xl bg-green-600 px-4 py-2 text-sm font-medium text-white hover:bg-green-700 active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed"
>
  Next
  <ChevronRight className="h-4 w-4" />
</button>

            ) : (
              <button
                onClick={onComplete}
                className="inline-flex items-center gap-2 rounded-xl bg-green-600 px-4 py-2 text-sm font-medium text-white hover:bg-green-700 active:scale-[0.98]"
              >
                <CheckCircle2 className="h-4 w-4" />
                Finish
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
