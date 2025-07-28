export async function getMessagingClient() {
  if (typeof window === "undefined") return null;

  const [{ getApps }, { getMessaging, isSupported, getToken, onMessage }] = await Promise.all([
    import("firebase/app"),
    import("firebase/messaging"),
  ]);

  const supported = await isSupported();
  if (!supported) {
    console.warn("🚫 Messaging not supported");
    return null;
  }

  const app = getApps()[0];
  return {
    messaging: getMessaging(app),
    getToken,
    onMessage,
  };
}
