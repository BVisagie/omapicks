#!/usr/bin/env node
// Prepare re-checks for qualified reviews whose repository changed after review.
// Fetches cited text and GitHub's file comparison only. Never clones, imports,
// builds, installs or executes plugin code, and never decides a qualification:
// a person (or agent) reads the proposal and accepts or rejects each plugin.
import { createHash } from "node:crypto";
import { appendFile, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { evidenceHash, reviewSources } from "../build/evidence.mjs";
import { taskMetadataHash } from "../build/task-fit.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SHA = /^[a-f0-9]{40}$/;
const usage = "Usage: node scripts/recheck-reviews.mjs --input inputs.json [--queue review-queue.json] [--limit 30] [--output DIR]\n" +
  "       node scripts/recheck-reviews.mjs --apply proposal.json --accept <pluginId>[,<pluginId>...] [--reviewed-at YYYY-MM-DD]";

export function parseArgs(argv) {
  const options = { limit: 30, output: path.join(root, "tmp", "review-recheck"), accept: [] };
  for (let i = 0; i < argv.length; i++) {
    const [flag, value] = [argv[i], argv[i + 1]];
    if (!value || value.startsWith("--")) throw new Error(usage);
    if (flag === "--input") options.input = path.resolve(value);
    else if (flag === "--queue") options.queue = path.resolve(value);
    else if (flag === "--limit") options.limit = Number(value);
    else if (flag === "--output") options.output = path.resolve(value);
    else if (flag === "--apply") options.apply = path.resolve(value);
    else if (flag === "--accept") options.accept = value.split(",").map((s) => s.trim()).filter(Boolean);
    else if (flag === "--reviewed-at") options.reviewedAt = value;
    else throw new Error(usage);
    i++;
  }
  if (!Number.isInteger(options.limit) || options.limit < 1) throw new Error("--limit must be a positive integer");
  if (!options.input === !options.apply) throw new Error(usage);
  if (options.apply && !options.accept.length) throw new Error("--apply needs --accept with the plugin IDs you re-checked");
  return options;
}

const sha256 = (text) => createHash("sha256").update(text).digest("hex");
const repoParts = (repository) => new URL(repository).pathname.replace(/\.git$/, "").split("/").filter(Boolean).slice(0, 2);
const blobUrl = (repository, revision, file) => `https://github.com/${repoParts(repository).join("/")}/blob/${revision}/${file.split("/").map(encodeURIComponent).join("/")}`;

// Passages use the same "<path> lines a-b:\n<text>" format that
// scripts/capture-review-evidence.mjs verifies.
export function splitPassages(evidence) {
  return evidence.split(/\n\n(?=[^\n]+ lines \d+-\d+:\n)/).map((passage) => {
    const match = /^([^\n]+) lines (\d+)-(\d+):\n([\s\S]+)$/.exec(passage);
    if (!match) throw new Error("Invalid passage format");
    return { path: match[1], first: Number(match[2]), last: Number(match[3]), text: match[4] };
  });
}

// Finds the passage's exact lines in the new file. When the block appears more
// than once, the copy nearest its old position wins, so relocation is stable.
export function relocatePassage(passage, body) {
  const lines = body.split(/\r?\n/);
  const wanted = passage.text.split("\n");
  let best = null;
  for (let start = 0; start + wanted.length <= lines.length; start++) {
    if (wanted.every((line, offset) => lines[start + offset] === line)) {
      const distance = Math.abs(start + 1 - passage.first);
      if (!best || distance < best.distance) best = { first: start + 1, last: start + wanted.length, distance };
    }
  }
  return best ? { ...passage, first: best.first, last: best.last } : null;
}

// `bytes` is the raw file, so the recorded hash matches capture-review-evidence.
export function repinSource(source, bytes, repository, revision) {
  const body = bytes.toString("utf8");
  const passages = splitPassages(source.evidence);
  const moved = passages.map((passage) => relocatePassage(passage, body));
  const missing = passages.filter((_, index) => !moved[index]).map((p) => `${p.path} lines ${p.first}-${p.last}`);
  if (missing.length) return { status: "passage-changed", missing };
  return {
    status: "relocated",
    source: {
      ...source, url: blobUrl(repository, revision, source.path), revision, sha256: sha256(bytes),
      evidence: moved.map((p) => `${p.path} lines ${p.first}-${p.last}:\n${p.text}`).join("\n\n"),
    },
  };
}

// Manifest keys other than the version, compared as JSON. A version bump alone
// is routine; a changed entry point, kind or permission is worth reading.
export function manifestChanges(before, after) {
  if (before == null || after == null) return before === after ? [] : ["manifest.json added or removed"];
  const keys = [...new Set([...Object.keys(before), ...Object.keys(after)])].filter((key) => key !== "version").sort();
  return keys.filter((key) => JSON.stringify(before[key]) !== JSON.stringify(after[key]));
}

async function fetchLimited(url, { token, accept } = {}) {
  const response = await fetch(url, {
    headers: { "user-agent": "OmaPicks-recheck", ...(accept ? { accept } : {}), ...(token ? { authorization: `Bearer ${token}` } : {}) },
    redirect: "error", signal: AbortSignal.timeout(20000),
  });
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const chunks = []; let bytes = 0;
  const reader = response.body.getReader();
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.length;
      if (bytes > 4 * 1024 * 1024) throw new Error("Response exceeds 4 MiB");
      chunks.push(value);
    }
  } finally { await reader.cancel(); }
  return Buffer.concat(chunks);
}

const rawFile = (repository, revision, file) =>
  fetchLimited(`https://raw.githubusercontent.com/${repoParts(repository).join("/")}/${revision}/${file.split("/").map(encodeURIComponent).join("/")}`);

async function compareFiles(repository, base, head, token) {
  const body = await fetchLimited(`https://api.github.com/repos/${repoParts(repository).join("/")}/compare/${base}...${head}?per_page=300`,
    { token, accept: "application/vnd.github+json" });
  if (body == null) throw new Error("Comparison not found");
  const result = JSON.parse(body.toString("utf8"));
  return {
    commits: result.total_commits,
    truncated: (result.files?.length ?? 0) >= 300,
    files: (result.files ?? []).map((f) => ({ path: f.filename, status: f.status, additions: f.additions, deletions: f.deletions })),
  };
}

// Only previous picks and podium entrants, in queue order, capped by assignment.
export function selectRechecks({ catalog, taskReviews, pluginProfiles, evidenceObservations, queue, limit }) {
  const byId = new Map(catalog.map((plugin) => [plugin.id, plugin]));
  const priority = (queue?.assignments ?? []).filter((entry) => entry.status === "stale-source" && (entry.previousPick || entry.wouldEnterPodium));
  const chosen = []; const plugins = new Map();
  for (const entry of priority) {
    if (chosen.length >= limit) break;
    const plugin = byId.get(entry.pluginId);
    const observation = evidenceObservations.plugins?.[entry.pluginId];
    const profile = pluginProfiles.plugins?.[entry.pluginId];
    if (!plugin || observation?.status !== "changed" || !SHA.test(observation.currentRevision ?? "") || profile?.requirementsStatus !== "reviewed") continue;
    chosen.push(entry);
    if (!plugins.has(entry.pluginId)) {
      // Every qualified repository review of the plugin moves to the new
      // revision together, because a plugin's citations share one commit.
      const reviews = taskReviews.assignments.filter((review) => review.pluginId === entry.pluginId &&
        review.provenance === "repository-evidence" && reviewSources(review).every((s) => s.revision === observation.reviewRevision));
      plugins.set(entry.pluginId, { plugin, observation, profile, reviews, queued: [] });
    }
    plugins.get(entry.pluginId).queued.push({ typeId: entry.typeId, previousPick: entry.previousPick, wouldEnterPodium: entry.wouldEnterPodium, prospectiveScore: entry.prospectiveScore });
  }
  return [...plugins.values()];
}

export async function prepareRecheck(group, { token, fetchText = rawFile, compare = compareFiles } = {}) {
  const { plugin, observation, profile, reviews } = group;
  const [from, to] = [observation.reviewRevision, observation.currentRevision];
  const cited = [...new Set([...reviews.flatMap(reviewSources), ...profile.sources].map((s) => s.path))].sort();
  const bodies = new Map();
  for (const file of cited) bodies.set(file, await fetchText(plugin.repo, to, file));
  const [before, after] = await Promise.all([fetchText(plugin.repo, from, "manifest.json"), fetchText(plugin.repo, to, "manifest.json")]);
  const parse = (bytes) => { try { return bytes == null ? null : JSON.parse(bytes.toString("utf8")); } catch { return { unreadable: true }; } };
  const changes = await compare(plugin.repo, from, to, token).catch((error) => ({ error: error.message, files: [] }));
  const repin = (source) => bodies.get(source.path) == null ? { status: "file-removed", missing: [source.path] } : repinSource(source, bodies.get(source.path), plugin.repo, to);
  const reviewResults = reviews.map((review) => {
    const results = reviewSources(review).map(repin);
    const ok = results.every((r) => r.status === "relocated");
    const sources = ok ? results.map((r) => r.source) : null;
    return {
      // The fingerprint lets --apply refuse a review edited after this proposal.
      typeId: review.typeId, decision: review.decision, ok, originalHash: evidenceHash(review), missing: results.flatMap((r) => r.missing ?? []),
      review: ok ? { ...review, metadataHash: taskMetadataHash(plugin), ...(review.sources ? { sources } : {}), source: sources[0] } : null,
    };
  });
  const profileResults = profile.sources.map(repin);
  const profileOk = profileResults.every((r) => r.status === "relocated");
  return {
    pluginId: plugin.id, name: plugin.name, repository: plugin.repo, fromRevision: from, toRevision: to,
    queued: group.queued, manifestChanges: manifestChanges(parse(before), parse(after)),
    comparison: changes,
    reviews: reviewResults,
    profile: { ok: profileOk, originalHash: evidenceHash(profile), missing: profileResults.flatMap((r) => r.missing ?? []), sources: profileOk ? profileResults.map((r) => r.source) : null },
    mechanicalStatus: reviewResults.every((r) => r.ok) && profileOk ? "passages-unchanged" : "passages-changed",
  };
}

export function renderMarkdown(proposal) {
  const lines = [`# Review re-checks for ${proposal.generatedAt.slice(0, 10)}`, "",
    "Each plugin below was a recent pick or podium entrant, and its repository changed after its capability review. " +
    "\"Passages unchanged\" only means the cited text still appears at the new commit. It is not a review: read the changes, " +
    "confirm the task still completes, then accept the plugin with `--apply`.", ""];
  for (const item of proposal.plugins) {
    const files = item.comparison.files ?? [];
    lines.push(`## ${item.name} (\`${item.pluginId}\`)`, "",
      `- Categories: ${item.queued.map((q) => `${q.typeId}${q.previousPick ? " (previous pick)" : ""}`).join(", ")}`,
      `- Repository: ${item.repository}/compare/${item.fromRevision.slice(0, 12)}...${item.toRevision.slice(0, 12)}`,
      `- Cited passages: ${item.mechanicalStatus === "passages-unchanged" ? "unchanged" : `changed (${[...new Set([...item.reviews.flatMap((r) => r.missing), ...item.profile.missing])].join("; ")})`}`,
      `- Manifest changes besides version: ${item.manifestChanges.length ? item.manifestChanges.join(", ") : "none"}`,
      item.comparison.error ? `- File comparison unavailable: ${item.comparison.error}` :
        `- ${item.comparison.commits} commits, ${files.length}${item.comparison.truncated ? "+" : ""} files: ${files.slice(0, 25).map((f) => `${f.path} (${f.status}, +${f.additions}/-${f.deletions})`).join(", ")}${files.length > 25 ? ", …" : ""}`,
      "");
  }
  return `${lines.join("\n")}\n`;
}

// Writes accepted re-checks into the editorial files. Rejected or unlisted
// plugins stay as they are, so they remain queued.
export function applyRecheck(proposal, accept, reviews, profiles, reviewedAt) {
  const wanted = new Set(accept);
  const items = proposal.plugins.filter((item) => wanted.has(item.pluginId));
  const unknown = [...wanted].filter((id) => !items.some((item) => item.pluginId === id));
  if (unknown.length) throw new Error(`Not in this proposal: ${unknown.join(", ")}`);
  for (const item of items) {
    if (item.mechanicalStatus !== "passages-unchanged") throw new Error(`${item.pluginId}: cited passages changed; write a new review instead`);
    const profile = profiles.plugins[item.pluginId];
    if (evidenceHash(profile) !== item.profile.originalHash) throw new Error(`${item.pluginId}: requirements changed since the proposal`);
    profiles.plugins[item.pluginId] = { ...profile, reviewedAt, sources: item.profile.sources };
    for (const result of item.reviews) {
      const index = reviews.assignments.findIndex((r) => r.pluginId === item.pluginId && r.typeId === result.typeId);
      if (index < 0 || evidenceHash(reviews.assignments[index]) !== result.originalHash) throw new Error(`${item.pluginId}/${result.typeId}: review changed since the proposal`);
      reviews.assignments[index] = { ...result.review, reviewedAt };
    }
  }
  return { reviews, profiles, applied: items.map((item) => item.pluginId) };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.apply) {
    const reviewedAt = options.reviewedAt ?? new Date().toISOString().slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(reviewedAt)) throw new Error("--reviewed-at must be YYYY-MM-DD");
    const proposal = JSON.parse(await readFile(options.apply, "utf8"));
    const reviewsFile = path.join(root, "data", "task-reviews.json");
    const profilesFile = path.join(root, "data", "plugin-profiles.json");
    const result = applyRecheck(proposal, options.accept, JSON.parse(await readFile(reviewsFile, "utf8")), JSON.parse(await readFile(profilesFile, "utf8")), reviewedAt);
    await writeFile(reviewsFile, `${JSON.stringify(result.reviews, null, 2)}\n`);
    await writeFile(profilesFile, `${JSON.stringify(result.profiles, null, 2)}\n`);
    console.log(`Re-pinned ${result.applied.length} plugins: ${result.applied.join(", ")}`);
    return;
  }
  const inputs = JSON.parse(await readFile(options.input, "utf8"));
  const queue = options.queue ? JSON.parse(await readFile(options.queue, "utf8")) : inputs.previousReviewQueue;
  const catalog = inputs.catalog?.body?.plugins ?? inputs.catalog?.body ?? [];
  const groups = selectRechecks({ catalog, taskReviews: inputs.taskReviews, pluginProfiles: inputs.pluginProfiles, evidenceObservations: inputs.evidenceObservations, queue, limit: options.limit });
  const token = process.env.GH_TOKEN ?? process.env.GITHUB_TOKEN;
  const plugins = [];
  for (const group of groups) {
    try { plugins.push(await prepareRecheck(group, { token })); }
    catch (error) { plugins.push({ pluginId: group.plugin.id, name: group.plugin.name, repository: group.plugin.repo, error: error.message, queued: group.queued, comparison: { files: [] }, reviews: [], profile: { missing: [] }, manifestChanges: [], mechanicalStatus: "unavailable", fromRevision: group.observation.reviewRevision, toRevision: group.observation.currentRevision }); }
  }
  const proposal = { schemaVersion: 1, generatedAt: inputs.now ?? new Date().toISOString(), codeRevision: inputs.codeRevision ?? null, limit: options.limit, plugins };
  await mkdir(options.output, { recursive: true });
  await writeFile(path.join(options.output, "proposal.json"), `${JSON.stringify(proposal, null, 2)}\n`);
  await writeFile(path.join(options.output, "proposal.md"), renderMarkdown(proposal));
  const unchanged = plugins.filter((p) => p.mechanicalStatus === "passages-unchanged").length;
  // Counts only: upstream names stay in the artifact, never in Actions Markdown.
  const line = `Review re-checks: ${plugins.length} plugins (${groups.reduce((n, g) => n + g.queued.length, 0)} queued assignments); ${unchanged} with unchanged cited passages; ${plugins.filter((p) => p.mechanicalStatus === "unavailable").length} could not be compared.`;
  console.log(`${line} ${path.relative(root, options.output)}/proposal.md`);
  if (process.env.GITHUB_STEP_SUMMARY) await appendFile(process.env.GITHUB_STEP_SUMMARY, `\n### Review re-checks\n\n${line} Read \`recheck/proposal.md\` in the review-evidence artifact.\n`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => { console.error(error.message); process.exitCode = 1; });
}
