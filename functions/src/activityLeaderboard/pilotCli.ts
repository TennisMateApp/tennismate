/* eslint-disable max-len, require-jsdoc, curly, brace-style, block-spacing */
export const PHASE2_PRODUCTION_PROJECT = "tennismate-d8acb";
export const PHASE2_CONTROLLED_PILOT_MONTHS = ["2025-12", "2026-02", "2026-03", "2026-04", "2026-07"] as const;
const VALUE_OPTIONS = new Set(["--month", "--confirm-project", "--confirm-source-checksum"]);
type EnvironmentVariables = Readonly<Record<string, string | undefined>>;

export interface Phase2PilotOptions {
  month: string | null;
  write: boolean;
  confirmProject: string | null;
  confirmSourceChecksum: string | null;
}

export function parsePhase2PilotOptions(argv: string[]): Phase2PilotOptions {
  const values = new Map<string, string>(); let write = false;
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index]; const equalsAt = argument.indexOf("=");
    if (argument === "--write") {write = true; continue;}
    if (equalsAt > 0) {const name = argument.slice(0, equalsAt); if (!VALUE_OPTIONS.has(name)) throw new Error(`Unknown option: ${name}`); values.set(name, argument.slice(equalsAt + 1)); continue;}
    if (!VALUE_OPTIONS.has(argument)) throw new Error(`Unknown or ambiguous option: ${argument}`);
    const next = argv[index + 1]; if (!next || next.startsWith("--")) throw new Error(`${argument} requires a value`); values.set(argument, next); index += 1;
  }
  const month = values.get("--month") || null;
  if (month && !/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) throw new Error("--month must use YYYY-MM");
  return {month, write, confirmProject: values.get("--confirm-project") || null, confirmSourceChecksum: values.get("--confirm-source-checksum") || null};
}

export function assertPhase2PilotSafeguards(options: Phase2PilotOptions, actualChecksum: string, env: EnvironmentVariables): void {
  if (!options.write) throw new Error("The pilot command requires --write and interactive confirmation");
  if (env.FIRESTORE_EMULATOR_HOST || env.FIREBASE_AUTH_EMULATOR_HOST || env.FUNCTIONS_EMULATOR) throw new Error("The production pilot refuses emulator environments");
  if (env.ACTIVITY_PHASE2_ENABLED !== "false") throw new Error("ACTIVITY_PHASE2_ENABLED must be explicitly false for a controlled pilot");
  if (!options.month || !PHASE2_CONTROLLED_PILOT_MONTHS.includes(options.month as typeof PHASE2_CONTROLLED_PILOT_MONTHS[number])) throw new Error("Pilot month is not in the controlled authorization set");
  if (env.ACTIVITY_PHASE2_PILOT_MONTH !== options.month) throw new Error("ACTIVITY_PHASE2_PILOT_MONTH must exactly lock the controlled execution month");
  if (options.confirmProject !== PHASE2_PRODUCTION_PROJECT) throw new Error(`--confirm-project must equal ${PHASE2_PRODUCTION_PROJECT}`);
  if (!options.confirmSourceChecksum || !/^[a-f0-9]{64}$/.test(options.confirmSourceChecksum)) throw new Error("--confirm-source-checksum must be a SHA-256 checksum");
  if (options.confirmSourceChecksum !== actualChecksum) throw new Error(`Pilot source checksum mismatch: expected ${options.confirmSourceChecksum}, actual ${actualChecksum}`);
}

export function phase2PilotConfirmation(month: string): string {return `${PHASE2_PRODUCTION_PROJECT} ${month} RECALCULATE`;}
export function isExactPhase2PilotAutomationConfirmation(value: string | undefined, month: string): boolean {return value === phase2PilotConfirmation(month);}
