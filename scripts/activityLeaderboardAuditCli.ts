export interface ActivityAuditOptions {
  month: string | null;
  limit: number | null;
  output: string | null;
}

const VALUE_OPTIONS = new Set(["--month", "--limit", "--output"]);

export function parseActivityAuditOptions(
  argv: string[],
  env: NodeJS.ProcessEnv = {} as NodeJS.ProcessEnv
): ActivityAuditOptions {
  const values = new Map<string, string>();

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    const equalsIndex = argument.indexOf("=");
    if (equalsIndex > 0) {
      const name = argument.slice(0, equalsIndex);
      if (VALUE_OPTIONS.has(name)) values.set(name, argument.slice(equalsIndex + 1));
      continue;
    }
    if (!VALUE_OPTIONS.has(argument)) continue;
    const next = argv[index + 1];
    if (next === undefined || next.startsWith("--")) {
      throw new Error(`${argument} requires a value`);
    }
    values.set(argument, next);
    index += 1;
  }

  // Windows PowerShell can route `npm` through npm.ps1, which consumes options
  // following `--` as npm config values instead of forwarding process argv.
  // npm exposes those values to lifecycle scripts using npm_config_*.
  for (const name of VALUE_OPTIONS) {
    if (values.has(name)) continue;
    const envName = `npm_config_${name.slice(2).replaceAll("-", "_")}`;
    const envValue = env[envName];
    if (typeof envValue === "string" && envValue.length > 0 &&
      envValue !== "true" && envValue !== "false") {
      values.set(name, envValue);
    }
  }

  const month = values.get("--month") || null;
  if (month && !/^\d{4}-\d{2}$/.test(month)) {
    throw new Error("--month must use YYYY-MM");
  }
  const limitValue = values.get("--limit") || null;
  const limit = limitValue === null ? null : Number(limitValue);
  if (limit !== null && (!Number.isInteger(limit) || limit <= 0)) {
    throw new Error("--limit must be a positive integer");
  }
  const output = values.get("--output") || null;
  return {month, limit, output};
}

export function expectedAuditArgumentsWereLost(
  argv: string[],
  env: NodeJS.ProcessEnv,
  options: ActivityAuditOptions
): boolean {
  if (argv.some((argument) => VALUE_OPTIONS.has(argument) ||
    Array.from(VALUE_OPTIONS).some((name) => argument.startsWith(`${name}=`)))) {
    return false;
  }
  const npmOriginalArgv = env.npm_config_argv || "";
  const expectedByOriginalArgv = Array.from(VALUE_OPTIONS)
    .some((name) => npmOriginalArgv.includes(name));
  const expectedByConfig = Array.from(VALUE_OPTIONS).some((name) => {
    const envName = `npm_config_${name.slice(2).replaceAll("-", "_")}`;
    return typeof env[envName] === "string" && env[envName] !== "";
  });
  const noneParsed = options.month === null &&
    options.limit === null && options.output === null;
  return (expectedByOriginalArgv || expectedByConfig) && noneParsed;
}
