import { appendFile, cp, mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { refresh, boundedFetch, fetchJson, codeRevision } from "../build/refresh.mjs";
import { availabilityFor } from "../build/availability.mjs";
import { ALGORITHM_VERSION, run as discovery } from "./category-discovery.mjs";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const json = async (file) => JSON.parse(await readFile(file, "utf8"));
const save = async (file, value) => { await mkdir(path.dirname(file), { recursive: true }); await writeFile(file, JSON.stringify(value, null, 2) + "\n"); };

export async function stageCandidate({ root, output, result }) {
  await rm(output, { recursive: true, force: true });
  await mkdir(output, { recursive: true });
  for (const name of ["build", "scripts", "site", "data", "docs", "workers", "test", "e2e", ".github", ".nvmrc", ".node-version", "package.json", "package-lock.json", "playwright.config.mjs"]) await cp(path.join(root, name), path.join(output, name), { recursive: true });
  await symlink(path.join(root, "node_modules"), path.join(output, "node_modules"), "dir");
  const rankings = structuredClone(result.rankings);
  const previousImages = new Map((result.auditInputs.previous?.types ?? []).flatMap((type) => [type.winner, type.runnerUp, ...(type.alternatives ?? [])].filter(Boolean)).map((pick) => [pick.id, pick]));
  for (const type of rankings.types) for (const pick of [type.winner, type.runnerUp, ...(type.alternatives ?? [])].filter(Boolean)) {
    const previous = previousImages.get(pick.id);
    if (previous?.previewSource === pick.previewSource) pick.localImage = previous.localImage;
  }
  await save(path.join(output, "data/rankings.json"), rankings);
  await save(path.join(output, `data/history/${rankings.week}.json`), { ...rankings, changes: result.changes, runnerUpChanges: result.weeklyRunnerUpChanges });
  await save(path.join(output, "data/changelog.json"), { schemaVersion: 1, week: rankings.week, generatedAt: rankings.generatedAt, changes: result.changes, runnerUpChanges: result.weeklyRunnerUpChanges });
  await save(path.join(output, "data/task-review-queue.json"), result.reviewQueue);
  await save(path.join(output, "data/availability.json"), availabilityFor(rankings, result.auditInputs.catalog.body, { now: new Date(result.auditInputs.now) }));
  return output;
}

export async function reviewEvidence({ root = ROOT, now = new Date(), fetchImpl = fetch, withDiscovery = true, previousFile = process.env.DISCOVERY_PREVIOUS, summaryFile = process.env.GITHUB_STEP_SUMMARY } = {}) {
  const result = await refresh({ root, now, fetchImpl, dryRun: true, revision: codeRevision(root) });
  const output = path.join(root, "tmp/review-evidence");
  await mkdir(output, { recursive: true });
  const inputs = result.auditInputs;
  await save(path.join(output, "inputs.json"), inputs);
  await save(path.join(output, "review-queue.json"), result.reviewQueue);
  const priorities = result.reviewQueue.assignments.filter((entry) => entry.previousPick || entry.wouldEnterPodium || entry.status !== "pending");
  // JSON is authoritative; do not interpolate upstream names into Actions Markdown/commands.
  const summary = `Review evidence captured ${inputs.now}. ${result.reviewQueue.assignments.length} unresolved research assignments; ${priorities.length} priority assignments. ${result.computedChanges.length} proposed leading-option changes. No recommendations were published.\n\nCandidate pages are staged separately and must pass validation. Captured inputs and explicit review priorities are in the review-evidence artifact. A queue departure is not necessarily an editorial decision.`;
  await save(path.join(output, "priorities.json"), priorities);
  await writeFile(path.join(output, "summary.md"), summary + "\n");
  if (summaryFile) await appendFile(summaryFile, `\n### Evidence review\n\n${summary}\n`);
  if (withDiscovery) {
    let explorer;
    try {
      const response = await fetchJson("https://plugins.omarchy.org/explorer-data.json", { fetchImpl: (url, options) => boundedFetch(fetchImpl, url, options) });
      explorer = { status: "fetched", url: "https://plugins.omarchy.org/explorer-data.json", body: response.body, generatedAt: response.body.generatedAt, method: response.body.method, sha256: createHash("sha256").update(JSON.stringify(response.body)).digest("hex") };
    } catch (error) { explorer = { status: "unavailable", body: null, warning: `Optional explorer unavailable: ${error.message}` }; }
    const discoveryInputs = { algorithmVersion: ALGORITHM_VERSION, catalog: inputs.catalog, stats: inputs.stats, explorer, taxonomy: inputs.taxonomy,
      config: await json(path.join(root, "data/category-discovery.json")), taskReviews: inputs.taskReviews, pluginProfiles: inputs.pluginProfiles,
      evidenceObservations: inputs.evidenceObservations, previousRankings: inputs.previous, previousReviewQueue: inputs.previousReviewQueue,
      validation: { minimumCatalogSize: Math.max(1000, Math.ceil((inputs.previous?.source?.catalog?.count ?? 0) * 0.75)), previousStatsCount: inputs.previous?.source?.stats?.count },
      now: inputs.now, previous: previousFile ? await json(previousFile) : null, commit: inputs.codeRevision };
    const file = path.join(output, "discovery-inputs.json");
    await save(file, discoveryInputs);
    await discovery({ root, output: path.join(root, "tmp/category-discovery"), inputFile: file, summaryFile });
  }
  await stageCandidate({ root, output: path.join(output, "site"), result });
  return result;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const flags = process.argv.slice(2);
  if (flags.some((flag) => flag !== "--without-discovery")) throw new Error("Usage: review-evidence.mjs [--without-discovery]");
  reviewEvidence({ withDiscovery: !flags.includes("--without-discovery") }).catch(async (error) => {
    console.error(`Evidence review failed: ${error.message}`);
    if (process.env.GITHUB_STEP_SUMMARY) await appendFile(process.env.GITHUB_STEP_SUMMARY, "\n### Evidence review failed\n\nThis run did not complete. Available diagnostics are archived; no recommendation or discovery approval was published.\n");
    process.exitCode = 1;
  });
}
