const admin = require("firebase-admin");

const serviceAccount = require("./serviceAccountKey.json");

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

const db = admin.firestore();
const auth = admin.auth();

async function backfillUsers() {
  console.log("🔄 Starting backfill...");

  const playersSnap = await db.collection("players").get();

  for (const doc of playersSnap.docs) {
    const player = doc.data();
    const email = player.email;
    const name = player.name;

    if (!email || !name) {
      console.warn(`⚠️ Skipping player missing name or email: ${doc.id}`);
      continue;
    }

    try {
      // Find user in Firebase Auth by email
      const userRecord = await auth.getUserByEmail(email);
      const uid = userRecord.uid;

      // Check if users/{uid} already exists
      const userDocRef = db.collection("users").doc(uid);
      const userDoc = await userDocRef.get();

      if (userDoc.exists) {
        console.log(`✅ Already exists: ${email}`);
        continue;
      }

      // Create new user doc
      await userDocRef.set({
        name,
        email,
      });

      console.log(`📝 Created users/${uid} for ${email}`);
    } catch (err) {
      console.error(`❌ Could not process ${email}:`, err.message);
    }
  }

  console.log("✅ Backfill complete.");
}

backfillUsers();
