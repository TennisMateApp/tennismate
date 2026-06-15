const admin = require("firebase-admin");

function loadServiceAccount() {
  const candidates = [
    "../serviceAccountKey.json",
    "./serviceAccountKey.json",
  ];

  for (const candidate of candidates) {
    try {
      return require(candidate);
    } catch (error) {
      if (error?.code !== "MODULE_NOT_FOUND") throw error;
    }
  }

  throw new Error(
    "Could not find serviceAccountKey.json. Tried project root and scripts directory."
  );
}

admin.initializeApp({
  credential: admin.credential.cert(loadServiceAccount()),
});

const db = admin.firestore();
const auth = admin.auth();

async function listAuthUsers() {
  const usersByUid = new Map();
  let pageToken;

  do {
    const page = await auth.listUsers(1000, pageToken);
    for (const user of page.users) {
      usersByUid.set(user.uid, user);
    }
    pageToken = page.pageToken;
  } while (pageToken);

  return usersByUid;
}

function normalizeEmail(value) {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

async function main() {
  console.log("Starting TennisMate signup integrity check...");

  const [authUsersByUid, usersSnap, playersSnap, privateSnap] = await Promise.all([
    listAuthUsers(),
    db.collection("users").get(),
    db.collection("players").get(),
    db.collection("players_private").get(),
  ]);

  const playerIds = new Set(playersSnap.docs.map((doc) => doc.id));
  const userIds = new Set(usersSnap.docs.map((doc) => doc.id));
  const privateIds = new Set(privateSnap.docs.map((doc) => doc.id));

  const findings = {
    usersMissingPlayers: [],
    usersMissingPlayersPrivate: [],
    privateEmailMismatchAuth: [],
    userEmailMismatchAuth: [],
    privateWithoutUser: [],
  };

  for (const userDoc of usersSnap.docs) {
    const uid = userDoc.id;
    const data = userDoc.data() || {};
    const authUser = authUsersByUid.get(uid);
    const authEmail = normalizeEmail(authUser?.email);
    const userEmail = normalizeEmail(data.email);

    if (!playerIds.has(uid)) {
      findings.usersMissingPlayers.push({ uid, userEmail, authEmail });
    }

    if (!privateIds.has(uid)) {
      findings.usersMissingPlayersPrivate.push({ uid, userEmail, authEmail });
    }

    if (authEmail && userEmail && userEmail !== authEmail) {
      findings.userEmailMismatchAuth.push({ uid, userEmail, authEmail });
    }
  }

  for (const privateDoc of privateSnap.docs) {
    const uid = privateDoc.id;
    const data = privateDoc.data() || {};
    const authUser = authUsersByUid.get(uid);
    const authEmail = normalizeEmail(authUser?.email);
    const privateEmail = normalizeEmail(data.email);

    if (!userIds.has(uid)) {
      findings.privateWithoutUser.push({ uid, privateEmail, authEmail });
    }

    if (authEmail && privateEmail && privateEmail !== authEmail) {
      findings.privateEmailMismatchAuth.push({ uid, privateEmail, authEmail });
    }
  }

  const summary = Object.fromEntries(
    Object.entries(findings).map(([key, rows]) => [key, rows.length])
  );

  console.log("Integrity check summary:");
  console.table(summary);

  for (const [key, rows] of Object.entries(findings)) {
    console.log(`\n${key} (${rows.length})`);
    if (rows.length === 0) {
      console.log("  none");
      continue;
    }
    console.table(rows);
  }

  console.log("\nReport only. No data was changed.");
}

main().catch((error) => {
  console.error("Integrity check failed:", error);
  process.exitCode = 1;
});
