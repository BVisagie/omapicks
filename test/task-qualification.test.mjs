import assert from "node:assert/strict";
import { readFile, mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import test from "node:test";
import { classifyPlugin, prepareTaxonomy, rankPlugins, methodologyFor, pickWithHysteresis } from "../build/rank.mjs";
import { assertTaskQualifiedSnapshot, explainTaskFit, prepareTaskReviews, taskMetadataHash, updateTaskReviewQueue } from "../build/task-fit.mjs";
import { auditClassifications } from "../build/classification-audit.mjs";
import { refresh, validateFeeds } from "../build/refresh.mjs";
import { renderFixtureType, renderFixtureMethodology } from "../build/render.mjs";
import { reviewProposal } from "../scripts/task-review.mjs";
import { compareTaskFit } from "../scripts/compare-task-fit.mjs";

const now = new Date("2026-10-12T15:00:00Z");
const taxonomy = { schemaVersion: 1, types: [{ id: "capture", name: "Screen Capture", description: "Take and save a screen image", include: ["\\bscreenshot\\b"],
  contract: { version: 1, outcome: "Take and save a screen image", capabilitySets: [["capture-image", "export-image"]] } }] };
const plugin = (id, description = "Native screenshot capture and image export.") => ({ id, name: id, description, repo: `https://github.com/example/${id}`,
  installAvailable: true, installCommand: `install ${id}`, repositoryUpdatedAt: "2026-10-10T00:00:00Z", verificationStatus: "verified", stars: 10 });
const review = (p, values = {}) => ({ pluginId: p.id, typeId: "capture", metadataHash: taskMetadataHash(p), contractVersion: 1, decision: "qualified", role: "core",
  capabilities: ["capture-image", "export-image"], constraints: [], reason: "Captures a screen region and exports the image for reuse.", reviewedAt: "2026-10-12", provenance: "repository-evidence",
  source: { url: `${p.repo}#features`, revision: "fixture-document-revision", evidence: "Documented region capture and image export." }, ...values });
const inputs = (catalog, reviews, values = {}) => ({ catalog, stats: Object.fromEntries(catalog.map((p) => [p.id, { copies: 10, hearts: 1, views: 50 }])), taxonomy,
  taskReviews: { schemaVersion: 1, assignments: reviews }, now, ...values });

test("a popular unreviewed claim and a status integration cannot replace a task-complete tool", () => {
  const good = plugin("capture-tool"), newcomer = plugin("new-capture"), indicator = plugin("recording-indicator");
  const args = inputs([good, newcomer, indicator], [review(good), review(indicator, { decision: "related", role: "integration", capabilities: [], reason: "Shows recording status but does not take and export screen images." })]);
  args.stats[newcomer.id] = args.stats[indicator.id] = { copies: 100000, hearts: 5000, views: 100000 };
  const result = rankPlugins(args);
  assert.equal(result.rankings.types[0].winner.id, good.id);
  assert.equal(result.rankings.types[0].runnerUp, null);
  assert.equal(result.rankings.types[0].eligibleCount, 1);
  assert.equal(result.rankings.types[0].relatedTools[0].id, indicator.id);
  assert.equal(result.reviewQueue.find((p) => p.pluginId === newcomer.id).status, "pending");
  assertTaskQualifiedSnapshot(result.rankings);
});

test("an equally complete secondary capability can win and exposes its requirements", () => {
  const specialist = plugin("specialist"), suite = plugin("suite");
  const result = rankPlugins(inputs([specialist, suite], [review(specialist), review(suite, { role: "substantial-secondary", constraints: ["Includes a wider desktop suite."] })],
    { stats: { specialist: { copies: 10, hearts: 1, views: 50 }, suite: { copies: 1000, hearts: 100, views: 5000 } } }));
  assert.equal(result.rankings.types[0].winner.id, suite.id);
  const html = renderFixtureType(result.rankings.types[0], result.rankings);
  assert.match(html, /Why it fits/);
  assert.match(html, /Includes a wider desktop suite/);
  assert.match(html, /Capability evidence/);
  assert.doesNotMatch(renderFixtureMethodology(result.rankings), /more than 0%/);
});

test("a changed claim removes an incumbent immediately and stays in the queue even without a regex match", () => {
  const before = plugin("old"), replacement = plugin("replacement");
  const previous = rankPlugins(inputs([before, replacement], [review(before), review(replacement)], { stats: { old: { copies: 1000, hearts: 90, views: 3000 } } })).rankings;
  const changed = { ...before, description: "A cloud folder synchronization tool." };
  const after = rankPlugins(inputs([changed, replacement], [review(before), review(replacement)], { previous }));
  assert.equal(after.rankings.types[0].winner.id, replacement.id);
  const pending = after.reviewQueue.find((p) => p.pluginId === before.id);
  assert.equal(pending.status, "stale-metadata");
  assert.equal(pending.previousPick, true);
  assertTaskQualifiedSnapshot(after.rankings);
});

test("contract changes, explicit holds and exclusions cannot reuse an old qualification", () => {
  const p = plugin("a");
  const changedContract = structuredClone(taxonomy); changedContract.types[0].contract.version = 2;
  const stale = rankPlugins(inputs([p], [review(p)], { taxonomy: changedContract }));
  assert.equal(stale.rankings.types[0].winner, null);
  assert.equal(stale.reviewQueue[0].status, "stale-contract");
  for (const group of ["review", "exclude"]) {
    const held = { ...taxonomy, overrides: { [group]: { a: ["capture"] }, reasons: { a: { capture: "The capability evidence needs another source check." } } } };
    assert.equal(rankPlugins(inputs([p], [review(p)], { taxonomy: held })).rankings.types[0].winner, null);
  }
});

test("source evidence can admit a real task omitted by lexical discovery without admitting health failures", () => {
  const p = plugin("native-image-tool", "Select pixels and export a PNG.");
  assert.deepEqual(classifyPlugin(p, prepareTaxonomy(taxonomy)), []);
  assert.equal(rankPlugins(inputs([p], [review(p)])).rankings.types[0].winner.id, p.id);
  assert.equal(rankPlugins(inputs([{ ...p, upstreamCheckStatus: "unreachable" }], [review(p)])).rankings.types[0].winner, null);
});

test("malformed and incomplete qualifications fail before publication", () => {
  const p = plugin("a");
  for (const values of [{ role: "integration" }, { capabilities: ["capture-image"] }, { reviewedAt: "2026-02-31" }, { source: { url: "https://user:pass@example.com/", revision: "x", evidence: "x" } }, { source: { url: "javascript:alert(1)", revision: "x", evidence: "x" } }, { metadataHash: "unknown" }]) {
    assert.throws(() => prepareTaskReviews({ schemaVersion: 1, assignments: [review(p, values)] }, taxonomy.types));
  }
  assert.throws(() => prepareTaskReviews({ schemaVersion: 1, assignments: [review(p), review(p)] }, taxonomy.types), /Duplicate/);
  const result = rankPlugins(inputs([p], [review(p)])).rankings;
  result.types[0].winner.description = "Different capability claim";
  assert.throws(() => assertTaskQualifiedSnapshot(result), /metadata changed/);
});

test("current selection can replace a high incumbent and uses the published tie-breaks", () => {
  const candidates = [{ id: "new", score: 0.995 }, { id: "old", score: 0.97 }];
  assert.equal(pickWithHysteresis(candidates, "old").id, "new");
  assert.equal(pickWithHysteresis(candidates, "old", new Set(), methodologyFor("1.1.0")).id, "old");
  assert.equal(pickWithHysteresis([{ id: "sorted-first", score: 0.97 }, { id: "old", score: 0.97 }], "old").id, "sorted-first");
});

test("a pending assignment retains its queue age and resolution clears it", () => {
  const row = { pluginId: "a", typeId: "capture", name: "a", repository: "https://github.com/example/a", status: "pending", reason: "Needs evidence", metadataHash: "a", contractVersion: 1, prospectiveScore: 0.99, previousPick: false, wouldEnterPodium: true };
  const first = updateTaskReviewQueue([row], null, "2026-10-01T00:00:00Z");
  const second = updateTaskReviewQueue([row], first, "2026-10-08T00:00:00Z");
  assert.equal(second.assignments[0].firstSeenAt, first.generatedAt);
  assert.equal(updateTaskReviewQueue([{ ...row, metadataHash: "b" }], second, now.toISOString()).assignments[0].firstSeenAt, now.toISOString());
  assert.equal(updateTaskReviewQueue([], second, now.toISOString()).resolvedCount, 1);
});

test("review proposal binds an explicit judgment to captured evidence and never invents approval", () => {
  const p = plugin("a"); const capture = { catalog: { body: { plugins: [p] } }, taxonomy };
  assert.throws(() => reviewProposal(capture, [{ pluginId: "a", typeId: "capture" }]), /decision/);
  assert.throws(() => reviewProposal(capture, [review(p, { source: undefined })]), /reviewed source revision/);
  assert.throws(() => reviewProposal(capture, [review(p, { metadataHash: "old" })]), /different captured metadata/);
  const proposed = reviewProposal(capture, [review(p)]);
  assert.equal(proposed.assignments[0].metadataHash, taskMetadataHash(p));
});

test("fixed-input comparison keeps feeds and time while changing qualification and selection", () => {
  const good = plugin("good"), unknown = plugin("unknown");
  const capture = { classificationVersion: 2, methodologyVersion: "1.1.0", catalog: { body: { plugins: [good, unknown] } }, stats: { body: { plugins: { good: { copies: 10, hearts: 1, views: 50 }, unknown: { copies: 10000, hearts: 1000, views: 10000 } } } }, taxonomy, now: now.toISOString(), previous: null };
  const compared = compareTaskFit(capture, taxonomy, { schemaVersion: 1, assignments: [review(good)] });
  assert.equal(compared.types[0].beforeWinner.id, unknown.id);
  assert.equal(compared.types[0].afterWinner.id, good.id);
});

test("refresh archives a task queue in dry runs, hashes decisions for the freeze and rejects a truncated catalog", async (context) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "omapicks-task-qualification-")); context.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(path.join(root, "data"));
  const p = plugin("a"); const reviews = { schemaVersion: 1, assignments: [review(p)] };
  for (const [file, value] of Object.entries({ "app-types": taxonomy, "task-reviews": reviews })) await writeFile(path.join(root, "data", file + ".json"), JSON.stringify(value));
  const fetchImpl = async (url) => new Response(JSON.stringify(url.includes("/stats") ? { schemaVersion: 1, plugins: { a: { copies: 10, hearts: 1, views: 50 } } }
    : url.includes("registry") ? { retiredPluginIds: [] } : { plugins: [p] }));
  const options = { root, now, minimumCatalogSize: 1, fetchImpl };
  const published = await refresh(options);
  assertTaskQualifiedSnapshot(published.rankings);
  const original = await readFile(path.join(root, "data", "rankings.json"), "utf8");
  assert.equal((await refresh(options)).reason, "already-refreshed");
  await refresh({ ...options, dryRun: true });
  assert.equal(await readFile(path.join(root, "data", "rankings.json"), "utf8"), original);
  assert.equal(JSON.parse(await readFile(path.join(root, "tmp", "classification-audit", "review-queue.json"))).assignments.length, 0);
  reviews.assignments[0].constraints = ["A new documented requirement."];
  await writeFile(path.join(root, "data", "task-reviews.json"), JSON.stringify(reviews));
  assert.equal((await refresh(options)).reason, undefined);
  assert.throws(() => validateFeeds({ plugins: [p] }, { schemaVersion: 1, plugins: { a: { copies: 0, hearts: 0, views: 0 } } }, 1, { source: { catalog: { count: 4 } } }), /fewer than 75%/);
});

test("version 2 audit captures still replay their classifier evidence under the recorded methodology", () => {
  const p = plugin("sync", "The screenshot shows the file synchronization panel.");
  const legacy = auditClassifications({ catalog: [p], stats: {}, taxonomy, classificationVersion: 2, methodology: methodologyFor("1.1.0"), now });
  assert.equal(legacy.picks[0].id, p.id);
  assert.equal(legacy.classificationVersion, 2);
  const current = auditClassifications({ ...inputs([p], []), classificationVersion: 3 });
  assert.equal(current.picks.length, 0);
});

test("production task reviews cover every category and unrelated winner examples stay out of its podium", async () => {
  const production = JSON.parse(await readFile(new URL("../data/app-types.json", import.meta.url)));
  const decisions = JSON.parse(await readFile(new URL("../data/task-reviews.json", import.meta.url)));
  const prepared = prepareTaskReviews(decisions, production.types);
  for (const type of production.types) assert.ok(decisions.assignments.filter((p) => p.typeId === type.id && p.decision === "qualified").length >= 3, type.id);
  assert.ok(!decisions.assignments.some((p) => p.pluginId === "io.github.ilyazar.syncthing" && p.typeId === "screenshots" && p.decision === "qualified"));
  const source = decisions.assignments.find((p) => p.pluginId === "io.github.ofa14-prog.dynamic-island" && p.typeId === "screen-recording");
  assert.equal(source.decision, "related");
  assert.ok(prepared.size > 250);
});

test("captured counterexamples and missed primary tasks have explicit recommendation outcomes", async () => {
  const json = async (file) => JSON.parse(await readFile(new URL(file, import.meta.url), "utf8"));
  const fixtures = await json("./fixtures/recommendation-fit.json");
  const productionTaxonomy = await json("../data/app-types.json");
  const productionReviews = await json("../data/task-reviews.json");
  const catalog = fixtures.cases.map((c) => c.plugin);
  const result = rankPlugins({ catalog, stats: {}, taxonomy: productionTaxonomy, taskReviews: productionReviews, now });
  for (const { plugin: p, qualified, rejected } of fixtures.cases) {
    const assignments = result.qualifiedTypeIdsById.get(p.id) ?? [];
    for (const typeId of qualified) assert.ok(assignments.includes(typeId), `${p.id} must qualify for ${typeId}`);
    for (const typeId of rejected) {
      assert.ok(!assignments.includes(typeId), `${p.id} cannot recommend ${typeId}`);
      assert.ok(!(result.typeIdsById.get(p.id) ?? []).includes(typeId), `${p.id} cannot match ${typeId}`);
    }
  }
  assertTaskQualifiedSnapshot(result.rankings);
});

test("taxonomy-only baselines cannot silently reuse current task adjudications", () => {
  const p = plugin("a");
  assert.throws(() => auditClassifications({ ...inputs([p], [review(p)]), baselineTaxonomy: taxonomy }), /compare:task-fit/);
});
