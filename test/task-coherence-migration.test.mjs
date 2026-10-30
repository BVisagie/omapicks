import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { gunzipSync } from "node:zlib";
import { createHash } from "node:crypto";
import { compareTaskFit } from "../scripts/compare-task-fit.mjs";
import { rankPlugins } from "../build/rank.mjs";
import { methodologyFor } from "../build/methodology.mjs";
import { assertTaskQualifiedSnapshot } from "../build/task-fit.mjs";

test("the 1.4 task migration replays every scored cohort, score and selection offline", async () => {
  const archive = await readFile(new URL("./fixtures/task-coherence-migration.json.gz", import.meta.url));
  const expected = JSON.parse(await readFile(new URL("../docs/analysis/2026-10-30-migration.json", import.meta.url)));
  assert.equal(createHash("sha256").update(archive).digest("hex"), expected.capture.sha256);
  const capture = JSON.parse(gunzipSync(archive));
  assert.deepEqual(capture.proposalCodeHashes, expected.proposalCodeHashes);
  for (const [file, hash] of Object.entries(expected.proposalCodeHashes)) {
    assert.equal(createHash("sha256").update(await readFile(new URL(`../${file}`, import.meta.url))).digest("hex"), hash, `stale migration code: ${file}`);
  }
  const { inputs, taxonomy, taskReviews, pluginProfiles, evidenceObservations } = capture;
  const actual = compareTaskFit(inputs, taxonomy, taskReviews, { pluginProfiles, evidenceObservations, methodology: methodologyFor("1.4.0") });
  for (const key of ["taxonomyHash", "taskReviewsHash", "pluginProfilesHash", "evidenceObservationsHash"]) assert.equal(actual[key], expected[key], key);
  for (const key of ["categories", "newCategories", "retiredCategories", "changedExistingChampions", "changedExistingRunnerUps", "categoriesWithLeadingOption", "categoriesWithRunnerUp", "beforeQualifiedAssignments", "qualifiedAssignments"]) assert.equal(actual.summary[key], expected.summary[key], key);
  assert.deepEqual(actual.categoryChanges, expected.categoryChanges);
  assert.deepEqual(actual.retiredTypes, expected.retiredTypes);
  for (const type of actual.types) {
    const baseline = expected.types.find((entry) => entry.id === type.id);
    assert.equal(type.beforeCount, baseline.beforeCount, type.id);
    assert.equal(type.qualifiedCount, baseline.qualifiedCount, type.id);
    for (const place of ["beforeWinner", "beforeRunnerUp", "afterWinner", "afterRunnerUp"]) {
      assert.equal(type[place]?.id, baseline[place]?.id, `${type.id}/${place}`);
      assert.equal(type[place]?.score, baseline[place]?.score, `${type.id}/${place}/score`);
    }
  }
  const ranked = rankPlugins({ catalog: inputs.catalog.body.plugins, stats: inputs.stats.body.plugins, taxonomy, taskReviews,
    pluginProfiles, evidenceObservations, previous: inputs.previous, now: new Date(inputs.now), methodology: methodologyFor("1.4.0"), detail: true });
  assertTaskQualifiedSnapshot(ranked.rankings);
  for (const [id, cohort] of Object.entries(ranked.cohorts)) {
    assert.deepEqual(cohort.map(({ id, name, score }) => ({ id, name, score })), expected.cohorts[id], id);
  }
  assert.deepEqual(ranked.rankings.types.filter((t) => t.eligibleCount === 1).map((t) => t.id).sort(),
    ["agent-monitoring", "ai-api-usage", "app-network-blocking", "desktop-clocks", "docks", "phone-integration", "timers-alarms", "weather-radar"]);
  assert.ok(ranked.rankings.types.every((t) => t.winner));
});
