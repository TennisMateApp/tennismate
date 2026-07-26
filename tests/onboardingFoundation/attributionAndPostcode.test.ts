import assert from "node:assert/strict";
import test from "node:test";

import { classifyPostcode } from "../../lib/postcodeEligibility";
import { collectReferralCandidates, normalizeReferralCode, referralCookieValue } from "../../lib/referralAttribution";
import { classifyVerificationError, safeNextDestination, verificationContinueUrl } from "../../lib/verificationFlow";

test("postcode classification distinguishes invalid, unsupported, unknown and supported", () => {
  assert.equal(classifyPostcode("abc", null).kind, "invalid");
  assert.equal(classifyPostcode("4000", null).kind, "unsupported");
  assert.equal(classifyPostcode("3068", null).kind, "unknown");
  assert.deepEqual(classifyPostcode("3068", { lat: -37.8, lng: 145 }), {
    kind: "supported", postcode: "3068", lat: -37.8, lng: 145,
  });
});

test("first-touch referral candidate stays first and duplicate codes collapse", () => {
  const candidates = collectReferralCandidates({ stored: "first", ref: "new", rc: "FIRST" });
  assert.deepEqual(candidates, [
    { code: "FIRST", source: "session" },
    { code: "NEW", source: "ref" },
  ]);
  assert.equal(normalizeReferralCode(" a bad!*code "), "ABADCODE");
  assert.equal(referralCookieValue("x=1; referral_code=club-20"), "CLUB-20");
  assert.deepEqual(collectReferralCandidates({ ref: "from-ref", rc: "from-rc", cookie: "from-cookie" }), [
    { code: "FROM-REF", source: "ref" },
    { code: "FROM-RC", source: "rc" },
    { code: "FROM-COOKIE", source: "cookie" },
  ]);
  assert.equal(normalizeReferralCode("!!!"), "");
});

test("verification errors and next destinations are safely classified", () => {
  assert.equal(classifyVerificationError({ code: "auth/expired-action-code" }), "expired");
  assert.equal(classifyVerificationError({ code: "auth/invalid-action-code" }), "already_used");
  assert.equal(classifyVerificationError({ code: "auth/network-request-failed" }), "network");
  assert.equal(safeNextDestination("https://example.com", "/home"), "/home");
  assert.equal(safeNextDestination("/matches", "/home"), "/matches");
  const continueUrl = new URL(verificationContinueUrl("/matches"));
  assert.equal(continueUrl.pathname, "/verify-complete");
  assert.equal(continueUrl.searchParams.get("next"), "/matches");
  assert.equal(continueUrl.searchParams.get("verification"), "1");
});
