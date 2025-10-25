// app/home/page.tsx
'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useMemo, useEffect, useState } from 'react';
import {
  CalendarPlus,
  UsersRound,
  Swords,
  CalendarDays,
  CircleAlert,
  Search,
  Construction,
  MessageSquare,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import Image from "next/image";
import { collection, query, where, getCountFromServer } from "firebase/firestore";
import { db } from "@/lib/firebase";


// --- light Card/Button fallbacks (remove if using shadcn/ui components) ---
function Card({
  className,
  children,
}: React.PropsWithChildren<{ className?: string }>) {
  return (
    <div className={cn('rounded-2xl border bg-card text-card-foreground shadow-sm', className)}>
      {children}
    </div>
  );
}
function CardHeader({
  className,
  children,
}: React.PropsWithChildren<{ className?: string }>) {
  return <div className={cn('p-4 pb-0', className)}>{children}</div>;
}
function CardTitle({
  className,
  children,
}: React.PropsWithChildren<{ className?: string }>) {
  return <h3 className={cn('text-lg font-semibold', className)}>{children}</h3>;
}
function CardContent({
  className,
  children,
}: React.PropsWithChildren<{ className?: string }>) {
  return <div className={cn('p-4 pt-2', className)}>{children}</div>;
}
function Button({
  className,
  children,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'default' | 'ghost' | 'secondary' | 'outline';
}) {
  return (
    <button
      {...props}
      className={cn(
        'inline-flex items-center justify-center gap-2 rounded-xl px-4 py-2 text-sm font-medium transition disabled:opacity-60 disabled:cursor-not-allowed',
        'bg-primary text-primary-foreground hover:opacity-90',
        className
      )}
    >
      {children}
    </button>
  );
}
// --------------------------------------------------------------------------

type Tile = {
  key: string;
  title: string;
  description: string;
  icon: React.ReactNode | null;
  href: string;
  actionLabel?: string;
  status: 'live' | 'soon';
  imageSrc?: string;
  imagePosition?: string;
  badge?: React.ReactNode;  
};

export default function HomeDashboard() {

const [eventsCount, setEventsCount] = useState(0);

useEffect(() => {
  // Keep the query simple and robust. If you want “future only” add the time filter (see note below).
  const q = query(
    collection(db, "events"),
    where("status", "==", "open")
  );

  getCountFromServer(q)
    .then((snap) => setEventsCount(snap.data().count))
    .catch((err) => {
      console.error("[Events badge] count error:", err);
      setEventsCount(0);
    });
}, []);


  const router = useRouter();

  // Placeholder counts (wire later)
  const invitesPending = 0;
  const upcomingCount = 0;

const tiles: Tile[] = useMemo(
  () => [
    {
      key: 'find-match',
      title: 'Find Match',
      description: 'Match with players near you and start a chat.',
      icon: null,
      href: '/match',
      status: 'live',
      imageSrc: '/images/findmatchtile.jpg',
    },
    {
      key: 'events',
      title: 'Events',
      description: 'Browse games & social hits or host your own.',
      icon: null,
      href: '/events',
      status: 'live',
      imageSrc: '/images/eventtile.jpg',
      imagePosition: 'center 80%',
badge: (
  <span className="relative inline-flex items-center gap-2 rounded-full px-3.5 py-1 text-xs font-extrabold
                    text-white bg-emerald-600 ring-1 ring-white/60
                    shadow-[0_6px_20px_rgba(16,185,129,.45)]">
    {/* pulsing dot */}
    <span className="relative flex h-2.5 w-2.5">
      <span className="absolute inline-flex h-full w-full rounded-full bg-white/80 opacity-75 animate-ping"></span>
      <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-white"></span>
    </span>
    {eventsCount === 1 ? '1 available' : `${eventsCount} available`}
  </span>
),
    },
    {
      key: 'competitive',
      title: 'Competitive',
      description: 'Compete for ranking (coming soon).',
      icon: null,
      href: '#',
      actionLabel: 'Coming soon',
      status: 'soon',
      imageSrc: '/images/competitive.jpg',
    },
    {
      key: 'find-coach',
      title: 'Find a Coach',
      description: 'Book 1:1 or group lessons (coming soon).',
      icon: null,
      href: '#',
      actionLabel: 'Coming soon',
      status: 'soon',
      imageSrc: '/images/coach.jpg',
      imagePosition: 'center 20%',
    },
  ],
  [eventsCount]
);


  return (
    <main className="mx-auto w-full max-w-5xl px-4 py-6 sm:py-8">
{/* Header */}
<section className="mb-6 sm:mb-8">
  <div className="relative overflow-hidden rounded-2xl border shadow-md">
    {/* Background image */}
    <Image
      src="/images/welcome.jpg"
      alt="Welcome background"
      fill
      className="object-cover"
      priority
      style={{ objectPosition: 'center 20%' }}
    />
    {/* Overlay for readability */}
    <div className="absolute inset-0 bg-black/40" />

    {/* Content */}
    <div className="relative z-10 p-6 sm:p-8 text-white text-center">
      <div className="flex flex-col sm:flex-row items-center justify-center gap-3 sm:gap-4">
        <Image
          src="/logo.png"
          alt="TennisMate logo"
          width={56}
          height={56}
          className="rounded-xl shadow-sm ring-1 ring-white/20"
          priority
        />
        <div>
          <h1 className="text-3xl sm:text-4xl font-bold tracking-tight drop-shadow-md">
            Welcome to TennisMate
          </h1>
          <p className="mt-1 text-sm text-gray-100 drop-shadow max-w-[36rem] mx-auto">
            Your hub for finding matches, scheduling games, and (soon) competing &amp; training.
          </p>
        </div>
      </div>
    </div>
  </div>
</section>

      {/* Tiles */}
      <section aria-label="Primary actions">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {tiles.map(({ key, ...tileProps }) => (
            <ActionTile key={key} {...tileProps} />
          ))}
        </div>
      </section>
    </main>
  );
}

function ActionTile({
  title,
  description,
  href,
  icon,
  actionLabel,
  status,
  imageSrc, // ← add this
  imagePosition,
  badge,  
}: {
  title: string;
  description: string;
  href: string;
  icon: React.ReactNode | null;
  actionLabel: string;
  status: 'live' | 'soon';
  imageSrc?: string; // ← add this
  imagePosition?: string;
  badge?: React.ReactNode; 
}) {

  const isSoon = status === 'soon';

const content = (
  <Card
    className={cn(
      'group relative overflow-hidden p-5 transition hover:shadow-md hover:-translate-y-[1px] hover:ring-1 hover:ring-primary/20',
      isSoon && 'opacity-90'
    )}
  >
    {/* ↓↓↓ Background image for tiles that provide imageSrc */}
    {imageSrc && (
      <>
        <Image
          src={imageSrc}
          alt={title}
          fill
          className="object-cover transition-transform duration-300 group-hover:scale-105"
          priority={false}
          style={imagePosition ? { objectPosition: imagePosition } : undefined} 
        />
        <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-black/20 to-transparent" />
      </>
    )}

       {badge && (
        <div className="absolute right-3 top-3 z-10">
          {badge}
        </div>
      )}

    <div className="relative flex items-start justify-between gap-3">
      <div>
<div className="flex items-center gap-2">
  {icon && (
    <span
      className={cn(
        'inline-flex h-11 w-11 items-center justify-center rounded-xl ring-1 transition',
        imageSrc
          ? 'bg-white/90 text-foreground ring-white/70'
          : 'bg-muted text-foreground ring-border/60 group-hover:ring-primary/30'
      )}
    >
      {icon}
    </span>
  )}

  <h3
    className={cn(
      'text-lg font-semibold leading-tight',
      imageSrc ? 'text-white drop-shadow-[0_1px_1px_rgba(0,0,0,0.35)]' : ''
    )}
  >
    {title}
  </h3>
</div>


        {/* Description color adjusts if on an image */}
        <p
          className={cn(
            'mt-2 text-sm',
            imageSrc ? 'text-white/90' : 'text-muted-foreground'
          )}
        >
          {description}
        </p>

        <div className="mt-4 flex items-center gap-2">
          {isSoon ? (
            <Button disabled aria-disabled className={cn(imageSrc ? 'bg-white/70 text-foreground' : 'bg-muted text-foreground')}>
              <Construction className="h-4 w-4" /> {actionLabel}
            </Button>
          ) : (
            <Button className={cn(imageSrc ? '' : '')}>{actionLabel}</Button>
          )}

          {isSoon && (
            <span className={cn(
              'inline-flex items-center gap-1 rounded-full px-2 py-1 text-xs font-medium',
              imageSrc ? 'bg-white/80 text-amber-800' : 'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-200'
            )}>
              <CircleAlert className="h-3.5 w-3.5" /> Under construction
            </span>
          )}
        </div>
      </div>
    </div>
  </Card>
);


  if (isSoon) return content;

  return (
    <Link
      href={href}
      className="block focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-primary rounded-2xl"
    >
      {content}
    </Link>
  );
}
