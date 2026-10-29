import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, readFile, writeFile, rm, symlink } from "node:fs/promises";
import { mkdirSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { compatibleState, eligibleStateRuns, restoreReviewState } from "../scripts/restore-review-state.mjs";
import { stageCandidate } from "../scripts/review-evidence.mjs";
import { ALGORITHM_VERSION } from "../scripts/category-discovery.mjs";
import { findStateFile, restoreState } from "../scripts/restore-category-state.mjs";

test("artifact paths cannot inject workflow variables or follow symlinks", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "omapicks-review-path-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const directory = path.join(root, "download"), destination = path.join(root, "restored/state.json"), envFile = path.join(root, "env");
  const nested = path.join(directory, "nested\nINJECTED=true");
  await mkdir(nested, { recursive: true });
  await writeFile(path.join(nested, "state.json"), "{}");
  assert.equal(await restoreState({ directory, destination, envFile }), true);
  assert.equal(await readFile(envFile, "utf8"), `DISCOVERY_PREVIOUS=${destination}\n`);
  await symlink(destination, path.join(directory, "linked-state.json"));
  await assert.rejects(findStateFile(directory), /symlinks/);
});

test("discovery restore accepts only recent compatible complete observations", () => {
  const now = new Date("2026-10-29T12:00:00Z");
  const state = { schemaVersion: 1, observations: [{ at: "2026-10-27T12:00:00Z", settingsHash: "current", groups: [{ id: "test", repositories: ["github.com/example/tool"] }] }] };
  assert.equal(compatibleState(state, "current", now), true);
  assert.equal(compatibleState(state, "old", now), false);
  assert.equal(compatibleState(state, "current", new Date("2026-12-01")), false);
  assert.equal(compatibleState({ ...state, observations: [{ ...state.observations[0], groups: null }] }, "current", now), false);
  assert.equal(compatibleState({ ...state, observations: [null] }, "current", now), false);
  assert.equal(compatibleState({ ...state, observations: [{ ...state.observations[0], groups: [null] }] }, "current", now), false);
});

test("branch experiments and incomplete runs cannot become canonical discovery state", () => {
  const good = { id: 1, head_branch: "default", conclusion: "success", event: "schedule", path: ".github/workflows/review-evidence.yml", created_at: "2026-10-27" };
  assert.deepEqual(eligibleStateRuns([good, { ...good, id: 2, head_branch: "experiment" }, { ...good, id: 3, event: "pull_request" }, { ...good, id: 4, conclusion: "failure" }, { ...good, id: 5, path: ".github/workflows/ci.yml" }], "default", 9), [good]);
  assert.deepEqual(eligibleStateRuns([good], "default", 1), []);
});

test("restoration searches past incompatible artifacts and surfaces API failures", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "omapicks-review-state-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(path.join(root, "data"));
  const taxonomy = { types: [] }, config = { decisions: [] };
  await writeFile(path.join(root, "data/app-types.json"), JSON.stringify(taxonomy));
  await writeFile(path.join(root, "data/category-discovery.json"), JSON.stringify(config));
  const settingsHash = createHash("sha256").update(JSON.stringify({ version: ALGORITHM_VERSION, taxonomy, config })).digest("hex");
  const base = { head_branch: "main", conclusion: "success", event: "schedule", path: ".github/workflows/review-evidence.yml" };
  const gh = (args) => {
    if (args[0] === "api" && args[1].includes("/actions/runs?")) return JSON.stringify({ workflow_runs: [{ ...base, id: 2, created_at: "2026-10-28" }, { ...base, id: 1, created_at: "2026-10-27" }] });
    if (args[0] === "api") return JSON.stringify({ artifacts: [{ name: "category-discovery-state", expired: false, size_in_bytes: 1000 }] });
    const destination = args[args.indexOf("--dir") + 1];
    mkdirSync(destination, { recursive: true });
    writeFileSync(path.join(destination, "state.json"), JSON.stringify({ schemaVersion: 1, observations: [{ at: new Date(Date.now() - 1000).toISOString(), settingsHash: args[2] === "1" ? settingsHash : "incompatible", groups: [] }] }));
    return "";
  };
  const envFile = path.join(root, "env");
  assert.match(await restoreReviewState({ root, repository: "example/repo", branch: "main", currentRun: 3, envFile, gh }), /run 1/);
  assert.match(await readFile(envFile, "utf8"), /DISCOVERY_PREVIOUS=/);
  await assert.rejects(restoreReviewState({ root, repository: "example/repo", branch: "main", envFile, gh: () => { throw new Error("API unavailable"); } }), /API unavailable/);
});

test("research stages candidate pages separately without mutating published inputs", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "omapicks-review-stage-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  for (const directory of ["build", "scripts", "site", "data/history", "workers", "test", "e2e", ".github", "node_modules"]) await mkdir(path.join(root, directory), { recursive: true });
  await writeFile(path.join(root, "workers/index.mjs"), "export default {};\n");
  for (const file of [".nvmrc", ".node-version", "package.json", "package-lock.json", "playwright.config.mjs"]) await writeFile(path.join(root, file), "{}");
  const before = { week: "2026-W43", types: [] }, candidate = { week: "2026-W44", generatedAt: "2026-10-29T12:00:00Z", types: [] };
  await writeFile(path.join(root, "data/rankings.json"), JSON.stringify(before));
  const catalog = { stateSchemaVersion: 2, generatedAt: candidate.generatedAt, plugins: Array.from({ length: 1000 }, (_, i) => ({ id: `plugin-${i}` })) };
  const output = path.join(root, "tmp/stage");
  await stageCandidate({ root, output, result: { rankings: candidate, auditInputs: { previous: before, now: candidate.generatedAt, catalog: { body: catalog } }, changes: [], weeklyRunnerUpChanges: [], reviewQueue: { assignments: [] } } });
  assert.deepEqual(JSON.parse(await readFile(path.join(root, "data/rankings.json"), "utf8")), before);
  assert.deepEqual(JSON.parse(await readFile(path.join(output, "data/rankings.json"), "utf8")), candidate);
  assert.equal(JSON.parse(await readFile(path.join(output, "data/availability.json"), "utf8")).rankingsGeneratedAt, candidate.generatedAt);
  assert.equal(await readFile(path.join(output, "workers/index.mjs"), "utf8"), "export default {};\n");
});
