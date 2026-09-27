import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { access, appendFile, mkdir, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { CLASSIFICATION_VERSION, METHODOLOGY, REMOVAL_REASONS, changesBetween, invertedRawScoreRaces, isoWeek, rankPlugins, runnerUpChangesBetween } from "./rank.mjs";
import { LEGACY_METHODOLOGY_VERSION, methodologyFor } from "./methodology.mjs";
import { auditClassifications, renderClassificationAudit } from "./classification-audit.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CATALOG_URL = "https://plugins.omarchy.org/catalog.json";
const STATS_URL = "https://api.omarchyplugins.com/v1/stats";
// The marketplace source registry (MIT); only retiredPluginIds is consumed. Not served on the website.
export const REGISTRY_URL = "https://raw.githubusercontent.com/omacom/omarchy-plugin-marketplace/main/registry.json";
const MAX_IMAGE_BYTES = 2 * 1024 * 1024;
const MAX_FEED_BYTES = 20 * 1024 * 1024;

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

export async function fetchJson(url, { attempts = 3, timeoutMs = 15_000, fetchImpl = fetch } = {}) {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetchImpl(url, {
        headers: { accept: "application/json", "user-agent": "OmaPicks/1.0 (+https://omapicks.com)" },
        signal: controller.signal
      });
      if (!response.ok) throw new Error(`${url} returned HTTP ${response.status}`);
      const body = await response.json();
      return {
        body,
        etag: response.headers.get("etag"),
        lastModified: response.headers.get("last-modified")
      };
    } catch (error) {
      lastError = error;
      if (attempt < attempts) await delay(250 * 2 ** (attempt - 1));
    } finally {
      clearTimeout(timer);
    }
  }
  throw new Error(`Unable to fetch ${url}: ${lastError?.message ?? "unknown error"}`);
}

function checksum(value) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

// Bound actual streamed bytes, not just an optional Content-Length header.
export async function boundedFetch(fetchImpl, url, options, maxBytes = MAX_FEED_BYTES) {
  const response = await fetchImpl(url, options);
  if (!response.ok) return response;
  const budget = `Feed exceeds ${Math.round(maxBytes / 1024 / 1024)} MiB budget`;
  if (Number(response.headers.get("content-length")) > maxBytes) {
    await response.body?.cancel();
    throw new Error(budget);
  }
  const reader = response.body?.getReader();
  if (!reader) throw new Error("Feed has no response body");
  const chunks = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) throw new Error(budget);
      chunks.push(value);
    }
  } finally { await reader.cancel(); }
  const headers = new Headers(response.headers);
  headers.delete("content-encoding");
  headers.delete("content-length");
  return new Response(Buffer.concat(chunks), { status: response.status, headers });
}

// Retirement evidence only labels changes; a failed or malformed fetch never blocks a refresh and is
// recorded as unavailable rather than as an empty list.
export async function fetchRetirements(fetchImpl = fetch) {
  try {
    const result = await fetchJson(REGISTRY_URL, { fetchImpl: (url, options) => boundedFetch(fetchImpl, url, options) });
    const ids = result.body?.retiredPluginIds;
    if (!Array.isArray(ids) || ids.some((id) => typeof id !== "string")) {
      throw new Error("registry.json retiredPluginIds must be an array of strings");
    }
    return { status: "available", url: REGISTRY_URL, etag: result.etag, lastModified: result.lastModified, retiredPluginIds: [...new Set(ids)].sort(), error: null };
  } catch (error) {
    return { status: "unavailable", url: REGISTRY_URL, etag: null, lastModified: null, retiredPluginIds: null, error: error.message };
  }
}

function registrySource(registry) {
  const available = registry?.status === "available";
  return {
    url: registry?.url ?? REGISTRY_URL,
    status: available ? "available" : "unavailable",
    etag: registry?.etag ?? null,
    lastModified: registry?.lastModified ?? null,
    sha256: available ? checksum(registry.retiredPluginIds) : null,
    count: available ? registry.retiredPluginIds.length : null,
    ...(available ? {} : { error: registry?.error ?? "not fetched" })
  };
}

export function changeContext({ catalog, registry, exclusions, typeIdsById }) {
  const available = registry?.status === "available";
  return {
    catalogIds: new Set(catalog.map((plugin) => plugin?.id)),
    retirement: { available, ids: new Set(available ? registry.retiredPluginIds : []) },
    exclusions,
    typeIdsById
  };
}

// Recompute this run's pick changes and their reasons from captured refresh inputs, offline.
export function replayChanges(inputs) {
  const catalog = inputs.catalog.body.plugins;
  const ranked = rankPlugins({
    catalog,
    stats: inputs.stats.body.plugins,
    taxonomy: inputs.taxonomy,
    previous: inputs.previous,
    now: new Date(inputs.now),
    methodology: methodologyFor(inputs.methodologyVersion ?? LEGACY_METHODOLOGY_VERSION)
  });
  const context = changeContext({ catalog, registry: inputs.registry, exclusions: ranked.exclusions, typeIdsById: ranked.typeIdsById });
  return {
    changes: changesBetween(inputs.previous, ranked.rankings, context),
    runnerUpChanges: runnerUpChangesBetween(inputs.previous, ranked.rankings, context)
  };
}

// Identifies the code that produced replay inputs or research reports. Never used for ranking.
export function codeRevision(root = ROOT) {
  if (process.env.GITHUB_SHA) return process.env.GITHUB_SHA;
  try {
    const head = execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
    const dirty = execFileSync("git", ["status", "--porcelain", "--untracked-files=no"], { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
    return dirty ? `${head}-dirty` : head;
  } catch {
    return null;
  }
}

// Catalog state schema 2 added graded verification and upstream health fields. Older fixtures and
// feeds carry no version; anything newer must be reviewed before it can silently change eligibility.
const SUPPORTED_CATALOG_SCHEMAS = new Set([undefined, 2]);

export function validateFeeds(catalogFeed, statsFeed, minimumCatalogSize, previous = null) {
  if (!catalogFeed || !Array.isArray(catalogFeed.plugins)) throw new Error("Catalog feed is missing plugins[]");
  if (!SUPPORTED_CATALOG_SCHEMAS.has(catalogFeed.stateSchemaVersion)) {
    throw new Error(`Unsupported catalog stateSchemaVersion: ${JSON.stringify(catalogFeed.stateSchemaVersion)}`);
  }
  if (catalogFeed.warnings !== undefined &&
      (!Array.isArray(catalogFeed.warnings) || catalogFeed.warnings.some((warning) => typeof warning !== "string"))) {
    throw new Error("Catalog warnings must be an array of strings");
  }
  if (catalogFeed.plugins.length < minimumCatalogSize) {
    throw new Error(`Catalog contains ${catalogFeed.plugins.length} plugins; expected at least ${minimumCatalogSize}`);
  }
  const ids = new Set();
  for (const [index, plugin] of catalogFeed.plugins.entries()) {
    if (!plugin || typeof plugin.id !== "string" || !/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(plugin.id)) {
      throw new Error(`Catalog plugin ${index} has an unsafe or missing id`);
    }
    if (ids.has(plugin.id)) throw new Error(`Catalog contains duplicate id: ${plugin.id}`);
    ids.add(plugin.id);
  }
  if (!statsFeed || statsFeed.schemaVersion !== 1 || !statsFeed.plugins ||
      typeof statsFeed.plugins !== "object" || Array.isArray(statsFeed.plugins)) {
    throw new Error("Stats feed does not match schemaVersion 1");
  }
  for (const [id, metrics] of Object.entries(statsFeed.plugins)) {
    if (!metrics || typeof metrics !== "object") throw new Error(`Stats entry ${id} is invalid`);
    for (const key of ["views", "copies", "hearts"]) {
      if (!Number.isFinite(Number(metrics[key])) || Number(metrics[key]) < 0) {
        throw new Error(`Stats entry ${id}.${key} must be a non-negative number`);
      }
    }
  }
  // A healthy catalog does not imply a healthy, independently fetched stats feed.
  // Allow new listings without stats, but stop a partial response from resetting scores.
  const statsCount = Object.keys(statsFeed.plugins).length;
  const overlapCount = [...ids].filter((id) => Object.hasOwn(statsFeed.plugins, id)).length;
  if (overlapCount < Math.max(1, Math.ceil(ids.size * 0.5))) {
    throw new Error(`Stats overlap only ${overlapCount} of ${ids.size} catalog plugins; expected at least 50%`);
  }
  const previousCount = previous?.source?.stats?.count;
  if (Number.isFinite(previousCount) && statsCount < previousCount * 0.75) {
    throw new Error(`Stats contains ${statsCount} entries; fewer than 75% of the previous ${previousCount}`);
  }
}

async function readJson(file, fallback = null) {
  try {
    return JSON.parse(await readFile(file, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") return fallback;
    throw error;
  }
}

// The latest published snapshot from an earlier ISO week. Same-week republishes therefore keep the
// interval that the week's first run used.
async function priorWeekBaseline(root, week) {
  const directory = path.join(root, "data", "history");
  let files;
  try {
    files = await readdir(directory);
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
  const latest = files.filter((file) => /^\d{4}-W\d{2}\.json$/.test(file) && file.slice(0, -5) < week).sort().at(-1);
  if (!latest) return null;
  const snapshot = await readJson(path.join(directory, latest));
  return Number.isFinite(Date.parse(snapshot?.generatedAt)) ? { week: snapshot.week ?? latest.slice(0, -5), generatedAt: snapshot.generatedAt } : null;
}

async function writeJsonAtomic(file, value) {
  await mkdir(path.dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`);
  await rename(temporary, file);
}

function safeAssetName(candidate, contentType) {
  const extension = new Map([
    ["image/webp", "webp"],
    ["image/png", "png"],
    ["image/jpeg", "jpg"]
  ]).get(contentType);
  if (!extension) return null;
  const id = candidate.id.replace(/[^a-zA-Z0-9.-]+/g, "-").slice(0, 100);
  const sourceHash = createHash("sha256").update(candidate.previewSource).digest("hex").slice(0, 10);
  return `${id}-${sourceHash}.${extension}`;
}

async function downloadImage(candidate, { fetchImpl = fetch, root = ROOT } = {}) {
  if (!candidate?.previewSource) return null;
  let url;
  try {
    url = new URL(candidate.previewSource);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" || url.hostname !== "plugins.omarchy.org") return null;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15_000);
  try {
    const response = await fetchImpl(url, {
      headers: { accept: "image/webp,image/png,image/jpeg", "user-agent": "OmaPicks/1.0 (+https://omapicks.com)" },
      signal: controller.signal
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const contentType = (response.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
    const assetName = safeAssetName(candidate, contentType);
    if (!assetName) throw new Error(`unsupported content type ${contentType || "unknown"}`);
    const contentLength = Number(response.headers.get("content-length") ?? 0);
    if (contentLength > MAX_IMAGE_BYTES) throw new Error("image exceeds 2 MiB");
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.byteLength > MAX_IMAGE_BYTES) throw new Error("image exceeds 2 MiB");
    const destination = path.join(root, "data", "assets", "plugins", assetName);
    await mkdir(path.dirname(destination), { recursive: true });
    await writeFile(destination, bytes);
    return `assets/plugins/${assetName}`;
  } finally {
    clearTimeout(timer);
  }
}

function previousImagesById(previous) {
  const images = new Map();
  for (const type of previous?.types ?? []) {
    for (const candidate of [type.winner, type.runnerUp]) {
      if (candidate?.id && candidate.localImage) images.set(candidate.id, candidate);
    }
  }
  return images;
}

async function reusableCachedImage(candidate, previousImages, root) {
  const prior = previousImages.get(candidate.id);
  if (!prior || prior.previewSource !== candidate.previewSource) return null;
  if (!/^assets\/plugins\/[a-zA-Z0-9][a-zA-Z0-9.-]*\.(?:webp|png|jpg)$/.test(prior.localImage)) return null;
  try {
    await access(path.join(root, "data", prior.localImage));
    return prior.localImage;
  } catch {
    return null;
  }
}

async function attachImages(rankings, { previous = null, root = ROOT, ...options }) {
  const seen = new Map();
  const previousImages = previousImagesById(previous);
  const warnings = [];
  for (const type of rankings.types) {
    for (const candidate of [type.winner, type.runnerUp]) {
      if (!candidate) continue;
      if (seen.has(candidate.id)) {
        candidate.localImage = seen.get(candidate.id);
        continue;
      }
      try {
        candidate.localImage = await downloadImage(candidate, { ...options, root });
      } catch (error) {
        candidate.localImage = await reusableCachedImage(candidate, previousImages, root);
        const retained = candidate.localImage ? "; retained cached preview" : "";
        warnings.push(`${candidate.id}: ${error.message}${retained}`);
      }
      seen.set(candidate.id, candidate.localImage);
    }
  }
  return warnings;
}

function withoutLocalImages(snapshot) {
  const copy = structuredClone(snapshot);
  for (const type of copy.types) {
    if (type.winner) type.winner.localImage = null;
    if (type.runnerUp) type.runnerUp.localImage = null;
  }
  return copy;
}

// Same-week reruns append to the week's recorded events for that slot ("changes" for champions,
// "runnerUpChanges" for runner-ups) instead of replacing them.
function weekChangeLog(previous, week, existingHistory, computedChanges, key = "changes") {
  const prior = existingHistory?.[key];
  if (previous?.week !== week || !Array.isArray(prior) || prior.length === 0) return computedChanges;
  if (computedChanges.length === 0) return prior;
  return [...prior, ...computedChanges];
}

function countDelta(previous, current) {
  return {
    previous: Number.isFinite(previous) ? previous : null,
    current,
    delta: Number.isFinite(previous) ? current - previous : null
  };
}

function formatSignedCount(value) {
  return value >= 0 ? `+${value}` : String(value);
}

function formatCountDelta(label, { previous, current, delta }) {
  if (!Number.isFinite(previous) || !Number.isFinite(delta)) return `${label} ${current} (no prior snapshot)`;
  return `${label} ${current} (was ${previous}, ${formatSignedCount(delta)})`;
}

function formatPickName(pick) {
  return pick?.name ?? "none";
}

function formatReason(change) {
  return change.reason && REMOVAL_REASONS[change.reason] ? ` (${change.previous?.name ?? "previous pick"} ${REMOVAL_REASONS[change.reason]})` : "";
}

function plural(count, singular, pluralForm = `${singular}s`) {
  return `${count} ${count === 1 ? singular : pluralForm}`;
}

// Upstream writes "<repository>: <code>"; repository URLs never contain ": ".
export function upstreamWarningCodes(warnings = []) {
  const codes = {};
  for (const warning of warnings) {
    const separator = warning.lastIndexOf(": ");
    const code = separator >= 0 ? warning.slice(separator + 2).trim() : "unspecified";
    codes[code || "unspecified"] = (codes[code || "unspecified"] ?? 0) + 1;
  }
  return Object.fromEntries(Object.entries(codes).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])));
}

function formatCatalogShape(catalog) {
  const schema = catalog.stateSchemaVersion == null ? "unversioned" : catalog.stateSchemaVersion;
  return `Catalog schema ${schema}; ${plural(catalog.warningCount ?? 0, "upstream warning")}; ` +
    `${plural(catalog.builtInCount ?? 0, "built-in listing")} excluded.`;
}

function formatValidation(source, previous, catalog, stats, report) {
  const contentChange = (feed) => {
    const prior = previous?.source?.[feed]?.sha256;
    return prior ? (prior === source[feed].sha256 ? "unchanged" : "changed") : "has no prior checksum";
  };
  const overlap = catalog.filter((plugin) => Object.hasOwn(stats, plugin.id)).length;
  const catalogIds = new Set(catalog.map((plugin) => plugin.id));
  // Stats for retired listings linger upstream; a jump in orphans suggests the feeds have diverged.
  const orphans = Object.keys(stats).filter((id) => !catalogIds.has(id)).length;
  const excluded = Object.values(report.excluded).reduce((total, count) => total + count, 0);
  return `Live feeds passed validation: ${source.catalog.count} catalog plugins; ${source.stats.count} stats entries; ${overlap} catalog IDs have stats; ${plural(orphans, "stats ID")} absent from the catalog. ` +
    `Catalog content ${contentChange("catalog")}; stats content ${contentChange("stats")}. ` +
    `${formatCatalogShape(source.catalog)} ` +
    `${report.eligibleClassifiedCount} unique plugins classified; ${excluded} excluded; ${report.uniqueUnclassifiedCount} eligible but unclassified.`;
}

const SIGNAL_NAMES = Object.freeze({
  copies: "copies",
  hearts: "hearts",
  stars: "stars",
  views: "views",
  freshness: "freshness",
  verified: "verification",
  installRateLowerBound: "copy/view lower bound"
});

function signalList(methodology) {
  const names = Object.keys(methodology.weights).map((metric) => SIGNAL_NAMES[metric] ?? metric);
  return names.length > 1 ? `${names.slice(0, -1).join(", ")} and ${names.at(-1)}` : names.join("");
}

function formatMethodology(result) {
  const current = result.rankings?.methodologyVersion ?? METHODOLOGY.version;
  const published = result.publishedMethodologyVersion;
  if (!published || published === current) return `Methodology ${current}, unchanged from the published snapshot.`;
  return `Methodology ${current} replaces published methodology ${published}.`;
}

export function formatRefreshLog(result, { dryRun = false } = {}) {
  if (result.reason === "already-refreshed") {
    const published = result.publishedMethodologyVersion ?? LEGACY_METHODOLOGY_VERSION;
    const pending = result.currentMethodologyVersion && result.currentMethodologyVersion !== published
      ? ` Code now defines methodology ${result.currentMethodologyVersion}; it takes effect at the next weekly refresh, or earlier through a deliberate --republish.`
      : "";
    return [
      `OmaPicks ${result.week}: skipped recalculation because this week's snapshot already exists and the taxonomy is unchanged.`,
      "Live feeds were not fetched or validated. This is the intentional weekly freeze, not a fresh finding of no leadership changes. Use --dry-run to check live candidates without publishing.",
      `The published snapshot keeps methodology ${published}.${pending}`
    ];
  }
  const changes = result.computedChanges ?? result.changes;
  const lines = [
    `OmaPicks ${result.week}: ranked ${result.rankings.types.length} app types; ` +
      `${changes.length} champion changes; ${result.report.uniqueUnclassifiedCount} unclassified.`
  ];
  lines.push(dryRun
    ? "Dry run: live candidates calculated against the published snapshot; no snapshot files written."
    : "Weekly refresh: validated live feeds and wrote the snapshot; unchanged picks do not mean unchanged data.");
  if (result.republished) {
    lines.push(dryRun
      ? "Republish requested: recalculated despite the weekly freeze, but this dry run still writes nothing."
      : "Deliberate republish: recalculated this week's snapshot despite the weekly freeze; earlier events this week are retained.");
  }
  lines.push(formatMethodology(result));
  if (result.validation) lines.push(result.validation);
  const exclusions = Object.entries(result.report?.excluded ?? {}).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  if (exclusions.length) lines.push(`Excluded listings by reason: ${exclusions.map(([reason, count]) => `${reason} ${count}`).join("; ")}.`);
  for (const warning of result.report?.builtInWarnings ?? []) lines.push(`  Built-in warning: ${warning}.`);
  if (result.rankings?.newListings) {
    const interval = result.rankings.newListingsInterval;
    lines.push(`${plural(result.rankings.newListings.length, "new listing")} in ranked categories since the ${interval.baselineWeek ?? "previous"} snapshot (${interval.since} to ${interval.until}).`);
  }
  for (const incumbent of result.report?.excludedIncumbents ?? []) {
    lines.push(`  Excluded incumbent: ${incumbent.typeName} ${incumbent.place} ${incumbent.name} (${incumbent.id}): ${incumbent.reason}.`);
  }
  const registry = result.rankings?.source?.registry;
  if (registry && registry.status !== "available") {
    lines.push(`Retirement registry unavailable (${registry.error}); removed picks are described neutrally as no longer in the catalog.`);
  }
  for (const id of result.retirementConflicts ?? []) {
    lines.push(`  Retirement conflict: ${id} is listed in the catalog and also retired in the registry; current catalog eligibility applies.`);
  }
  const warningCodes = Object.entries(result.upstreamWarnings ?? {});
  if (warningCodes.length) {
    lines.push(`Upstream catalog warnings: ${warningCodes.map(([code, count]) => `${code} ${count}`).join("; ")}.`);
  }
  const methodology = result.methodology ?? METHODOLOGY;
  lines.push(`Scores combine ${signalList(methodology)}, with sparse engagement dampened. Both places retain eligible incumbents unless a challenger scores strictly more than ${methodology.hysteresis * 100}% higher; runner-up selection excludes the champion.`);
  if (!changes.length) lines.push("No champion identities changed: the per-type decisions below explain which incumbents still lead and which were retained by the stability rule.");
  for (const change of changes) lines.push(`  Champion ${change.typeName}: ${formatPickName(change.previous)} -> ${formatPickName(change.current)}${formatReason(change)}`);
  if (result.changes.length !== changes.length) lines.push(`Weekly changelog retains ${result.changes.length} events, including earlier runs; this calculation has ${changes.length} champion changes.`);

  lines.push(
    `${formatCountDelta("Catalog", result.deltas.catalog)}; ${formatCountDelta("unclassified", result.deltas.unclassified)}.`
  );

  const runnerUpChanges = result.runnerUpChanges ?? [];
  const invertedRaces = result.invertedRaces ?? [];
  const invertedClause = invertedRaces.length
    ? `${plural(invertedRaces.length, "type")} where the raw-score leader is not champion (held by ${methodology.hysteresis * 100}% hysteresis)`
    : `${plural(0, "type")} where the raw-score leader is not champion`;
  lines.push(`${plural(runnerUpChanges.length, "runner-up change")}; ${invertedClause}.`);

  for (const change of runnerUpChanges) {
    lines.push(`  Runner-up ${change.typeName}: ${formatPickName(change.previous)} -> ${formatPickName(change.current)}${formatReason(change)}`);
  }
  const weeklyRunnerUps = result.weeklyRunnerUpChanges ?? runnerUpChanges;
  if (weeklyRunnerUps.length !== runnerUpChanges.length) {
    lines.push(`Weekly changelog retains ${plural(weeklyRunnerUps.length, "runner-up event")}, including earlier runs.`);
  }
  for (const race of invertedRaces) {
    lines.push(
      `  ${race.typeName}: ${race.leader.name} ${race.leader.score} leads champion ${race.champion.name} ${race.champion.score} by ${race.gapPercent.toFixed(1)}%.`
    );
  }
  for (const decision of result.decisions ?? []) {
    lines.push(`  ${decision.typeName} (${decision.eligibleCount} eligible): Champion: ${decision.champion} Runner-up: ${decision.runnerUp}`);
  }
  return lines;
}

async function removeStaleImages(rankings, root) {
  const directory = path.join(root, "data", "assets", "plugins");
  const current = new Set();
  for (const type of rankings.types) {
    for (const candidate of [type.winner, type.runnerUp]) {
      if (candidate?.localImage) current.add(path.basename(candidate.localImage));
    }
  }
  try {
    const files = await readdir(directory);
    await Promise.all(
      files
        .filter((file) => !current.has(file))
        .map((file) => rm(path.join(directory, file), { force: true }))
    );
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
}

// `republish` deliberately recalculates a week that already has a snapshot (for example after a
// methodology change). It still validates feeds and keeps the week's earlier changelog events.
export async function refresh({
  now = new Date(),
  dryRun = false,
  republish = false,
  minimumCatalogSize = 1_000,
  fetchImpl = fetch,
  root = ROOT,
  revision = null
} = {}) {
  const taxonomyFile = path.join(root, "data", "app-types.json");
  const rankingsFile = path.join(root, "data", "rankings.json");
  const previous = await readJson(rankingsFile, null);
  const taxonomy = await readJson(taxonomyFile);
  const taxonomySha = checksum(taxonomy);
  const week = isoWeek(now);
  const publishedMethodologyVersion = previous?.week ? previous.methodologyVersion ?? LEGACY_METHODOLOGY_VERSION : null;
  if (!dryRun && !republish && previous?.week === week && previous.source?.taxonomy?.sha256 === taxonomySha && previous.source?.taxonomy?.classificationVersion === CLASSIFICATION_VERSION) {
    return {
      changed: false,
      week,
      reason: "already-refreshed",
      publishedMethodologyVersion,
      currentMethodologyVersion: METHODOLOGY.version
    };
  }

  const [catalogResult, statsResult, registry] = await Promise.all([
    fetchJson(CATALOG_URL, { fetchImpl }),
    fetchJson(STATS_URL, { fetchImpl }),
    fetchRetirements(fetchImpl)
  ]);
  validateFeeds(catalogResult.body, statsResult.body, minimumCatalogSize, previous);

  const source = {
    catalog: {
      url: CATALOG_URL,
      generatedAt: catalogResult.body.generatedAt ?? null,
      etag: catalogResult.etag,
      lastModified: catalogResult.lastModified,
      sha256: checksum(catalogResult.body),
      count: catalogResult.body.plugins.length,
      stateSchemaVersion: catalogResult.body.stateSchemaVersion ?? null,
      mode: typeof catalogResult.body.mode === "string" ? catalogResult.body.mode : null,
      warningCount: catalogResult.body.warnings?.length ?? 0,
      builtInCount: catalogResult.body.plugins.filter((plugin) => plugin.sourceType === "builtin").length
    },
    stats: {
      url: STATS_URL,
      schemaVersion: statsResult.body.schemaVersion,
      etag: statsResult.etag,
      lastModified: statsResult.lastModified,
      sha256: checksum(statsResult.body),
      count: Object.keys(statsResult.body.plugins).length
    },
    taxonomy: {
      sha256: taxonomySha,
      classificationVersion: CLASSIFICATION_VERSION,
      typeCount: Array.isArray(taxonomy?.types) ? taxonomy.types.length : 0
    },
    registry: registrySource(registry)
  };

  const { rankings, report, decisions, exclusions, typeIdsById } = rankPlugins({
    catalog: catalogResult.body.plugins,
    stats: statsResult.body.plugins,
    taxonomy,
    previous,
    now,
    source,
    newListingsBaseline: await priorWeekBaseline(root, week)
  });
  const historyFile = path.join(root, "data", "history", `${week}.json`);
  const existingHistory = await readJson(historyFile, null);
  const context = changeContext({ catalog: catalogResult.body.plugins, registry, exclusions, typeIdsById });
  const computedChanges = changesBetween(previous, rankings, context);
  const changes = weekChangeLog(previous, week, existingHistory, computedChanges);
  const runnerUpChanges = runnerUpChangesBetween(previous, rankings, context);
  const weeklyRunnerUpChanges = weekChangeLog(previous, week, existingHistory, runnerUpChanges, "runnerUpChanges");
  const previousReport = await readJson(path.join(root, "data", "unclassified-report.json"), null);
  const previousState = await readJson(path.join(root, "data", "classification-state.json"), null);
  const auditInputs = { schemaVersion: 1, classificationVersion: CLASSIFICATION_VERSION, methodologyVersion: METHODOLOGY.version, codeRevision: revision, now: now.toISOString(), catalog: catalogResult, stats: statsResult, registry, taxonomy, previous, previousState };
  const classificationAudit = auditClassifications({ catalog: catalogResult.body.plugins, stats: statsResult.body.plugins, taxonomy, previous, previousState, now });
  classificationAudit.inputsHash = checksum(auditInputs);
  const summary = {
    changed: true,
    week,
    republished: republish && previous?.week === week,
    methodology: METHODOLOGY,
    publishedMethodologyVersion,
    rankings,
    report,
    changes,
    computedChanges,
    decisions,
    classificationAudit,
    auditInputs,
    validation: formatValidation(source, previous, catalogResult.body.plugins, statsResult.body.plugins, report),
    upstreamWarnings: upstreamWarningCodes(catalogResult.body.warnings),
    runnerUpChanges,
    weeklyRunnerUpChanges,
    retirementConflicts: registry.status === "available" ? registry.retiredPluginIds.filter((id) => context.catalogIds.has(id)) : [],
    invertedRaces: invertedRawScoreRaces(rankings),
    deltas: {
      catalog: countDelta(previous?.source?.catalog?.count, source.catalog.count),
      unclassified: countDelta(previousReport?.uniqueUnclassifiedCount, report.uniqueUnclassifiedCount)
    },
    imageWarnings: []
  };

  if (dryRun) return summary;

  const imageWarnings = await attachImages(rankings, { fetchImpl, previous, root });
  const history = {
    ...withoutLocalImages(rankings),
    changes,
    runnerUpChanges: weeklyRunnerUpChanges
  };
  await writeJsonAtomic(historyFile, history);
  await writeJsonAtomic(path.join(root, "data", "changelog.json"), {
    schemaVersion: 1,
    week,
    generatedAt: rankings.generatedAt,
    changes,
    runnerUpChanges: weeklyRunnerUpChanges
  });
  await writeJsonAtomic(path.join(root, "data", "unclassified-report.json"), report);
  await writeJsonAtomic(path.join(root, "data", "classification-state.json"), classificationAudit.state);
  await writeJsonAtomic(rankingsFile, rankings);
  await removeStaleImages(rankings, root);

  return { ...summary, imageWarnings };
}

async function main() {
  const args = process.argv.slice(2);
  const unknown = args.filter((arg) => !["--dry-run", "--republish"].includes(arg));
  if (unknown.length) throw new Error(`Unknown option: ${unknown.join(" ")}`);
  const dryRun = args.includes("--dry-run");
  const republish = args.includes("--republish");
  const result = await refresh({ dryRun, republish, revision: codeRevision() });
  const lines = formatRefreshLog(result, { dryRun });
  for (const line of lines) console.log(line);
  for (const warning of result.imageWarnings ?? []) console.warn(`Image warning: ${warning}`);
  if (result.classificationAudit) {
    const output = path.join(ROOT, "tmp", "classification-audit");
    await writeJsonAtomic(path.join(output, "inputs.json"), result.auditInputs);
    await writeJsonAtomic(path.join(output, "report.json"), result.classificationAudit);
    await writeFile(path.join(output, "report.md"), renderClassificationAudit(result.classificationAudit));
    const { changed, unresolved, assignments } = result.classificationAudit.counts;
    lines.push(`Classification: ${assignments} task-fit assignments; ${changed} changed listings; ${unresolved} held assignments. Full evidence: tmp/classification-audit/report.json`);
    console.log(lines.at(-1));
  }
  if (process.env.GITHUB_STEP_SUMMARY) {
    const escape = (line) => line.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
    await appendFile(process.env.GITHUB_STEP_SUMMARY, `<pre>${lines.map(escape).join("\n")}</pre>\n`);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error.stack || error.message);
    process.exitCode = 1;
  });
}
