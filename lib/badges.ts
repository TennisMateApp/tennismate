export type BadgeId =
  | "mvp"
  | "firstMatch"
  | "firstMatchComplete"
  | "firstWin";

export const BADGE_CATALOG: Array<{
  id: BadgeId;
  title: string;

  icon: string;        // unlocked svg
  iconLocked: string;  // locked svg
}> = [
  {
    id: "mvp",
    title: "MVP",
    icon: "/badges/mvp-badge.svg",
    iconLocked: "/badges/mvp-badge.svg", // if MVP is always unlocked, keep same
  },
  {
    id: "firstMatch",
    title: "First Match",
    icon: "/badges/first-match.svg",
    iconLocked: "/badges/first-match-locked.svg",
  },
  {
    id: "firstMatchComplete",
    title: "Complete",
    icon: "/badges/first-match-complete.svg",
    iconLocked: "/badges/first-match-complete-locked.svg",
  },
  {
    id: "firstWin",
    title: "First Win",
    icon: "/badges/first-win.svg",
    iconLocked: "/badges/first-win-locked.svg",
  },
];
