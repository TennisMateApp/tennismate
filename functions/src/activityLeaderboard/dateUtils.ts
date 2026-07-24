/* eslint-disable max-len, require-jsdoc */
import {ACTIVITY_TIME_ZONE} from "./config";

type TimestampLike = { toDate: () => Date };

const DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/;

function isValidParts(year: number, month: number, day: number): boolean {
  const check = new Date(Date.UTC(year, month - 1, day));
  return check.getUTCFullYear() === year && check.getUTCMonth() === month - 1 && check.getUTCDate() === day;
}

function zonedParts(date: Date): { year: number; month: number; day: number } {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: ACTIVITY_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const value = (type: string) => Number(parts.find((part) => part.type === type)?.value);
  return {year: value("year"), month: value("month"), day: value("day")};
}

function melbourneMidnight(year: number, month: number, day: number): Date | null {
  if (!isValidParts(year, month, day)) return null;
  const localMidnightAsUtc = Date.UTC(year, month - 1, day);
  let offsetMinutes = 10 * 60;
  let result = new Date(localMidnightAsUtc - offsetMinutes * 60 * 1000);
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const zoneName = new Intl.DateTimeFormat("en-AU", {
      timeZone: ACTIVITY_TIME_ZONE,
      timeZoneName: "longOffset",
    }).formatToParts(result).find((part) => part.type === "timeZoneName")?.value;
    const match = zoneName?.match(/^GMT([+-])(\d{2}):(\d{2})$/);
    if (!match) return null;
    const sign = match[1] === "+" ? 1 : -1;
    offsetMinutes = sign * (Number(match[2]) * 60 + Number(match[3]));
    result = new Date(localMidnightAsUtc - offsetMinutes * 60 * 1000);
  }
  const finalParts = zonedParts(result);
  return finalParts.year === year && finalParts.month === month && finalParts.day === day ? result : null;
}

export function parseActivityDate(value: unknown, dateOnlyInMelbourne = false): Date | null {
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : new Date(value.getTime());
  }
  if (value && typeof (value as TimestampLike).toDate === "function") {
    const converted = (value as TimestampLike).toDate();
    return converted instanceof Date && !Number.isNaN(converted.getTime()) ? converted : null;
  }
  if (typeof value !== "string" || value.trim().length === 0) return null;
  const cleaned = value.trim();
  const dateOnlyMatch = cleaned.match(DATE_ONLY);
  if (dateOnlyMatch && dateOnlyInMelbourne) {
    return melbourneMidnight(Number(dateOnlyMatch[1]), Number(dateOnlyMatch[2]), Number(dateOnlyMatch[3]));
  }
  const millis = Date.parse(cleaned);
  return Number.isNaN(millis) ? null : new Date(millis);
}

export function monthKeyFor(date: Date): string {
  const {year, month} = zonedParts(date);
  return `${year}-${String(month).padStart(2, "0")}`;
}

export function weekKeyFor(date: Date): string {
  const local = zonedParts(date);
  const calendarDate = new Date(Date.UTC(local.year, local.month - 1, local.day));
  const day = calendarDate.getUTCDay() || 7;
  calendarDate.setUTCDate(calendarDate.getUTCDate() + 4 - day);
  const weekYear = calendarDate.getUTCFullYear();
  const yearStart = new Date(Date.UTC(weekYear, 0, 1));
  const week = Math.ceil((((calendarDate.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
  return `${weekYear}-W${String(week).padStart(2, "0")}`;
}

export function activityDateMonthDisagreement(
  playedDateValue: unknown,
  completedAtValue: unknown
): {playedDateMonth: string; completedAtMonth: string} | null {
  const playedDate = parseActivityDate(playedDateValue, true);
  const completedAt = parseActivityDate(completedAtValue);
  if (!playedDate || !completedAt) return null;
  const playedDateMonth = monthKeyFor(playedDate);
  const completedAtMonth = monthKeyFor(completedAt);
  return playedDateMonth === completedAtMonth ? null : {
    playedDateMonth,
    completedAtMonth,
  };
}
