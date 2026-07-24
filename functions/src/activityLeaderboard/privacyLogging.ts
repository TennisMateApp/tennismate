/* eslint-disable max-len, require-jsdoc */
import {createHash} from "crypto";

const HASH_LENGTH = 16;

export function privacySafeRefHash(value: string | null | undefined): string | null {
  if (!value) return null;
  return createHash("sha256").update(value).digest("hex").slice(0, HASH_LENGTH);
}

export interface ActivityPersistenceLog {
  operation: "create" | "update" | "delete";
  sourceRefHash: string;
  eventRefHash: string | null;
  duplicateGroupRefHash: string | null;
  resolutionSource: "automatic" | "manual" | "pending" | "none";
  oldMonthKey: string | null;
  newMonthKey: string | null;
  collision: boolean;
  dirtyMonthCount: number;
}

export function activityPersistenceLog(input: {
  operation: ActivityPersistenceLog["operation"];
  sourceDocumentId: string;
  canonicalEventId: string | null;
  duplicateGroupKey: string | null;
  resolutionSource: ActivityPersistenceLog["resolutionSource"];
  oldMonthKey: string | null;
  newMonthKey: string | null;
  collision: boolean;
  dirtyMonthCount: number;
}): ActivityPersistenceLog {
  return {
    operation: input.operation,
    sourceRefHash: privacySafeRefHash(input.sourceDocumentId) as string,
    eventRefHash: privacySafeRefHash(input.canonicalEventId),
    duplicateGroupRefHash: privacySafeRefHash(input.duplicateGroupKey),
    resolutionSource: input.resolutionSource,
    oldMonthKey: input.oldMonthKey,
    newMonthKey: input.newMonthKey,
    collision: input.collision,
    dirtyMonthCount: input.dirtyMonthCount,
  };
}
