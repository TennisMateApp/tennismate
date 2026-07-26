import assert from "node:assert/strict";
import test from "node:test";
import {getClubExternalLinks} from "../../../../lib/clubExternalLinks.js";
import {shouldHideFloatingFeedback} from "../../../../lib/feedbackVisibility.js";

test("booking and official website URLs remain semantically distinct", () => {
  assert.deepEqual(getClubExternalLinks({bookingUrl: "https://example.test/book"}), {
    bookingUrl: "https://example.test/book",
    officialWebsiteUrl: null,
  });

  assert.deepEqual(getClubExternalLinks({
    bookingUrl: "https://example.test/book",
    officialWebsite: "https://club.example.test",
  }), {
    bookingUrl: "https://example.test/book",
    officialWebsiteUrl: "https://club.example.test/",
  });
});

test("a booking URL is not duplicated as an official website", () => {
  assert.deepEqual(getClubExternalLinks({
    bookingUrl: "https://example.test/book",
    website: "https://example.test/book",
  }), {
    bookingUrl: "https://example.test/book",
    officialWebsiteUrl: null,
  });
});

test("floating feedback is hidden only on club profile and member-list routes", () => {
  assert.equal(shouldHideFloatingFeedback("/clubs/clifton-hill-tennis-club-3068"), true);
  assert.equal(shouldHideFloatingFeedback("/clubs/clifton-hill-tennis-club-3068/"), true);
  assert.equal(shouldHideFloatingFeedback("/clubs/clifton-hill-tennis-club-3068/members"), true);
  assert.equal(shouldHideFloatingFeedback("/clubs"), false);
  assert.equal(shouldHideFloatingFeedback("/clubs/clifton-hill/members/extra"), false);
  assert.equal(shouldHideFloatingFeedback("/profile"), false);
});
