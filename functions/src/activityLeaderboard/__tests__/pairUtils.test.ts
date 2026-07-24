/* eslint-disable max-len */
import assert from "node:assert/strict";
import test from "node:test";
import {buildPairId, extractParticipants} from "../pairUtils";

test("extracts and sorts a players array", () => {
  assert.deepEqual(extractParticipants({players: ["z", "a"]}).participantIds, ["a", "z"]);
});

test("extracts from/to fields", () => {
  assert.deepEqual(extractParticipants({fromUserId: "b", toUserId: "a"}).participantIds, ["a", "b"]);
});

test("deduplicates mixed fields and trims whitespace", () => {
  const result = extractParticipants({players: [" a ", "b"], fromUserId: "a", toUserId: " b "});
  assert.deepEqual(result.participantIds, ["a", "b"]);
  assert.equal(result.validUidCount, 2);
});

test("rejects one and three participants", () => {
  assert.deepEqual(extractParticipants({players: ["a"]}).participantIds, []);
  assert.deepEqual(extractParticipants({players: ["a", "b", "c"]}).participantIds, []);
});

test("detects a self match", () => {
  const result = extractParticipants({fromUserId: "same", toUserId: " same "});
  assert.equal(result.selfMatch, true);
  assert.deepEqual(result.participantIds, []);
});

test("pair ID is deterministic and repository-compatible", () => {
  assert.equal(buildPairId(["z", "a"]), "a_z");
  assert.equal(buildPairId(["a", "z"]), "a_z");
});
