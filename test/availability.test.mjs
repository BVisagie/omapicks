import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, writeFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { availabilityFor, refreshAvailability } from "../build/availability.mjs";

const now = new Date("2026-10-29T12:00:00Z");
const pick = { id: "example.tool", repository: "https://github.com/example/tool" };
const rankings = { generatedAt: "2026-10-26T06:00:00Z", source: { catalog: { count: 1 } }, types: [{ winner: pick, runnerUp: null, alternatives: [] }] };
const plugin = { id: pick.id, repo: pick.repository, installAvailable: true, installCommand: "omarchy plugin add tool", upstreamCheckStatus: "passed", verificationCoverage: "snapshot-verified" };
const catalog = (plugins = [plugin]) => ({ stateSchemaVersion: 2, generatedAt: "2026-10-29T11:00:00Z", plugins });
const options = { now, minimumCatalogSize: 0 };

test("current availability isolates health from weekly scores and covers displayed alternatives", () => {
  const snapshot = structuredClone(rankings);
  snapshot.types[0].alternatives = [{ id: "other", repository: "https://github.com/other/tool" }];
  const before = JSON.stringify(snapshot);
  const result = availabilityFor(snapshot, catalog(), options);
  assert.equal(result.plugins[pick.id].status, "available");
  assert.equal(result.plugins.other.reason, "missing-from-catalog");
  assert.equal(result.rankingsGeneratedAt, snapshot.generatedAt);
  assert.equal(JSON.stringify(snapshot), before);
});

test("availability distinguishes failed, missing, changed and unknown checks", () => {
  for (const [patch, status, reason] of [
    [{ upstreamCheckStatus: "failed" }, "unavailable", "compatibility-failed"],
    [{ upstreamCheckStatus: "unreachable" }, "unavailable", "repository-unreachable"],
    [{ installAvailable: false }, "unavailable", "not-installable"],
    [{ repo: "https://github.com/other/repository" }, "unavailable", "repository-changed"],
    [{ upstreamCheckStatus: undefined }, "unknown", "check-unavailable"]
  ]) {
    assert.deepEqual(Object.values(availabilityFor(rankings, catalog([{ ...plugin, ...patch }]), options).plugins).map(({ status, reason }) => ({ status, reason })), [{ status, reason }]);
  }
  assert.equal(availabilityFor(rankings, catalog([{ ...plugin, verificationCoverage: "update-unverified" }]), options).plugins[pick.id].verificationCoverage, "update-unverified");
});

test("availability rejects truncated, duplicate and stale upstream catalogs", () => {
  assert.throws(() => availabilityFor(rankings, catalog([]), options), /at least/);
  assert.throws(() => availabilityFor(rankings, catalog([plugin, plugin]), options), /duplicate/);
  assert.throws(() => availabilityFor(rankings, { ...catalog(), generatedAt: "2026-10-20" }, options), /stale/);
  assert.throws(() => availabilityFor(rankings, { ...catalog(), stateSchemaVersion: 3 }, options), /Unsupported/);
});

test("failed availability refresh preserves prior files and identical observations are no-ops", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "omapicks-availability-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(path.join(root, "data"));
  await writeFile(path.join(root, "data/rankings.json"), JSON.stringify(rankings));
  const fetchImpl = async () => new Response(JSON.stringify(catalog()));
  const result = await refreshAvailability({ root, ...options, fetchImpl, summaryFile: null });
  assert.equal(result.changed, true);
  const previous = await readFile(path.join(root, "data/availability.json"), "utf8");
  assert.equal((await refreshAvailability({ root, ...options, now: new Date(now.getTime() + 60000), fetchImpl, summaryFile: null })).changed, false);
  await assert.rejects(refreshAvailability({ root, ...options, fetchImpl: async () => new Response(JSON.stringify(catalog([]))), summaryFile: null }));
  assert.equal(await readFile(path.join(root, "data/availability.json"), "utf8"), previous);
  assert.deepEqual(JSON.parse(await readFile(path.join(root, "data/rankings.json"), "utf8")), rankings);
});
