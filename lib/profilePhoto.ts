import { ref, listAll, deleteObject, type FirebaseStorage } from "firebase/storage";

export const PROFILE_FULL_PATH = (uid: string) => `profile_pictures/${uid}/avatar_full.jpg`;
export const PROFILE_THUMB_PATH = (uid: string) => `profile_pictures/${uid}/avatar_thumb.jpg`;

export function withPhotoCacheBust(url: string | null | undefined, version: string | number): string {
  if (typeof url !== "string" || !url.trim()) return "";
  const separator = url.includes("?") ? "&" : "?";
  return `${url}${separator}v=${encodeURIComponent(String(version))}`;
}

export function resolveProfilePhoto(data: any): string | null {
  if (!data || typeof data !== "object") return null;

  const thumb =
    typeof data.photoThumbURL === "string" && data.photoThumbURL.trim()
      ? data.photoThumbURL.trim()
      : null;
  if (thumb) return thumb;

  const full =
    typeof data.photoURL === "string" && data.photoURL.trim()
      ? data.photoURL.trim()
      : typeof data.photoUrl === "string" && data.photoUrl.trim()
      ? data.photoUrl.trim()
      : null;
  if (full) return full;

  const legacy =
    typeof data.avatar === "string" && data.avatar.trim()
      ? data.avatar.trim()
      : typeof data.avatarUrl === "string" && data.avatarUrl.trim()
      ? data.avatarUrl.trim()
      : null;

  return legacy;
}

export async function cleanupLegacyProfilePhotos(storage: FirebaseStorage, uid: string) {
  const dirRef = ref(storage, `profile_pictures/${uid}`);

  try {
    const listing = await listAll(dirRef);
    const keep = new Set(["avatar_full.jpg", "avatar_thumb.jpg"]);

    await Promise.all(
      listing.items
        .filter((item) => !keep.has(item.name))
        .map((item) =>
          deleteObject(item).catch((error) => {
            console.warn("[ProfilePhoto] failed to delete legacy image", item.fullPath, error);
          })
        )
    );
  } catch (error) {
    console.warn("[ProfilePhoto] legacy cleanup skipped", error);
  }
}
