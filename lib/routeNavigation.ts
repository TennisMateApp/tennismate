/**
 * Canonical route-to-navigation configuration for the TennisMate application shell.
 * Route components must not supply or derive desktop/mobile active destinations.
 */
export const APPROVED_SCREEN_TITLES = [
  "Home",
  "Chat",
  "Search",
  "Directory",
  "Find a Match",
  "Match Me",
  "My Matches",
  "Messages",
  "Players",
  "Events",
  "Calendar",
  "Clubs",
  "Coaches",
  "Courts",
  "Activity Leaderboard",
  "Profile",
] as const;

export type ApprovedScreenTitle = (typeof APPROVED_SCREEN_TITLES)[number];

export const PRIMARY_NAVIGATION_ITEMS = [
  { label: "Home", href: "/home" },
  { label: "Chat", href: "/messages" },
  { label: "Calendar", href: "/calendar" },
  { label: "Search", href: "/directory" },
  { label: "Profile", href: "/profile" },
] as const satisfies ReadonlyArray<{ label: ApprovedScreenTitle; href: string }>;

export type PrimaryNavigationDestination =
  (typeof PRIMARY_NAVIGATION_ITEMS)[number]["label"];

export type RouteNavigationConfig = {
  screenTitle: string;
  parentNavigationDestination: string | null;
  desktopActiveDestination: PrimaryNavigationDestination | null;
  mobileActiveDestination: PrimaryNavigationDestination | null;
  showBackButton: boolean;
  fallbackRoute: string;
  usesStandardApplicationHeader: boolean;
};

type RouteRule = RouteNavigationConfig & {
  matches: (pathname: string) => boolean;
};

const exact = (route: string) => (pathname: string) => pathname === route;
const under = (route: string) => (pathname: string) =>
  pathname === route || pathname.startsWith(`${route}/`);

const routeRules: readonly RouteRule[] = [
  {
    matches: exact("/home"),
    screenTitle: "Home",
    parentNavigationDestination: null,
    desktopActiveDestination: "Home",
    mobileActiveDestination: "Home",
    showBackButton: false,
    fallbackRoute: "/home",
    usesStandardApplicationHeader: false,
  },
  {
    matches: exact("/match"),
    screenTitle: "Find a Match",
    parentNavigationDestination: "/home",
    desktopActiveDestination: null,
    mobileActiveDestination: null,
    showBackButton: true,
    fallbackRoute: "/home",
    usesStandardApplicationHeader: false,
  },
  {
    matches: under("/matches"),
    screenTitle: "My Matches",
    parentNavigationDestination: "/home",
    desktopActiveDestination: null,
    mobileActiveDestination: null,
    showBackButton: true,
    fallbackRoute: "/home",
    usesStandardApplicationHeader: false,
  },
  {
    matches: (pathname) => pathname.startsWith("/messages/"),
    screenTitle: "Messages",
    parentNavigationDestination: "/messages",
    desktopActiveDestination: "Chat",
    mobileActiveDestination: "Chat",
    showBackButton: true,
    fallbackRoute: "/messages",
    usesStandardApplicationHeader: false,
  },
  {
    matches: exact("/messages"),
    screenTitle: "Messages",
    parentNavigationDestination: null,
    desktopActiveDestination: "Chat",
    mobileActiveDestination: "Chat",
    showBackButton: false,
    fallbackRoute: "/home",
    usesStandardApplicationHeader: false,
  },
  {
    matches: under("/directory"),
    screenTitle: "Directory",
    parentNavigationDestination: null,
    desktopActiveDestination: "Search",
    mobileActiveDestination: "Search",
    showBackButton: false,
    fallbackRoute: "/home",
    usesStandardApplicationHeader: false,
  },
  {
    matches: exact("/events/new"),
    screenTitle: "Events",
    parentNavigationDestination: "/events",
    desktopActiveDestination: null,
    mobileActiveDestination: null,
    showBackButton: true,
    fallbackRoute: "/events",
    usesStandardApplicationHeader: false,
  },
  {
    matches: under("/events"),
    screenTitle: "Events",
    parentNavigationDestination: "/calendar",
    desktopActiveDestination: null,
    mobileActiveDestination: null,
    showBackButton: true,
    fallbackRoute: "/home",
    usesStandardApplicationHeader: false,
  },
  {
    matches: exact("/calendar"),
    screenTitle: "Calendar",
    parentNavigationDestination: null,
    desktopActiveDestination: "Calendar",
    mobileActiveDestination: "Calendar",
    showBackButton: true,
    fallbackRoute: "/home",
    usesStandardApplicationHeader: false,
  },
  {
    matches: under("/profile"),
    screenTitle: "Profile",
    parentNavigationDestination: "/home",
    desktopActiveDestination: "Profile",
    mobileActiveDestination: "Profile",
    showBackButton: true,
    fallbackRoute: "/home",
    usesStandardApplicationHeader: false,
  },
  {
    matches: exact("/activity-leaderboard"),
    screenTitle: "Activity Leaderboard",
    parentNavigationDestination: "/home",
    desktopActiveDestination: null,
    mobileActiveDestination: null,
    showBackButton: true,
    fallbackRoute: "/home",
    usesStandardApplicationHeader: false,
  },
  {
    matches: under("/clubs"),
    screenTitle: "Clubs",
    parentNavigationDestination: "/directory",
    desktopActiveDestination: null,
    mobileActiveDestination: null,
    showBackButton: true,
    fallbackRoute: "/directory",
    usesStandardApplicationHeader: true,
  },
  {
    matches: under("/coaches"),
    screenTitle: "Coaches",
    parentNavigationDestination: "/directory",
    desktopActiveDestination: null,
    mobileActiveDestination: null,
    showBackButton: true,
    fallbackRoute: "/directory",
    usesStandardApplicationHeader: true,
  },
  {
    matches: under("/coach/profile"),
    screenTitle: "Coaches",
    parentNavigationDestination: "/coaches",
    desktopActiveDestination: null,
    mobileActiveDestination: null,
    showBackButton: true,
    fallbackRoute: "/coaches",
    usesStandardApplicationHeader: true,
  },
  {
    matches: exact("/courts"),
    screenTitle: "Courts",
    parentNavigationDestination: "/directory",
    desktopActiveDestination: null,
    mobileActiveDestination: null,
    showBackButton: true,
    fallbackRoute: "/directory",
    usesStandardApplicationHeader: true,
  },
  {
    matches: under("/players"),
    screenTitle: "Players",
    parentNavigationDestination: "/directory",
    desktopActiveDestination: "Search",
    mobileActiveDestination: "Search",
    showBackButton: true,
    fallbackRoute: "/directory",
    usesStandardApplicationHeader: true,
  },
  {
    matches: under("/invites"),
    screenTitle: "My Matches",
    parentNavigationDestination: "/messages",
    desktopActiveDestination: "Chat",
    mobileActiveDestination: "Chat",
    showBackButton: true,
    fallbackRoute: "/messages",
    usesStandardApplicationHeader: true,
  },
  {
    matches: exact("/support"),
    screenTitle: "Support",
    parentNavigationDestination: "/profile",
    desktopActiveDestination: null,
    mobileActiveDestination: null,
    showBackButton: true,
    fallbackRoute: "/profile",
    usesStandardApplicationHeader: true,
  },
  {
    matches: (pathname) => pathname === "/privacy" || pathname === "/terms" || pathname.startsWith("/legal/"),
    screenTitle: "Legal",
    parentNavigationDestination: null,
    desktopActiveDestination: null,
    mobileActiveDestination: null,
    showBackButton: true,
    fallbackRoute: "/login",
    usesStandardApplicationHeader: false,
  },
  {
    matches: (pathname) => pathname === "/login" || pathname === "/signup" || pathname === "/signup-v2",
    screenTitle: "Account",
    parentNavigationDestination: null,
    desktopActiveDestination: null,
    mobileActiveDestination: null,
    showBackButton: false,
    fallbackRoute: "/login",
    usesStandardApplicationHeader: false,
  },
  {
    matches: exact("/forgot-password"),
    screenTitle: "Reset password",
    parentNavigationDestination: "/login",
    desktopActiveDestination: null,
    mobileActiveDestination: null,
    showBackButton: true,
    fallbackRoute: "/login",
    usesStandardApplicationHeader: false,
  },
  {
    matches: (pathname) => pathname.startsWith("/verify-") || pathname === "/verified",
    screenTitle: "Verify email",
    parentNavigationDestination: "/login",
    desktopActiveDestination: null,
    mobileActiveDestination: null,
    showBackButton: false,
    fallbackRoute: "/login",
    usesStandardApplicationHeader: false,
  },
  {
    matches: exact("/waitlist"),
    screenTitle: "Waitlist",
    parentNavigationDestination: null,
    desktopActiveDestination: null,
    mobileActiveDestination: null,
    showBackButton: false,
    fallbackRoute: "/login",
    usesStandardApplicationHeader: false,
  },
  {
    matches: exact("/"),
    screenTitle: "TennisMate",
    parentNavigationDestination: null,
    desktopActiveDestination: null,
    mobileActiveDestination: null,
    showBackButton: false,
    fallbackRoute: "/login",
    usesStandardApplicationHeader: false,
  },
];

const fallbackConfig: RouteNavigationConfig = {
  screenTitle: "TennisMate",
  parentNavigationDestination: "/home",
  desktopActiveDestination: null,
  mobileActiveDestination: null,
  showBackButton: true,
  fallbackRoute: "/home",
  usesStandardApplicationHeader: false,
};

export function normalizeNavigationPathname(pathname: string): string {
  const withoutQuery = (pathname || "/").split(/[?#]/, 1)[0] || "/";
  return withoutQuery.length > 1 ? withoutQuery.replace(/\/+$/, "") : withoutQuery;
}

export function getRouteNavigation(pathname: string): RouteNavigationConfig {
  const normalized = normalizeNavigationPathname(pathname);
  const rule = routeRules.find((candidate) => candidate.matches(normalized));
  if (!rule) return fallbackConfig;

  const { matches: _matches, ...config } = rule;
  return config;
}
