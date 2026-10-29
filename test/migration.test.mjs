import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { gunzipSync } from "node:zlib";
import { createHash } from "node:crypto";
import { compareTaskFit } from "../scripts/compare-task-fit.mjs";
import { methodologyFor } from "../build/methodology.mjs";

test("the captured 1.3 migration replays all scored cohorts and selections offline", async () => {
  const archive = await readFile(new URL("./fixtures/recommendation-migration.json.gz", import.meta.url));
  const expected = JSON.parse(await readFile(new URL("../docs/analysis/2026-10-29-migration.json", import.meta.url)));
  assert.equal(createHash("sha256").update(archive).digest("hex"), expected.capture.sha256);
  const capture = JSON.parse(gunzipSync(archive));
  const actual = compareTaskFit(capture.inputs, capture.taxonomy, capture.taskReviews, { ...capture, methodology: methodologyFor("1.3.0") });
  for (const key of ["taxonomyHash", "taskReviewsHash", "pluginProfilesHash", "evidenceObservationsHash"]) assert.equal(actual[key], expected[key], key);
  for (const key of ["categories", "changedExistingChampions", "changedExistingRunnerUps", "categoriesWithLeadingOption", "categoriesWithRunnerUp", "beforeQualifiedAssignments", "qualifiedAssignments"]) assert.equal(actual.summary[key], expected.summary[key], key);
  for (const type of actual.types) {
    const baseline = expected.types.find((entry) => entry.id === type.id);
    assert.equal(type.beforeCount, baseline.beforeCount, type.id);
    assert.equal(type.qualifiedCount, baseline.qualifiedCount, type.id);
    for (const place of ["beforeWinner", "beforeRunnerUp", "afterWinner", "afterRunnerUp"]) {
      assert.equal(type[place]?.id, baseline[place]?.id, `${type.id}/${place}`);
      assert.equal(type[place]?.score, baseline[place]?.score, `${type.id}/${place}/score`);
    }
  }
});
