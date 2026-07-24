/* eslint-disable max-len, require-jsdoc */
export interface ParticipantExtraction {
  participantIds: [string, string] | [];
  validUidCount: number;
  selfMatch: boolean;
}

function cleanUid(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const cleaned = value.trim();
  return cleaned.length > 0 ? cleaned : null;
}

export function extractParticipants(source: {
  players?: unknown;
  fromUserId?: unknown;
  toUserId?: unknown;
}): ParticipantExtraction {
  const candidates: unknown[] = Array.isArray(source.players) ? [...source.players] : [];
  candidates.push(source.fromUserId, source.toUserId);
  const cleaned = candidates.map(cleanUid).filter((uid): uid is string => uid !== null);
  const unique = Array.from(new Set(cleaned)).sort((a, b) => a.localeCompare(b));
  const selfMatch = cleaned.length >= 2 && unique.length === 1;

  return {
    participantIds: unique.length === 2 ? [unique[0], unique[1]] : [],
    validUidCount: unique.length,
    selfMatch,
  };
}

export function buildPairId(participantIds: [string, string]): string {
  // Compatibility with the existing repository convention. This delimiter can
  // theoretically collide when custom Auth UIDs contain underscores.
  return [...participantIds].sort((a, b) => a.localeCompare(b)).join("_");
}
