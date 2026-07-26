import { isOnboardingV2Destination } from "@/lib/onboardingV2";
import { classifyVerificationError, safeNextDestination } from "@/lib/verificationFlow";

export const VERIFICATION_ACTION_TIMEOUT_MS = 12_000;

export type VerificationActionState =
  | "checking"
  | "success"
  | "alreadyVerified"
  | "expired"
  | "invalid"
  | "networkError"
  | "unexpectedError";

export type VerificationActionResult = {
  state: Exclude<VerificationActionState, "checking">;
  reason?: "timeout" | "firebase" | "malformed" | "unexpected";
};

type VerificationActionDependencies = {
  waitForAuthReady?: () => Promise<void>;
  isCurrentUserVerified: () => boolean;
  applyCode: (code: string) => Promise<void>;
  reloadCurrentUser: () => Promise<void>;
};

export async function processVerificationAction(input: {
  code: string | null | undefined;
  mode: string | null | undefined;
  dependencies: VerificationActionDependencies;
  timeoutMs?: number;
}): Promise<VerificationActionResult> {
  const { code, mode, dependencies } = input;

  const work = async (): Promise<VerificationActionResult> => {
    try {
      await dependencies.waitForAuthReady?.();
      if (dependencies.isCurrentUserVerified()) {
        return { state: "alreadyVerified" };
      }
      if (!code || mode !== "verifyEmail") {
        return { state: "invalid", reason: "malformed" };
      }

      await dependencies.applyCode(code);
      await dependencies.reloadCurrentUser().catch(() => undefined);
      return { state: "success" };
    } catch (error) {
      await dependencies.reloadCurrentUser().catch(() => undefined);
      if (dependencies.isCurrentUserVerified()) {
        return { state: "alreadyVerified" };
      }

      const category = classifyVerificationError(error);
      if (category === "expired") return { state: "expired", reason: "firebase" };
      if (category === "network") return { state: "networkError", reason: "firebase" };
      if (category === "invalid" || category === "already_used") {
        return { state: "invalid", reason: "firebase" };
      }
      return { state: "unexpectedError", reason: "unexpected" };
    }
  };

  return new Promise<VerificationActionResult>((resolve) => {
    let settled = false;
    const timer = globalThis.setTimeout(() => {
      if (settled) return;
      settled = true;
      resolve({ state: "networkError", reason: "timeout" });
    }, input.timeoutMs ?? VERIFICATION_ACTION_TIMEOUT_MS);

    void work().then((result) => {
      if (settled) return;
      settled = true;
      globalThis.clearTimeout(timer);
      resolve(result);
    });
  });
}

export function createVerificationActionRunner() {
  let activeKey: string | null = null;
  let activePromise: Promise<VerificationActionResult> | null = null;

  return (
    key: string,
    run: () => Promise<VerificationActionResult>
  ): Promise<VerificationActionResult> => {
    if (activeKey === key && activePromise) return activePromise;
    activeKey = key;
    activePromise = run();
    return activePromise;
  };
}

export function verificationOpenDestination(value: string | null | undefined) {
  const safe = safeNextDestination(value, "/login");
  return isOnboardingV2Destination(safe) ? safe : safe;
}
