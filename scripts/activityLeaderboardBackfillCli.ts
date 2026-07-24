/* eslint-disable max-len, require-jsdoc, curly, brace-style, block-spacing */
export const PRODUCTION_PROJECT_ID = "tennismate-d8acb";
const VALUE_OPTIONS = new Set(["--month", "--limit", "--output", "--resume-from", "--batch-size", "--confirm-project", "--confirm-checksum"]);
const BOOLEAN_OPTIONS = new Set(["--write", "--reconcile"]);

export interface ActivityBackfillCliOptions {
  month: string | null; limit: number | null; output: string | null; resumeFrom: string | null; batchSize: number;
  write: boolean; reconcile: boolean; confirmProject: string | null; confirmChecksum: string | null;
}

export function parseActivityBackfillOptions(argv: string[], env: NodeJS.ProcessEnv = {} as NodeJS.ProcessEnv): ActivityBackfillCliOptions {
  const values = new Map<string, string>(); const flags = new Set<string>();
  const onlyBarePowerShellValues = argv.length > 0 && argv.every((argument) => !argument.startsWith("--"));
  if (onlyBarePowerShellValues) {
    const consumedNames = [...VALUE_OPTIONS].filter((name) => env[`npm_config_${name.slice(2).replaceAll("-", "_")}`] === "true");
    if (consumedNames.length !== argv.length) throw new Error("Ambiguous PowerShell npm arguments; invoke the script through npx tsx or use --name=value");
    consumedNames.forEach((name, index) => values.set(name, argv[index]));
    argv = [];
  }
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index]; const equalsIndex = argument.indexOf("=");
    if (equalsIndex > 0) { const name = argument.slice(0, equalsIndex); if (VALUE_OPTIONS.has(name)) values.set(name, argument.slice(equalsIndex + 1)); else throw new Error(`Unknown option: ${name}`); continue; }
    if (BOOLEAN_OPTIONS.has(argument)) { flags.add(argument); continue; }
    if (!VALUE_OPTIONS.has(argument)) throw new Error(`Unknown or ambiguous argument: ${argument}`);
    const next = argv[index + 1]; if (next === undefined || next.startsWith("--")) throw new Error(`${argument} requires a value`);
    values.set(argument, next); index += 1;
  }
  // PowerShell's npm shim exposes value options as npm_config_* variables.
  // Safety flags are deliberately never recovered from the environment.
  for (const name of VALUE_OPTIONS) { if (values.has(name)) continue; const value = env[`npm_config_${name.slice(2).replaceAll("-", "_")}`]; if (value && value !== "true" && value !== "false") values.set(name, value); }
  const month = values.get("--month") || null; if (month && !/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) throw new Error("--month must use YYYY-MM");
  const numberValue = (name: string, fallback: number | null): number | null => { const raw = values.get(name); if (!raw) return fallback; const parsed = Number(raw); if (!Number.isInteger(parsed) || parsed <= 0) throw new Error(`${name} must be a positive integer`); return parsed; };
  const write = flags.has("--write"); const reconcile = flags.has("--reconcile"); if (write && reconcile) throw new Error("--write and --reconcile are mutually exclusive");
  return {month, limit: numberValue("--limit", null), output: values.get("--output") || null, resumeFrom: values.get("--resume-from") || null, batchSize: numberValue("--batch-size", 20) as number, write, reconcile, confirmProject: values.get("--confirm-project") || null, confirmChecksum: values.get("--confirm-checksum") || null};
}

export function assertWriteSafeguards(options: ActivityBackfillCliOptions, activeProject: string | null, env: NodeJS.ProcessEnv = {} as NodeJS.ProcessEnv): void {
  if (!options.write) return;
  if (env.FIRESTORE_EMULATOR_HOST || env.FIREBASE_AUTH_EMULATOR_HOST || env.FUNCTIONS_EMULATOR) throw new Error("Production write mode refuses emulator environments");
  if (!activeProject || activeProject !== PRODUCTION_PROJECT_ID) throw new Error(`Unsupported active project: ${activeProject || "unknown"}`);
  if (options.confirmProject !== PRODUCTION_PROJECT_ID) throw new Error(`--confirm-project must equal ${PRODUCTION_PROJECT_ID}`);
  if (!options.confirmChecksum || !/^[a-f0-9]{64}$/.test(options.confirmChecksum)) throw new Error("--confirm-checksum is required and must be a SHA-256 checksum");
}

export function assertFreshChecksum(expected: string | null, actual: string): void {
  if (!expected || expected !== actual) throw new Error(`Preview freshness checksum mismatch: expected ${expected || "missing"}, actual ${actual}`);
}

export function activeProjectId(appOptions: {projectId?: string}, env: NodeJS.ProcessEnv): string | null {
  if (appOptions.projectId) return appOptions.projectId;
  for (const name of ["GOOGLE_CLOUD_PROJECT", "GCLOUD_PROJECT"]) if (env[name]) return env[name] as string;
  if (env.FIREBASE_CONFIG) { try { const parsed = JSON.parse(env.FIREBASE_CONFIG); if (typeof parsed.projectId === "string") return parsed.projectId; } catch { return null; } }
  return null;
}
