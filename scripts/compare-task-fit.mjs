import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { rankPlugins, CLASSIFICATION_VERSION, METHODOLOGY } from "../build/rank.mjs";
import { methodologyFor } from "../build/methodology.mjs";
import { checksum } from "../build/classification-audit.mjs";

export function compareTaskFit(inputs, taxonomy, taskReviews) {
  const shared = { catalog: inputs.catalog.body.plugins, stats: inputs.stats.body.plugins, now: new Date(inputs.now), previous: inputs.previous };
  const before = rankPlugins({ ...shared, taxonomy: inputs.taxonomy, taskReviews: inputs.taskReviews,
    classificationVersion: inputs.classificationVersion ?? 2, methodology: methodologyFor(inputs.methodologyVersion ?? "1.0.0") }).rankings;
  const ranked = rankPlugins({ ...shared, previous: before, taxonomy, taskReviews, classificationVersion: CLASSIFICATION_VERSION, methodology: METHODOLOGY });
  const prior = new Map(before.types.map((t) => [t.id, t]));
  const types = ranked.rankings.types.map((type) => {
    const old = prior.get(type.id);
    const ref = (p) => p ? { id: p.id, name: p.name, score: p.score, ...(p.taskFit ? { taskFit: p.taskFit } : {}) } : null;
    return { id: type.id, name: type.name, newCategory: !old, changed: old?.winner?.id !== type.winner?.id || old?.runnerUp?.id !== type.runnerUp?.id,
      beforeCount: old?.eligibleCount ?? 0, matchedCount: type.matchedCount, qualifiedCount: type.eligibleCount,
      beforeWinner: ref(old?.winner), afterWinner: ref(type.winner), beforeRunnerUp: ref(old?.runnerUp), afterRunnerUp: ref(type.runnerUp) };
  });
  return { schemaVersion: 1, capturedAt: inputs.now, inputHash: checksum(inputs), taxonomyHash: checksum(taxonomy), taskReviewsHash: checksum(taskReviews),
    methodologyBefore: before.methodologyVersion, methodologyAfter: ranked.rankings.methodologyVersion,
    summary: { categories: types.length, newCategories: types.filter((t) => t.newCategory).length,
      changedExistingChampions: types.filter((t) => !t.newCategory && t.beforeWinner?.id !== t.afterWinner?.id).length,
      qualifiedAssignments: ranked.report.qualifiedAssignments, queuedAssignments: ranked.reviewQueue.length }, types };
}

export function renderTaskFitComparison(report) {
  const clean = (v) => String(v ?? "none").replace(/[\u0000-\u001f\u007f]/g, " ").replaceAll("|", "\\|");
  return ["# Fixed-input task qualification comparison", "", `Captured ${report.capturedAt}; inputs ${report.inputHash}. Methodology ${report.methodologyBefore} → ${report.methodologyAfter}.`, "",
    `${report.summary.newCategories} new categories; ${report.summary.changedExistingChampions} existing champion changes; ${report.summary.qualifiedAssignments} reviewed assignments compete; ${report.summary.queuedAssignments} assignments await review.`, "",
    "Before counts are the old eligible cohort; after counts are reviewed candidates. Taxonomy, task evidence and selection change together here; feed, engagement and time are held fixed. Popularity cannot replace task qualification.", "",
    "| Category | Old candidates → reviewed candidates | Champion before → after | Runner-up before → after |", "| --- | --- | --- | --- |",
    ...report.types.filter((t) => t.changed).map((t) => `| ${clean(t.name)}${t.newCategory ? " (new)" : ""} | ${t.beforeCount} → ${t.qualifiedCount} | ${clean(t.beforeWinner?.name)} → ${clean(t.afterWinner?.name)} | ${clean(t.beforeRunnerUp?.name)} → ${clean(t.afterRunnerUp?.name)} |`), ""
  ].join("\n");
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const options = {};
  for (let i = 0; i < args.length; i += 2) {
    if (!["--input", "--taxonomy", "--reviews", "--output"].includes(args[i]) || !args[i + 1] || args[i + 1].startsWith("--")) throw new Error(`Unknown or incomplete option: ${args[i]}`);
    options[args[i]] = args[i + 1];
  }
  if (!options["--input"]) throw new Error("An --input capture is required");
  const json = async (file) => JSON.parse(await readFile(file, "utf8"));
  const report = compareTaskFit(await json(options["--input"]), await json(options["--taxonomy"] ?? "data/app-types.json"), await json(options["--reviews"] ?? "data/task-reviews.json"));
  const output = path.resolve(options["--output"] ?? "tmp/task-fit-comparison");
  await mkdir(output, { recursive: true });
  await writeFile(path.join(output, "report.json"), JSON.stringify(report, null, 2) + "\n");
  await writeFile(path.join(output, "report.md"), renderTaskFitComparison(report));
  console.log(renderTaskFitComparison(report));
}
