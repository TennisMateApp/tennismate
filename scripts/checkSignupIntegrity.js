const admin = require("firebase-admin");
const fs = require("node:fs");
const path = require("node:path");

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

function csvEscape(value) {
  const text = value == null ? "" : String(value);
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function getRecommendedAction({
  authExists,
  userExists,
  playerExists,
  privateExists,
  waitlistUserExists,
}) {
  if (waitlistUserExists) return "WAITLIST_IGNORE";
  if (authExists && playerExists && privateExists && !userExists) return "CREATE_USER";
  if (authExists && userExists && !playerExists) return "CREATE_PLAYER";
  if (authExists && userExists && !privateExists) return "CREATE_PRIVATE";
  if (privateExists && (!authExists || !userExists || !playerExists)) {
    return "DELETE_ORPHAN_PRIVATE";
  }
  return "REVIEW";
}

async function main() {
  console.log("Starting TennisMate signup integrity check...");

  const [authUsersByUid, usersSnap, playersSnap, privateSnap, waitlistSnap] = await Promise.all([
    listAuthUsers(),
    db.collection("users").get(),
    db.collection("players").get(),
    db.collection("players_private").get(),
    db.collection("waitlist_users").get(),
  ]);

  const playerIds = new Set(playersSnap.docs.map((doc) => doc.id));
  const userIds = new Set(usersSnap.docs.map((doc) => doc.id));
  const privateIds = new Set(privateSnap.docs.map((doc) => doc.id));
  const waitlistIds = new Set(waitlistSnap.docs.map((doc) => doc.id));
  const usersByUid = new Map(usersSnap.docs.map((doc) => [doc.id, doc.data() || {}]));
  const privateByUid = new Map(privateSnap.docs.map((doc) => [doc.id, doc.data() || {}]));

  const findings = {
    usersMissingPlayers: [],
    usersMissingPlayersPrivate: [],
    privateEmailMismatchAuth: [],
    userEmailMismatchAuth: [],
    privateWithoutUser: [],
  };
  const privateWithoutUserGroups = {
    privateOnly: [],
    privateAndAuth: [],
    privateAndPlayer: [],
    privateAndAuthAndPlayer: [],
  };

  for (const userDoc of usersSnap.docs) {
    const uid = userDoc.id;
    const data = userDoc.data() || {};
    const authUser = authUsersByUid.get(uid);
    const authEmail = normalizeEmail(authUser?.email);
    const userEmail = normalizeEmail(data.email);

    if (!waitlistIds.has(uid) && !playerIds.has(uid)) {
      findings.usersMissingPlayers.push({ uid, userEmail, authEmail });
    }

    if (!waitlistIds.has(uid) && !privateIds.has(uid)) {
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
      const hasAuth = authUsersByUid.has(uid);
      const hasUser = userIds.has(uid);
      const hasPlayer = playerIds.has(uid);
      const row = { uid, privateEmail, authEmail, hasAuth, hasUser, hasPlayer };

      findings.privateWithoutUser.push(row);

      if (hasAuth && hasPlayer) {
        privateWithoutUserGroups.privateAndAuthAndPlayer.push(row);
      } else if (hasAuth) {
        privateWithoutUserGroups.privateAndAuth.push(row);
      } else if (hasPlayer) {
        privateWithoutUserGroups.privateAndPlayer.push(row);
      } else {
        privateWithoutUserGroups.privateOnly.push(row);
      }
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

  console.log("\nprivateWithoutUser grouped counts:");
  console.table({
    "A. Private only": privateWithoutUserGroups.privateOnly.length,
    "B. Private + Auth": privateWithoutUserGroups.privateAndAuth.length,
    "C. Private + Player": privateWithoutUserGroups.privateAndPlayer.length,
    "D. Private + Auth + Player": privateWithoutUserGroups.privateAndAuthAndPlayer.length,
  });

  for (const [label, rows] of [
    ["A. Private only", privateWithoutUserGroups.privateOnly],
    ["B. Private + Auth", privateWithoutUserGroups.privateAndAuth],
    ["C. Private + Player", privateWithoutUserGroups.privateAndPlayer],
    ["D. Private + Auth + Player", privateWithoutUserGroups.privateAndAuthAndPlayer],
  ]) {
    console.log(`\n${label} (${rows.length})`);
    if (rows.length === 0) {
      console.log("  none");
      continue;
    }
    console.table(rows);
  }

  const allUids = new Set([
    ...authUsersByUid.keys(),
    ...userIds,
    ...playerIds,
    ...privateIds,
    ...waitlistIds,
  ]);

  const csvRows = Array.from(allUids)
    .sort()
    .map((uid) => {
      const authUser = authUsersByUid.get(uid);
      const userData = usersByUid.get(uid) || {};
      const privateData = privateByUid.get(uid) || {};
      const authExists = authUsersByUid.has(uid);
      const userExists = userIds.has(uid);
      const playerExists = playerIds.has(uid);
      const privateExists = privateIds.has(uid);
      const waitlistUserExists = waitlistIds.has(uid);
      const email =
        normalizeEmail(authUser?.email) ||
        normalizeEmail(userData.email) ||
        normalizeEmail(privateData.email);

      return {
        uid,
        email,
        authExists,
        userExists,
        playerExists,
        privateExists,
        waitlistUserExists,
        recommendedAction: getRecommendedAction({
          authExists,
          userExists,
          playerExists,
          privateExists,
          waitlistUserExists,
        }),
      };
    });

  const csvHeaders = [
    "uid",
    "email",
    "authExists",
    "userExists",
    "playerExists",
    "privateExists",
    "waitlistUserExists",
    "recommendedAction",
  ];
  const csv = [
    csvHeaders.join(","),
    ...csvRows.map((row) => csvHeaders.map((header) => csvEscape(row[header])).join(",")),
  ].join("\n");
  const reportPath = path.join(process.cwd(), "signup-integrity-report.csv");
  fs.writeFileSync(reportPath, `${csv}\n`, "utf8");

  console.log(`\nCSV report written to ${reportPath}`);

  console.log("\nReport only. No data was changed.");
}

main().catch((error) => {
  console.error("Integrity check failed:", error);
  process.exitCode = 1;
});
