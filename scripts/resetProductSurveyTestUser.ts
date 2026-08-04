import {applicationDefault, deleteApp, initializeApp} from "firebase-admin/app";
import {getFirestore} from "firebase-admin/firestore";

const SURVEY_ID = "product-survey-2026-08";
const PRODUCTION_PROJECT_ID = "tennismate-d8acb";

type ResetOptions = {
  uid: string;
  project: string;
  confirmProject: string | null;
  confirmDocument: string | null;
  write: boolean;
};

export function surveyResetTargets(uid: string) {
  return {
    documentPath: `surveyResponses/${SURVEY_ID}_${uid}`,
    localStorageKey: `tm_survey_dismissed_${SURVEY_ID}_${uid}`,
  };
}

export function parseResetOptions(argv: string[], emulatorHost?: string): ResetOptions {
  const values = new Map<string, string>();
  let write = false;

  for (const argument of argv) {
    if (argument === "--write") {
      write = true;
      continue;
    }
    const separator = argument.indexOf("=");
    if (separator <= 2) throw new Error(`Unknown argument: ${argument}`);
    const name = argument.slice(0, separator);
    if (!["--uid", "--project", "--confirm-project", "--confirm-document"].includes(name)) {
      throw new Error(`Unknown argument: ${name}`);
    }
    values.set(name, argument.slice(separator + 1));
  }

  const uid = values.get("--uid")?.trim() ?? "";
  if (!uid || uid.length > 128 || uid.includes("/")) {
    throw new Error("--uid is required and must be one Firebase Auth UID without a slash");
  }

  const project = values.get("--project")?.trim() || (emulatorHost ? "demo-tennismate-survey-reset" : "");
  if (!project) throw new Error("--project is required when FIRESTORE_EMULATOR_HOST is not set");

  return {
    uid,
    project,
    confirmProject: values.get("--confirm-project")?.trim() || null,
    confirmDocument: values.get("--confirm-document")?.trim() || null,
    write,
  };
}

export function assertResetIsSafe(options: ResetOptions, emulatorHost?: string) {
  const targets = surveyResetTargets(options.uid);

  if (emulatorHost) {
    if (!options.project.startsWith("demo-")) {
      throw new Error("Emulator resets require a demo-* project ID");
    }
    return targets;
  }

  if (options.project !== PRODUCTION_PROJECT_ID) {
    throw new Error(`Live test-user resets are restricted to ${PRODUCTION_PROJECT_ID}`);
  }
  if (options.confirmProject !== PRODUCTION_PROJECT_ID) {
    throw new Error(`--confirm-project must equal ${PRODUCTION_PROJECT_ID}`);
  }
  if (options.confirmDocument !== targets.documentPath) {
    throw new Error(`--confirm-document must exactly equal ${targets.documentPath}`);
  }
  return targets;
}

async function main() {
  const emulatorHost = process.env.FIRESTORE_EMULATOR_HOST;
  const options = parseResetOptions(process.argv.slice(2), emulatorHost);
  const targets = assertResetIsSafe(options, emulatorHost);
  const app = initializeApp({
    ...(emulatorHost ? {} : {credential: applicationDefault()}),
    projectId: options.project,
  }, `survey-reset-${Date.now()}`);

  try {
    const reference = getFirestore(app).doc(targets.documentPath);
    const snapshot = await reference.get();

    console.log(`Target project: ${options.project}${emulatorHost ? ` (emulator ${emulatorHost})` : ""}`);
    console.log(`Target document: ${targets.documentPath}`);
    console.log(`Document exists: ${snapshot.exists}`);
    console.log(`Browser localStorage key: ${targets.localStorageKey}`);

    if (snapshot.exists) {
      const data = snapshot.data();
      if (data?.surveyId !== SURVEY_ID || data?.userId !== options.uid) {
        throw new Error("Target document data does not match the fixed survey ID and requested UID; refusing deletion");
      }
    }

    if (!options.write) {
      console.log("Preview only. Re-run with --write after verifying the exact target above.");
      return;
    }

    if (snapshot.exists) await reference.delete();
    console.log(snapshot.exists ? "Survey response deleted." : "No survey response existed; nothing was deleted.");
    console.log(`In the same browser used for testing, run: localStorage.removeItem(${JSON.stringify(targets.localStorageKey)})`);
  } finally {
    await deleteApp(app);
  }
}

const invokedAsScript = process.argv[1]?.replace(/\\/g, "/").endsWith("/scripts/resetProductSurveyTestUser.ts");
if (invokedAsScript) {
  void main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
