import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { captureEvidence, observationCurrent, pinnedSource, relevantTreeFingerprint } from "../build/evidence.mjs";
import { changesBetween, rankPlugins, methodologyFor } from "../build/rank.mjs";
import { assertTaskQualifiedSnapshot, taskMetadataHash } from "../build/task-fit.mjs";
import { refresh, replayChanges } from "../build/refresh.mjs";

const revision = "a".repeat(40), currentRevision = "b".repeat(40);
const now = new Date("2026-10-29T12:00:00Z");
const source = { url: `https://github.com/example/capture/blob/${revision}/README.md`, revision, path: "README.md", evidence: "Capture regions and save PNG images. Requires grim." };
const plugin = { id: "capture", name: "Capture", description: "Screenshots", repo: "https://github.com/example/capture", installAvailable: true, installCommand: "omarchy plugin add https://github.com/example/capture", upstreamObservedCommit: currentRevision };
const taxonomy = { schemaVersion: 1, types: [{ id: "capture", name: "Capture", include: ["screenshots"], contract: { version: 1, outcome: "Capture a screen region and save its image", capabilitySets: [["capture", "save"]] } }] };
const review = { pluginId: plugin.id, typeId: "capture", contractVersion: 1, metadataHash: taskMetadataHash(plugin), decision: "qualified", role: "core", capabilities: ["capture", "save"], constraints: [], reason: "Captures screen regions and saves PNG images.", reviewedAt: "2026-10-29", provenance: "repository-evidence", source };
const taskReviews = { schemaVersion: 2, assignments: [review] };
const pluginProfiles = { schemaVersion: 1, plugins: { capture: { requirementsStatus: "reviewed", requirements: ["Requires grim."], reviewedAt: "2026-10-29", sources: [source] } } };
const tree = { truncated: false, tree: [{ path: "README.md", type: "blob", mode: "100644", sha: "c".repeat(40) }, { path: "Main.qml", type: "blob", mode: "100644", sha: "d".repeat(40) }] };
const fingerprint = relevantTreeFingerprint(tree, ["README.md"]);
const observation = { repository: plugin.repo, reviewRevision: revision, currentRevision, checkedAt: now.toISOString(), status: "current", baselineFingerprint: fingerprint, currentFingerprint: fingerprint, evidencePaths: ["README.md"] };
const args = () => structuredClone({ catalog: [plugin], stats: {}, taxonomy, taskReviews, pluginProfiles, evidenceObservations: { schemaVersion: 1, plugins: { capture: observation } }, now });

test("1.3 requires pinned task evidence, reviewed shared requirements and a matching current observation", () => {
  const result = rankPlugins(args());
  assert.equal(result.rankings.types[0].winner.id, "capture");
  assert.deepEqual(result.rankings.types[0].winner.taskFit.pluginRequirements, ["Requires grim."]);
  assertTaskQualifiedSnapshot(result.rankings);
  for (const mutate of [
    (a) => { a.taskReviews.assignments[0].provenance = "catalog-evidence"; },
    (a) => { a.taskReviews.assignments[0].source = { ...a.taskReviews.assignments[0].source, url: "https://github.com/example/capture#readme" }; },
    (a) => { a.pluginProfiles.plugins = {}; },
    (a) => { a.pluginProfiles.plugins.capture.reviewedAt = "2026-10-30"; },
    (a) => { a.evidenceObservations.plugins = {}; },
    (a) => { a.evidenceObservations.plugins.capture.currentRevision = revision; },
    (a) => { a.evidenceObservations.plugins.capture.status = "changed"; }
  ]) { const a = args(); mutate(a); assert.equal(rankPlugins(a).rankings.types[0].winner, null); }
});

test("metadata reconciliation keeps unchanged source qualification without changing the reviewed capabilities or review date", () => {
  const a = args(); a.catalog[0].description += ", including power readouts";
  const r = rankPlugins(a); const fit = r.rankings.types[0].winner.taskFit;
  assert.equal(fit.evidenceStatus, "metadata-reconciliation");
  assert.equal(fit.reviewedAt, review.reviewedAt);
  assert.deepEqual(fit.capabilities, review.capabilities);
  assert.equal(r.reviewQueue[0].status, "metadata-reconciliation");
  assertTaskQualifiedSnapshot(r.rankings);
  a.catalog[0].repo = "https://github.com/other/capture";
  assert.equal(rankPlugins(a).rankings.types[0].winner, null);
});

test("source changes, future observations and old observations cannot qualify", () => {
  for (const changes of [{ currentFingerprint: "f".repeat(64) }, { checkedAt: "2026-10-30T12:00:00Z" }, { checkedAt: "2026-10-20T12:00:00Z" }, { evidencePaths: [] }]) {
    assert.equal(observationCurrent({ ...observation, ...changes }, plugin, [source], now), false);
  }
});

test("source fingerprints ignore unrelated images and workflow edits, but include new code, manifests, modes and cited documentation", () => {
  const irrelevant = [...tree.tree, { path: "preview.png", type: "blob", mode: "100644", sha: "e".repeat(40) }, { path: ".github/workflows/build.yml", type: "blob", mode: "100644", sha: "e".repeat(40) }, { path: "docs/history.md", type: "blob", mode: "100644", sha: "e".repeat(40) }];
  assert.equal(relevantTreeFingerprint({ tree: irrelevant }, ["README.md"]), fingerprint);
  for (const entry of [{ path: "docs/helper.py", type: "blob", mode: "100644", sha: "e".repeat(40) }, { path: "requirements.txt", type: "blob", mode: "100644", sha: "e".repeat(40) }, { path: "CMakeLists.txt", type: "blob", mode: "100644", sha: "e".repeat(40) }, { path: "manifest.json", type: "blob", mode: "100644", sha: "e".repeat(40) }, { path: "dependency", type: "commit", mode: "100644", sha: "e".repeat(40) }]) assert.notEqual(relevantTreeFingerprint({ tree: [...tree.tree, entry] }, ["README.md"]), fingerprint);
  const changed = structuredClone(tree); changed.tree[0].sha = "e".repeat(40);
  assert.notEqual(relevantTreeFingerprint(changed, ["README.md"]), fingerprint);
  assert.throws(() => relevantTreeFingerprint({ tree: [{ path: "Main.qml", type: "blob", mode: "100644", sha: "bad" }] }, []), /Malformed/);
  assert.throws(() => relevantTreeFingerprint({ ...tree, truncated: true }, ["README.md"]), /Incomplete/);
  assert.throws(() => relevantTreeFingerprint(tree, ["docs/missing.md"]), /Missing/);
});

test("capture reads immutable repository trees, reuses requests, and retains failed observations for replay", async () => {
  const urls = [];
  const observed = await captureEvidence({ catalog: [plugin], taskReviews, pluginProfiles, now, fetchImpl: async (url) => { urls.push(url); return new Response(JSON.stringify(tree)); } });
  assert.equal(observed.plugins.capture.status, "current");
  assert.equal(urls.length, 2);
  assert.ok(urls.every((u) => u.startsWith("https://api.github.com/repos/example/capture/git/trees/")));
  const failed = await captureEvidence({ catalog: [plugin], taskReviews, pluginProfiles, now, fetchImpl: async () => new Response("rate limit", { status: 403 }) });
  assert.equal(failed.plugins.capture.status, "unavailable");
  assert.equal(failed.attempted, 1); assert.equal(failed.completed, 0);
  const olderReview = { ...review, typeId: "other", source: { ...source, revision: currentRevision, url: source.url.replace(revision, currentRevision) } };
  const mixed = await captureEvidence({ catalog: [plugin], taskReviews: { schemaVersion: 2, assignments: [olderReview, review] }, pluginProfiles, now, fetchImpl: async () => new Response(JSON.stringify(tree)) });
  assert.equal(mixed.plugins.capture.status, "current");
  assert.equal(observationCurrent(mixed.plugins.capture, plugin, [olderReview.source], now), false);
  const malformed = await captureEvidence({ catalog: [{ ...plugin, repo: "not a repository" }], taskReviews, pluginProfiles, now, fetchImpl: () => { throw new Error("Invalid identity should not fetch"); } });
  assert.equal(malformed.attempted, 1); assert.equal(malformed.completed, 0);
  const obsolete = { ...review, typeId: "obsolete", source: { ...source, path: "old-task.md", url: source.url.replace("README.md", "old-task.md") } };
  const filtered = await captureEvidence({ catalog: [plugin], taskReviews: { schemaVersion: 2, assignments: [obsolete, review] }, taxonomy, pluginProfiles, now, fetchImpl: async () => new Response(JSON.stringify(tree)) });
  assert.equal(filtered.plugins.capture.status, "current");
  assert.deepEqual(filtered.plugins.capture.evidencePaths, ["README.md"]);
});

test("related tools retain reviewed shared requirements without acquiring qualification", () => {
  const a = args(); a.taskReviews.assignments[0].decision = "related"; a.taskReviews.assignments[0].role = "integration"; a.taskReviews.assignments[0].capabilities = ["save"];
  const type = rankPlugins(a).rankings.types[0];
  assert.equal(type.winner, null);
  assert.equal(type.relatedTools[0].taskFit.qualified, false);
  assert.deepEqual(type.relatedTools[0].taskFit.pluginRequirements, ["Requires grim."]);
  assert.equal(type.relatedTools[0].taskFit.requirementsStatus, "reviewed");
});

test("missing or changed source evidence is described as pending qualification, not task departure", () => {
  const previous = rankPlugins(args()).rankings;
  for (const mutate of [
    (a) => { a.pluginProfiles.plugins = {}; },
    (a) => { a.taskReviews.assignments[0].provenance = "catalog-evidence"; },
    (a) => { a.evidenceObservations.plugins = {}; },
    (a) => { a.evidenceObservations.plugins.capture.status = "changed"; }
  ]) {
    const a = args(); mutate(a); const result = rankPlugins({ ...a, previous });
    const [change] = changesBetween(previous, result.rankings, { catalogIds: new Set([plugin.id]), exclusions: result.exclusions, typeIdsById: result.typeIdsById, taskStatusByAssignment: result.taskStatusByAssignment });
    assert.equal(change.reason, "awaiting-task-qualification");
  }
});

test("immutable sources must bind repository, revision and evidence path", () => {
  assert.equal(pinnedSource(source, plugin.repo), true);
  assert.equal(pinnedSource({ ...source, url: source.url.replace("github.com", "github.com.evil.test") }, plugin.repo), false);
  assert.equal(pinnedSource({ ...source, url: source.url.replace("github.com", "github.com:444") }, plugin.repo), false);
  assert.equal(pinnedSource({ ...source, revision: currentRevision }, plugin.repo), false);
  assert.equal(pinnedSource({ ...source, path: "other.md" }, plugin.repo), false);
});

test("1.2 keeps catalog-evidence qualification without modern source observations", () => {
  const a = args(); a.methodology = methodologyFor("1.2.0"); a.taskReviews.assignments[0].provenance = "catalog-evidence"; delete a.pluginProfiles; delete a.evidenceObservations;
  const r = rankPlugins(a).rankings;
  assert.equal(r.types[0].winner.id, plugin.id); assertTaskQualifiedSnapshot(r);
});

test("1.3 refresh captures deterministic evidence, freezes shared requirements and preserves published data on source outage", async (context) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "omapicks-source-refresh-"));
  context.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(path.join(root, "data"));
  for (const [name, value] of Object.entries({ "app-types": taxonomy, "task-reviews": taskReviews, "plugin-profiles": pluginProfiles })) {
    await writeFile(path.join(root, `data/${name}.json`), JSON.stringify(value));
  }
  const fetchImpl = async (url) => new Response(JSON.stringify(url.includes("api.github.com") ? tree : url.includes("/stats")
    ? { schemaVersion: 1, plugins: { capture: { copies: 1, views: 30, hearts: 0 } } }
    : url.endsWith("registry.json") ? { retiredPluginIds: [] } : { plugins: [plugin] }));
  const published = await refresh({ root, now, minimumCatalogSize: 1, fetchImpl });
  assert.equal(published.rankings.methodologyVersion, "1.3.0");
  assert.deepEqual(replayChanges(published.auditInputs).changes, published.computedChanges);
  assert.deepEqual(published.auditInputs.evidenceObservations.plugins.capture, observation);
  assert.equal((await refresh({ root, now, minimumCatalogSize: 1, fetchImpl: () => { throw new Error("Frozen run fetched"); } })).changed, false);
  const changed = structuredClone(pluginProfiles); changed.plugins.capture.requirements.push("Install the documented helpers.");
  await writeFile(path.join(root, "data/plugin-profiles.json"), JSON.stringify(changed));
  const next = await refresh({ root, now, minimumCatalogSize: 1, fetchImpl });
  assert.equal(next.changed, true);
  assert.notEqual(next.rankings.source.pluginProfiles.sha256, published.rankings.source.pluginProfiles.sha256);
  const files = ["rankings.json", `history/${published.week}.json`, "changelog.json", "task-review-queue.json", "classification-state.json"];
  const before = await Promise.all(files.map((file) => readFile(path.join(root, "data", file), "utf8")));
  await assert.rejects(refresh({ root, now, republish: true, minimumCatalogSize: 1, fetchImpl: (url) => url.includes("api.github.com") ? new Response("unavailable", { status: 503 }) : fetchImpl(url) }), /coverage fell below/);
  assert.deepEqual(await Promise.all(files.map((file) => readFile(path.join(root, "data", file), "utf8"))), before);
  const failed = JSON.parse(await readFile(path.join(root, "tmp/classification-audit/inputs.json")));
  assert.equal(failed.evidenceObservations.plugins.capture.status, "unavailable");
  for (const brokenProfiles of [
    { schemaVersion: 1, plugins: {} },
    { schemaVersion: 1, plugins: { capture: { ...pluginProfiles.plugins.capture, sources: [{ ...source, revision: currentRevision, url: source.url.replace(revision, currentRevision) }] } } }
  ]) {
    await writeFile(path.join(root, "data/plugin-profiles.json"), JSON.stringify(brokenProfiles));
    await assert.rejects(refresh({ root, now, republish: true, minimumCatalogSize: 1, fetchImpl }), /coverage fell below/);
    const missing = JSON.parse(await readFile(path.join(root, "tmp/classification-audit/inputs.json")));
    assert.equal(missing.evidenceObservations.expected, 1);
    assert.equal(missing.evidenceObservations.attempted, 0);
    assert.deepEqual(await Promise.all(files.map((file) => readFile(path.join(root, "data", file), "utf8"))), before);
  }
});
