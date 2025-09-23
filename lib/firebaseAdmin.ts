// lib/firebaseAdmin.ts
import type { App } from "firebase-admin/app";
import { getApps, initializeApp, cert, applicationDefault } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { getMessaging } from "firebase-admin/messaging";
import { getAuth } from "firebase-admin/auth";

// ---- Prevent use on the client (protect secrets) ----
if (typeof window !== "undefined") {
  throw new Error("firebaseAdmin.ts must only be imported on the server.");
}

// ---- Singleton across hot-reloads (Next.js dev) ----
declare global {
  // eslint-disable-next-line no-var
  var _firebaseAdminApp: App | undefined;
}

function initAdminApp(): App {
  if (getApps().length) {
    return getApps()[0]!;
  }

  // Prefer explicit service account JSON if provided
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT_KEY;

  const credential = raw
    ? cert(JSON.parse(raw))
    : applicationDefault(); // falls back to GOOGLE_APPLICATION_CREDENTIALS or runtime IAM

  return initializeApp({ credential });
}

const adminApp = global._firebaseAdminApp ?? initAdminApp();
global._firebaseAdminApp = adminApp;

// Firestore: set any global settings once
const adminDB = getFirestore(adminApp);
adminDB.settings({ ignoreUndefinedProperties: true });

const adminMessaging = getMessaging(adminApp);
const adminAuth = getAuth(adminApp);

export { adminApp, adminDB, adminMessaging, adminAuth };
