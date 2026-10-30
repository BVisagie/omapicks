import { readFile, writeFile } from "node:fs/promises";
import { gunzipSync } from "node:zlib";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { classifyPlugin, prepareTaxonomy } from "../build/rank.mjs";
import { CATEGORY_MIGRATIONS } from "../build/category-migrations.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const successors = new Map(CATEGORY_MIGRATIONS.find((migration) => migration.id === "task-coherence-2026-10-30")
  .changes.map((change) => [change.from.id, change.to.map((type) => type.id)]));
const key = (assignment) => `${assignment.pluginId}/${assignment.typeId}`;
export const discoveryListingHash = (plugin) => createHash("sha256")
  .update(JSON.stringify(plugin ? { id: plugin.id, name: plugin.name, description: plugin.description } : null)).digest("hex");

// Expectations are separately authored from captured listing text, before comparing classifier
// output. The generated report must never be used as its own expected answer. This is an audit
// of research routing, not evidence of task qualification or an estimate of catalog-wide recall.
export function auditDiscoveryRecall(fixture, taxonomy, expectations = [], taskReviews = { assignments: [] }) {
  const initial = prepareTaxonomy(fixture.initialTaxonomy);
  const current = prepareTaxonomy(taxonomy);
  const plugins = new Map(fixture.plugins.map((plugin) => [plugin.id, plugin]));
  const matches = new Map(fixture.plugins.map((plugin) => [plugin.id, {
    initial: classifyPlugin(plugin, initial), current: classifyPlugin(plugin, current)
  }]));
  const judgments = new Map(expectations.map((entry) => [key(entry), entry]));
  const reviewed = new Map(taskReviews.assignments.filter((entry) => ["qualified", "related"].includes(entry.decision))
    .map((entry) => [key(entry), { typeId: entry.typeId, decision: entry.decision, contractVersion: entry.contractVersion }]));
  if (judgments.size !== expectations.length) throw new Error("Duplicate discovery expectation");
  const assignments = [...fixture.baselineAssignments, ...(fixture.regressionAssignments ?? [])];
  if (new Set(assignments.map(key)).size !== assignments.length) throw new Error("Duplicate baseline discovery assignment");
  const rows = [];
  for (const assignment of assignments) {
    const targets = successors.get(assignment.typeId) ?? [assignment.typeId];
    const plugin = plugins.get(assignment.pluginId);
    const match = matches.get(assignment.pluginId) ?? { initial: [], current: [] };
    const initialTargets = targets.filter((id) => match.initial.includes(id));
    const currentTargets = targets.filter((id) => match.current.includes(id));
    // Check every baseline lead in every split, even if it still reaches one successor.
    // Also retain the initial proposal's losses, new losses and named regression cases.
    if (!successors.has(assignment.typeId) && initialTargets.length && currentTargets.length &&
        !assignment.origins.includes("review-regression")) continue;
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
      baselineOrigins: assignment.origins, successors: targets, initialTargets, currentTargets, expectedTargets,
      missingTargets, unexpectedTargets, otherCurrentTasks: match.current.filter((id) => !targets.includes(id)),
      reason: judgment?.reason ?? "", evidence: judgment?.evidence ?? [],
      ...(retainedReviews.length ? { retainedEditorialDecisions: retainedReviews } : {}), issues });
  }
  const expected = new Set(rows.map(key));
  const obsoleteExpectations = expectations.filter((entry) => !expected.has(key(entry))).map(key);
  return { schemaVersion: 2, capturedAt: fixture.capturedAt, catalogGeneratedAt: fixture.catalogGeneratedAt,
    baselineRevision: fixture.baselineRevision, initialProposalRevision: fixture.initialProposalRevision,
    scope: "Per old-category assignment: all seven splits, initial or new discovery losses, and named regressions. Independently authored target sets are checked against every successor, including unwanted matches. Source-reviewed membership and qualification remain separate. This targeted audit is not catalog-wide recall.",
    summary: { catalogListings: fixture.plugins.length, baselineAssignments: fixture.baselineAssignments.length,
      auditedAssignments: rows.length, splitAssignments: rows.filter((row) => successors.has(row.typeId)).length,
      originalLostAssignments: rows.filter((row) => !row.initialTargets.length).length,
      expectedRoutes: rows.reduce((n, row) => n + row.expectedTargets.length, 0),
      matchedRoutes: rows.reduce((n, row) => n + row.currentTargets.filter((id) => row.expectedTargets.includes(id)).length, 0),
      missingRoutes: rows.reduce((n, row) => n + row.missingTargets.length, 0),
      unexpectedRoutes: rows.reduce((n, row) => n + row.unexpectedTargets.length, 0),
      explicitExclusions: rows.filter((row) => !row.expectedTargets.length).length,
      retainedEditorialAssignments: rows.filter((row) => row.retainedEditorialDecisions?.length).length,
      absentListings: rows.filter((row) => row.name === null).length,
      unresolvedAssignments: rows.filter((row) => row.issues.length).length },
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
  console.log(JSON.stringify({ ...result.summary, obsoleteExpectations: result.obsoleteExpectations,
    unresolved: result.decisions.filter((entry) => entry.issues.length).map(({ pluginId, typeId, missingTargets, unexpectedTargets, issues }) => ({ pluginId, typeId, missingTargets, unexpectedTargets, issues })) }, null, 2));
  if (result.summary.unresolvedAssignments || result.obsoleteExpectations.length) process.exitCode = 1;
}
