import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { appendFile, lstat, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ALGORITHM_VERSION } from "./category-discovery.mjs";
import { findStateFile } from "./restore-category-state.mjs";

const hash = (value) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const MAX_STATE_BYTES = 2 * 1024 * 1024;
export function compatibleState(state, settingsHash, now = new Date()) {
  if (state?.schemaVersion !== 1 || !Array.isArray(state.observations) || state.observations.length > 4) return false;
  if (state.observations.some((entry) => !entry || !Number.isFinite(Date.parse(entry.at)) || !Array.isArray(entry.groups) || entry.groups.length > 1000 || entry.groups.some((group) => !group || typeof group.id !== "string" || !Array.isArray(group.repositories) || group.repositories.length > 5000 || group.repositories.some((repo) => typeof repo !== "string")))) return false;
  return state.observations.some((entry) => entry.settingsHash === settingsHash && now - new Date(entry.at) >= 0 && now - new Date(entry.at) <= 21 * 86400000);
}

export function eligibleStateRuns(runs, branch, currentRun) {
  return runs.filter((run) => String(run.id) !== String(currentRun) && run.head_branch === branch && run.conclusion === "success" &&
    ["schedule", "workflow_dispatch"].includes(run.event) && [".github/workflows/review-evidence.yml", ".github/workflows/category-discovery.yml"].includes(run.path))
    .sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at));
}

export async function restoreReviewState({ root = process.cwd(), repository = process.env.GITHUB_REPOSITORY, branch = process.env.DEFAULT_BRANCH,
  currentRun = process.env.GITHUB_RUN_ID, envFile = process.env.GITHUB_ENV,
  gh = (args) => execFileSync("gh", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }) } = {}) {
  if (!/^[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+$/.test(repository ?? "") || !branch) throw new Error("State restoration requires repository and default branch");
  const read = async (file) => JSON.parse(await readFile(path.join(root, file), "utf8"));
  const taxonomy = await read("data/app-types.json"), config = await read("data/category-discovery.json");
  const settingsHash = hash({ version: ALGORITHM_VERSION, taxonomy, config: { ...config, decisions: [] } });
  // API/download errors fail the research run; they are never interpreted as empty history.
  const response = JSON.parse(gh(["api", `repos/${repository}/actions/runs?status=success&branch=${encodeURIComponent(branch)}&per_page=50`]));
  const runs = eligibleStateRuns(response.workflow_runs ?? [], branch, currentRun).slice(0, 20);
  for (const run of runs) {
    const artifacts = JSON.parse(gh(["api", `repos/${repository}/actions/runs/${run.id}/artifacts?per_page=100`]));
    if (!artifacts.artifacts?.some((artifact) => artifact.name === "category-discovery-state" && !artifact.expired && Number.isInteger(artifact.size_in_bytes) && artifact.size_in_bytes <= MAX_STATE_BYTES)) continue;
    const directory = path.join(root, "tmp/category-discovery-previous");
    await rm(directory, { recursive: true, force: true });
    gh(["run", "download", String(run.id), "--repo", repository, "--name", "category-discovery-state", "--dir", directory]);
    const file = await findStateFile(directory);
    if (!file) continue;
    const metadata = await lstat(file);
    if (!metadata.isFile() || metadata.size > MAX_STATE_BYTES) continue;
    let state;
    try { state = JSON.parse(await readFile(file, "utf8")); } catch (error) { if (error instanceof SyntaxError) continue; throw error; }
    if (!compatibleState(state, settingsHash)) continue;
    const destination = path.join(root, "tmp/category-discovery-restored/state.json");
    await mkdir(path.dirname(destination), { recursive: true });
    await writeFile(destination, JSON.stringify(state) + "\n");
    if (/[\r\n]/.test(destination)) throw new Error("Invalid state destination");
    await appendFile(envFile, `DISCOVERY_PREVIOUS=${destination}\n`);
    return `Restored compatible discovery observation from run ${run.id}.`;
  }
  return "No compatible, unexpired observation in the bounded successful-run history; establishing a new baseline.";
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  restoreReviewState().then(console.log).catch((error) => { console.error(`Discovery history could not be restored: ${error.message}`); process.exitCode = 1; });
}
