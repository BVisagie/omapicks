import { ReportSectionError, boundedText, finite, ratio, sectionError } from "./common.mjs";

const REPOSITORY = /^[A-Za-z0-9-]+\/[A-Za-z0-9._-]+$/;
const LOOKBACK_DAYS = 30;
const MAX_PAGES = 5;

async function githubJson(fetchImpl, url, token) {
  const response = await fetchImpl(url, {
    headers: { authorization: `Bearer ${token}`, accept: "application/vnd.github+json", "x-github-api-version": "2022-11-28" }
  });
  if (!response.ok) throw new ReportSectionError(`GitHub API returned HTTP ${response.status}.`);
  return response.json();
}

function median(values) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

export function summarizeRuns(runs, repository) {
  const workflows = new Map();
  for (const run of runs) {
    const name = boundedText(run?.name, 60) || "Unnamed workflow";
    const entry = workflows.get(name) ?? { name, runs: 0, completed: 0, succeeded: 0, failed: 0, durations: [], lastRun: null, lastSuccess: null, lastConclusion: null };
    entry.runs += 1;
    const created = typeof run?.created_at === "string" ? run.created_at : null;
    if (created && (!entry.lastRun || created > entry.lastRun)) {
      entry.lastRun = created;
      entry.lastConclusion = run?.status === "completed" ? boundedText(run?.conclusion, 20) : boundedText(run?.status, 20);
    }
    if (run?.status === "completed") {
      entry.completed += 1;
      if (run.conclusion === "success") {
        entry.succeeded += 1;
        if (created && (!entry.lastSuccess || created > entry.lastSuccess)) entry.lastSuccess = created;
      } else if (["failure", "timed_out", "startup_failure"].includes(run.conclusion)) {
        entry.failed += 1;
      }
      const started = Date.parse(run?.run_started_at ?? run?.created_at);
      const finished = Date.parse(run?.updated_at);
      if (Number.isFinite(started) && Number.isFinite(finished) && finished >= started) entry.durations.push((finished - started) / 1000);
    }
    workflows.set(name, entry);
  }
  return {
    status: "ok",
    lookbackDays: LOOKBACK_DAYS,
    workflows: [...workflows.values()]
      .map(({ durations, ...entry }) => ({ ...entry, successRate: ratio(entry.succeeded, entry.completed), medianSeconds: median(durations) }))
      .sort((a, b) => a.name.localeCompare(b.name)),
    repository
  };
}

export async function collectAutomation({ env = process.env, now = new Date(), fetchImpl = fetch }) {
  const token = String(env.GITHUB_TOKEN ?? "").trim();
  const repository = String(env.GITHUB_REPOSITORY ?? "").trim();
  if (!token || !repository) return { status: "not-configured" };
  try {
    if (!REPOSITORY.test(repository)) throw new ReportSectionError("GITHUB_REPOSITORY is not owner/name.");
    const since = new Date(now.getTime() - LOOKBACK_DAYS * 86400000).toISOString().slice(0, 10);
    const runs = [];
    for (let page = 1; page <= MAX_PAGES; page += 1) {
      const body = await githubJson(fetchImpl, `https://api.github.com/repos/${repository}/actions/runs?created=%3E%3D${since}&per_page=100&page=${page}`, token);
      const batch = Array.isArray(body?.workflow_runs) ? body.workflow_runs : [];
      runs.push(...batch);
      if (batch.length < 100) break;
    }
    const repo = await githubJson(fetchImpl, `https://api.github.com/repos/${repository}`, token);
    return {
      ...summarizeRuns(runs, { stars: finite(repo?.stargazers_count), forks: finite(repo?.forks_count), openIssues: finite(repo?.open_issues_count) })
    };
  } catch (error) {
    return sectionError(error, "GitHub Actions history could not be collected.");
  }
}
