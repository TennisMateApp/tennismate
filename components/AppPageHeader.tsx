import type { ReactNode } from "react";

type AppPageHeaderProps = {
  title: ReactNode;
  subtitle?: ReactNode;
  leading?: ReactNode;
  actions?: ReactNode;
  eyebrow?: ReactNode;
  className?: string;
  titleAs?: "h1" | "div";
  stackActions?: boolean;
};

/**
 * Shared page-heading treatment taken directly from the Directory page.
 * Content, navigation and actions remain owned by each route.
 */
export default function AppPageHeader({
  title,
  subtitle,
  leading,
  actions,
  eyebrow,
  className = "",
  titleAs = "h1",
  stackActions = false,
}: AppPageHeaderProps) {
  const Title = titleAs;

  return (
    <header
      className={`grid min-w-0 grid-cols-[minmax(0,1fr)_minmax(0,2fr)_minmax(0,1fr)] items-start gap-x-3 gap-y-3 ${className}`}
    >
      <div className="col-start-1 row-start-1 flex min-w-0 justify-self-start">
        {leading ? <div className="-my-2 shrink-0">{leading}</div> : null}
      </div>
      <div className="col-start-2 row-start-1 min-w-0 justify-self-stretch text-center">
          {eyebrow ? (
            <div className="mb-1 text-xs font-extrabold uppercase tracking-[0.18em] text-[#0B3D2E]/60">
              {eyebrow}
            </div>
          ) : null}
          <Title className="text-[22px] font-extrabold leading-tight tracking-tight text-[#0B3D2E] lg:text-[28px]">
            {title}
          </Title>
          {subtitle ? (
            <div className="mt-1 text-sm leading-snug text-[#0B3D2E]/60">{subtitle}</div>
          ) : null}
      </div>
      <div
        className={
          stackActions
            ? "col-span-3 col-start-1 row-start-2 flex min-h-11 min-w-0 items-center justify-center gap-2"
            : "col-start-3 row-start-1 flex min-h-11 min-w-0 items-start justify-self-stretch gap-2 [&>*]:ml-auto"
        }
      >
        {actions}
      </div>
    </header>
  );
}

export const appPageHeaderButtonClass =
  "inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-[#0B3D2E]/15 bg-white text-[#0B3D2E] shadow-sm transition-colors hover:bg-[#0B3D2E]/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#39FF14] focus-visible:ring-offset-2";
