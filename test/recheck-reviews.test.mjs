import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { pinnedSource } from "../build/evidence.mjs";
import { taskMetadataHash } from "../build/task-fit.mjs";
import { applyRecheck, manifestChanges, parseArgs, prepareRecheck, relocatePassage, renderMarkdown, repinSource, selectRechecks, splitPassages } from "../scripts/recheck-reviews.mjs";

const OLD = "a".repeat(40);
const NEW = "b".repeat(40);
const repo = "https://github.com/example/vpn";
const hash = (text) => createHash("sha256").update(text).digest("hex");
const oldReadme = "# VPN\n\nConnect and disconnect from the bar.\nShows tunnel status.\n\n## Requirements\n\nNeeds the provider CLI.\n";
const newReadme = "# VPN\n\nA new intro line.\n\nConnect and disconnect from the bar.\nShows tunnel status.\n\n## Requirements\n\nNeeds the provider CLI.\n";
const source = (revision, path, evidence) => ({ url: `${repo}/blob/${revision}/${path}`, revision, path, sha256: hash(oldReadme), evidence });
const taskSource = source(OLD, "README.md", "README.md lines 3-4:\nConnect and disconnect from the bar.\nShows tunnel status.");
const requirementSource = source(OLD, "README.md", "README.md lines 8-8:\nNeeds the provider CLI.");
const plugin = { id: "example.vpn", name: "VPN", description: "A VPN widget", repo, upstreamObservedCommit: NEW };
const review = { pluginId: plugin.id, typeId: "vpn", decision: "qualified", role: "core", contractVersion: 2, metadataHash: "0".repeat(64),
  capabilities: ["read-vpn-status"], constraints: [], reason: "Shows tunnel status and controls connections.", reviewedAt: "2026-10-29",
  provenance: "repository-evidence", source: taskSource };
const profile = { repository: repo, requirementsStatus: "reviewed", requirements: ["Needs the provider CLI."], reviewedAt: "2026-10-29", sources: [requirementSource] };
const observation = { status: "changed", repository: repo, reviewRevision: OLD, currentRevision: NEW, evidencePaths: ["README.md"] };
const queue = { assignments: [
  { pluginId: plugin.id, typeId: "vpn", status: "stale-source", previousPick: true, wouldEnterPodium: true, prospectiveScore: 0.9 },
  { pluginId: "other", typeId: "vpn", status: "pending", previousPick: false, wouldEnterPodium: true },
  { pluginId: "quiet", typeId: "vpn", status: "stale-source", previousPick: false, wouldEnterPodium: false },
] };

test("passages keep their exact text and move to their new lines", () => {
  const [passage] = splitPassages(taskSource.evidence);
  assert.deepEqual(relocatePassage(passage, newReadme), { ...passage, first: 5, last: 6 });
  assert.equal(relocatePassage({ ...passage, text: "Connect from the bar." }, newReadme), null);
  // The nearest copy wins when a block repeats, so relocation is stable.
  assert.equal(relocatePassage({ path: "README.md", first: 6, last: 6, text: "x" }, "x\ny\nx\ny\nx\n").first, 5);
});

test("a re-pinned source is immutable and verifiable at the new commit", () => {
  const result = repinSource(taskSource, Buffer.from(newReadme), repo, NEW);
  assert.equal(result.status, "relocated");
  assert.ok(pinnedSource(result.source, repo));
  assert.equal(result.source.sha256, hash(newReadme));
  assert.equal(result.source.evidence, "README.md lines 5-6:\nConnect and disconnect from the bar.\nShows tunnel status.");
  assert.deepEqual(repinSource(taskSource, Buffer.from("# VPN\n"), repo, NEW), { status: "passage-changed", missing: ["README.md lines 3-4"] });
});

test("only manifest keys other than the version count as changes", () => {
  assert.deepEqual(manifestChanges({ version: "1.0", entryPoints: { barWidget: "A.qml" } }, { version: "1.1", entryPoints: { barWidget: "A.qml" } }), []);
  assert.deepEqual(manifestChanges({ version: "1.0", kinds: ["bar-widget"] }, { version: "1.0", kinds: ["panel"] }), ["kinds"]);
  assert.deepEqual(manifestChanges(null, { version: "1.0" }), ["manifest.json added or removed"]);
});

test("selection keeps changed picks and podium entrants, capped by assignment", () => {
  const groups = selectRechecks({ catalog: [plugin], taskReviews: { assignments: [review] }, pluginProfiles: { plugins: { [plugin.id]: profile } },
    evidenceObservations: { plugins: { [plugin.id]: observation } }, queue, limit: 30 });
  assert.deepEqual(groups.map((g) => [g.plugin.id, g.queued.map((q) => q.typeId), g.reviews.length]), [[plugin.id, ["vpn"], 1]]);
  assert.equal(selectRechecks({ catalog: [plugin], taskReviews: { assignments: [review] }, pluginProfiles: { plugins: { [plugin.id]: profile } },
    evidenceObservations: { plugins: { [plugin.id]: { ...observation, status: "current" } } }, queue, limit: 30 }).length, 0);
});

test("a proposal re-pins reviews and requirements together, and applying it needs an explicit acceptance", async () => {
  const [group] = selectRechecks({ catalog: [plugin], taskReviews: { assignments: [review] }, pluginProfiles: { plugins: { [plugin.id]: profile } },
    evidenceObservations: { plugins: { [plugin.id]: observation } }, queue, limit: 30 });
  const files = { [`${NEW}/README.md`]: newReadme, [`${OLD}/manifest.json`]: '{"version":"1.0"}', [`${NEW}/manifest.json`]: '{"version":"1.1"}' };
  const fetchText = async (_repo, revision, file) => files[`${revision}/${file}`] == null ? null : Buffer.from(files[`${revision}/${file}`]);
  const compare = async () => ({ commits: 2, truncated: false, files: [{ path: "Panel.qml", status: "modified", additions: 3, deletions: 1 }] });
  const item = await prepareRecheck(group, { fetchText, compare });
  assert.equal(item.mechanicalStatus, "passages-unchanged");
  assert.deepEqual(item.manifestChanges, []);
  assert.equal(item.reviews[0].review.metadataHash, taskMetadataHash(plugin));
  const proposal = { generatedAt: "2026-11-09T07:54:02.698Z", plugins: [item] };
  assert.match(renderMarkdown(proposal), /Cited passages: unchanged/);
  assert.match(renderMarkdown({ ...proposal, plugins: [{ pluginId: "x", name: "X", mechanicalStatus: "unavailable", error: "HTTP 502" }] }), /Could not be prepared: HTTP 502/);

  const reviews = { schemaVersion: 2, assignments: [review] };
  const profiles = { schemaVersion: 1, plugins: { [plugin.id]: profile } };
  assert.throws(() => applyRecheck(proposal, ["missing"], structuredClone(reviews), structuredClone(profiles), "2026-11-09"), /Not in this proposal/);
  const applied = applyRecheck(proposal, [plugin.id], structuredClone(reviews), structuredClone(profiles), "2026-11-09");
  assert.equal(applied.reviews.assignments[0].source.revision, NEW);
  assert.equal(applied.reviews.assignments[0].reviewedAt, "2026-11-09");
  assert.equal(applied.profiles.plugins[plugin.id].sources[0].evidence, "README.md lines 10-10:\nNeeds the provider CLI.");
  // Capabilities and the decision are kept, never invented.
  assert.deepEqual(applied.reviews.assignments[0].capabilities, review.capabilities);

  // An editorial change made after the proposal, even at the same revision, wins.
  const rejected = structuredClone(reviews); rejected.assignments[0].decision = "rejected";
  assert.throws(() => applyRecheck(proposal, [plugin.id], rejected, structuredClone(profiles), "2026-11-09"), /review changed since the proposal/);
  const edited = structuredClone(profiles); edited.plugins[plugin.id].requirements = ["Needs a different CLI."];
  assert.throws(() => applyRecheck(proposal, [plugin.id], structuredClone(reviews), edited, "2026-11-09"), /requirements changed since the proposal/);

  const changed = await prepareRecheck(group, { fetchText: async (...args) => args[2] === "README.md" ? Buffer.from("# VPN\n") : fetchText(...args), compare });
  assert.equal(changed.mechanicalStatus, "passages-changed");
  assert.throws(() => applyRecheck({ ...proposal, plugins: [changed] }, [plugin.id], structuredClone(reviews), structuredClone(profiles), "2026-11-09"), /write a new review/);
});

test("arguments need either an input or an accepted proposal", () => {
  assert.throws(() => parseArgs([]), /Usage/);
  assert.throws(() => parseArgs(["--apply", "p.json"]), /--accept/);
  assert.equal(parseArgs(["--input", "i.json", "--limit", "5"]).limit, 5);
});
