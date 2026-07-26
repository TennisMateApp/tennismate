import assert from "node:assert/strict";
import test from "node:test";
import {
  CLUB_MEMBERSHIP_PROMPT_DISMISSAL_MS,
  clubMembershipPromptDismissalKey,
  isClubMembershipPromptDismissalActive,
  shouldShowClubMembershipPrompt,
} from "../../../../lib/clubMembershipPrompt.js";
import {getClubMembershipPresentation} from "../../../../lib/clubMembershipPresentation.js";

const NOW = Date.UTC(2026, 6, 25, 12, 0, 0);

test("a prompt dismissed today remains hidden", () => {
  const storedDismissal = String(NOW);
  assert.equal(isClubMembershipPromptDismissalActive(storedDismissal, NOW), true);
  assert.equal(shouldShowClubMembershipPrompt({clubStatus: null, storedDismissal, now: NOW}), false);
});

test("a prompt dismissed more than 30 days ago is eligible again", () => {
  const storedDismissal = String(NOW - CLUB_MEMBERSHIP_PROMPT_DISMISSAL_MS - 1);
  assert.equal(isClubMembershipPromptDismissalActive(storedDismissal, NOW), false);
  assert.equal(shouldShowClubMembershipPrompt({clubStatus: null, storedDismissal, now: NOW}), true);
});

test("invalid stored dismissal data is handled as expired", () => {
  assert.equal(isClubMembershipPromptDismissalActive("not-a-timestamp", NOW), false);
  assert.equal(shouldShowClubMembershipPrompt({
    clubStatus: null,
    storedDismissal: "not-a-timestamp",
    now: NOW,
  }), true);
});

test("dismissal storage is isolated by user ID", () => {
  assert.notEqual(clubMembershipPromptDismissalKey("player-a"), clubMembershipPromptDismissalKey("player-b"));
  assert.match(clubMembershipPromptDismissalKey("player-a"), /player-a$/);
});

test("persisted member and none statuses always suppress the prompt", () => {
  assert.equal(shouldShowClubMembershipPrompt({clubStatus: "member", storedDismissal: null, now: NOW}), false);
  assert.equal(shouldShowClubMembershipPrompt({clubStatus: "none", storedDismissal: null, now: NOW}), false);
});

test("missing or null club status remains eligible for prompting", () => {
  assert.equal(shouldShowClubMembershipPrompt({clubStatus: null, storedDismissal: null, now: NOW}), true);
  assert.equal(shouldShowClubMembershipPrompt({clubStatus: undefined, storedDismissal: null, now: NOW}), true);
});

test("selected membership presents the canonical club name", () => {
  assert.deepEqual(getClubMembershipPresentation({
    clubId: "clifton-hill-tennis-club-3068",
    clubName: "Clifton Hill Tennis Club",
    clubStatus: "member",
  }), {
    label: "Member of",
    clubName: "Clifton Hill Tennis Club",
  });
});

test("none and incomplete member data do not present a membership section", () => {
  assert.equal(getClubMembershipPresentation({clubId: null, clubName: null, clubStatus: "none"}), null);
  assert.equal(getClubMembershipPresentation({clubId: null, clubName: "Clifton Hill Tennis Club", clubStatus: "member"}), null);
  assert.equal(getClubMembershipPresentation({clubId: "clifton-hill", clubName: null, clubStatus: "member"}), null);
});
