const admin = require("firebase-admin");
const serviceAccount = require("../serviceAccountKey.json");

const UID = "cJP6OyLswneVoJWKXbNwlLjl2AK2";

function logUser(label, userRecord) {
  console.log(`${label}:`, {
    email: userRecord.email || null,
    uid: userRecord.uid,
    emailVerified: userRecord.emailVerified,
  });
}

async function main() {
  try {
    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount),
    });

    const before = await admin.auth().getUser(UID);
    logUser("Before update", before);

    await admin.auth().updateUser(UID, {
      emailVerified: true,
    });

    const after = await admin.auth().getUser(UID);
    logUser("After update", after);
  } catch (error) {
    console.error("Failed to verify Firebase Auth user:", error);
    process.exitCode = 1;
  }
}

void main();