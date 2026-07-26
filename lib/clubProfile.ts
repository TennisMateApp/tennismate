import {
  collection,
  doc,
  documentId,
  getCountFromServer,
  getDoc,
  getDocs,
  limit,
  orderBy,
  query,
  startAfter,
  where,
  type DocumentData,
} from "firebase/firestore";
import { db } from "@/lib/firebaseConfig";
import { resolveSmallProfilePhoto } from "@/lib/profilePhoto";
import { SKILL_OPTIONS, skillFromUTR, type SkillBand } from "@/lib/skills";
import { getClubExternalLinks } from "@/lib/clubExternalLinks";

export type ClubProfile = {
  id: string;
  name: string;
  suburb: string;
  postcode: string;
  description: string;
  bookingUrl: string | null;
  officialWebsiteUrl: string | null;
};

export type ClubMember = {
  id: string;
  name: string;
  skill: string;
  availability: string[];
  photoUrl: string | null;
};

const readString = (value: unknown) => (typeof value === "string" ? value.trim() : "");

function skillLabel(data: DocumentData): string {
  const explicit = readString(data.skillBandLabel) || readString(data.skillLevel);
  if (explicit) return explicit;

  const band = readString(data.skillBand) as SkillBand | "";
  if (band) {
    return SKILL_OPTIONS.find((option) => option.value === band)?.label
      || band.split("_").map((word) => word.charAt(0).toUpperCase() + word.slice(1)).join(" ");
  }

  const rating = typeof data.skillRating === "number"
    ? data.skillRating
    : typeof data.utr === "number"
      ? data.utr
      : null;
  if (rating !== null) {
    const ratingBand = skillFromUTR(rating);
    if (ratingBand) return SKILL_OPTIONS.find((option) => option.value === ratingBand)?.label || ratingBand;
  }

  return "Skill not set";
}

function memberFromData(id: string, data: DocumentData): ClubMember {
  return {
    id,
    name: readString(data.name) || "TennisMate Player",
    skill: skillLabel(data),
    availability: Array.isArray(data.availability)
      ? data.availability.filter((slot: unknown): slot is string => typeof slot === "string" && Boolean(slot.trim()))
      : [],
    photoUrl: resolveSmallProfilePhoto(data),
  };
}

export async function getClubProfile(courtId: string): Promise<ClubProfile | null> {
  const snapshot = await getDoc(doc(db, "courts", courtId));
  if (!snapshot.exists()) return null;
  const data = snapshot.data();
  const name = readString(data.name);
  if (!name) return null;

  const suburb = readString(data.suburb) || readString(data.city);
  const postcode = readString(data.postcode) || readString(data.post_code);
  const description = readString(data.description) || readString(data.about);
  const { bookingUrl, officialWebsiteUrl } = getClubExternalLinks(data);

  return { id: snapshot.id, name, suburb, postcode, description, bookingUrl, officialWebsiteUrl };
}

const membersQuery = (courtId: string) => query(
  collection(db, "players"),
  where("clubId", "==", courtId)
);

export async function getClubMemberCount(courtId: string): Promise<number> {
  const snapshot = await getCountFromServer(membersQuery(courtId));
  return snapshot.data().count;
}

export async function getClubMembersPage(input: {
  courtId: string;
  pageSize: number;
  afterId?: string | null;
}): Promise<{ members: ClubMember[]; nextCursor: string | null }> {
  const constraints = [
    where("clubId", "==", input.courtId),
    orderBy(documentId()),
    ...(input.afterId ? [startAfter(input.afterId)] : []),
    limit(input.pageSize + 1),
  ];
  const snapshot = await getDocs(query(collection(db, "players"), ...constraints));
  const hasMore = snapshot.docs.length > input.pageSize;
  const visible = snapshot.docs.slice(0, input.pageSize);

  return {
    members: visible.map((member) => memberFromData(member.id, member.data())),
    nextCursor: hasMore && visible.length ? visible[visible.length - 1].id : null,
  };
}
