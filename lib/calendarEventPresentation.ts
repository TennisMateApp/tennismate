type CalendarEntryLike = {
  eventId?: string | null;
  inviteId?: string | null;
  type?: string | null;
  source?: string | null;
  title?: string | null;
};

export function isTennisEventCalendarEntry(entry?: CalendarEntryLike | null): boolean {
  if (!entry?.eventId) return false;

  const type = String(entry.type ?? "").toLowerCase();
  const source = String(entry.source ?? "").toLowerCase();
  const isMatchInvite = type === "invite" || source.includes("invite") || Boolean(entry.inviteId);

  return !isMatchInvite;
}

export function getCalendarEntryDisplayTitle(
  entry: CalendarEntryLike,
  opponentName: string
): string {
  if (!isTennisEventCalendarEntry(entry)) return opponentName;

  const eventTitle = typeof entry.title === "string" ? entry.title.trim() : "";
  return eventTitle || "Tennis Event";
}
