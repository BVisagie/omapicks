import { readFile } from "node:fs/promises";
import { gunzipSync } from "node:zlib";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { classifyPlugin, prepareTaxonomy } from "../build/rank.mjs";
import { CATEGORY_MIGRATIONS } from "../build/category-migrations.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const successors = new Map(CATEGORY_MIGRATIONS.find((migration) => migration.id === "task-coherence-2026-10-30")
  .changes.map((change) => [change.from.id, change.to.map((type) => type.id)]));
const key = (assignment) => `${assignment.pluginId}/${assignment.typeId}`;

// Discovery recall and qualification are different audits. This intentionally checks
// name/description rules without importing any source decision into those rules.
export function auditDiscoveryRecall(fixture, taxonomy, decisions = [], taskReviews = { assignments: [] }) {
  const initial = prepareTaxonomy(fixture.initialTaxonomy);
  const current = prepareTaxonomy(taxonomy);
  const plugins = new Map(fixture.plugins.map((plugin) => [plugin.id, plugin]));
  const matches = new Map(fixture.plugins.map((plugin) => [plugin.id, {
    initial: classifyPlugin(plugin, initial), current: classifyPlugin(plugin, current)
  }]));
  const judgments = new Map(decisions.map((entry) => [key(entry), entry]));
  const reviewed = new Map(taskReviews.assignments.filter((entry) => ["qualified", "related"].includes(entry.decision))
    .map((entry) => [key(entry), { typeId: entry.typeId, decision: entry.decision, contractVersion: entry.contractVersion }]));
  if (judgments.size !== decisions.length) throw new Error("Duplicate recall decision");
  const rows = [];
  for (const assignment of fixture.baselineAssignments) {
    const targets = successors.get(assignment.typeId) ?? [assignment.typeId];
    const plugin = plugins.get(assignment.pluginId);
    const match = matches.get(assignment.pluginId) ?? { initial: [], current: [] };
    const initialTargets = targets.filter((id) => match.initial.includes(id));
    const currentTargets = targets.filter((id) => match.current.includes(id));
    if (initialTargets.length && currentTargets.length) continue;
    const judgment = judgments.get(key(assignment));
    const retainedReviews = targets.map((typeId) => reviewed.get(`${assignment.pluginId}/${typeId}`)).filter(Boolean);
    const status = !plugin ? "listing-unavailable" : currentTargets.length ? "repaired-discovery"
      : retainedReviews.length ? "editorial-assignment-retained" : "intentional-exclusion";
    rows.push({ pluginId: assignment.pluginId, typeId: assignment.typeId,
      name: plugin?.name ?? null, description: plugin?.description ?? null,
      baselineOrigins: assignment.origins, successors: targets,
      initialTargets, currentTargets, otherCurrentTasks: match.current.filter((id) => !targets.includes(id)),
      status, reason: judgment?.reason ?? "",
      ...(retainedReviews.length ? { retainedEditorialDecisions: retainedReviews } : {}),
      explained: judgment?.status === status && typeof judgment.reason === "string" && judgment.reason.length >= 30 });
  }
  const expected = new Set(rows.map(key));
  const obsoleteDecisions = decisions.filter((entry) => !expected.has(key(entry))).map(key);
  return { schemaVersion: 1, capturedAt: fixture.capturedAt,
    baselineRevision: fixture.baselineRevision, initialProposalRevision: fixture.initialProposalRevision,
    scope: "Same captured catalog, baseline classifier matches plus persisted review-queue and shortlist assignments. Every lost raw-discovery route is adjudicated; source-reviewed membership and qualification are separate.",
    summary: { catalogListings: fixture.plugins.length, baselineAssignments: fixture.baselineAssignments.length,
      originalLostAssignments: rows.filter((row) => !row.initialTargets.length).length,
      newlyLostAssignments: rows.filter((row) => row.initialTargets.length && !row.currentTargets.length).length,
      repairedDiscoveryAssignments: rows.filter((row) => row.status === "repaired-discovery").length,
      retainedEditorialAssignments: rows.filter((row) => row.status === "editorial-assignment-retained").length,
      intentionalExclusions: rows.filter((row) => row.status === "intentional-exclusion").length,
      absentListings: rows.filter((row) => row.status === "listing-unavailable").length,
      unexplainedAssignments: rows.filter((row) => !row.explained).length },
    obsoleteDecisions, decisions: rows };
}

export async function readDiscoveryFixture(file = path.join(ROOT, "test/fixtures/discovery-recall.json.gz")) {
  return JSON.parse(gunzipSync(await readFile(file)));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const fixture = await readDiscoveryFixture();
  const taxonomy = JSON.parse(await readFile(path.join(ROOT, "data/app-types.json"), "utf8"));
  const decisions = JSON.parse(await readFile(path.join(ROOT, "docs/analysis/2026-10-30-discovery-recall.json"), "utf8")).decisions;
  const reviews = JSON.parse(await readFile(path.join(ROOT, "data/task-reviews.json"), "utf8"));
  const result = auditDiscoveryRecall(fixture, taxonomy, decisions, reviews);
  console.log(JSON.stringify({ ...result.summary, obsoleteDecisions: result.obsoleteDecisions,
    unexplained: result.decisions.filter((entry) => !entry.explained).map(({ pluginId, typeId, status }) => ({ pluginId, typeId, status })) }, null, 2));
  if (result.summary.unexplainedAssignments || result.obsoleteDecisions.length) process.exitCode = 1;
}
