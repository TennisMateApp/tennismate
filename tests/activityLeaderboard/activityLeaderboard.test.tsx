import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {test} from "node:test";
import React from "react";
import {renderToStaticMarkup} from "react-dom/server";
import LeaderboardRows from "@/components/activityLeaderboard/LeaderboardRows";
import {
  ActivityLeaderboardRow,
  activityLeaderboardViewState,
  currentUserPlacement,
  defaultPublishedMonth,
  isExcludedActivityLeaderboardRow,
  parseActivityLeaderboardRow,
  rowTone,
  sortPublishedRows,
  tiedRanks,
} from "@/lib/activityLeaderboardModel";

function row(overrides: Partial<ActivityLeaderboardRow> = {}): ActivityLeaderboardRow {
  return {
    avatarUrl: null,
    displayName: "Court Player",
    distinctOpponentCount: 1,
    eligibleActivityCount: 1,
    playerId: "player-a",
    points: 15,
    rank: 1,
    scoringActivityCount: 1,
    ...overrides,
  };
}

test("published rows retain only the approved public fields", () => {
  const parsed = parseActivityLeaderboardRow({
    ...row(),
    email: "private@example.test",
    postcode: "0000",
    coordinates: {latitude: 1},
    eventId: "private-event",
  });
  assert.deepEqual(parsed, row());
  assert.equal(Object.hasOwn(parsed || {}, "email"), false);
  assert.equal(Object.hasOwn(parsed || {}, "postcode"), false);
});

test("malformed public rows fail closed", () => {
  assert.equal(parseActivityLeaderboardRow({...row(), rank: 0}), null);
  assert.equal(parseActivityLeaderboardRow({...row(), points: "15"}), null);
  assert.equal(parseActivityLeaderboardRow({...row(), displayName: ""}), null);
  assert.equal(parseActivityLeaderboardRow({...row(), avatarUrl: {url: "private"}}), null);
});

test("the exact Test account name is omitted without matching real names", () => {
  assert.equal(isExcludedActivityLeaderboardRow(row({displayName: "Test"})), true);
  assert.equal(isExcludedActivityLeaderboardRow(row({displayName: "  TEST  "})), true);
  assert.equal(isExcludedActivityLeaderboardRow(row({displayName: "Testing"})), false);
  assert.equal(isExcludedActivityLeaderboardRow(row({displayName: "Testa"})), false);
});

test("competition ranks and public tie ordering are deterministic", () => {
  const rows = sortPublishedRows([
    row({playerId: "c", displayName: "C", rank: 4, points: 15}),
    row({playerId: "b", displayName: "B", rank: 2, points: 30}),
    row({playerId: "a", displayName: "A", rank: 1, points: 40}),
    row({playerId: "d", displayName: "D", rank: 2, points: 30}),
  ]);
  assert.deepEqual(rows.map((item) => item.rank), [1, 2, 2, 4]);
  assert.deepEqual([...tiedRanks(rows)], [2]);
});

test("top three and current-user tones are explicit", () => {
  assert.equal(rowTone(row({rank: 1}), null), "gold");
  assert.equal(rowTone(row({rank: 2}), null), "silver");
  assert.equal(rowTone(row({rank: 3}), null), "bronze");
  assert.equal(rowTone(row({rank: 8}), "player-a"), "current-user");
});

test("current-user placement covers visible, outside, and absent states", () => {
  const rows = Array.from({length: 12}, (_, index) => row({playerId: `player-${index}`, rank: index + 1}));
  assert.equal(currentUserPlacement(rows, "player-2"), "visible");
  assert.equal(currentUserPlacement(rows, "player-11"), "outside");
  assert.equal(currentUserPlacement(rows, "missing"), "absent");
});

test("current available month selection handles missing and future months", () => {
  const now = new Date("2026-07-19T00:00:00Z");
  assert.equal(defaultPublishedMonth(["2026-02", "2026-07", "2026-06"], now), "2026-07");
  assert.equal(defaultPublishedMonth(["2026-08", "2026-06"], now), "2026-06");
  assert.equal(defaultPublishedMonth([], now), null);
});

test("loading, missing, empty, error, and ranked states resolve explicitly", () => {
  assert.equal(activityLeaderboardViewState("loading", false, 0), "loading");
  assert.equal(activityLeaderboardViewState("unavailable", false, 0), "unavailable");
  assert.equal(activityLeaderboardViewState("ready", true, 0), "empty");
  assert.equal(activityLeaderboardViewState("error", false, 0), "error");
  assert.equal(activityLeaderboardViewState("ready", true, 2), "ranked");
});

test("ranking markup exposes tied ranks, top styling, current user, and mobile-safe layout", () => {
  const markup = renderToStaticMarkup(<LeaderboardRows currentUserId="player-b" rows={[
    row({playerId: "player-a", displayName: "Alex", rank: 1, points: 40}),
    row({playerId: "player-b", displayName: "Blair", rank: 2, points: 30}),
    row({playerId: "player-c", displayName: "Casey", rank: 2, points: 30}),
  ]} />);
  assert.match(markup, /data-tone="gold"/);
  assert.match(markup, /data-current-user="true"/);
  assert.equal((markup.match(/data-tied="true"/g) || []).length, 2);
  assert.match(markup, /grid-cols-\[42px_1fr_auto\]/);
  assert.doesNotMatch(markup, /overflow-x-auto/);
});

test("client read source names only the published leaderboard collection", () => {
  const source = readFileSync("lib/activityLeaderboardClient.ts", "utf8");
  assert.match(source, /activity_leaderboards/);
  for (const forbidden of ["players/", "activity_match_events", "activity_months", "activity_duplicate", "activity_recalculation_requests"]) {
    assert.equal(source.includes(forbidden), false, `unexpected private read reference: ${forbidden}`);
  }
  assert.match(source, /rankingRowLimit: ROW_LIMIT/);
  assert.match(source, /publishedGenerationId/);
});

test("page includes unavailable, empty, permission-safe error, and encouragement copy", () => {
  const source = readFileSync("app/activity-leaderboard/ActivityLeaderboardClient.tsx", "utf8");
  assert.match(source, /No published leaderboard for this month/);
  assert.match(source, /There are no published rankings for this month yet/);
  assert.match(source, /We couldn&apos;t load the leaderboard/);
  assert.match(source, /Want to join the standings/);
  assert.doesNotMatch(source, /duplicateResolutionRole|ineligibilityReasons|eventId|postcode|birthYear|skillLevel/);
});
