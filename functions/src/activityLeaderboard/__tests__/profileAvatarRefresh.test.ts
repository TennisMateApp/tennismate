import assert from "node:assert/strict";
import {test} from "node:test";
import {
  currentActivityMonth,
  handleProfilePhotoUpdate,
  isSuccessfulProfilePhotoUpdate,
} from "../profileAvatarRefresh";

test("only a successfully persisted full and thumbnail photo change requests refresh", () => {
  const before = {photoURL: "full-old", photoThumbURL: "thumb-old"};
  assert.equal(isSuccessfulProfilePhotoUpdate(before, {photoURL: "full-new", photoThumbURL: "thumb-new"}), true);
  assert.equal(isSuccessfulProfilePhotoUpdate(before, before), false);
  assert.equal(isSuccessfulProfilePhotoUpdate(before, {photoURL: "full-new", photoThumbURL: ""}), false);
  assert.equal(isSuccessfulProfilePhotoUpdate(before, {photoURL: "", photoThumbURL: "thumb-new"}), false);
});
test("current month follows Australia Melbourne boundaries", () => {
  assert.equal(currentActivityMonth(new Date("2026-07-31T13:59:59.000Z")), "2026-07");
  assert.equal(currentActivityMonth(new Date("2026-07-31T14:00:00.000Z")), "2026-08");
});

test("photo refresh queues once and ignores non-photo and historical work", async () => {
  let calls = 0;
  const queue = async () => { calls += 1; return {monthKey: "2026-07", queued: true}; };
  assert.equal(await handleProfilePhotoUpdate({photoURL: "a", photoThumbURL: "b"}, {photoURL: "c", photoThumbURL: "d"}, queue), "queued");
  assert.equal(await handleProfilePhotoUpdate({photoURL: "c", photoThumbURL: "d"}, {photoURL: "c", photoThumbURL: "d"}, queue), "ignored");
  assert.equal(calls, 1);
});

test("dirtying failure is contained after profile persistence", async () => {
  const original = console.error;
  console.error = () => undefined;
  try {
    const result = await handleProfilePhotoUpdate(
      {photoURL: "a", photoThumbURL: "b"},
      {photoURL: "c", photoThumbURL: "d"},
      async () => { throw new Error("queue unavailable"); },
    );
    assert.equal(result, "failed");
  } finally {
    console.error = original;
  }
});
