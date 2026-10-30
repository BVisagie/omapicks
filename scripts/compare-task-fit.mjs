import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { rankPlugins, CLASSIFICATION_VERSION, METHODOLOGY } from "../build/rank.mjs";
import { methodologyFor } from "../build/methodology.mjs";
import { checksum } from "../build/classification-audit.mjs";
import { categoryChangesBetween } from "../build/category-migrations.mjs";

export function compareTaskFit(inputs, taxonomy, taskReviews, { pluginProfiles = inputs.pluginProfiles, evidenceObservations = inputs.evidenceObservations, methodology = METHODOLOGY } = {}) {
  const shared = { catalog: inputs.catalog.body.plugins, stats: inputs.stats.body.plugins, now: new Date(inputs.now), previous: inputs.previous };
  const before = rankPlugins({ ...shared, taxonomy: inputs.taxonomy, taskReviews: inputs.taskReviews, pluginProfiles: inputs.pluginProfiles, evidenceObservations: inputs.evidenceObservations,
    classificationVersion: inputs.classificationVersion ?? 2, methodology: methodologyFor(inputs.methodologyVersion ?? "1.0.0") }).rankings;
  const ranked = rankPlugins({ ...shared, previous: before, taxonomy, taskReviews, pluginProfiles, evidenceObservations, classificationVersion: CLASSIFICATION_VERSION, methodology });
  const prior = new Map(before.types.map((t) => [t.id, t]));
  const types = ranked.rankings.types.map((type) => {
    const old = prior.get(type.id);
    const ref = (p) => p ? { id: p.id, name: p.name, score: p.score, ...(p.taskFit ? { taskFit: p.taskFit } : {}) } : null;
    return { id: type.id, name: type.name, newCategory: !old, changed: old?.winner?.id !== type.winner?.id || old?.runnerUp?.id !== type.runnerUp?.id,
      beforeCount: old?.eligibleCount ?? 0, matchedCount: type.matchedCount, qualifiedCount: type.eligibleCount,
      beforeWinner: ref(old?.winner), afterWinner: ref(type.winner), beforeRunnerUp: ref(old?.runnerUp), afterRunnerUp: ref(type.runnerUp) };
  });
  const currentIds = new Set(types.map((type) => type.id));
  const retiredTypes = before.types.filter((type) => !currentIds.has(type.id)).map((type) => ({
    id: type.id, name: type.name, beforeCount: type.eligibleCount,
    beforeWinner: type.winner ? { id: type.winner.id, name: type.winner.name } : null,
    beforeRunnerUp: type.runnerUp ? { id: type.runnerUp.id, name: type.runnerUp.name } : null
  }));
  return { schemaVersion: 1, capturedAt: inputs.now, inputHash: checksum(inputs), taxonomyHash: checksum(taxonomy), taskReviewsHash: checksum(taskReviews),
    pluginProfilesHash: pluginProfiles ? checksum(pluginProfiles) : null, evidenceObservationsHash: evidenceObservations ? checksum(evidenceObservations) : null,
    methodologyBefore: before.methodologyVersion, methodologyAfter: ranked.rankings.methodologyVersion,
    summary: { categories: types.length, newCategories: types.filter((t) => t.newCategory).length, retiredCategories: retiredTypes.length,
      changedExistingChampions: types.filter((t) => !t.newCategory && t.beforeWinner?.id !== t.afterWinner?.id).length,
      changedExistingRunnerUps: types.filter((t) => !t.newCategory && t.beforeRunnerUp?.id !== t.afterRunnerUp?.id).length,
      categoriesWithLeadingOption: types.filter((t) => t.afterWinner).length,
      categoriesWithRunnerUp: types.filter((t) => t.afterRunnerUp).length,
      beforeQualifiedAssignments: before.types.reduce((count, type) => count + type.eligibleCount, 0),
      qualifiedAssignments: ranked.report.qualifiedAssignments, queuedAssignments: ranked.reviewQueue.length },
    categoryChanges: categoryChangesBetween(before, ranked.rankings), retiredTypes, types };
}

export function renderTaskFitComparison(report) {
  const clean = (v) => String(v ?? "none").replace(/[\u0000-\u001f\u007f]/g, " ").replaceAll("|", "\\|");
  return ["# Fixed-input task qualification comparison", "", `Captured ${report.capturedAt}; inputs ${report.inputHash}. Methodology ${report.methodologyBefore} → ${report.methodologyAfter}.`, "",
    `${report.summary.newCategories} new categories; ${report.summary.retiredCategories ?? 0} retired category IDs; ${report.summary.changedExistingChampions} existing champion changes; ${report.summary.qualifiedAssignments} reviewed assignments compete; ${report.summary.queuedAssignments} assignments await review.`, "",
    "Before counts are the old eligible cohort; after counts are reviewed candidates. Taxonomy, task evidence and selection change together here; feed, engagement and time are held fixed. Popularity cannot replace task qualification.", "",
    "| Category | Old candidates → reviewed candidates | Champion before → after | Runner-up before → after |", "| --- | --- | --- | --- |",
    ...report.types.filter((t) => t.changed).map((t) => `| ${clean(t.name)}${t.newCategory ? " (new)" : ""} | ${t.beforeCount} → ${t.qualifiedCount} | ${clean(t.beforeWinner?.name)} → ${clean(t.afterWinner?.name)} | ${clean(t.beforeRunnerUp?.name)} → ${clean(t.afterRunnerUp?.name)} |`), "",
    ...(report.retiredTypes?.length ? ["Retired category IDs retain explanatory pages; their old recommendations are not silently reassigned:", "", ...report.retiredTypes.map((t) => `- ${clean(t.name)} (\`${t.id}\`)`), ""] : [])
  ].join("\n");
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const options = {};
  for (let i = 0; i < args.length; i += 2) {
    if (!["--input", "--taxonomy", "--reviews", "--profiles", "--observations", "--output"].includes(args[i]) || !args[i + 1] || args[i + 1].startsWith("--")) throw new Error(`Unknown or incomplete option: ${args[i]}`);
    options[args[i]] = args[i + 1];
  }
  if (!options["--input"]) throw new Error("An --input capture is required");
  const json = async (file) => JSON.parse(await readFile(file, "utf8"));
  const report = compareTaskFit(await json(options["--input"]), await json(options["--taxonomy"] ?? "data/app-types.json"), await json(options["--reviews"] ?? "data/task-reviews.json"), { pluginProfiles: options["--profiles"] ? await json(options["--profiles"]) : undefined, evidenceObservations: options["--observations"] ? await json(options["--observations"]) : undefined });
  const output = path.resolve(options["--output"] ?? "tmp/task-fit-comparison");
  await mkdir(output, { recursive: true });
  await writeFile(path.join(output, "report.json"), JSON.stringify(report, null, 2) + "\n");
  await writeFile(path.join(output, "report.md"), renderTaskFitComparison(report));
  console.log(renderTaskFitComparison(report));
}
