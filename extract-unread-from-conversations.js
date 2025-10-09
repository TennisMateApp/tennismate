// extract-unread-from-conversations.js
const admin = require("firebase-admin");
const fs = require("fs");
const path = require("path");

if (process.argv.length < 3) {
  console.error("Usage: node extract-unread-from-conversations.js /path/to/serviceAccountKey.json");
  process.exit(1);
}
const keyPath = path.resolve(process.argv[2]);
admin.initializeApp({ credential: admin.credential.cert(require(keyPath)) });
const db = admin.firestore();

const USERS_COLLECTION = "users";
const PAGE_SIZE = 500;

async function main() {
  const unreadCounts = new Map(); // uid -> count
  const seenUsers = new Set();

  let lastDoc = null;
  while (true) {
    let q = db.collectionGroup("messages").where("read", "==", false).limit(PAGE_SIZE);
    if (lastDoc) q = q.startAfter(lastDoc);
    const snap = await q.get();
    if (snap.empty) break;

    for (const doc of snap.docs) {
      const data = doc.data() || {};
      const senderId = data.senderId || data.fromUserId || null;
      const convRef = doc.ref.parent.parent;
      if (!convRef) continue;

      const convSnap = await convRef.get();
      if (!convSnap.exists) continue;
      const conv = convSnap.data() || {};
      const participants = Array.isArray(conv.participants) ? conv.participants : [];
      const recipients = participants.filter(uid => !senderId || uid !== senderId);

      for (const uid of recipients) {
        seenUsers.add(uid);
        unreadCounts.set(uid, (unreadCounts.get(uid) || 0) + 1);
      }
    }
    lastDoc = snap.docs[snap.docs.length - 1];
    if (snap.size < PAGE_SIZE) break;
  }

  // Fetch user profiles for name/email
  const uids = Array.from(seenUsers);
  const rows = [["uid","displayName","email","unread_count"]];
  for (let i = 0; i < uids.length; i += 100) {
    const chunk = uids.slice(i, i + 100);
    const refs = chunk.map(uid => db.collection(USERS_COLLECTION).doc(uid));
    const snaps = await db.getAll(...refs);
    snaps.forEach((snap, idx) => {
      const uid = chunk[idx];
      const d = snap.exists ? (snap.data() || {}) : {};
      const name = d.name || d.displayName || d.fullName || "";
      const email = d.email || d.userEmail || "";
      const count = unreadCounts.get(uid) || 0;
      rows.push([
        uid,
        String(name).replace(/"/g,'""'),
        String(email).replace(/"/g,'""'),
        String(count),
      ]);
    });
  }

  const csv = rows.map(r => r.map(c => `"${c}"`).join(",")).join("\n");
  fs.writeFileSync("unread_users.csv", csv, "utf8");
  console.log("Wrote unread_users.csv");
}

main().catch(e => { console.error(e); process.exit(1); });
