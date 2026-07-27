import assert from "node:assert/strict";
import test from "node:test";
import {resolveNativePushDestination} from "../../lib/nativePush";

test("native event reminder taps use the route field sent by Functions", () => {
  assert.equal(
    resolveNativePushDestination({route: "/events/event-123", type: "event_reminder"}),
    "/events/event-123"
  );
});

test("native routing safely supports existing URL payloads and fallback", () => {
  assert.equal(
    resolveNativePushDestination({url: "https://tennismate-s7vk.vercel.app/events/event-123?from=push"}),
    "/events/event-123?from=push"
  );
  assert.equal(resolveNativePushDestination({route: "https://untrusted.example"}), "/home");
  assert.equal(resolveNativePushDestination(null), "/home");
});
