import assert from "node:assert/strict";
import test from "node:test";
import {
  ANY_CLUB_FILTER,
  clubFilterUrlValue,
  clubProfileHref,
  filterCandidatesByClub,
  getCompleteClubMembership,
  isMyClubFilterAvailable,
  resolveClubFilterFromUrl,
  selectedClubFilter,
  stopClubLinkPropagation,
} from "../../../../lib/matchClubDiscovery.js";

const myPlayer = {clubStatus: "member", clubId: "clifton", clubName: "Clifton Hill Tennis Club"};
const candidates = [
  {id: "same", clubStatus: "member", clubId: "clifton", clubName: "Clifton Hill Tennis Club", skill: "intermediate", age: 30, gender: "Female", activity: "recent", contacted: false},
  {id: "other", clubStatus: "member", clubId: "fitzroy", clubName: "Fitzroy Tennis Club", skill: "intermediate", age: 30, gender: "Female", activity: "recent", contacted: false},
  {id: "none", clubStatus: "none", clubId: null, clubName: null, skill: "intermediate", age: 30, gender: "Female", activity: "recent", contacted: false},
  {id: "incomplete", clubStatus: "member", clubId: "clifton", clubName: "", skill: "intermediate", age: 30, gender: "Female", activity: "recent", contacted: false},
];

test("Any club leaves the existing eligible candidate pool unchanged", () => {
  assert.equal(filterCandidatesByClub(candidates, myPlayer, ANY_CLUB_FILTER), candidates);
});

test("My club includes only complete memberships with the same club ID", () => {
  assert.deepEqual(
    filterCandidatesByClub(candidates, myPlayer, {mode: "my", clubId: null, clubName: null}).map((player) => player.id),
    ["same"]
  );
});

test("My club is unavailable without a complete current-player membership", () => {
  assert.equal(isMyClubFilterAvailable(myPlayer), true);
  assert.equal(isMyClubFilterAvailable({clubStatus: "none", clubId: null, clubName: null}), false);
  assert.equal(isMyClubFilterAvailable({clubStatus: "member", clubId: "clifton", clubName: ""}), false);
  assert.deepEqual(filterCandidatesByClub(candidates, {clubStatus: "none"}, {mode: "my", clubId: null, clubName: null}), []);
});

test("Select a club filters by the stable court document ID", () => {
  const selected = selectedClubFilter({id: "fitzroy", canonicalName: "Fitzroy Tennis Club"});
  assert.deepEqual(filterCandidatesByClub(candidates, myPlayer, selected).map((player) => player.id), ["other"]);
  assert.deepEqual(clubFilterUrlValue(selected), {club: null, clubId: "fitzroy"});
});

test("Club filtering composes with the existing filtered pool without changing its order", () => {
  const existingEligiblePool = candidates.filter((player) =>
    player.skill === "intermediate" &&
    player.age >= 25 && player.age <= 34 &&
    player.gender === "Female" &&
    player.activity === "recent" &&
    !player.contacted
  ).reverse();
  assert.deepEqual(
    filterCandidatesByClub(existingEligiblePool, myPlayer, {mode: "my", clubId: null, clubName: null}).map((player) => player.id),
    ["same"]
  );
});

test("Reset state is Any club and removes club URL values", () => {
  assert.deepEqual(ANY_CLUB_FILTER, {mode: "any", clubId: null, clubName: null});
  assert.deepEqual(clubFilterUrlValue(ANY_CLUB_FILTER), {club: null, clubId: null});
});

test("Invalid URL club IDs safely resolve to Any club", () => {
  const clubs = [{id: "clifton", canonicalName: "Clifton Hill Tennis Club"}];
  assert.deepEqual(resolveClubFilterFromUrl({clubId: "missing"}, clubs), ANY_CLUB_FILTER);
  assert.equal(resolveClubFilterFromUrl({clubId: "clifton"}, clubs).mode, "selected");
  assert.equal(resolveClubFilterFromUrl({club: "my"}, clubs).mode, "my");
});

test("Only complete memberships present a club link", () => {
  assert.deepEqual(getCompleteClubMembership(myPlayer), {clubId: "clifton", clubName: "Clifton Hill Tennis Club"});
  assert.equal(clubProfileHref(myPlayer), "/clubs/clifton");
  assert.equal(clubProfileHref({clubStatus: "none", clubId: null, clubName: null}), null);
  assert.equal(clubProfileHref({clubStatus: "member", clubId: "clifton", clubName: ""}), null);
});

test("Match Me club-link interaction does not propagate to card actions", () => {
  let stopped = false;
  stopClubLinkPropagation({stopPropagation: () => { stopped = true; }});
  assert.equal(stopped, true);
});
