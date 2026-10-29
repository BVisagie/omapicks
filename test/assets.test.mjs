import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { gzipSync } from "node:zlib";

// The interface ships one stylesheet and one script, both content-hashed and cached for a year.
// Budgets keep them small enough that a cold visit on a slow connection paints quickly.
const BUDGETS = Object.freeze({
  "site/styles.css": 14 * 1024,
  "site/app.js": 8 * 1024
});

for (const [file, budget] of Object.entries(BUDGETS)) {
  test(`${file} stays within its gzip budget`, () => {
    const size = gzipSync(readFileSync(new URL(`../${file}`, import.meta.url)), { level: 9 }).length;
    assert.ok(size <= budget, `${file} is ${size} bytes gzipped, budget ${budget}`);
  });
}
