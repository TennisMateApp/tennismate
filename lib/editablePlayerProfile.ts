export type EditablePlayerProfileInput = {
  name: string;
  postcode: string;
  bio: string;
  availability: string[];
  gender: string | null;
  isMatchable: boolean;
  skillBand: string | null;
  skillBandLabel: string | null;
  skillRating: number | null;
  skillLevel: string;
  photoURL: string;
  photoThumbURL: string;
};

/** Public player fields that profile owners are intentionally allowed to edit. */
export function buildEditablePlayerProfileUpdate(input: EditablePlayerProfileInput) {
  const name = input.name.trim();

  return {
    name,
    nameLower: name.toLowerCase(),
    postcode: input.postcode,
    bio: input.bio,
    availability: input.availability,
    gender: input.gender,
    isMatchable: input.isMatchable,
    skillBand: input.skillBand,
    skillBandLabel: input.skillBandLabel,
    skillRating: input.skillRating,
    utr: input.skillRating,
    skillLevel: input.skillLevel,
    photoURL: input.photoURL,
    photoThumbURL: input.photoThumbURL,
    avatar: input.photoThumbURL || input.photoURL || null,
    profileComplete: true,
  };
}
