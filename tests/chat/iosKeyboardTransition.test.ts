import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import test from "node:test";
import {
  fallbackScrollTopFromBottomDistance,
  shouldSuppressIOSKeyboardScroll,
  viewportMeasurementsEqual,
} from "../../lib/iosChatScrollTransition";

const source = readFileSync("app/messages/MatchHubChat.tsx", "utf8");

test("iOS user at bottom remains anchored to the final bottom", () => {
  assert.match(source, /if \(anchor\.nearBottom\)[\s\S]*list\.scrollTop = Math\.max\(0, list\.scrollHeight - list\.clientHeight\)/);
  assert.equal(fallbackScrollTopFromBottomDistance(1200, 400, 0), 800);
});

test("iOS user reading older messages retains an element anchor with a distance fallback", () => {
  assert.match(source, /querySelectorAll<HTMLElement>\("\[data-chat-scroll-anchor\]"\)/);
  assert.match(source, /list\.scrollTop \+= currentOffset - anchor\.offset/);
  assert.equal(fallbackScrollTopFromBottomDistance(1600, 500, 300), 800);
});

test("multiple intermediate viewport events wait for stability and schedule one restoration", () => {
  assert.equal(viewportMeasurementsEqual([500, 0, 500, 320, 70], [499, 0, 499, 320, 70]), false);
  assert.equal(viewportMeasurementsEqual([500, 0, 500, 320, 70], [500.25, 0, 500, 320, 70]), true);
  assert.match(source, /window\.clearTimeout\(iosKeyboardSettleTimerRef\.current\)/);
  assert.match(source, /cancelAnimationFrame\(iosKeyboardRestoreRafRef\.current\)/);
  assert.match(source, /}, 150\)/);
});

test("focus and compact viewport scrolls are suppressed only during an active iOS transition", () => {
  for (const scrollSource of ["composer-focus", "compact-mode", "viewport-change", "input-bar-resize"] as const) {
    assert.equal(shouldSuppressIOSKeyboardScroll(true, true, scrollSource), true);
    assert.equal(shouldSuppressIOSKeyboardScroll(true, false, scrollSource), false);
  }
});

test("Android follows the existing scroll path unchanged", () => {
  assert.equal(shouldSuppressIOSKeyboardScroll(false, true, "composer-focus"), false);
  assert.match(source, /if \(isAndroid && isComposerFocused && keyboardVisible\)/);
});

test("keyboard close preserves the current section instead of forcing bottom", () => {
  assert.match(source, /onBlur=\{\(\) => \{\s*beginIOSKeyboardTransition\("closing"\)/);
  assert.doesNotMatch(source, /onBlur=\{\(\) => \{[\s\S]{0,180}scrollToBottom/);
});

test("unmount and route changes cancel pending timers and animation frames", () => {
  assert.match(source, /return \(\) => finishIOSKeyboardTransition\(\);\s*}, \[conversationID\]\)/);
  assert.match(source, /useEffect\(\(\) => \(\) => finishIOSKeyboardTransition\(\), \[\]\)/);
  assert.match(source, /window\.clearTimeout\(iosKeyboardSettleTimerRef\.current\)/);
  assert.match(source, /cancelAnimationFrame\(iosKeyboardRestoreRafRef\.current\)/);
});

test("jump-to-latest remains explicit and is never suppressed", () => {
  assert.equal(shouldSuppressIOSKeyboardScroll(true, true, "jump-to-latest"), false);
  assert.match(source, /scrollToBottom\(true, "jump-to-latest"\)/);
});
