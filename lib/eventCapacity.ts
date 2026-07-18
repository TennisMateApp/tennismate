type EventCapacitySource = {
  hostId?: string | null;
  participants?: Array<string | null | undefined> | null;
  spotsFilled?: number | null;
};

export function countEventAttendees(
  hostId?: string | null,
  participants?: Array<string | null | undefined> | null
): number {
  return new Set(
    [hostId, ...(participants ?? [])]
      .map((value) => (typeof value === "string" ? value.trim() : ""))
      .filter(Boolean)
  ).size;
}

export function getEventFilledSpots(event: EventCapacitySource): number {
  const identityCount = countEventAttendees(event.hostId, event.participants);
  if (identityCount > 0) return identityCount;

  return typeof event.spotsFilled === "number" && event.spotsFilled > 0
    ? event.spotsFilled
    : 0;
}
