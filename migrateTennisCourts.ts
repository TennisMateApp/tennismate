import * as admin from "firebase-admin";

// Initialize Firebase Admin
admin.initializeApp({
  credential: admin.credential.applicationDefault(),
});

const db = admin.firestore();

async function migrateCourts() {
  const sourceRef = db.collection("tennis courts");
  const targetRef = db.collection("courts");

  const snapshot = await sourceRef.get();
  const batch = db.batch();

  if (snapshot.empty) {
    console.log("❌ No courts found in 'tennis courts' collection.");
    return;
  }

  snapshot.forEach((doc) => {
    const newDocRef = targetRef.doc(doc.id); // Keep same ID
    batch.set(newDocRef, doc.data());
  });

  await batch.commit();
  console.log(`✅ Migrated ${snapshot.size} court(s) to 'courts' collection.`);
}

migrateCourts().catch((err) => {
  console.error("❌ Migration failed:", err);
});
