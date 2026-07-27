export type VerifiedAuthUser = {
  emailVerified: boolean;
  reload: () => Promise<void>;
  getIdToken: (forceRefresh?: boolean) => Promise<string>;
};

export type VerifiedAuthSessionResult = {
  verified: boolean;
  tokenReady: boolean;
};

const refreshedUsers = new WeakSet<VerifiedAuthUser>();
const refreshesInFlight = new WeakMap<VerifiedAuthUser, Promise<VerifiedAuthSessionResult>>();

export async function ensureVerifiedAuthSession(
  user: VerifiedAuthUser,
  options: {force?: boolean} = {}
): Promise<VerifiedAuthSessionResult> {
  const inFlight = refreshesInFlight.get(user);
  if (inFlight) return inFlight;

  if (!options.force && refreshedUsers.has(user) && user.emailVerified) {
    return {verified: true, tokenReady: true};
  }

  const refresh = (async () => {
    await user.reload();
    if (!user.emailVerified) {
      return {verified: false, tokenReady: false};
    }

    await user.getIdToken(true);
    refreshedUsers.add(user);
    return {verified: true, tokenReady: true};
  })();

  refreshesInFlight.set(user, refresh);
  try {
    return await refresh;
  } finally {
    if (refreshesInFlight.get(user) === refresh) {
      refreshesInFlight.delete(user);
    }
  }
}
