// lib/skill.ts
export type SkillBand =
  | "lower_beginner" | "beginner" | "upper_beginner"
  | "lower_intermediate" | "intermediate" | "upper_intermediate"
  | "lower_advanced" | "advanced" | "upper_advanced";

export const SKILL_OPTIONS: { value: SkillBand; label: string }[] = [
  { value: "lower_beginner", label: "Lower Beginner" },
  { value: "beginner", label: "Beginner" },
  { value: "upper_beginner", label: "Upper Beginner" },
  { value: "lower_intermediate", label: "Lower Intermediate" },
  { value: "intermediate", label: "Intermediate" },
  { value: "upper_intermediate", label: "Upper Intermediate" },
  { value: "lower_advanced", label: "Lower Advanced" },
  { value: "advanced", label: "Advanced" },
  { value: "upper_advanced", label: "Upper Advanced" },
];

export function clampUTR(n: number) {
  // UTR official scale is 1.00–16.50; clamp + round to 2dp for storage
  const x = Math.max(1, Math.min(16.5, n));
  return Math.round(x * 100) / 100;
}

/** Map UTR -> Skill band (approximate, tweakable) */
export function skillFromUTR(utr?: number | null): SkillBand | null {
  if (utr == null || Number.isNaN(utr)) return null;
  if (utr < 2.5) return "lower_beginner";
  if (utr < 3.4) return "beginner";
  if (utr < 4.4) return "upper_beginner";
  if (utr < 5.4) return "lower_intermediate";
  if (utr < 6.4) return "intermediate";
  if (utr < 7.4) return "upper_intermediate";
  if (utr < 9.0) return "lower_advanced";
  if (utr < 10.5) return "advanced";
  return "upper_advanced";
}
