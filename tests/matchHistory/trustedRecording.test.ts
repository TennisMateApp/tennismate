import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {test} from "node:test";

const read = (path: string) => readFileSync(path, "utf8");

test("all completion clients use the trusted callable and do not write match history", () => {
  const files = [
    "app/matches/[id]/complete/details/page.tsx",
    "app/matches/[id]/summary/page.tsx",
    "components/matches/MatchCheckInOverlay.tsx",
  ];
  for (const file of files) {
    const source = read(file);
    assert.match(source, /recordCompletedMatch/);
    assert.doesNotMatch(source, /addDoc\(\s*collection\(db,\s*["']match_history["']/);
    assert.doesNotMatch(source, /setDoc\(\s*doc\(db,\s*["']match_history["']/);
    assert.doesNotMatch(source, /doc\(\s*collection\(db,\s*["']match_history["']/);
  }
});

test("the callable contract never accepts participant identity", () => {
  const client = read("lib/recordCompletedMatchClient.ts");
  const backend = read("functions/src/recordCompletedMatch.ts");
  assert.doesNotMatch(client, /players\??:|fromUserId\??:|toUserId\??:/);
  assert.match(backend, /participantsFrom\(source\)/);
  assert.match(backend, /participantsFrom\(conversation\)/);
  assert.match(backend, /transaction\.create\(historyRef/);
});

test("rules reserve history creation and completion transitions for trusted writes", () => {
  const rules = read("firestore.rules");
  assert.match(rules, /match \/match_history\/\{historyId\}[\s\S]*allow create: if false/);
  assert.match(rules, /request\.resource\.data\.status != "completed" \|\| resource\.data\.status == "completed"/);
  assert.match(rules, /request\.resource\.data\.inviteStatus != "completed" \|\| resource\.data\.inviteStatus == "completed"/);
});
