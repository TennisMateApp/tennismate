// lib/authEmail.ts
import { sendEmailVerification, type ActionCodeSettings, type User } from "firebase/auth";

const VERIFIED_URL = "https://tennis-mate.com.au/verified";

export const verificationActionCodeSettings: ActionCodeSettings = {
  url: VERIFIED_URL,
  handleCodeInApp: false,
};

export async function sendVerificationEmail(user: User) {
  if (!user || user.emailVerified) return;
  await sendEmailVerification(user, verificationActionCodeSettings);
}
