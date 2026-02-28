export type BadgeId =
  | "mvp"
  | "firstMatch"
  | "firstMatchComplete"
  | "firstWin";

export const BADGE_CATALOG: Array<{
  id: BadgeId;
  title: string;
  subtitle?: string;

  icon: string;        // unlocked svg
  iconLocked: string;  // locked svg
}> = [
 {
  id: "mvp",
  title: "MVP",
  subtitle: "Top performer",
  icon: "/badges/mvp-badge.svg",
  iconLocked: "/badges/mvp-badge.svg",
},
{
  id: "firstMatch",
  title: "First Match",
  subtitle: "Get your first match",
  icon: "/badges/first-match.svg",
  iconLocked: "/badges/first-match-locked.svg",
},
{
  id: "firstMatchComplete",
  title: "Complete",
  subtitle: "Finish a match",
  icon: "/badges/first-match-complete.svg",
  iconLocked: "/badges/first-match-complete-locked.svg",
},
{
  id: "firstWin",
  title: "First Win",
  subtitle: "Win a match",
  icon: "/badges/first-win.svg",
  iconLocked: "/badges/first-win-locked.svg",
},
];
