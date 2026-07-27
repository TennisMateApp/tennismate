/* eslint-disable require-jsdoc, max-len */
import assert from "node:assert/strict";
import test from "node:test";
import {isPushDeviceEligible} from "./pushEligibility";

test("push delivery respects device notification preferences", () => {
  assert.equal(isPushDeviceEligible({}), true);
  assert.equal(isPushDeviceEligible({notificationsEnabled: false}), false);
  assert.equal(isPushDeviceEligible({pushOptOut: true}), false);
  assert.equal(isPushDeviceEligible({revoked: true}), false);
});
