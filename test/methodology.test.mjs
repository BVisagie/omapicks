import assert from "node:assert/strict";
import { cp, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { gunzipSync } from "node:zlib";
import test from "node:test";
import {
  CURRENT_METHODOLOGY_VERSION,
  LEGACY_METHODOLOGY_VERSION,
  deriveMethodology,
  methodologyFor,
  methodologyVersions,
  snapshotMethodology
} from "../build/methodology.mjs";
import { METHODOLOGY, rankPlugins } from "../build/rank.mjs";
import { renderFixtureMethodology, renderFixtureType } from "../build/render.mjs";
import { compareMethodologies, renderComparison, runComparison } from "../scripts/compare-methodologies.mjs";
import { assertTaskQualifiedSnapshot } from "../build/task-fit.mjs";

test("every registered methodology is frozen, sums to one, and unknown versions fail clearly", () => {
  for (const version of methodologyVersions()) {
    const definition = methodologyFor(version);
    assert.ok(Object.isFrozen(definition) && Object.isFrozen(definition.weights));
    const total = Object.values(definition.weights).reduce((sum, weight) => sum + weight, 0);
    assert.ok(Math.abs(total - 1) < 1e-9, `${version} weights sum to ${total}`);
  }
  assert.equal(METHODOLOGY, methodologyFor(CURRENT_METHODOLOGY_VERSION));
  assert.equal(snapshotMethodology({}).version, LEGACY_METHODOLOGY_VERSION);
  assert.equal(snapshotMethodology({ methodologyVersion: null }).version, LEGACY_METHODOLOGY_VERSION);
  assert.throws(() => methodologyFor("9.9.9"), /Unknown methodology version "9\.9\.9"/);
  assert.throws(() => deriveMethodology(methodologyFor("1.0.0"), { weights: { views: 0.5 } }, "bad"), /sum to 1/);
});

test("the published 1.0.0 definition keeps its original rules", () => {
  const legacy = methodologyFor("1.0.0");
  assert.deepEqual(legacy.weights, { copies: 0.36, hearts: 0.2, stars: 0.18, views: 0.08, freshness: 0.13, verified: 0.05 });
  assert.equal(legacy.hysteresis, 0.1);
  assert.equal(legacy.priorStrength, 12);
  assert.equal(legacy.freshness.halfLifeDays, 180);
  assert.equal(legacy.freshness.shippingBonus, null);
  assert.equal(legacy.verification.rule, "status");
  assert.equal(legacy.installRate, null);
  assert.equal(legacy.eligibility.upstreamHealth, false);
});

test("later registered methodologies retain evidence guards, configured age limits and reviewed presentation", async (context) => {
  // Add a later definition in an isolated copy, without registering a fictional
  // version in production or bypassing the registry used by real snapshots.
  const directory = await mkdtemp(path.join(os.tmpdir(), "omapicks-next-methodology-"));
  context.after(() => rm(directory, { recursive: true, force: true }));
  for (const name of ["build", "site"]) await cp(new URL(`../${name}/`, import.meta.url), path.join(directory, name), { recursive: true });
  await symlink(fileURLToPath(new URL("../node_modules/", import.meta.url)), path.join(directory, "node_modules"), "dir");
  const next = { ...structuredClone(methodologyFor("1.3.0")), version: "999.0.0-test", eligibility: { ...methodologyFor("1.3.0").eligibility, sourceMaxAgeDays: 2 } };
  const registryFile = path.join(directory, "build/methodology.mjs");
  const registry = await readFile(registryFile, "utf8");
  const marker = "const REGISTRY = new Map(";
  assert.ok(registry.includes(marker));
  await writeFile(registryFile, registry.replace(marker, `DEFINITIONS.push(${JSON.stringify(next)});\n\n${marker}`));
  const { assertTaskQualifiedSnapshot: assertNextSnapshot } = await import(pathToFileURL(path.join(directory, "build/task-fit.mjs")));
  const { renderFixtureType: renderNextType, withAvailability: withNextAvailability } = await import(pathToFileURL(path.join(directory, "build/render.mjs")));
  const { socialSvg } = await import(pathToFileURL(path.join(directory, "build/social.mjs")));
  const capture = JSON.parse(gunzipSync(await readFile(new URL("./fixtures/recommendation-migration.json.gz", import.meta.url))));
  const { rankings: snapshot } = rankPlugins({ catalog: capture.inputs.catalog.body.plugins, stats: capture.inputs.stats.body.plugins,
    taxonomy: capture.taxonomy, taskReviews: capture.taskReviews, pluginProfiles: capture.pluginProfiles, evidenceObservations: capture.evidenceObservations,
    now: new Date(capture.inputs.now), methodology: methodologyFor("1.3.0") });
  snapshot.methodologyVersion = next.version;
  snapshot.types = [{ ...snapshot.types[0], runnerUp: null, alternatives: [] }];
  assert.throws(() => assertTaskQualifiedSnapshot(snapshot), /Unknown methodology version/);
  assertNextSnapshot(snapshot);
  for (const field of ["profileSources", "evidenceObservation"]) {
    const broken = structuredClone(snapshot);
    delete broken.types[0].winner.taskFit[field];
    assert.throws(() => assertNextSnapshot(broken), /Missing reviewed requirements|Invalid recommendation/);
  }
  const dated = structuredClone(snapshot);
  const fit = dated.types[0].winner.taskFit;
  fit.lastValidatedAt = fit.evidenceObservation.checkedAt = new Date(Date.parse(dated.generatedAt) - 3 * 86400000).toISOString();
  assert.throws(() => assertNextSnapshot(dated), /Invalid recommendation observation/);
  fit.lastValidatedAt = fit.evidenceObservation.checkedAt = new Date(Date.parse(dated.generatedAt) - 86400000).toISOString();
  assertNextSnapshot(dated);
  assert.match(renderNextType(snapshot.types[0], snapshot), /01 Leading reviewed option/);
  assert.match(socialSvg(snapshot.types[0], snapshot.week, { methodologyVersion: next.version }), /01 LEADING REVIEWED OPTION/);
  assert.match(socialSvg(snapshot.types[0], snapshot.week, { methodologyVersion: "1.2.0" }), /01 CHAMPION/);
  assert.throws(() => socialSvg(snapshot.types[0], snapshot.week, { methodologyVersion: "9.9.9" }), /Unknown methodology version/);
  const projected = withNextAvailability(snapshot, null);
  assert.equal(projected.types[0].winner.availability.status, "unknown");
});

const taxonomy = { schemaVersion: 1, types: [{ id: "weather", name: "Weather", description: "Forecasts", include: ["\\bweather\\b"] }] };
const plugin = (id, values = {}) => ({
  id, name: id, description: "Weather widget", installAvailable: true, installCommand: `install ${id}`,
  repo: `https://github.com/example/${id}`, repositoryUpdatedAt: "2026-08-01T00:00:00Z", verificationStatus: "verified", stars: 3, ...values
});
const now = new Date("2026-09-01T09:00:00Z");

test("a 1.0.0 snapshot renders its own weights and rules with newer code", () => {
  const { rankings } = rankPlugins({
    catalog: [plugin("a", { stars: 20 }), plugin("b")],
    stats: { a: { copies: 30, hearts: 4, views: 90 }, b: { copies: 2, hearts: 0, views: 10 } },
    taxonomy, now, methodology: methodologyFor("1.0.0")
  });
  assert.equal(rankings.methodologyVersion, "1.0.0");
  const page = renderFixtureMethodology(rankings);
  assert.match(page, /Methodology v1\.0\.0/);
  assert.match(page, /<span>Views<\/span>.*?<span class="pct">8%<\/span>/s);
  assert.match(page, /<span>Verified<\/span>.*?<span class="pct">5%<\/span>/s);
  assert.match(page, /180-day half-life/);
  assert.match(page, /more than 10%/);
  const pick = renderFixtureType(rankings.types[0], rankings);
  assert.match(pick, /more than 10% ahead on the combined score/);
  assert.throws(() => renderFixtureMethodology({ ...rankings, methodologyVersion: "9.9.9" }), /Unknown methodology version/);
});

function captured() {
  const catalog = { generatedAt: "2026-09-01T00:00:00Z", plugins: [plugin("a", { stars: 20 }), plugin("b", { verificationStatus: "unverified" }), plugin("c")] };
  const stats = { schemaVersion: 1, plugins: { a: { copies: 30, hearts: 4, views: 90 }, b: { copies: 28, hearts: 5, views: 70 }, c: { copies: 1, hearts: 0, views: 30 } } };
  const previous = rankPlugins({ catalog: catalog.plugins, stats: stats.plugins, taxonomy, now, methodology: methodologyFor("1.0.0") }).rankings;
  return { schemaVersion: 1, classificationVersion: 2, codeRevision: "capture", now: now.toISOString(), catalog: { body: catalog }, stats: { body: stats }, taxonomy, previous, previousState: null };
}

test("the offline comparison is deterministic, never fetches and writes only its output directory", async (context) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "omapicks-compare-"));
  context.after(() => rm(directory, { recursive: true, force: true }));
  const inputFile = path.join(directory, "inputs.json");
  const inputs = captured();
  await writeFile(inputFile, JSON.stringify(inputs));
  const originalFetch = globalThis.fetch;
  globalThis.fetch = () => { throw new Error("network access is forbidden in comparisons"); };
  context.after(() => { globalThis.fetch = originalFetch; });
  const output = path.join(directory, "out");
  const first = await runComparison({ inputFile, output, revision: "test" });
  const second = compareMethodologies(JSON.parse(await readFile(inputFile, "utf8")), { revision: "test" });
  assert.deepEqual(first, second);
  assert.equal(await readFile(path.join(output, "report.md"), "utf8"), renderComparison(second));
  assert.deepEqual(JSON.parse(await readFile(inputFile, "utf8")), inputs);
  assert.equal(first.inputs.captureRevision, "capture");
  assert.equal(first.comparisonRevision, "test");
  assert.equal(first.variants[0].methodologyVersion, "1.0.0");
  for (const comparison of first.comparisons) {
    assert.ok(first.variants.some((variant) => variant.id === comparison.baseline));
    assert.ok(Number.isInteger(comparison.summary.championChanges));
  }
  await assert.rejects(runComparison({ output, revision: "test" }), /--input/);
});
