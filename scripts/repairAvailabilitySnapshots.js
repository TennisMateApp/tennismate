const admin = require("firebase-admin");

const serviceAccount = require("../firebase-service-account.json");

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

const db = admin.firestore();

const DRY_RUN = !process.argv.includes("--write");

function hasText(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function hasUsablePublicPlayerProfile(data) {
  if (!data || typeof data !== "object") return false;

  const hasSkill =
    hasText(data.skillLevel) ||
    hasText(data.skillBand) ||
    (typeof data.skillRating === "number" && Number.isFinite(data.skillRating)) ||
    (typeof data.utr === "number" && Number.isFinite(data.utr));

  return hasText(data.name) && hasText(data.postcode) && hasSkill;
}

function resolveProfilePhoto(data) {
  if (!data || typeof data !== "object") return null;

  for (const key of ["photoThumbURL", "photoURL", "photoUrl", "avatar", "avatarUrl"]) {
    if (hasText(data[key])) return data[key].trim();
  }

  return null;
}

function needsRepair(data) {
  return (
    !hasText(data.name) ||
    data.name.trim().toLowerCase() === "player" ||
    !hasText(data.photoURL) ||
    !hasText(data.photoThumbURL)
  );
}

function publicAvailabilitySnapshot(player) {
  const photo = resolveProfilePhoto(player);

  return {
    name: player.name.trim(),
    photoURL: photo,
    photoThumbURL: hasText(player.photoThumbURL) ? player.photoThumbURL.trim() : photo,
    postcode: hasText(player.postcode) ? player.postcode.trim() : "",
    skillBand: hasText(player.skillBand) ? player.skillBand.trim() : "",
    skillBandLabel: hasText(player.skillBandLabel) ? player.skillBandLabel.trim() : null,
    skillLevel: hasText(player.skillLevel) ? player.skillLevel.trim() : null,
    skillRating:
      typeof player.skillRating === "number" && Number.isFinite(player.skillRating)
        ? player.skillRating
        : null,
    utr:
      typeof player.utr === "number" && Number.isFinite(player.utr) ? player.utr : null,
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  };
}

async function main() {
  const availabilitySnap = await db.collection("availabilities").get();
  const manualRepair = [];
  const orphaned = [];
  let repairable = 0;
  let repaired = 0;

  for (const docSnap of availabilitySnap.docs) {
    const availability = docSnap.data();

    const userId = hasText(availability.userId)
      ? availability.userId.trim()
      : hasText(availability.uid)
      ? availability.uid.trim()
      : docSnap.id;

    const playerSnap = await db.collection("players").doc(userId).get();
    const player = playerSnap.exists ? playerSnap.data() : null;

    if (!playerSnap.exists) {
      orphaned.push({
        availabilityId: docSnap.id,
        userId,
        status: availability.status || null,
        name: availability.name || null,
        reason: "players/{uid} does not exist",
      });
      continue;
    }

    if (!needsRepair(availability)) continue;

    if (!playerSnap.exists || !hasUsablePublicPlayerProfile(player)) {
      manualRepair.push({
        availabilityId: docSnap.id,
        userId,
        reason: "players/{uid} exists but is missing public profile fields",
        playerKeys: player ? Object.keys(player).sort() : [],
      });
      continue;
    }

    repairable += 1;
    const patch = publicAvailabilitySnapshot(player);

    console.log(`${DRY_RUN ? "[dry-run]" : "[write]"} repair ${docSnap.id}`, patch);

    if (!DRY_RUN) {
      await docSnap.ref.set(patch, { merge: true });
      repaired += 1;
    }
  }

  console.log(
    JSON.stringify(
      {
        dryRun: DRY_RUN,
        scanned: availabilitySnap.size,
        repairable,
        repaired,
        orphaned,
        manualRepair,
      },
      null,
      2
    )
  );
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
