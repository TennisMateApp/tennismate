export type PostcodeEligibility =
  | { kind: "invalid"; postcode: string }
  | { kind: "unsupported"; postcode: string }
  | { kind: "unknown"; postcode: string }
  | { kind: "supported"; postcode: string; lat: number; lng: number };

export function classifyPostcode(
  rawPostcode: string,
  record: Record<string, unknown> | null
): PostcodeEligibility {
  const postcode = rawPostcode.trim();
  if (!/^\d{4}$/.test(postcode)) return { kind: "invalid", postcode };
  if (postcode[0] !== "2" && postcode[0] !== "3") {
    return { kind: "unsupported", postcode };
  }
  if (!record) return { kind: "unknown", postcode };
  const lat = record.lat;
  const lng = record.lng;
  if (typeof lat !== "number" || !Number.isFinite(lat) || typeof lng !== "number" || !Number.isFinite(lng)) {
    return { kind: "unknown", postcode };
  }
  return { kind: "supported", postcode, lat, lng };
}

