import assert from "node:assert/strict";
import { readFile, mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import test from "node:test";
import { classifyPlugin, prepareTaxonomy, rankPlugins as rankLatest, methodologyFor, pickWithHysteresis } from "../build/rank.mjs";
import { assertTaskQualifiedSnapshot, explainTaskFit, prepareTaskReviews, taskMetadataHash, updateTaskReviewQueue } from "../build/task-fit.mjs";
import { auditClassifications as auditLatest, checksum, renderClassificationAudit } from "../build/classification-audit.mjs";
import { refresh as refreshLatest, replayChanges, validateFeeds } from "../build/refresh.mjs";
import { renderFixtureType, renderFixtureMethodology, renderFixtureChangelog } from "../build/render.mjs";
import { reviewProposal } from "../scripts/task-review.mjs";
import { compareTaskFit } from "../scripts/compare-task-fit.mjs";

// Published 1.2 qualification remains replayable. New evidence policy is in evidence.test.mjs.
const rankPlugins = (options) => rankLatest({ methodology: methodologyFor("1.2.0"), ...options });
const auditClassifications = (options) => auditLatest({ methodology: methodologyFor("1.2.0"), ...options });
const refresh = (options) => refreshLatest({ methodology: methodologyFor("1.2.0"), ...options });

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

test("unresolved former picks keep their priority and queue age after replacement", () => {
  const old = plugin("old"), replacement = plugin("replacement"), challenger = plugin("challenger");
  const reviews = [review(old), review(replacement)];
  const args = inputs([old, replacement, challenger], reviews, { stats: {
    old: { copies: 1000, hearts: 90, views: 3000 }, replacement: { copies: 10, hearts: 1, views: 50 },
    challenger: { copies: 10000, hearts: 1000, views: 30000 }
  } });
  const initial = rankPlugins(args);
  const changed = { ...old, description: "A changed screenshot capture claim." };
  const first = rankPlugins({ ...args, catalog: [changed, replacement, challenger], previous: initial.rankings });
  const queue = updateTaskReviewQueue(first.reviewQueue, null, now.toISOString());
  const next = auditClassifications({ ...args, catalog: [changed, replacement, challenger], previous: first.rankings,
    previousReviewQueue: queue, now: new Date("2026-10-19T15:00:00Z") });
  const pending = next.reviewQueue.find((p) => p.pluginId === old.id);
  assert.equal(pending.previousPick, true);
  assert.equal(pending.firstSeenAt, now.toISOString());
  assert.equal(next.reviewQueue[0].pluginId, old.id, "a stronger pending challenger cannot bury the unresolved former pick");
  assert.match(renderClassificationAudit(next), /former pick;/);
  const stored = updateTaskReviewQueue(next.reviewQueue, queue, next.generatedAt);
  assert.equal(stored.assignments[0].previousPick, true);
  const editedAgain = updateTaskReviewQueue([{ ...pending, metadataHash: "changed-again", previousPick: false }], stored, "2026-10-20T15:00:00Z");
  assert.equal(editedAgain.assignments[0].previousPick, true);
  assert.equal(editedAgain.assignments[0].firstSeenAt, "2026-10-20T15:00:00Z");
  const resolved = updateTaskReviewQueue([], editedAgain, "2026-10-21T15:00:00Z");
  assert.equal(updateTaskReviewQueue([{ ...pending, previousPick: false }], resolved).assignments[0].previousPick, false);
});

test("known related integrations cannot hide a challenger from prospective podium review", () => {
  const good = plugin("good"), pending = plugin("pending"), a = plugin("related-a"), b = plugin("related-b");
  const related = (p) => review(p, { decision: "related", role: "integration", capabilities: [],
    reason: "Only reports capture activity from another tool; cannot capture and export images." });
  const args = inputs([good, pending, a, b], [review(good), related(a), related(b)], { stats: {
    good: { copies: 10, hearts: 1, views: 50 }, pending: { copies: 1000, hearts: 100, views: 3000 },
    "related-a": { copies: 10000, hearts: 1000, views: 30000 }, "related-b": { copies: 20000, hearts: 2000, views: 60000 }
  } });
  const before = rankPlugins(args);
  const row = before.reviewQueue.find((p) => p.pluginId === pending.id);
  assert.equal(row.wouldEnterPodium, true);
  assert.equal(before.rankings.types[0].winner.id, good.id);
  const admitted = rankPlugins({ ...args, taskReviews: { schemaVersion: 1, assignments: [...args.taskReviews.assignments, review(pending)] } });
  assert.equal(admitted.rankings.types[0].winner.id, pending.id);
  const withoutRelated = rankPlugins({ ...args, catalog: [good, pending] });
  assert.equal(row.prospectiveScore, withoutRelated.reviewQueue[0].prospectiveScore, "related popularity also cannot alter research normalization");
});

test("review proposal binds an explicit judgment to captured evidence and never invents approval", () => {
  const p = plugin("a"); const capture = { catalog: { body: { plugins: [p] } }, taxonomy };
  assert.throws(() => reviewProposal(capture, [{ pluginId: "a", typeId: "capture" }]), /decision/);
  assert.throws(() => reviewProposal(capture, [review(p, { source: undefined })]), /reviewed source revision/);
  assert.throws(() => reviewProposal(capture, [review(p, { metadataHash: "old" })]), /different captured metadata/);
  const proposed = reviewProposal(capture, [review(p)]);
  assert.equal(proposed.assignments[0].metadataHash, taskMetadataHash(p));
  const catalogDecision = review(p, { provenance: "catalog-evidence", source: undefined });
  const source = reviewProposal(capture, [catalogDecision]).assignments[0].source;
  assert.equal(source.revision, checksum(capture.catalog.body));
  assert.equal(source.path, "catalog.json");
  assert.equal(source.evidence, `plugins[0].description (a): ${p.description}`);
  assert.notEqual(source.evidence, catalogDecision.reason);
});

test("fixed-input comparison keeps feeds and time while changing qualification and selection", () => {
  const good = plugin("good"), unknown = plugin("unknown");
  const capture = { classificationVersion: 2, methodologyVersion: "1.1.0", catalog: { body: { plugins: [good, unknown] } }, stats: { body: { plugins: { good: { copies: 10, hearts: 1, views: 50 }, unknown: { copies: 10000, hearts: 1000, views: 10000 } } } }, taxonomy, now: now.toISOString(), previous: null };
  const compared = compareTaskFit(capture, taxonomy, { schemaVersion: 1, assignments: [review(good)] }, { methodology: methodologyFor("1.2.0") });
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

test("publishing a replacement does not erase former-pick priority from subsequent refresh captures", async (context) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "omapicks-former-pick-"));
  context.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(path.join(root, "data"));
  const old = plugin("old"), replacement = plugin("replacement"), challenger = plugin("challenger");
  let entries = [old, replacement, challenger];
  for (const [file, value] of Object.entries({ "app-types": taxonomy, "task-reviews": { schemaVersion: 1, assignments: [review(old), review(replacement)] } })) {
    await writeFile(path.join(root, "data", `${file}.json`), JSON.stringify(value));
  }
  const stats = { old: { copies: 1000, hearts: 90, views: 3000 }, replacement: { copies: 10, hearts: 1, views: 50 }, challenger: { copies: 10000, hearts: 1000, views: 30000 } };
  const fetchImpl = async (url) => new Response(JSON.stringify(url.includes("/stats") ? { schemaVersion: 1, plugins: stats }
    : url.includes("registry") ? { retiredPluginIds: [] } : { plugins: entries }));
  const options = { root, now, minimumCatalogSize: 1, fetchImpl };
  await refresh(options);
  entries = [{ ...old, description: "Changed screenshot capture evidence." }, replacement, challenger];
  const replaced = await refresh({ ...options, republish: true });
  assert.equal(replaced.rankings.types[0].winner.id, replacement.id);
  const firstQueue = replaced.reviewQueue;
  const later = await refresh({ ...options, now: new Date("2026-10-19T15:00:00Z") });
  assert.equal(later.reviewQueue.assignments[0].pluginId, old.id);
  assert.equal(later.classificationAudit.reviewQueue[0].previousPick, true);
  assert.deepEqual(later.auditInputs.previousReviewQueue, firstQueue);
  assert.equal(later.reviewQueue.assignments[0].firstSeenAt, firstQueue.assignments[0].firstSeenAt);
  const stored = JSON.parse(await readFile(path.join(root, "data", "task-review-queue.json")));
  assert.equal(stored.assignments[0].previousPick, true);
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

test("captured 1.2 counterexamples and missed primary tasks replay their explicit outcomes", async () => {
  const json = async (file) => JSON.parse(await readFile(new URL(file, import.meta.url), "utf8"));
  const fixtures = await json("./fixtures/recommendation-fit.json");
  const productionTaxonomy = fixtures.taxonomy;
  const productionReviews = fixtures.taskReviews;
  const catalog = fixtures.cases.map((c) => c.plugin);
  const result = rankPlugins({ catalog, stats: {}, taxonomy: productionTaxonomy, taskReviews: productionReviews, now });
  for (const { plugin: p, qualified, rejected, related = [] } of fixtures.cases) {
    const assignments = result.qualifiedTypeIdsById.get(p.id) ?? [];
    for (const typeId of qualified) assert.ok(assignments.includes(typeId), `${p.id} must qualify for ${typeId}`);
    for (const typeId of related) {
      assert.ok(!assignments.includes(typeId), `${p.id} has insufficient scope for ${typeId}`);
      assert.ok(result.rankings.types.find((t) => t.id === typeId).relatedTools.some((c) => c.id === p.id), `${p.id} stays discoverable as related to ${typeId}`);
    }
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

test("caption wording preserves one- and two-sentence task claims for review", async () => {
  const production = JSON.parse(await readFile(new URL("../data/app-types.json", import.meta.url)));
  for (const [typeId, description] of [
    ["weather", "The image shows a weather radar widget for the menu bar."],
    ["weather", "Menu-bar weather radar. The image shows the forecast."],
    ["network", "The image shows how you connect, disconnect and configure Wi-Fi networks."],
    ["network", "Connect, disconnect and configure Wi-Fi networks. The preview image shows the controls."],
    ["screenshots", "The screenshot shows how to take a screenshot of a window and save the image."],
    ["screenshots", "Take a screenshot of a window and save the image."],
    ["screenshots", "Take screenshots of a window and save the images."]
  ]) {
    const p = plugin("neutral-utility", description);
    const result = rankPlugins(inputs([p], [], { taxonomy: production }));
    assert.ok(result.typeIdsById.get(p.id)?.includes(typeId), description);
    assert.equal(result.reviewQueue.find((r) => r.pluginId === p.id && r.typeId === typeId)?.status, "pending", description);
    assert.equal(result.rankings.types.find((t) => t.id === typeId).winner, null, "discovery cannot manufacture qualification");
  }
});

test("source evidence reflects the related scope instead of a qualified category template", async () => {
  const decisions = JSON.parse(await readFile(new URL("../data/task-reviews.json", import.meta.url)));
  for (const r of decisions.assignments.filter((r) => r.decision !== "qualified")) {
    assert.ok(!decisions.assignments.some((q) => q.typeId === r.typeId && q.decision === "qualified" && q.source.evidence === r.source.evidence), `${r.pluginId}/${r.typeId}`);
    assert.match(r.source.evidence, r.provenance === "catalog-evidence" ? /^plugins\[\d+\]\.(?:description|name) / : /^.+(?:, line \d+| lines \d+(?:-\d+)?):\s/);
  }
  const manager = decisions.assignments.find((r) => r.pluginId === "io.github.sahzudin.omarchy-screenshot-manager" && r.typeId === "screenshots");
  assert.match(manager.source.evidence, /Browse, preview, copy, and delete screenshots taken with omarchy capture/);
  assert.doesNotMatch(manager.source.evidence, /Captures a screen region/);
});

test("the VPN contract requires connection controls and its reviewed tools document both capabilities", async () => {
  const production = JSON.parse(await readFile(new URL("../data/app-types.json", import.meta.url)));
  const decisions = JSON.parse(await readFile(new URL("../data/task-reviews.json", import.meta.url)));
  const vpn = production.types.find((t) => t.id === "vpn");
  assert.equal(vpn.contract.version, 2);
  const assignments = decisions.assignments.filter((r) => r.typeId === "vpn");
  assert.equal(assignments.length, 4);
  for (const r of assignments) {
    assert.deepEqual(r.capabilities, ["read-vpn-status", "control-vpn-connection"]);
    assert.equal(r.provenance, "repository-evidence");
    assert.match(r.source.evidence, /^.+(?:, line \d+| lines \d+(?:-\d+)?):\s/);
    assert.throws(() => prepareTaskReviews({ schemaVersion: 1, assignments: [{ ...r, capabilities: ["read-vpn-status"] }] }, [vpn]), /does not meet task contract/);
  }
});

test("refresh and replay distinguish related, unresolved and departed former picks", async (context) => {
  const scenarios = [
    ["related", "related-task-scope"], ["pending", "awaiting-task-qualification"],
    ["stale-metadata", "awaiting-task-qualification"], ["stale-without-match", "awaiting-task-qualification"],
    ["stale-contract", "awaiting-task-qualification"], ["held", "awaiting-task-qualification"],
    ["departed", "no-longer-in-category"], ["failed", "compatibility-failed"],
    ["unreachable", "repository-unreachable"], ["retired", "retired"]
  ];
  for (const [scenario, expected] of scenarios) {
    const root = await mkdtemp(path.join(os.tmpdir(), "omapicks-removal-scope-"));
    context.after(() => rm(root, { recursive: true, force: true }));
    await mkdir(path.join(root, "data"));
    const old = plugin("old"), runner = plugin("old-runner"), replacement = plugin("replacement");
    const stats = { old: { copies: 10000, hearts: 1000, views: 30000 }, "old-runner": { copies: 1000, hearts: 100, views: 3000 }, replacement: { copies: 10, hearts: 1, views: 50 } };
    const previous = rankPlugins(inputs([old, runner, replacement], [], { stats, methodology: methodologyFor("1.1.0") })).rankings;
    assert.equal(previous.types[0].winner.id, old.id);
    assert.equal(previous.types[0].runnerUp.id, runner.id);
    let catalog = [old, runner, replacement], reviews = [review(replacement)];
    const currentTaxonomy = structuredClone(taxonomy);
    if (["related", "failed", "unreachable"].includes(scenario)) {
      reviews.push(...[old, runner].map((p) => review(p, { decision: "related", role: "integration", capabilities: [], reason: "Only indicates capture activity from another application." })));
      if (scenario !== "related") catalog = catalog.map((p) => p.id === replacement.id ? p : { ...p, upstreamCheckStatus: scenario });
    } else if (scenario.startsWith("stale")) {
      reviews.push(review(old), review(runner));
      if (scenario === "stale-contract") {
        currentTaxonomy.types[0].contract.version = 2;
        reviews[0].contractVersion = 2;
      } else catalog = catalog.map((p) => p.id === replacement.id ? p : { ...p, description: scenario === "stale-without-match" ? "Synchronizes local folders." : "Changed screenshot capture claim." });
    } else if (scenario === "held") {
      reviews.push(review(old), review(runner));
      currentTaxonomy.overrides = { review: { old: ["capture"], "old-runner": ["capture"] }, reasons: {
        old: { capture: "Requires another capability source check." }, "old-runner": { capture: "Requires another capability source check." }
      } };
    } else if (scenario === "departed") catalog = catalog.map((p) => p.id === replacement.id ? p : { ...p, description: "Synchronizes local folders." });
    else if (scenario === "retired") catalog = [replacement];
    for (const [file, value] of Object.entries({ "app-types": currentTaxonomy, "task-reviews": { schemaVersion: 1, assignments: reviews }, rankings: previous })) {
      await writeFile(path.join(root, "data", `${file}.json`), JSON.stringify(value));
    }
    const fetchImpl = async (url) => new Response(JSON.stringify(url.includes("/stats") ? { schemaVersion: 1, plugins: stats }
      : url.includes("registry") ? { retiredPluginIds: [old.id, runner.id] } : { plugins: catalog }));
    const result = await refresh({ root, now, minimumCatalogSize: 1, fetchImpl, dryRun: true });
    assert.equal(result.computedChanges[0].reason, expected, `${scenario}: champion`);
    assert.equal(result.runnerUpChanges[0].reason, expected, `${scenario}: runner-up`);
    const replayed = replayChanges(JSON.parse(JSON.stringify(result.auditInputs)));
    assert.deepEqual(replayed.changes, result.computedChanges, scenario);
    assert.deepEqual(replayed.runnerUpChanges, result.runnerUpChanges, scenario);
  }
});

test("the W42 related peripheral tool has consistent history and changelog wording", async () => {
  const history = JSON.parse(await readFile(new URL("../data/history/2026-W42.json", import.meta.url)));
  const event = history.runnerUpChanges.find((c) => c.typeId === "peripheral-battery" && c.previous?.id === "davedes.mouse-keybind-settings");
  assert.equal(event.reason, "related-task-scope");
  // changelog.json only holds the latest published week, so compare it with that week's history.
  const changelog = JSON.parse(await readFile(new URL("../data/changelog.json", import.meta.url)));
  const latest = JSON.parse(await readFile(new URL(`../data/history/${changelog.week}.json`, import.meta.url)));
  assert.deepEqual(changelog.changes, latest.changes);
  assert.deepEqual(changelog.runnerUpChanges, latest.runnerUpChanges);
  const html = renderFixtureChangelog([history]);
  assert.match(html, /Mouse &amp; Keybind Settings remains a related tool with a narrower task scope/);
  assert.doesNotMatch(html, /Mouse &amp; Keybind Settings no longer matches this category/);
});
