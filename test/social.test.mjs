import assert from "node:assert/strict";
import test from "node:test";
import { renderSocialImage, socialSvg } from "../build/social.mjs";

test("social images are category-specific, escaped 1200x630 PNGs", () => {
  const type = { name: "Screenshots & Recording", winner: { name: "<img onerror=alert(1)>" }, runnerUp: null };
  const svg = socialSvg(type, "2026-W37");
  assert.match(svg, /&lt;img onerror=alert\(1\)&gt;/);
  assert.doesNotMatch(svg, /<img/);
  const png = renderSocialImage(type, "2026-W37");
  assert.equal(png.subarray(0, 8).toString("hex"), "89504e470d0a1a0a");
  assert.equal(png.readUInt32BE(16), 1200);
  assert.equal(png.readUInt32BE(20), 630);
  assert.notDeepEqual(png, renderSocialImage({ name: "Weather" }, "2026-W37"));
});

test("reviewed shortlists use dated selection labels while historical images retain their labels", () => {
  const type = { name: "Weather", winner: { name: "Forecast" } };
  const modern = socialSvg(type, "2026-W44", { methodologyVersion: "1.3.0" });
  assert.match(modern, /01 LEADING REVIEWED OPTION/);
  assert.match(modern, /02 ANOTHER REVIEWED OPTION/);
  assert.match(modern, /No additional reviewed option yet/);
  assert.doesNotMatch(modern, /CHAMPION|RUNNER-UP/);
  assert.match(socialSvg(type, "2026-W43", { methodologyVersion: "1.2.0" }), /01 CHAMPION/);
  const png = renderSocialImage(type, "2026-W44", { methodologyVersion: "1.3.0" });
  assert.equal(png.readUInt32BE(16), 1200);
  assert.equal(png.readUInt32BE(20), 630);
});
