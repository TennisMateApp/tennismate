import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import MatchDistanceFilter from "../../components/match/MatchDistanceFilter";
import {
  DEFAULT_MATCH_DISTANCE_KM,
  MATCH_DISTANCE_OPTIONS_KM,
  normalizeMatchDistanceKm,
} from "../../lib/matchDistance";
import { normalizeMatchDistanceKm as normalizeBackendDistance } from "../../functions/src/matchDistance";

const matchClientSource = readFileSync("app/match/MatchClient.tsx", "utf8");
const desktopSource = readFileSync("components/match/DesktopMatchPage.tsx", "utf8");
const backendSource = readFileSync("functions/src/nearbyPlayers.ts", "utf8");

test("the existing Match Me default remains 50 kilometres", () => {
  assert.equal(DEFAULT_MATCH_DISTANCE_KM, 50);
  assert.equal(normalizeMatchDistanceKm(undefined), 50);
  assert.equal(normalizeBackendDistance(undefined), 50);
});

test("all supported fixed distance options render as accessible radio buttons", () => {
  assert.deepEqual([...MATCH_DISTANCE_OPTIONS_KM], [5, 10, 15, 20, 30, 50]);
  const html = renderToStaticMarkup(
    <MatchDistanceFilter value={15} onChange={() => undefined} />
  );
  for (const distance of MATCH_DISTANCE_OPTIONS_KM) {
    assert.match(html, new RegExp(`>${distance} km</button>`));
  }
  assert.match(html, /role="radiogroup"/);
  assert.match(html, /aria-label="Maximum match distance"/);
  assert.match(html, /Distance <span[^>]*>\(15 km\)<\/span>/);
  assert.match(html, /aria-checked="true"[^>]*>15 km<\/button>/);
});

test("unsupported client values normalize and unsupported backend values are rejected", () => {
  assert.equal(normalizeMatchDistanceKm("20"), 20);
  assert.equal(normalizeMatchDistanceKm("17"), DEFAULT_MATCH_DISTANCE_KM);
  assert.throws(() => normalizeBackendDistance(17), /unsupported-match-distance/);
  assert.throws(() => normalizeBackendDistance("20"), /unsupported-match-distance/);
});

test("the selected distance is sent to getNearbyPlayers and clear filters restores default", () => {
  assert.match(matchClientSource, /loadNearbyPlayers\(requestedRadiusKm\)/);
  assert.match(matchClientSource, /radiusKm,/);
  assert.match(matchClientSource, /setMatchDistanceKmState\(DEFAULT_MATCH_DISTANCE_KM\)/);
  assert.match(matchClientSource, /"distance"\]\.forEach/);
});

test("the callable validates the allowlisted radius and retains bounded candidate reads", () => {
  assert.match(backendSource, /normalizeMatchDistanceKm\(requestData\.radiusKm\)/);
  assert.match(backendSource, /invalid-argument/);
  assert.match(backendSource, /MAX_LIMIT = 600/);
  assert.match(matchClientSource, /MAX_NEARBY_READS = 600/);
});

test("club URL changes cannot re-enter the initial loading lifecycle", () => {
  assert.match(matchClientSource, /URL-backed filters must not restart the initial page-loading lifecycle/);
  assert.doesNotMatch(
    matchClientSource.match(/URL-backed filters must not restart[\s\S]*?\}, \[[^\]]+\]\);/)?.[0] ?? "",
    /params|refreshMatches/
  );
});

test("successful cards stay visible and a refresh is announced in place", () => {
  assert.match(matchClientSource, /Preserve the last successful cards when a background refresh fails/);
  assert.match(matchClientSource, /Updating matches…/);
  assert.match(desktopSource, /Updating matches…/);
  assert.match(desktopSource, /refreshing && visibleMatches\.length > 0/);
});

test("only the latest distance request can replace results", () => {
  assert.match(matchClientSource, /requestVersion = \+\+matchRequestVersionRef\.current/);
  assert.match(matchClientSource, /requestVersion !== matchRequestVersionRef\.current\) return/);
  assert.match(matchClientSource, /requestVersion === matchRequestVersionRef\.current\) setRefreshing\(false\)/);
});

test("club and distance controls coexist on mobile and desktop", () => {
  assert.match(matchClientSource, /<ClubDiscoveryFilter[\s\S]*?<MatchDistanceFilter/);
  assert.match(desktopSource, /<ClubDiscoveryFilter[\s\S]*?<MatchDistanceFilter/);
});

test("distance participates in active-filter and pagination reset behaviour", () => {
  assert.match(matchClientSource, /matchDistanceKm !== DEFAULT_MATCH_DISTANCE_KM/);
  assert.match(matchClientSource, /clubFilter, matchDistanceKm\]\);/);
});
