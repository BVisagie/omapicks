import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { classifyPlugin, explainClassification, prepareTaxonomy, rankPlugins } from "../build/rank.mjs";
import { auditClassifications, renderClassificationAudit } from "../build/classification-audit.mjs";

const production = JSON.parse(await readFile(new URL("../data/app-types.json", import.meta.url)));
const prepared = prepareTaxonomy(production);
const cases = JSON.parse(await readFile(new URL("fixtures/task-fit.json", import.meta.url)));
for (const { plugin, accepted, rejected } of cases) test(`task fit: ${plugin.id}`, () => {
  const types = classifyPlugin(plugin, prepared);
  for (const id of accepted) assert.ok(types.includes(id), `${plugin.name} should provide ${id}; got ${types}`);
  for (const id of rejected) assert.ok(!types.includes(id), `${plugin.name} should not qualify for ${id}; got ${types}`);
});

const taxonomy = { schemaVersion: 1, types: [{ id: "battery", name: "Battery", include: ["battery health"], nameInclude: ["^Battery$"] }] };
const eligible = (id, values = {}) => ({ id, name: id, description: "battery health", repo: `https://github.com/test/${id}`, installAvailable: true, installCommand: "install", ...values });
const now = new Date("2026-09-21T12:00:00Z");

test("metadata cannot qualify a plugin or manufacture a phrase across fields", () => {
  const p = prepareTaxonomy(taxonomy);
  assert.deepEqual(classifyPlugin({ id: "tags", name: "Other", description: "Nothing related", tags: ["battery health"], category: "battery health", kind: "battery health" }, p), []);
  assert.deepEqual(classifyPlugin({ id: "joined", name: "laptop battery", description: "health information" }, p), []);
  assert.deepEqual(classifyPlugin({ id: "name", name: "Battery", description: "Computer charging" }, p), ["battery"]);
  assert.deepEqual(classifyPlugin({ id: "description", name: "Other", description: "A Battery plugin" }, p), []);
});

test("held and excluded assignments beat forced inclusion; explained decisions match eligibility", () => {
  const t = structuredClone(taxonomy);
  t.overrides = { include: { held: ["battery"], excluded: ["battery"], forced: ["battery"] }, exclude: { excluded: ["battery"] }, review: { held: ["battery"] }, reasons: { held: { battery: "Need evidence of computer battery support" } } };
  const p = prepareTaxonomy(t);
  assert.deepEqual(classifyPlugin(eligible("held"), p), []);
  assert.deepEqual(classifyPlugin(eligible("excluded"), p), []);
  assert.deepEqual(classifyPlugin(eligible("forced", { description: "" }), p), ["battery"]);
  const held = explainClassification(eligible("held"), p)[0];
  assert.equal(held.decision, "review");
  assert.equal(held.reason, t.overrides.reasons.held.battery);
  assert.equal(held.evidence[0].field, "description");
  assert.equal(held.evidence[0].match, "battery health");
});

test("ineligible incumbents leave immediately, including held assignments and empty cohorts", () => {
  const old = { ...taxonomy, overrides: { include: { incumbent: ["battery"] } } };
  const catalog = [eligible("incumbent", { description: "phone battery", stars: 100000 }), eligible("replacement")];
  const previous = rankPlugins({ catalog, taxonomy: old, stats: {}, now }).rankings;
  assert.equal(previous.types[0].winner.id, "incumbent");
  const current = rankPlugins({ catalog, taxonomy, stats: {}, previous, now }).rankings;
  assert.equal(current.types[0].winner.id, "replacement");
  assert.equal(current.types[0].runnerUp, null);
  const held = { ...taxonomy, overrides: { review: { replacement: ["battery"] } } };
  const empty = rankPlugins({ catalog, taxonomy: held, stats: {}, previous, now }).rankings;
  assert.equal(empty.types[0].winner, null);
  assert.equal(empty.types[0].runnerUp, null);
});

test("audit records every listing, rejected prior membership, and evidence for each pick", () => {
  const catalog = [eligible("real"), eligible("phone", { name: "Phone", description: "phone status", tags: ["battery health"] }), eligible("offline", { installAvailable: false })];
  const inputs = { catalog, taxonomy, baselineTaxonomy: taxonomy, baselineVersion: 1, stats: {}, now };
  const report = auditClassifications(inputs);
  assert.deepEqual(report, auditClassifications({ ...inputs, catalog: [...catalog] }));
  assert.equal(report.records.length, catalog.length);
  assert.equal(report.counts.changed, 1);
  const phone = report.records.find((p) => p.id === "phone");
  assert.deepEqual(phone.before, ["battery"]);
  assert.deepEqual(phone.types, []);
  assert.equal(phone.evidence[0].decision, "no-task-evidence");
  assert.ok(report.picks.every((p) => p.eligibility.accepted));
  assert.equal(report.rankingComparison[0].afterCount, 1);
  const next = auditClassifications({ catalog: catalog.filter((p) => p.id !== "real"), taxonomy, previousState: report.state, now });
  assert.deepEqual(next.changes.find((p) => p.id === "real").removed, ["battery"]);
  assert.equal(next.counts.changed, next.changes.length);
  assert.equal(next.comparison, "previous-published-memberships");
});

test("audit exposes removed categories and new listings", () => {
  const catalog = [eligible("new")];
  const previous = rankPlugins({ catalog, taxonomy, stats: {}, now }).rankings;
  const replacement = { schemaVersion: 1, types: [{ id: "other", name: "Other", include: ["other task"] }] };
  const report = auditClassifications({ catalog, taxonomy: replacement, previous, previousState: { plugins: [] }, stats: {}, now });
  const removed = report.rankingComparison.find((t) => t.typeId === "battery");
  assert.equal(removed.beforeWinner, "new");
  assert.equal(removed.afterWinner, null);
  assert.equal(removed.afterCount, 0);
  assert.deepEqual(report.newListings, ["new"]);
  assert.match(renderClassificationAudit(report), /## New listings\n\n- new/);
});

test("baseline replay ignores feed changes against the published state", () => {
  const previousState = { plugins: [{ id: "gone", name: "Gone", metadataHash: "x", types: ["battery"] }] };
  const report = auditClassifications({ catalog: [eligible("new")], taxonomy, previousState, baselineTaxonomy: taxonomy, baselineVersion: 1, now });
  assert.equal(report.comparison, "same-input-taxonomy-replay");
  assert.deepEqual(report.changes, []);
  assert.deepEqual(report.newListings, []);
  assert.equal(report.counts.changed, 0);
});

test("audit markdown escapes catalog text", () => {
  const report = auditClassifications({ catalog: [eligible("x", { name: "<script>\n::error::[link](bad)", tags: ["battery health"], description: "unrelated" })], taxonomy, baselineTaxonomy: taxonomy, baselineVersion: 1, now });
  const text = renderClassificationAudit(report);
  assert.ok(!text.includes("<script>"));
  assert.ok(text.includes("&lt;script&gt;"));
  assert.ok(!text.includes("\n::error::"));
});

test("audit retains exclusion evidence even without a positive match", () => {
  const t = structuredClone(taxonomy);
  t.types[0].exclude = ["phone battery"];
  const report = auditClassifications({ catalog: [eligible("phone", { description: "phone battery" })], taxonomy: t, now });
  const decision = report.records[0].evidence[0];
  assert.equal(decision.decision, "excluded");
  assert.equal(decision.exclusions[0].match, "phone battery");
  assert.deepEqual(report.records[0].types, []);
});

test("every production type has a task contract and every editorial override has a reason", () => {
  for (const type of production.types) assert.ok(type.task?.length > 20, type.id);
  for (const group of ["include", "exclude", "review"]) for (const [id, types] of Object.entries(production.overrides[group] ?? {})) for (const type of types) assert.ok(production.overrides.reasons[id]?.[type]?.length > 20, `${id}/${type}`);
});

test("ranker and audit agree on health exclusions, cohorts and pick evidence", () => {
  const catalog = [
    eligible("healthy", { upstreamCheckStatus: "passed", stars: 5 }),
    eligible("gone", { upstreamCheckStatus: "unreachable", stars: 500 }),
    eligible("broken", { upstreamCheckStatus: "failed", installAvailable: false, installCommand: "", stars: 400 }),
    eligible("legacy", { stars: 1 }),
    { id: "omarchy.battery", name: "Battery", description: "battery health", sourceType: "builtin", builtIn: true, installCommand: "", repo: "https://github.com/omacom/omarchy" }
  ];
  const stats = { gone: { copies: 900, hearts: 90, views: 9000 }, broken: { copies: 800, hearts: 80, views: 8000 } };
  const ranked = rankPlugins({ catalog, taxonomy, stats, now });
  const audit = auditClassifications({ catalog, taxonomy, stats, now });
  const reasons = Object.fromEntries(audit.records.map((record) => [record.id, record.ineligible]));
  assert.deepEqual(reasons, { broken: "compatibility-failed", gone: "repository-unreachable", healthy: null, legacy: null, "omarchy.battery": "built-in" });
  assert.deepEqual(Object.fromEntries(ranked.exclusions), { gone: "repository-unreachable", broken: "compatibility-failed", "omarchy.battery": "built-in" });
  assert.equal(audit.counts.eligible, 2);
  assert.equal(audit.counts.assignments, ranked.report.classificationAssignments);
  assert.equal(ranked.rankings.types[0].eligibleCount, 2);
  assert.deepEqual(audit.picks.map((pick) => pick.id).sort(), ["healthy", "legacy"]);
  for (const pick of audit.picks) assert.equal(pick.eligibility.accepted, true);
  for (const id of ["gone", "broken", "omarchy.battery"]) {
    assert.deepEqual(audit.records.find((record) => record.id === id).evidence, []);
  }
});

test("audits apply the methodology they are given and replays honour the recorded version", async (context) => {
  const { methodologyFor } = await import("../build/methodology.mjs");
  const { runAudit } = await import("../scripts/classification-audit.mjs");
  const { mkdtemp, rm, writeFile } = await import("node:fs/promises");
  const os = await import("node:os");
  const path = await import("node:path");
  const catalog = [
    eligible("gone", { upstreamCheckStatus: "unreachable", status: "Status unknown" }),
    eligible("healthy", { upstreamCheckStatus: "passed" }),
    ...Array.from({ length: 998 }, (_, i) => eligible(`filler${i}`, { installAvailable: false }))
  ];
  const stats = { gone: { copies: 900, hearts: 90, views: 9000 }, healthy: { copies: 5, hearts: 1, views: 40 } };
  const previous = rankPlugins({ catalog, taxonomy, stats, now, methodology: methodologyFor("1.0.0") }).rankings;
  assert.equal(previous.types[0].winner.id, "gone");

  const legacy = auditClassifications({ catalog, taxonomy, stats, previous, now, methodology: methodologyFor("1.0.0") });
  const current = auditClassifications({ catalog, taxonomy, stats, previous, now });
  assert.equal(legacy.methodologyVersion, "1.0.0");
  assert.equal(current.methodologyVersion, "1.1.0");
  assert.equal(legacy.records.find((record) => record.id === "gone").ineligible, null);
  assert.equal(current.records.find((record) => record.id === "gone").ineligible, "repository-unreachable");
  assert.deepEqual([legacy.counts.classified, current.counts.classified], [2, 1]);
  assert.equal(legacy.picks.find((pick) => pick.slot === "winner").id, "gone");
  assert.equal(current.picks.find((pick) => pick.slot === "winner").id, "healthy");

  const directory = await mkdtemp(path.join(os.tmpdir(), "omapicks-audit-replay-"));
  context.after(() => rm(directory, { recursive: true, force: true }));
  const inputs = {
    schemaVersion: 1, classificationVersion: 2, now: now.toISOString(), taxonomy, previous, previousState: null,
    catalog: { body: { plugins: catalog } }, stats: { body: { schemaVersion: 1, plugins: Object.fromEntries(catalog.map((p) => [p.id, stats[p.id] ?? { copies: 0, hearts: 0, views: 0 }])) } }
  };
  const replay = async (values, name) => {
    const file = path.join(directory, `${name}.json`);
    await writeFile(file, JSON.stringify({ ...inputs, ...values }));
    return runAudit({ inputFile: file, output: path.join(directory, name), fetchImpl: () => { throw new Error("replay fetched"); } });
  };
  // Inputs captured before versions were recorded replay under the legacy rules.
  assert.equal((await replay({}, "unversioned")).methodologyVersion, "1.0.0");
  assert.equal((await replay({}, "unversioned")).counts.classified, 2);
  assert.equal((await replay({ methodologyVersion: "1.1.0" }, "current")).counts.classified, 1);
  await assert.rejects(replay({ methodologyVersion: "9.9.9", codeRevision: "abc123" }, "unknown"), /methodology "9\.9\.9".*check out revision abc123/);
});
