import assert from "node:assert/strict";
import test from "node:test";
import { captureEvidence, passagesPresent, relevantTreeFingerprint } from "../build/evidence.mjs";
import { changesBetween, methodologyFor, rankPlugins } from "../build/rank.mjs";
import { coverageWarnings } from "../build/refresh.mjs";
import { renderFixtureType } from "../build/render.mjs";
import { compareTaskFit } from "../scripts/compare-task-fit.mjs";
import { assertTaskQualifiedSnapshot, publicationWeeksSince, taskMetadataHash } from "../build/task-fit.mjs";

// Methodology 1.5.0: a previous pick whose repository changed keeps its place for a limited
// time while its cited passages survive. 1.4.0 replays never grant it.
const revision = "a".repeat(40), currentRevision = "b".repeat(40);
const now = new Date("2026-11-16T06:17:00Z");
const repo = "https://github.com/example/capture";
const evidence = "README.md lines 3-3:\nCapture regions and save PNG images.";
const requirement = "README.md lines 5-5:\nRequires grim.";
const source = (text) => ({ url: `${repo}/blob/${revision}/README.md`, revision, path: "README.md", evidence: text });
const plugin = { id: "capture", name: "Capture", description: "Screenshots", repo, installAvailable: true, installCommand: `omarchy plugin add ${repo}`, upstreamObservedCommit: currentRevision, upstreamCheckStatus: "ok" };
const rival = { ...plugin, id: "rival", name: "Rival", repo: "https://github.com/example/rival", installCommand: "omarchy plugin add https://github.com/example/rival" };
const taxonomy = { schemaVersion: 1, types: [{ id: "capture", name: "Capture", include: ["screenshots"], contract: { version: 1, outcome: "Capture a screen region and save its image", capabilitySets: [["capture", "save"]] } }] };
const review = (p) => ({ pluginId: p.id, typeId: "capture", contractVersion: 1, metadataHash: taskMetadataHash(p), decision: "qualified", role: "core", capabilities: ["capture", "save"],
  constraints: [], reason: "Captures screen regions and saves PNG images.", reviewedAt: "2026-10-29", provenance: "repository-evidence",
  source: { ...source(evidence), url: `${p.repo}/blob/${revision}/README.md` } });
const profile = (p) => ({ requirementsStatus: "reviewed", requirements: ["Requires grim."], reviewedAt: "2026-10-29", sources: [{ ...source(requirement), url: `${p.repo}/blob/${revision}/README.md` }] });
const tree = { truncated: false, tree: [{ path: "README.md", type: "blob", mode: "100644", sha: "c".repeat(40) }, { path: "Main.qml", type: "blob", mode: "100644", sha: "d".repeat(40) }] };
const fingerprint = relevantTreeFingerprint(tree, ["README.md"]);
const observed = (p, extra = {}) => ({ repository: p.repo, reviewRevision: revision, currentRevision, checkedAt: now.toISOString(), status: "current",
  baselineFingerprint: fingerprint, currentFingerprint: fingerprint, evidencePaths: ["README.md"], ...extra });
const changed = (p, recheck = { status: "checked", passagesPresent: true, manifestChanges: [] }) => observed(p, { status: "changed", currentFingerprint: "e".repeat(64), recheck });
const stats = { capture: { copies: 50, hearts: 5, views: 200 }, rival: { copies: 5, hearts: 0, views: 40 } };
const args = (observation, extra = {}) => structuredClone({ catalog: [plugin, rival], stats, taxonomy,
  taskReviews: { schemaVersion: 2, assignments: [review(plugin), review(rival)] },
  pluginProfiles: { schemaVersion: 1, plugins: { capture: profile(plugin), rival: profile(rival) } },
  evidenceObservations: { schemaVersion: 1, plugins: { capture: observation, rival: observed(rival) } }, now, methodology: methodologyFor("1.5.0"), ...extra });
const previousWeek = (methodology = methodologyFor("1.5.0")) => rankPlugins({ ...args(observed(plugin)), now: new Date("2026-11-09T06:17:00Z"),
  evidenceObservations: { schemaVersion: 1, plugins: { capture: observed(plugin, { checkedAt: "2026-11-09T06:17:00Z" }), rival: observed(rival, { checkedAt: "2026-11-09T06:17:00Z" }) } }, methodology }).rankings;

test("passages must appear word for word; line numbers may move", () => {
  assert.equal(passagesPresent(evidence, "# Capture\n\nNew intro.\n\nCapture regions and save PNG images.\n"), true);
  assert.equal(passagesPresent(evidence, "Capture regions and save images.\n"), false);
  assert.equal(passagesPresent("not a passage", "anything"), false);
});

test("a changed previous pick keeps its place, labelled, while its passages survive", () => {
  const previous = previousWeek();
  assert.equal(previous.types[0].winner.id, "capture");
  const result = rankPlugins({ ...args(changed(plugin)), previous });
  const winner = result.rankings.types[0].winner;
  assert.equal(winner.id, "capture");
  assert.equal(winner.taskFit.evidenceStatus, "recheck-pending");
  assert.equal(winner.taskFit.recheckSince, now.toISOString());
  assertTaskQualifiedSnapshot(result.rankings);
  // It still asks for a re-check, under the status the re-check tool reads.
  assert.equal(result.reviewQueue.find((entry) => entry.pluginId === "capture")?.status, "stale-source");
  assert.equal(result.taskStatusByAssignment.get("capture/capture"), "qualified");
  assert.match(renderFixtureType(result.rankings.types[0], result.rankings), /Re-check pending: the repository changed after review/);
});

test("grace lasts two weekly publications, then the pick waits for its re-check", () => {
  const first = rankPlugins({ ...args(changed(plugin)), previous: previousWeek() }).rankings;
  const nextWeek = new Date("2026-11-23T06:17:00Z");
  const second = rankPlugins({ ...args(changed(plugin, undefined)), now: nextWeek, previous: first,
    evidenceObservations: { schemaVersion: 1, plugins: { capture: { ...changed(plugin), checkedAt: nextWeek.toISOString() }, rival: observed(rival, { checkedAt: nextWeek.toISOString() }) } } });
  assert.equal(second.rankings.types[0].winner.taskFit.recheckSince, now.toISOString());
  assert.equal(publicationWeeksSince(now.toISOString(), nextWeek), 1);
  const thirdWeek = new Date("2026-11-30T06:17:00Z");
  const third = rankPlugins({ ...args(changed(plugin)), now: thirdWeek, previous: second.rankings,
    evidenceObservations: { schemaVersion: 1, plugins: { capture: { ...changed(plugin), checkedAt: thirdWeek.toISOString() }, rival: observed(rival, { checkedAt: thirdWeek.toISOString() }) } } });
  const type = third.rankings.types[0];
  assert.equal(type.winner.id, "rival");
  assert.deepEqual(type.recheckPending, [{ id: "capture", name: "Capture" }]);
  const [change] = changesBetween(second.rankings, third.rankings, { catalogIds: new Set(["capture", "rival"]), exclusions: third.exclusions, typeIdsById: third.typeIdsById, taskStatusByAssignment: third.taskStatusByAssignment });
  assert.equal(change.reason, "recheck-after-update");
  assert.match(renderFixtureType(type, third.rankings), /Capture is being re-checked after an update/);
  // An expired grace cannot be published.
  const forged = structuredClone(second.rankings); forged.generatedAt = thirdWeek.toISOString();
  const fit = forged.types[0].winner.taskFit; fit.evidenceObservation.checkedAt = fit.lastValidatedAt = thirdWeek.toISOString();
  assert.throws(() => assertTaskQualifiedSnapshot(forged), /Expired re-check grace/);
});

test("grace needs a previous pick, surviving passages, a stable manifest and methodology 1.5.0", () => {
  const previous = previousWeek();
  const stale = (result) => result.rankings.types[0].winner?.id !== "capture";
  assert.ok(stale(rankPlugins(args(changed(plugin)))), "not a previous pick");
  assert.ok(stale(rankPlugins({ ...args(changed(plugin, { status: "checked", passagesPresent: false, manifestChanges: [] })), previous })), "passage removed");
  assert.ok(stale(rankPlugins({ ...args(changed(plugin, { status: "checked", passagesPresent: true, manifestChanges: ["entryPoints"] })), previous })), "entry point changed");
  assert.ok(stale(rankPlugins({ ...args(changed(plugin, { status: "unavailable", reason: "HTTP 502" })), previous })), "re-check evidence unavailable");
  assert.ok(stale(rankPlugins({ ...args(changed(plugin)), previous: previousWeek(methodologyFor("1.4.0")), methodology: methodologyFor("1.4.0") })), "1.4.0");
});

test("only a 1.5.0 capture records re-check evidence, and a failed fetch grants none", async () => {
  const changedTree = { truncated: false, tree: [tree.tree[0], { ...tree.tree[1], sha: "f".repeat(40) }] };
  const files = { [`${currentRevision}/README.md`]: "# Capture\n\nCapture regions and save PNG images.\n\nRequires grim.\n",
    [`${revision}/manifest.json`]: '{"version":"1.0","entryPoints":{"barWidget":"Main.qml"}}', [`${currentRevision}/manifest.json`]: '{"version":"1.1","entryPoints":{"barWidget":"Main.qml"}}' };
  const fetchImpl = (fail) => async (url) => {
    if (url.includes("api.github.com")) return new Response(JSON.stringify(url.includes(revision) ? tree : changedTree));
    if (fail) return new Response("", { status: 502 });
    const key = Object.keys(files).find((k) => url.endsWith(k));
    return key ? new Response(files[key]) : new Response("", { status: 404 });
  };
  const input = { catalog: [plugin], taskReviews: { schemaVersion: 2, assignments: [review(plugin)] }, pluginProfiles: { schemaVersion: 1, plugins: { capture: profile(plugin) } }, taxonomy, now };
  const recheck = methodologyFor("1.5.0").eligibility.recheckGrace;
  assert.deepEqual((await captureEvidence({ ...input, fetchImpl: fetchImpl(false), recheck })).plugins.capture.recheck, { status: "checked", passagesPresent: true, manifestChanges: [] });
  assert.equal((await captureEvidence({ ...input, fetchImpl: fetchImpl(false) })).plugins.capture.recheck, undefined);
  assert.equal((await captureEvidence({ ...input, fetchImpl: fetchImpl(true), recheck })).plugins.capture.recheck.status, "unavailable");
});

test("coverage warnings flag a falling shortlist with counts only", () => {
  const snapshot = (week, runnerUps, total = 10) => ({ week, types: Array.from({ length: total }, (_, i) => ({ id: `t${i}`, winner: { id: `w${i}` }, runnerUp: i < runnerUps ? { id: `r${i}` } : null })) });
  assert.deepEqual(coverageWarnings(snapshot("2026-W45", 9), snapshot("2026-W46", 6), { qualifiedAssignments: 100 }, { qualifiedAssignments: 91 }), []);
  const warnings = coverageWarnings(snapshot("2026-W45", 9), snapshot("2026-W46", 5), { qualifiedAssignments: 170 }, { qualifiedAssignments: 139 });
  assert.deepEqual(warnings, [
    "Coverage warning: Runners-up fell from 9 to 5 since 2026-W45. Check the review queue for picks whose repositories changed.",
    "Coverage warning: Qualified assignments fell from 170 to 139 (18%). Check the review queue for picks whose repositories changed."
  ]);
  assert.deepEqual(coverageWarnings(null, snapshot("2026-W46", 5), null, null), []);
});

test("a pick found only through its review still gets its re-check note", () => {
  // No lexical match: the plugin competes only because its source review qualifies it.
  const quiet = { ...plugin, description: "A tool for grabbing the desktop" };
  const build = (observation, extra = {}) => {
    const a = args(observation, extra);
    a.catalog = [quiet];
    a.taskReviews.assignments = [review(quiet)];
    delete a.evidenceObservations.plugins.rival;
    return a;
  };
  const previous = rankPlugins({ ...build(observed(quiet)), now: new Date("2026-11-09T06:17:00Z"),
    evidenceObservations: { schemaVersion: 1, plugins: { capture: observed(quiet, { checkedAt: "2026-11-09T06:17:00Z" }) } } }).rankings;
  assert.equal(previous.types[0].winner?.id, "capture");
  const result = rankPlugins({ ...build(changed(quiet, { status: "checked", passagesPresent: false, manifestChanges: [] })), previous });
  assert.equal(result.rankings.types[0].winner, null);
  assert.deepEqual(result.rankings.types[0].recheckPending, [{ id: "capture", name: "Capture" }]);
});

test("the task-fit comparison grants grace against the published picks", () => {
  const before = previousWeek(methodologyFor("1.4.0"));
  const base = args(changed(plugin, undefined));
  const inputs = { catalog: { body: { plugins: base.catalog } }, stats: { body: { plugins: stats } }, now: now.toISOString(), previous: before,
    taxonomy, taskReviews: base.taskReviews, pluginProfiles: base.pluginProfiles,
    evidenceObservations: { schemaVersion: 1, plugins: { capture: { ...changed(plugin), recheck: undefined }, rival: observed(rival) } }, classificationVersion: 3, methodologyVersion: "1.4.0" };
  const result = compareTaskFit(inputs, taxonomy, base.taskReviews, { evidenceObservations: base.evidenceObservations, methodology: methodologyFor("1.5.0") });
  const type = result.types.find((t) => t.id === "capture");
  assert.equal(type.beforeWinner.id, "rival");
  assert.equal(type.afterWinner.id, "capture");
  assert.equal(type.afterWinner.taskFit.evidenceStatus, "recheck-pending");
});
