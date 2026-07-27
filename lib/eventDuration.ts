export const EVENT_DURATION_OPTIONS = [30, 60, 90, 120] as const;

export type EventDurationMinutes = (typeof EVENT_DURATION_OPTIONS)[number];

export const DEFAULT_EVENT_DURATION_MINUTES: EventDurationMinutes = 90;
export const DEFAULT_EVENT_TIME_ZONE = "Australia/Melbourne";

export type EventTimingFields = {
  start?: string | null;
  end?: string | null;
  durationMinutes?: unknown;
  durationMins?: unknown;
};

export function isEventDurationMinutes(value: unknown): value is EventDurationMinutes {
  return (
    typeof value === "number" &&
    EVENT_DURATION_OPTIONS.includes(value as EventDurationMinutes)
  );
}

function durationFromRange(start?: string | null, end?: string | null): number | null {
  if (!start || !end) return null;

  const startMs = Date.parse(start);
  const endMs = Date.parse(end);
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) {
    return null;
  }

  const minutes = (endMs - startMs) / 60_000;
  return Number.isInteger(minutes) && minutes > 0 ? minutes : null;
}

/**
 * Reads the canonical field first, then the legacy field/range, and finally
 * applies the product default for older events with incomplete timing data.
 */
export function resolveEventDurationMinutes(
  event: EventTimingFields
): EventDurationMinutes {
  if (isEventDurationMinutes(event.durationMinutes)) {
    return event.durationMinutes;
  }
  if (isEventDurationMinutes(event.durationMins)) {
    return event.durationMins;
  }

  const rangeDuration = durationFromRange(event.start, event.end);
  return isEventDurationMinutes(rangeDuration)
    ? rangeDuration
    : DEFAULT_EVENT_DURATION_MINUTES;
}

export function resolveEventDisplayDurationMinutes(event: EventTimingFields): number {
  if (isEventDurationMinutes(event.durationMinutes)) return event.durationMinutes;
  if (typeof event.durationMins === "number" && event.durationMins > 0) {
    return event.durationMins;
  }
  return durationFromRange(event.start, event.end) ?? DEFAULT_EVENT_DURATION_MINUTES;
}

export function calculateEventEnd(
  start: Date,
  durationMinutes: EventDurationMinutes
): Date {
  return new Date(start.getTime() + durationMinutes * 60_000);
}

export function resolveEventEnd(event: EventTimingFields): Date | null {
  if (!event.start) return null;
  const start = new Date(event.start);
  if (!Number.isFinite(start.getTime())) return null;
  if (isEventDurationMinutes(event.durationMinutes)) {
    return calculateEventEnd(start, event.durationMinutes);
  }

  if (event.end) {
    const storedEnd = new Date(event.end);
    if (Number.isFinite(storedEnd.getTime()) && storedEnd.getTime() > start.getTime()) {
      return storedEnd;
    }
  }

  return calculateEventEnd(start, resolveEventDurationMinutes(event));
}

export function formatEventDuration(minutes: number): string {
  if (minutes < 60 || minutes % 30 !== 0) return `${minutes} minutes`;
  const hours = minutes / 60;
  return `${hours} ${hours === 1 ? "hour" : "hours"}`;
}
