import {applicationDefault, getApps, initializeApp} from "firebase-admin/app";
import {getFirestore} from "firebase-admin/firestore";
import {promises as fs} from "node:fs";
import path from "node:path";

const PROJECT_ID = "tennismate-d8acb";
const DEFAULT_CONCURRENCY = 5;
const DEFAULT_TIMEOUT_MS = 5000;
const MONTH_LIMIT = 24;
const ROW_LIMIT = 500;

export type AvatarProbeResult = "available" | "broken" | "transient";

export type AvatarAuditMonthInput = {
  month: string;
  avatarUrls: string[];
  rowCount: number;
};

export type AvatarAuditMonthReport = {
  month: string;
  rowsChecked: number;
  nonEmptyAvatarsChecked: number;
  brokenAvatars: number;
  transientFailures: number;
  regenerationRecommended: boolean;
};

export async function probeAvatarUrl(
  avatarUrl: string,
  fetcher: typeof fetch = fetch,
  timeoutMs = DEFAULT_TIMEOUT_MS,
): Promise<AvatarProbeResult> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetcher(avatarUrl, {method: "HEAD", signal: controller.signal});
    if (response.status === 404 || response.status === 410) return "broken";
    if (response.ok) return "available";
    return "transient";
  } catch {
    return "transient";
  } finally {
    clearTimeout(timeout);
  }
}

export async function auditAvatarUrls(
  input: AvatarAuditMonthInput,
  options: {concurrency?: number; fetcher?: typeof fetch; timeoutMs?: number} = {},
): Promise<AvatarAuditMonthReport> {
  const concurrency = Math.max(1, Math.min(options.concurrency || DEFAULT_CONCURRENCY, 10));
  const fetcher = options.fetcher || fetch;
  const results: AvatarProbeResult[] = new Array(input.avatarUrls.length);
  let cursor = 0;
  await Promise.all(Array.from({length: Math.min(concurrency, input.avatarUrls.length)}, async () => {
    while (cursor < input.avatarUrls.length) {
      const index = cursor++;
      results[index] = await probeAvatarUrl(input.avatarUrls[index], fetcher, options.timeoutMs);
    }
  }));
  const brokenAvatars = results.filter((result) => result === "broken").length;
  return {
    month: input.month,
    rowsChecked: input.rowCount,
    nonEmptyAvatarsChecked: input.avatarUrls.length,
    brokenAvatars,
    transientFailures: results.filter((result) => result === "transient").length,
    regenerationRecommended: brokenAvatars > 0,
  };
}

type AuditOptions = {month: string | null; output: string | null};

export function parseAvatarAuditOptions(
  argv: string[],
  env: Readonly<Record<string, string | undefined>> = process.env,
): AuditOptions {
  const value = (name: string) => {
    const equals = argv.find((item) => item.startsWith(`${name}=`));
    if (equals) return equals.slice(name.length + 1);
    const index = argv.indexOf(name);
    return index >= 0 ? argv[index + 1] : undefined;
  };
  const month = value("--month") || (env.npm_config_month && env.npm_config_month !== "true" ? env.npm_config_month : null);
  if (month && !/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) throw new Error("--month must use YYYY-MM");
  const npmOutput = env.npm_config_output && env.npm_config_output !== "true" ? env.npm_config_output : null;
  return {month, output: value("--output") || npmOutput || null};
}

async function publishedMonthInputs(month: string | null): Promise<AvatarAuditMonthInput[]> {
  if (!getApps().length) initializeApp({credential: applicationDefault(), projectId: PROJECT_ID});
  const db = getFirestore();
  const parents = month
    ? [await db.doc(`activity_leaderboards/${month}`).get()]
    : (await db.collection("activity_leaderboards").where("status", "==", "published").limit(MONTH_LIMIT).get()).docs;
  const inputs: AvatarAuditMonthInput[] = [];
  for (const parent of parents) {
    if (!parent.exists || parent.data()?.status !== "published") continue;
    const generationId = parent.data()?.publishedGenerationId;
    if (typeof generationId !== "string" || !generationId) continue;
    const rankings = await db.collection(`activity_leaderboards/${parent.id}/generations/${generationId}/rankings`).limit(ROW_LIMIT).get();
    inputs.push({
      month: parent.id,
      rowCount: rankings.size,
      avatarUrls: rankings.docs.map((item) => item.data().avatarUrl).filter((item): item is string => typeof item === "string" && item.trim().length > 0),
    });
  }
  return inputs.sort((left, right) => left.month.localeCompare(right.month));
}

async function main() {
  if (process.env.FIRESTORE_EMULATOR_HOST) throw new Error("Avatar audit refuses emulator state");
  const options = parseAvatarAuditOptions(process.argv.slice(2));
  const reports = [];
  for (const input of await publishedMonthInputs(options.month)) reports.push(await auditAvatarUrls(input));
  const report = {
    mode: "READ_ONLY_ACTIVITY_AVATAR_AUDIT",
    projectId: PROJECT_ID,
    generatedAt: new Date().toISOString(),
    months: reports,
    totals: {
      rowsChecked: reports.reduce((sum, item) => sum + item.rowsChecked, 0),
      brokenAvatars: reports.reduce((sum, item) => sum + item.brokenAvatars, 0),
      transientFailures: reports.reduce((sum, item) => sum + item.transientFailures, 0),
    },
    privacy: {containsPlayerIds: false, containsDisplayNames: false, containsAvatarUrls: false, containsTokens: false},
  };
  const serialized = `${JSON.stringify(report, null, 2)}\n`;
  if (options.output) await fs.writeFile(path.resolve(options.output), serialized, "utf8");
  console.log(serialized.trim());
}

if (require.main === module) {
  main().catch((error) => {
    console.error(JSON.stringify({script: "activityLeaderboardAvatarAudit", errorCategory: error instanceof Error ? error.name : "UNKNOWN"}));
    process.exitCode = 1;
  });
}
