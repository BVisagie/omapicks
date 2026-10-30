import { readFile, writeFile } from "node:fs/promises";
import { gunzipSync } from "node:zlib";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { classifyPlugin, prepareTaxonomy, discoveryListingHash, discoveryCurationStatus } from "../build/rank.mjs";
import { CATEGORY_MIGRATIONS } from "../build/category-migrations.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const successors = new Map(CATEGORY_MIGRATIONS.find((migration) => migration.id === "task-coherence-2026-10-30")
  .changes.map((change) => [change.from.id, change.to.map((type) => type.id)]));
const key = (assignment) => `${assignment.pluginId}/${assignment.typeId}`;
export { discoveryListingHash };

export function discoveryAuditInventory(fixture, taxonomy) {
  const initial = prepareTaxonomy(fixture.initialTaxonomy);
  const current = prepareTaxonomy(taxonomy);
  const rulesOnly = prepareTaxonomy({ ...taxonomy, overrides: {} });
  const proposals = (fixture.proposalDiscoveries ?? []).map(({ revision, assignments }) => ({ revision, routes: new Map(assignments.map(({ pluginId, typeIds }) => [pluginId, typeIds])) }));
  const plugins = new Map(fixture.plugins.map((plugin) => [plugin.id, plugin]));
  const matches = new Map(fixture.plugins.map((plugin) => [plugin.id, {
    initial: classifyPlugin(plugin, initial), current: classifyPlugin(plugin, current), rulesOnly: classifyPlugin(plugin, rulesOnly),
    proposals: proposals.map(({ revision, routes }) => ({ revision, types: routes.get(plugin.id) ?? [] }))
  }]));
  const assignments = new Map();
  const add = (pluginId, typeId, origin) => {
    const id = key({ pluginId, typeId });
    const row = assignments.get(id) ?? { pluginId, typeId, origins: [] };
    if (!row.origins.includes(origin)) row.origins.push(origin);
    assignments.set(id, row);
  };
  const baseline = [...fixture.baselineAssignments, ...(fixture.regressionAssignments ?? [])];
  if (new Set(baseline.map(key)).size !== baseline.length) throw new Error("Duplicate baseline discovery assignment");
  for (const row of baseline) for (const origin of row.origins) add(row.pluginId, row.typeId, origin);
  const parents = new Map([...successors].flatMap(([from, targets]) => targets.map((id) => [id, from])));
  for (const [pluginId, match] of matches) {
    for (const [origin, types] of [["initial-successor-discovery", match.initial], ["current-successor-discovery", match.current],
      ["current-rules-only-discovery", match.rulesOnly],
      ...match.proposals.map(({ revision, types }) => [`proposal-${revision}-successor-discovery`, types])]) {
      for (const typeId of types) if (parents.has(typeId)) add(pluginId, parents.get(typeId), origin);
    }
    // A broad rule repair can also affect a retained category. Audit every gained/lost
    // route between the preserved follow-up proposals and current rules, not just splits.
    const versions = [...match.proposals.map((p) => p.types), match.current];
    for (const typeId of new Set(versions.flat())) if (!parents.has(typeId) &&
      versions.some((types) => types.includes(typeId)) && versions.some((types) => !types.includes(typeId))) {
      add(pluginId, typeId, "proposal-discovery-change");
    }
  }
  return { plugins, matches, assignments: [...assignments.values()].sort((a, b) => key(a).localeCompare(key(b))) };
}

// Target judgments are authored from listing evidence, independently of the classifier.
// The generated report is never its own expected answer; this does not measure catalog-wide recall.
export function auditDiscoveryRecall(fixture, taxonomy, expectations = [], taskReviews = { assignments: [] }) {
  const { plugins, matches, assignments } = discoveryAuditInventory(fixture, taxonomy);
  const judgments = new Map(expectations.map((entry) => [key(entry), entry]));
  const reviewed = new Map(taskReviews.assignments.filter((entry) => ["qualified", "related"].includes(entry.decision))
    .map((entry) => [key(entry), { typeId: entry.typeId, decision: entry.decision, contractVersion: entry.contractVersion }]));
  if (judgments.size !== expectations.length) throw new Error("Duplicate discovery expectation");
  const rows = [];
  for (const assignment of assignments) {
    const targets = successors.get(assignment.typeId) ?? [assignment.typeId];
    const plugin = plugins.get(assignment.pluginId);
    const match = matches.get(assignment.pluginId) ?? { initial: [], current: [] };
    const initialTargets = targets.filter((id) => match.initial.includes(id));
    const currentTargets = targets.filter((id) => match.current.includes(id));
    const rulesOnlyTargets = targets.filter((id) => (match.rulesOnly ?? []).includes(id));
    // Check every discovered lead in every split, even if it still reaches one successor.
    // Also retain the initial proposal's losses, new losses and named regression cases.
    if (!successors.has(assignment.typeId) && initialTargets.length && currentTargets.length &&
        !assignment.origins.includes("review-regression") && !assignment.origins.includes("proposal-discovery-change")) continue;
    const judgment = judgments.get(key(assignment));
    const issues = [];
    if (!judgment) issues.push("missing-expectation");
    else {
      if (!Array.isArray(judgment.expectedTargets) || judgment.expectedTargets.some((id) => !targets.includes(id)) ||
          new Set(judgment.expectedTargets).size !== judgment.expectedTargets.length) issues.push("invalid-expected-targets");
      if (typeof judgment.reason !== "string" || !judgment.reason.trim()) issues.push("missing-rationale");
      if (judgment.listingSha256 !== discoveryListingHash(plugin)) issues.push("listing-changed");
      if (!Array.isArray(judgment.evidence) || (plugin && !judgment.evidence.length) ||
          judgment.evidence?.some((entry) => !["name", "description"].includes(entry.field) ||
            typeof entry.quote !== "string" || !entry.quote.length || !plugin?.[entry.field]?.includes(entry.quote))) issues.push("invalid-listing-evidence");
    }
    const expectedTargets = Array.isArray(judgment?.expectedTargets) ? judgment.expectedTargets : [];
    const missingTargets = expectedTargets.filter((id) => !currentTargets.includes(id));
    const unexpectedTargets = currentTargets.filter((id) => !expectedTargets.includes(id));
    if (missingTargets.length) issues.push("missing-target");
    if (unexpectedTargets.length) issues.push("unexpected-target");
    const retainedReviews = targets.map((typeId) => reviewed.get(`${assignment.pluginId}/${typeId}`)).filter(Boolean);
    rows.push({ pluginId: assignment.pluginId, typeId: assignment.typeId,
      name: plugin?.name ?? null, description: plugin?.description ?? null,
      inventoryOrigins: assignment.origins, successors: targets, initialTargets, currentTargets, expectedTargets,
      missingTargets, unexpectedTargets, rulesOnlyTargets,
      rulesOnlyMissingTargets: expectedTargets.filter((id) => !rulesOnlyTargets.includes(id)),
      rulesOnlyUnexpectedTargets: rulesOnlyTargets.filter((id) => !expectedTargets.includes(id)), otherCurrentTasks: match.current.filter((id) => !targets.includes(id)),
      reason: judgment?.reason ?? "", evidence: judgment?.evidence ?? [],
      ...(retainedReviews.length ? { retainedEditorialDecisions: retainedReviews } : {}), issues });
  }
  const expected = new Set(rows.map(key));
  const obsoleteExpectations = expectations.filter((entry) => !expected.has(key(entry))).map(key);
  const ruleEmitted = rows.reduce((n, row) => n + row.rulesOnlyTargets.length, 0);
  const ruleUnexpected = rows.reduce((n, row) => n + row.rulesOnlyUnexpectedTargets.length, 0);
  const ruleMissing = rows.reduce((n, row) => n + row.rulesOnlyMissingTargets.length, 0);
  return { schemaVersion: 4, capturedAt: fixture.capturedAt, catalogGeneratedAt: fixture.catalogGeneratedAt,
    baselineRevision: fixture.baselineRevision, initialProposalRevision: fixture.initialProposalRevision,
    preservedProposals: (fixture.proposalDiscoveries ?? []).map(({ revision, taxonomySha256 }) => ({ revision, taxonomySha256 })),
    scope: "Per old-category assignment: all seven splits across baseline, initial, preserved proposals and current rules with and without per-plugin overrides, including successor-only leads; changed routes in retained categories and named regressions. Independently authored target sets are checked against every successor, including unwanted matches. Source-reviewed membership and qualification remain separate. This targeted audit is not catalog-wide recall.",
    summary: { catalogListings: fixture.plugins.length, baselineAssignments: fixture.baselineAssignments.length,
      auditedAssignments: rows.length, splitAssignments: rows.filter((row) => successors.has(row.typeId)).length,
      initiallyUnmatchedAssignments: rows.filter((row) => !row.initialTargets.length).length,
      expectedRoutes: rows.reduce((n, row) => n + row.expectedTargets.length, 0),
      matchedRoutes: rows.reduce((n, row) => n + row.currentTargets.filter((id) => row.expectedTargets.includes(id)).length, 0),
      missingRoutes: rows.reduce((n, row) => n + row.missingTargets.length, 0),
      unexpectedRoutes: rows.reduce((n, row) => n + row.unexpectedTargets.length, 0),
      explicitExclusions: rows.filter((row) => !row.expectedTargets.length).length,
      retainedEditorialAssignments: rows.filter((row) => row.retainedEditorialDecisions?.length).length,
      absentListings: rows.filter((row) => row.name === null).length,
      unresolvedAssignments: rows.filter((row) => row.issues.length).length },
    rulesOnly: { scope: "Within this reviewed inventory, without any per-plugin overrides or source decisions; not catalog-wide precision.",
      emittedRoutes: ruleEmitted, matchedRoutes: ruleEmitted - ruleUnexpected, missingRoutes: ruleMissing, unexpectedRoutes: ruleUnexpected,
      precisionWithinAudit: ruleEmitted ? Number(((ruleEmitted - ruleUnexpected) / ruleEmitted).toFixed(6)) : null },
    discoveryCuration: discoveryCurationStatus(fixture.plugins, prepareTaxonomy(taxonomy)),
    obsoleteExpectations, decisions: rows };
}

export async function readDiscoveryFixture(file = path.join(ROOT, "test/fixtures/discovery-recall.json.gz")) {
  return JSON.parse(gunzipSync(await readFile(file)));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.slice(2).some((arg) => arg !== "--write")) throw new Error("Usage: audit-discovery-recall.mjs [--write]");
  const fixture = await readDiscoveryFixture();
  const taxonomy = JSON.parse(await readFile(path.join(ROOT, "data/app-types.json"), "utf8"));
  const expectations = JSON.parse(await readFile(path.join(ROOT, "test/fixtures/discovery-expectations.json"), "utf8")).assignments;
  const reviews = JSON.parse(await readFile(path.join(ROOT, "data/task-reviews.json"), "utf8"));
  const result = auditDiscoveryRecall(fixture, taxonomy, expectations, reviews);
  if (process.argv.includes("--write")) await writeFile(path.join(ROOT, "docs/analysis/2026-10-30-discovery-recall.json"), JSON.stringify(result, null, 2) + "\n");
  console.log(JSON.stringify({ ...result.summary, rulesOnly: result.rulesOnly, discoveryCuration: result.discoveryCuration, obsoleteExpectations: result.obsoleteExpectations,
    unresolved: result.decisions.filter((entry) => entry.issues.length).map(({ pluginId, typeId, missingTargets, unexpectedTargets, issues }) => ({ pluginId, typeId, missingTargets, unexpectedTargets, issues })) }, null, 2));
  if (result.summary.unresolvedAssignments || result.obsoleteExpectations.length) process.exitCode = 1;
}
