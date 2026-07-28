export type IOSKeyboardScrollSource =
  | "composer-focus"
  | "compact-mode"
  | "viewport-change"
  | "input-bar-resize"
  | "initial-position"
  | "initial-position-retry"
  | "snapshot-update"
  | "post-send"
  | "tab-restore"
  | "jump-to-latest";

const KEYBOARD_DRIVEN_SCROLL_SOURCES = new Set<IOSKeyboardScrollSource>([
  "composer-focus",
  "compact-mode",
  "viewport-change",
  "input-bar-resize",
]);

export function shouldSuppressIOSKeyboardScroll(
  isIOS: boolean,
  transitionActive: boolean,
  source: IOSKeyboardScrollSource,
) {
  return isIOS && transitionActive && KEYBOARD_DRIVEN_SCROLL_SOURCES.has(source);
}

export function fallbackScrollTopFromBottomDistance(
  scrollHeight: number,
  clientHeight: number,
  distanceFromBottom: number,
) {
  return Math.max(0, scrollHeight - clientHeight - Math.max(0, distanceFromBottom));
}

export function viewportMeasurementsEqual(
  left: readonly number[],
  right: readonly number[],
  tolerance = 0.5,
) {
  return left.length === right.length && left.every((value, index) => (
    Math.abs(value - right[index]) <= tolerance
  ));
}
