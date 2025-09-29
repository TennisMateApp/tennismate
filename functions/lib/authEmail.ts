// lib/authEmail.ts
import { sendEmailVerification, type ActionCodeSettings, type User } from "firebase/auth";

const APP_URL = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";

// NOTE: If you configured a Firebase Dynamic Link domain, set NEXT_PUBLIC_FIREBASE_DYNAMIC_LINK_DOMAIN
// Otherwise you can omit dynamicLinkDomain.
const dynamicLinkDomain = process.env.NEXT_PUBLIC_FIREBASE_DYNAMIC_LINK_DOMAIN;

export const verificationActionCodeSettings: ActionCodeSettings = {
  url: `${APP_URL}/auth/action`,          // this page will handle the oobCode
  handleCodeInApp: true,                  // ensures links open on your domain
  ...(dynamicLinkDomain ? { dynamicLinkDomain } : {}),
};

export async function sendVerificationEmail(user: User) {
  // Only send if not already verified
  if (!user || user.emailVerified) return;
  await sendEmailVerification(user, verificationActionCodeSettings);
}
