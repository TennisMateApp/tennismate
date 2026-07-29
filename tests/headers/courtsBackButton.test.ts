import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const source = readFileSync(join(process.cwd(), "components", "CourtsBackButton.tsx"), "utf8");
const courts = readFileSync(join(process.cwd(), "app", "courts", "page.tsx"), "utf8");

test("Courts and shared back controls use one implementation", () => {
  assert.match(courts, /<CourtsBackButton onClick=\{handleBack\}/);
  assert.match(source, /appPageHeaderButtonClass/);
  assert.match(source, /ArrowLeft className="h-5 w-5 text-gray-700"/);
});

test("shared back control preserves button, link, and accessible-name behavior", () => {
  assert.match(source, /<Link href=\{href\}/);
  assert.match(source, /type="button"/);
  assert.match(source, /aria-label=\{label\}/);
  assert.match(source, /title=\{title\}/);
  assert.match(source, /aria-hidden="true"/);
});
