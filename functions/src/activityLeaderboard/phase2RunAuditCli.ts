/* eslint-disable max-len, require-jsdoc, curly, brace-style, block-spacing */
import {PHASE2_JUNE_PILOT_CHECKSUM, PHASE2_JUNE_PILOT_MONTH} from "./phase2RunAudit";
import {PHASE2_PRODUCTION_PROJECT} from "./pilotCli";

const VALUE_OPTIONS = new Set(["--month", "--confirm-project", "--confirm-source-checksum"]);
export const PHASE2_AUDIT_RECONSTRUCTION_CONFIRMATION = `${PHASE2_PRODUCTION_PROJECT} 2026-06 RECONSTRUCT AUDIT`;
type EnvironmentVariables = Readonly<Record<string, string | undefined>>;

export function isExactPhase2AuditAutomationConfirmation(value: string | undefined): boolean {return value === PHASE2_AUDIT_RECONSTRUCTION_CONFIRMATION;}

export interface Phase2AuditReconstructionOptions {
  month: string | null;
  write: boolean;
  confirmProject: string | null;
  confirmSourceChecksum: string | null;
}

export function parsePhase2AuditReconstructionOptions(argv: string[]): Phase2AuditReconstructionOptions {
  const values = new Map<string, string>(); let write = false;
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index]; const equalsAt = argument.indexOf("=");
    if (argument === "--write") {write = true; continue;}
    if (equalsAt > 0) {const name = argument.slice(0, equalsAt); if (!VALUE_OPTIONS.has(name)) throw new Error(`Unknown option: ${name}`); values.set(name, argument.slice(equalsAt + 1)); continue;}
    if (!VALUE_OPTIONS.has(argument)) throw new Error(`Unknown or ambiguous option: ${argument}`);
    const next = argv[index + 1]; if (!next || next.startsWith("--")) throw new Error(`${argument} requires a value`); values.set(argument, next); index += 1;
  }
  return {month: values.get("--month") || null, write, confirmProject: values.get("--confirm-project") || null, confirmSourceChecksum: values.get("--confirm-source-checksum") || null};
}

export function assertPhase2AuditReconstructionSafeguards(options: Phase2AuditReconstructionOptions, env: EnvironmentVariables): void {
  if (options.month && options.month !== PHASE2_JUNE_PILOT_MONTH) throw new Error(`Reconstruction month must equal ${PHASE2_JUNE_PILOT_MONTH}`);
  if (options.confirmProject && options.confirmProject !== PHASE2_PRODUCTION_PROJECT) throw new Error(`--confirm-project must equal ${PHASE2_PRODUCTION_PROJECT}`);
  if (options.confirmSourceChecksum && options.confirmSourceChecksum !== PHASE2_JUNE_PILOT_CHECKSUM) throw new Error("--confirm-source-checksum must equal the verified June checksum");
  if (!options.write) return;
  if (env.FIRESTORE_EMULATOR_HOST || env.FIREBASE_AUTH_EMULATOR_HOST || env.FUNCTIONS_EMULATOR) throw new Error("Production audit reconstruction refuses emulator environments");
  if (env.ACTIVITY_PHASE2_AUDIT_RECONSTRUCTION_ENABLED !== "true") throw new Error("ACTIVITY_PHASE2_AUDIT_RECONSTRUCTION_ENABLED must equal true");
  if (options.month !== PHASE2_JUNE_PILOT_MONTH || options.confirmProject !== PHASE2_PRODUCTION_PROJECT || options.confirmSourceChecksum !== PHASE2_JUNE_PILOT_CHECKSUM) throw new Error("Production reconstruction requires explicit month, project, and checksum guards");
}
