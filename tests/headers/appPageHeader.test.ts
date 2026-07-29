import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { join } from "node:path";

const source = readFileSync(join(process.cwd(), "components", "AppPageHeader.tsx"), "utf8");

test("page heading is centred independently of unequal side controls", () => {
  assert.match(
    source,
    /grid-cols-\[minmax\(0,1fr\)_minmax\(0,2fr\)_minmax\(0,1fr\)\]/,
    "outer grid tracks must remain equal",
  );
  assert.match(source, /col-start-1 row-start-1/);
  assert.match(source, /col-start-2 row-start-1[^\n]*text-center/);
  assert.match(source, /col-start-3 row-start-1/);
});

test("shared header preserves semantic and responsive safeguards", () => {
  assert.match(source, /titleAs = "h1"/);
  assert.match(source, /min-w-0/);
  assert.match(source, /stackActions/);
  assert.doesNotMatch(source, /absolute/);
});
