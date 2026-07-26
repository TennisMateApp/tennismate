type CourtLinkFields = Record<string, unknown>;

function readString(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

export function normalizeClubExternalUrl(value: unknown): string | null {
  const raw = readString(value);
  if (!raw) return null;
  const candidate = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
  try {
    const parsed = new URL(candidate);
    return parsed.protocol === "http:" || parsed.protocol === "https:" ? parsed.toString() : null;
  } catch {
    return null;
  }
}

export function getClubExternalLinks(data: CourtLinkFields) {
  const bookingUrl = normalizeClubExternalUrl(
    data.bookingUrl
      ?? data.bookingURL
      ?? data.bookingLink
      ?? data.booking_link
  );
  const possibleOfficialWebsite = normalizeClubExternalUrl(
    data.officialWebsite
      ?? data.clubWebsite
      ?? data.website
      ?? data.websiteUrl
      ?? data.officialUrl
  );

  return {
    bookingUrl,
    officialWebsiteUrl: possibleOfficialWebsite && possibleOfficialWebsite !== bookingUrl
      ? possibleOfficialWebsite
      : null,
  };
}
