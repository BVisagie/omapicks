import { createHash } from "node:crypto";

export const evidenceHash = (value) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
export const repositoryKey = (value) => String(value ?? "").toLowerCase().replace(/\.git\/?$/, "").replace(/\/+$/, "");
const SHA = /^[a-f0-9]{40}$/;
const HASH = /^[a-f0-9]{64}$/;
const validDate = (value) => /^\d{4}-\d{2}-\d{2}$/.test(value ?? "") && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;

// A citation is an inspectable, immutable passage, not an attestation that the code works.
export function pinnedSource(source, repository = null) {
  try {
    const url = new URL(source.url);
    const parts = url.pathname.split("/").filter(Boolean);
    return url.origin === "https://github.com" && !url.username && !url.password &&
      parts.length >= 5 && parts[2] === "blob" && SHA.test(source.revision) && parts[3] === source.revision &&
      source.path === decodeURIComponent(parts.slice(4).join("/")) &&
      typeof source.evidence === "string" && source.evidence.trim().length > 0 &&
      (!repository || repositoryKey(`https://github.com/${parts[0]}/${parts[1]}`) === repositoryKey(repository));
  } catch { return false; }
}

export function reviewSources(review) { return review?.sources?.length ? review.sources : review?.source ? [review.source] : []; }

export function validateProfiles(profiles) {
  if (profiles?.schemaVersion !== 1 || !profiles.plugins || typeof profiles.plugins !== "object" || Array.isArray(profiles.plugins)) throw new Error("Unsupported plugin profiles schema");
  for (const [id, profile] of Object.entries(profiles.plugins)) {
    if (!["unknown", "reviewed"].includes(profile.requirementsStatus) || !Array.isArray(profile.requirements) || profile.requirements.some((s) => typeof s !== "string" || !s.trim())) throw new Error(`Invalid shared requirements: ${id}`);
    if (profile.requirementsStatus === "reviewed" && (!validDate(profile.reviewedAt) || !Array.isArray(profile.sources) || !profile.sources.length || !profile.sources.every((s) => pinnedSource(s)))) throw new Error(`Reviewed requirements need pinned evidence: ${id}`);
  }
  return profiles;
}

export function observationCurrent(observation, plugin, sources, now, maxAgeDays = 8) {
  const checked = Date.parse(observation?.checkedAt);
  const age = now.getTime() - checked;
  return observation?.status === "current" && repositoryKey(observation.repository) === repositoryKey(plugin.repo) &&
    SHA.test(plugin.upstreamObservedCommit ?? "") && observation.currentRevision === plugin.upstreamObservedCommit &&
    sources.every((s) => s.revision === observation.reviewRevision && observation.evidencePaths?.includes(s.path)) &&
    HASH.test(observation.baselineFingerprint ?? "") && observation.baselineFingerprint === observation.currentFingerprint &&
    Number.isFinite(age) && age >= 0 && age <= maxAgeDays * 86400000;
}

// Every cited "<path> lines a-b:\n<text>" passage still appears, word for word and
// anywhere in the file. Line numbers may move; the text may not.
export function passagesPresent(evidence, body) {
  const lines = body.split(/\r?\n/);
  return evidence.split(/\n\n(?=[^\n]+ lines \d+-\d+:\n)/).every((passage) => {
    const match = /^[^\n]+ lines \d+-\d+:\n([\s\S]+)$/.exec(passage);
    if (!match) return false;
    const wanted = match[1].split("\n");
    for (let start = 0; start + wanted.length <= lines.length; start++) {
      if (wanted.every((line, offset) => lines[start + offset] === line)) return true;
    }
    return false;
  });
}

// Methodology 1.5.0: a changed repository can keep a previous pick in place while the
// re-check is pending. Everything observationCurrent requires still holds except the
// matching fingerprints; instead, the cited passages must survive at the new commit and
// the listed manifest keys must be unchanged.
export function observationGraceable(observation, plugin, sources, now, maxAgeDays = 8) {
  const checked = Date.parse(observation?.checkedAt);
  const age = now.getTime() - checked;
  return observation?.status === "changed" && repositoryKey(observation.repository) === repositoryKey(plugin.repo) &&
    SHA.test(plugin.upstreamObservedCommit ?? "") && observation.currentRevision === plugin.upstreamObservedCommit &&
    sources.every((s) => s.revision === observation.reviewRevision && observation.evidencePaths?.includes(s.path)) &&
    observation.recheck?.status === "checked" && observation.recheck.passagesPresent === true &&
    Array.isArray(observation.recheck.manifestChanges) && observation.recheck.manifestChanges.length === 0 &&
    Number.isFinite(age) && age >= 0 && age <= maxAgeDays * 86400000;
}

async function rawText(repository, revision, file, fetchImpl) {
  const parts = new URL(repository).pathname.replace(/\.git$/, "").split("/").filter(Boolean);
  const url = `https://raw.githubusercontent.com/${parts.map(encodeURIComponent).join("/")}/${revision}/${file.split("/").map(encodeURIComponent).join("/")}`;
  const response = await fetchImpl(url, { headers: { "user-agent": "OmaPicks-evidence" }, signal: AbortSignal.timeout(20000), redirect: "error" });
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`Source text fetch failed (HTTP ${response.status})`);
  const text = await response.text();
  if (text.length > 2 * 1024 * 1024) throw new Error("Source text exceeds 2 MiB budget");
  return text;
}

// What a re-check needs to know about a changed repository, recorded with the observation
// so replays never fetch. A failure is recorded too and simply grants no grace.
async function recheckEvidence(plugin, sources, from, to, manifestKeys, fetchImpl) {
  try {
    const bodies = new Map();
    for (const file of [...new Set(sources.map((s) => s.path))]) bodies.set(file, await rawText(plugin.repo, to, file, fetchImpl));
    const present = sources.every((s) => bodies.get(s.path) != null && passagesPresent(s.evidence, bodies.get(s.path)));
    const [before, after] = await Promise.all([rawText(plugin.repo, from, "manifest.json", fetchImpl), rawText(plugin.repo, to, "manifest.json", fetchImpl)]);
    const parse = (text) => (text == null ? null : JSON.parse(text));
    const [a, b] = [parse(before), parse(after)];
    const manifestChanges = a == null || b == null ? ["manifest.json"] : manifestKeys.filter((key) => JSON.stringify(a[key]) !== JSON.stringify(b[key]));
    return { status: "checked", passagesPresent: present, manifestChanges };
  } catch (error) { return { status: "unavailable", reason: error.message }; }
}

// All non-documentation/non-media files participate, including manifests, lockfiles,
// scripts and newly added source files. Cited documentation always participates.
// This intentionally makes no semantic or runtime compatibility claim.
export function relevantTreeFingerprint(tree, evidencePaths) {
  if (tree?.truncated || !Array.isArray(tree?.tree)) throw new Error("Incomplete repository tree");
  const paths = new Set();
  for (const entry of tree.tree) {
    if (typeof entry.path !== "string" || !entry.path || paths.has(entry.path) || !SHA.test(entry.sha ?? "") || !["blob", "commit", "tree"].includes(entry.type) || !/^[0-7]{6}$/.test(entry.mode ?? "")) throw new Error("Malformed repository tree entry");
    paths.add(entry.path);
  }
  const cited = new Set(evidencePaths);
  const entries = tree.tree.filter((entry) => {
    if (!["blob", "commit"].includes(entry.type)) return false;
    if (cited.has(entry.path)) return true;
    if (/^\.github(?:\/|$)/i.test(entry.path)) return false;
    return !/\.(?:md|mdx|rst|png|jpe?g|gif|webp|svg|ico|mp4|webm|woff2?|ttf|otf)$/i.test(entry.path);
  }).map(({ path, sha, mode, type }) => ({ path, sha, mode, type })).sort((a, b) => a.path.localeCompare(b.path));
  for (const path of cited) if (!entries.some((e) => e.path === path && e.type === "blob")) throw new Error(`Missing evidence file: ${path}`);
  return evidenceHash(entries);
}

async function githubTree(repository, revision, fetchImpl, token) {
  const parsed = new URL(repository);
  const parts = parsed.pathname.replace(/\.git$/, "").split("/").filter(Boolean);
  if (parsed.origin !== "https://github.com" || parsed.username || parsed.password || parts.length !== 2 || !SHA.test(revision)) throw new Error("Unsupported repository identity");
  const url = `https://api.github.com/repos/${parts.map(encodeURIComponent).join("/")}/git/trees/${revision}?recursive=1`;
  const response = await fetchImpl(url, { headers: { accept: "application/vnd.github+json", "user-agent": "OmaPicks-evidence", ...(token ? { authorization: `Bearer ${token}` } : {}) }, signal: AbortSignal.timeout(20000), redirect: "error" });
  if (!response.ok) throw new Error(`Source observation failed (HTTP ${response.status})`);
  const reader = response.body.getReader();
  const chunks = []; let bytes = 0;
  try {
    while (true) { const { done, value } = await reader.read(); if (done) break; bytes += value.length; if (bytes > 8 * 1024 * 1024) throw new Error("Repository tree exceeds 8 MiB budget"); chunks.push(value); }
  } finally { await reader.cancel(); }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

// Read-only repository observation. Every result, including failure, travels with
// replay inputs. Only the final weekly publication persists a ranking decision.
// `recheck` (methodology 1.5.0's recheckGrace) adds passage and manifest evidence for
// changed repositories; without it the observation is exactly as before.
export async function captureEvidence({ catalog, taskReviews, pluginProfiles, taxonomy = null, now = new Date(), fetchImpl = fetch, token = process.env.GH_TOKEN ?? process.env.GITHUB_TOKEN, concurrency = 6, recheck = null }) {
  validateProfiles(pluginProfiles);
  const byId = new Map(catalog.map((p) => [p.id, p]));
  const groups = new Map();
  const expected = new Set();
  const contracts = new Map((taxonomy?.types ?? []).map((type) => [type.id, type.contract?.version]));
  for (const review of taskReviews.assignments) if (review.decision === "qualified" && review.provenance === "repository-evidence") {
    if (taxonomy && contracts.get(review.typeId) !== review.contractVersion) continue;
    // Count prerequisites/revision failures too: losing all profiles must not
    // turn a failed observation run into a successfully published empty set.
    if (byId.has(review.pluginId)) expected.add(review.pluginId);
    // One plugin observation follows its shared requirements review. An older
    // category review cannot poison newer reviews for the same plugin; it will
    // independently fail the revision match in observationCurrent.
    const revision = pluginProfiles.plugins[review.pluginId]?.sources?.[0]?.revision;
    const sources = reviewSources(review);
    if (revision && sources.every((source) => source.revision === revision)) groups.set(review.pluginId, [...(groups.get(review.pluginId) ?? []), ...sources]);
  }
  const cache = new Map();
  const tree = (repo, sha) => { const key = `${repositoryKey(repo)}/${sha}`; if (!cache.has(key)) cache.set(key, githubTree(repo, sha, fetchImpl, token)); return cache.get(key); };
  const plugins = {};
  let attempted = 0, completed = 0;
  const pending = [...groups];
  await Promise.all(Array.from({ length: Math.min(concurrency, pending.length) }, async () => {
    while (pending.length) {
      const [id, citations] = pending.shift();
      const plugin = byId.get(id); const profile = pluginProfiles.plugins[id];
      const sources = [...citations, ...(profile?.sources ?? [])];
      const base = { repository: plugin?.repo ?? null, reviewRevision: sources[0]?.revision ?? null, currentRevision: plugin?.upstreamObservedCommit ?? null, checkedAt: now.toISOString(), evidencePaths: [...new Set(sources.map((s) => s.path))].sort() };
      if (plugin) attempted += 1;
      try {
        if (!plugin || profile?.requirementsStatus !== "reviewed" || !sources.length || !sources.every((s) => pinnedSource(s, plugin.repo) && s.revision === base.reviewRevision)) throw new Error("Missing or inconsistent review and requirement sources");
        const [before, after] = await Promise.all([tree(plugin.repo, base.reviewRevision), tree(plugin.repo, base.currentRevision)]);
        const baselineFingerprint = relevantTreeFingerprint(before, base.evidencePaths);
        const currentFingerprint = relevantTreeFingerprint(after, base.evidencePaths);
        plugins[id] = { ...base, baselineFingerprint, currentFingerprint, status: baselineFingerprint === currentFingerprint ? "current" : "changed" };
        if (recheck && plugins[id].status === "changed") plugins[id].recheck = await recheckEvidence(plugin, sources, base.reviewRevision, base.currentRevision, recheck.manifestKeys, fetchImpl);
        completed += 1;
      } catch (error) { plugins[id] = { ...base, status: "unavailable", reason: error.message }; }
    }
  }));
  return { schemaVersion: 1, generatedAt: now.toISOString(), expected: expected.size, attempted, completed, plugins: Object.fromEntries(Object.entries(plugins).sort(([a], [b]) => a.localeCompare(b))) };
}
