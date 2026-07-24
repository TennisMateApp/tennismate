import {applicationDefault, getApps, initializeApp} from "firebase-admin/app";
import {getFirestore} from "firebase-admin/firestore";
import {promises as fs} from "node:fs";
import path from "node:path";
import {
  ACTIVITY_LEADERBOARD_ROW_FIELDS,
  parseActivityLeaderboardRow,
} from "../lib/activityLeaderboardModel";

const PROJECT = "tennismate-d8acb";
const EXPECTED: Record<string, number> = {
  "2025-12": 2,
  "2026-02": 3,
  "2026-03": 12,
  "2026-04": 10,
  "2026-05": 4,
  "2026-06": 2,
  "2026-07": 2,
};
const outputArg = process.argv.find((item) => item.startsWith("--output="));
const outputPath = path.resolve(outputArg?.slice("--output=".length) || "activity-leaderboard-phase3-production-read-validation.json");

async function main() {
  if (process.env.FIRESTORE_EMULATOR_HOST) throw new Error("Production read validation refuses emulator state");
  if (!getApps().length) initializeApp({credential: applicationDefault(), projectId: PROJECT});
  const db = getFirestore();
  const parentSnapshot = await db.collection("activity_leaderboards").get();
  const results = [];
  for (const [month, expectedRows] of Object.entries(EXPECTED)) {
    const parent = parentSnapshot.docs.find((item) => item.id === month);
    const parentData = parent?.data() || {};
    const generationId = parentData.publishedGenerationId;
    const generation = typeof generationId === "string" ? await db.doc(`activity_leaderboards/${month}/generations/${generationId}`).get() : null;
    const rankings = generation ? await generation.ref.collection("rankings").get() : null;
    const exactFields = rankings?.docs.every((item) => JSON.stringify(Object.keys(item.data()).sort()) === JSON.stringify([...ACTIVITY_LEADERBOARD_ROW_FIELDS].sort())) || false;
    const malformedRows = rankings?.docs.filter((item) => !parseActivityLeaderboardRow(item.data())).length || 0;
    const testAccountRows = rankings?.docs
      .map((item) => parseActivityLeaderboardRow(item.data()))
      .filter((item) => item?.displayName.trim().toLowerCase() === "test") || [];
    const retired = parent ? await parent.ref.collection("generations").where("status", "==", "retired").get() : null;
    results.push({
      month,
      pass: parentData.status === "published" && typeof generationId === "string" && generation?.data()?.status === "published" && rankings?.size === expectedRows && exactFields && malformedRows === 0 && retired?.size === 0,
      expectedRows,
      publishedRows: rankings?.size || 0,
      pointerPresent: typeof generationId === "string",
      generationPublished: generation?.data()?.status === "published",
      exactPublicFieldAllowlist: exactFields,
      malformedRows,
      testAccountRows: testAccountRows.length,
      testAccountRanks: testAccountRows.map((item) => item?.rank).filter((rank): rank is number => typeof rank === "number"),
      retiredGenerationCount: retired?.size || 0,
    });
  }
  const report = {
    mode: "READ_ONLY_PHASE3_PRODUCTION_VALIDATION",
    projectId: PROJECT,
    generatedAt: new Date().toISOString(),
    pass: results.every((item) => item.pass) && parentSnapshot.size === 7,
    publishedMonthCount: parentSnapshot.size,
    months: results,
    privacy: {
      containsPlayerIds: false,
      containsDisplayNames: false,
      containsAvatarUrls: false,
      containsPrivateProfileFields: false,
    },
  };
  await fs.writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  console.log(JSON.stringify({...report, outputPath}, null, 2));
  if (!report.pass) process.exitCode = 1;
}

main().catch((error) => {
  console.error(JSON.stringify({script: "validateActivityLeaderboardPhase3", errorCategory: error instanceof Error ? error.name : "UNKNOWN"}));
  process.exitCode = 1;
});
