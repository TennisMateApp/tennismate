import {
  collection,
  doc,
  getDocs,
  runTransaction,
  serverTimestamp,
} from "firebase/firestore";
import { db } from "@/lib/firebaseConfig";

export type ClubStatus = "member" | "none";

export type ClubSelection = {
  clubId: string | null;
  clubName: string | null;
  clubStatus: ClubStatus;
};

export type ClubSearchResult = {
  id: string;
  canonicalName: string;
  name: string;
  suburb: string;
  postcode: string;
};

export class ClubRequestDuplicateError extends Error {
  constructor() {
    super("This club has already been requested.");
    this.name = "ClubRequestDuplicateError";
  }
}

const normalize = (value: unknown) =>
  typeof value === "string"
    ? value.trim().replace(/\s+/g, " ").toLocaleLowerCase("en-AU")
    : "";

const readString = (value: unknown) =>
  typeof value === "string" ? value.trim().replace(/\s+/g, " ") : "";

let clubCache: Promise<ClubSearchResult[]> | null = null;

export function loadUniqueClubs(): Promise<ClubSearchResult[]> {
  if (clubCache) return clubCache;

  clubCache = getDocs(collection(db, "courts"))
    .then((snapshot) => {
      const unique = new Map<string, ClubSearchResult>();

      snapshot.forEach((courtDoc) => {
        const data = courtDoc.data() as Record<string, unknown>;
        const canonicalName = typeof data.name === "string" ? data.name : "";
        const name = readString(canonicalName);
        if (!name) return;

        const key = normalize(name);
        const candidate: ClubSearchResult = {
          id: courtDoc.id,
          canonicalName,
          name,
          suburb: readString(data.suburb) || readString(data.city),
          postcode: readString(data.postcode) || readString(data.post_code),
        };
        const current = unique.get(key);
        const candidateCompleteness = Number(Boolean(candidate.suburb)) + Number(Boolean(candidate.postcode));
        const currentCompleteness = current
          ? Number(Boolean(current.suburb)) + Number(Boolean(current.postcode))
          : -1;

        if (!current || candidateCompleteness > currentCompleteness) unique.set(key, candidate);
      });

      return Array.from(unique.values()).sort((a, b) => a.name.localeCompare(b.name));
    })
    .catch((error) => {
      clubCache = null;
      throw error;
    });

  return clubCache;
}

export function clubSelectionFromCourt(club: ClubSearchResult): ClubSelection {
  return {
    clubId: club.id,
    clubName: club.canonicalName,
    clubStatus: "member",
  };
}

function matchScore(club: ClubSearchResult, queryText: string): number | null {
  const query = normalize(queryText);
  if (!query) return null;

  const name = normalize(club.name);
  const suburb = normalize(club.suburb);
  const postcode = normalize(club.postcode);
  const fields = [name, suburb, postcode];
  if (!fields.some((field) => field.includes(query))) return null;

  if (name === query) return 0;
  if (postcode === query) return 1;
  if (suburb === query) return 2;
  if (name.startsWith(query)) return 3;
  if (name.split(/\s+/).some((word) => word.startsWith(query))) return 4;
  if (suburb.startsWith(query)) return 5;
  if (postcode.startsWith(query)) return 6;
  if (name.includes(query)) return 7;
  return 8;
}

export function searchClubs(
  clubs: ClubSearchResult[],
  queryText: string,
  limit = 8
): ClubSearchResult[] {
  return clubs
    .map((club) => ({ club, score: matchScore(club, queryText) }))
    .filter((item): item is { club: ClubSearchResult; score: number } => item.score !== null)
    .sort((a, b) => a.score - b.score || a.club.name.localeCompare(b.club.name))
    .slice(0, limit)
    .map(({ club }) => club);
}

async function requestDocumentId(clubName: string, suburb: string) {
  const normalizedIdentity = `${normalize(clubName)}|${normalize(suburb)}`;
  const bytes = new TextEncoder().encode(normalizedIdentity);
  const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes);
  const hash = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
  return `club-request-${hash}`;
}

export async function submitClubRequest(input: {
  clubName: string;
  suburb: string;
  submittedBy: string;
}) {
  const clubName = readString(input.clubName);
  const suburb = readString(input.suburb);
  if (!clubName || !suburb) throw new Error("Club name and suburb are required.");
  if (clubName.length > 100 || suburb.length > 80) throw new Error("Please shorten the club details.");

  const requestId = await requestDocumentId(clubName, suburb);
  const requestRef = doc(db, "clubRequests", requestId);

  await runTransaction(db, async (transaction) => {
    const existing = await transaction.get(requestRef);
    if (existing.exists()) throw new ClubRequestDuplicateError();

    transaction.set(requestRef, {
      clubName,
      suburb,
      submittedBy: input.submittedBy,
      submittedAt: serverTimestamp(),
      status: "pending",
    });
  });
}
