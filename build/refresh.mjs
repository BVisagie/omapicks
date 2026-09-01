import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { changesBetween, isoWeek, rankPlugins } from "./rank.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CATALOG_URL = "https://plugins.omarchy.org/catalog.json";
const STATS_URL = "https://api.omarchyplugins.com/v1/stats";
const MAX_IMAGE_BYTES = 2 * 1024 * 1024;

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

export function validateFeeds(catalogFeed, statsFeed, minimumCatalogSize) {
  if (!catalogFeed || !Array.isArray(catalogFeed.plugins)) throw new Error("Catalog feed is missing plugins[]");
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
  if (!statsFeed || statsFeed.schemaVersion !== 1 || !statsFeed.plugins || Array.isArray(statsFeed.plugins)) {
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
}

async function readJson(file, fallback = null) {
  try {
    return JSON.parse(await readFile(file, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") return fallback;
    throw error;
  }
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

async function attachImages(rankings, options) {
  const seen = new Map();
  const warnings = [];
  for (const type of rankings.types) {
    for (const candidate of [type.winner, type.runnerUp]) {
      if (!candidate) continue;
      if (seen.has(candidate.id)) {
        candidate.localImage = seen.get(candidate.id);
        continue;
      }
      try {
        candidate.localImage = await downloadImage(candidate, options);
      } catch (error) {
        candidate.localImage = null;
        warnings.push(`${candidate.id}: ${error.message}`);
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

function weekChangeLog(previous, week, existingHistory, computedChanges) {
  const prior = existingHistory?.changes;
  if (previous?.week !== week || !Array.isArray(prior) || prior.length === 0) return computedChanges;
  if (computedChanges.length === 0) return prior;
  return [...prior, ...computedChanges];
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

export async function refresh({
  now = new Date(),
  dryRun = false,
  minimumCatalogSize = 1_000,
  fetchImpl = fetch,
  root = ROOT
} = {}) {
  const taxonomyFile = path.join(root, "data", "app-types.json");
  const rankingsFile = path.join(root, "data", "rankings.json");
  const previous = await readJson(rankingsFile, null);
  const taxonomy = await readJson(taxonomyFile);
  const taxonomySha = checksum(taxonomy);
  const week = isoWeek(now);
  if (!dryRun && previous?.week === week && previous.source?.taxonomy?.sha256 === taxonomySha) {
    return { changed: false, week, reason: "already-refreshed" };
  }

  const [catalogResult, statsResult] = await Promise.all([
    fetchJson(CATALOG_URL, { fetchImpl }),
    fetchJson(STATS_URL, { fetchImpl })
  ]);
  validateFeeds(catalogResult.body, statsResult.body, minimumCatalogSize);

  const source = {
    catalog: {
      url: CATALOG_URL,
      generatedAt: catalogResult.body.generatedAt ?? null,
      etag: catalogResult.etag,
      lastModified: catalogResult.lastModified,
      sha256: checksum(catalogResult.body),
      count: catalogResult.body.plugins.length
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
      typeCount: Array.isArray(taxonomy?.types) ? taxonomy.types.length : 0
    }
  };

  const { rankings, report } = rankPlugins({
    catalog: catalogResult.body.plugins,
    stats: statsResult.body.plugins,
    taxonomy,
    previous,
    now,
    source
  });
  const historyFile = path.join(root, "data", "history", `${week}.json`);
  const existingHistory = await readJson(historyFile, null);
  const computedChanges = changesBetween(previous, rankings);
  const changes = weekChangeLog(previous, week, existingHistory, computedChanges);

  if (dryRun) {
    return { changed: true, week, rankings, report, changes, imageWarnings: [] };
  }

  const imageWarnings = await attachImages(rankings, { fetchImpl, root });
  const history = {
    ...withoutLocalImages(rankings),
    changes
  };
  await writeJsonAtomic(historyFile, history);
  await writeJsonAtomic(path.join(root, "data", "changelog.json"), {
    schemaVersion: 1,
    week,
    generatedAt: rankings.generatedAt,
    changes
  });
  await writeJsonAtomic(path.join(root, "data", "unclassified-report.json"), report);
  await writeJsonAtomic(rankingsFile, rankings);
  await removeStaleImages(rankings, root);

  return { changed: true, week, rankings, report, changes, imageWarnings };
}

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  const result = await refresh({ dryRun });
  if (!result.changed) {
    console.log(`OmaPicks ${result.week}: no refresh needed (${result.reason}).`);
    return;
  }
  console.log(
    `OmaPicks ${result.week}: ranked ${result.rankings.types.length} app types; ` +
      `${result.changes.length} champion changes; ${result.report.uniqueUnclassifiedCount} unclassified.`
  );
  for (const warning of result.imageWarnings) console.warn(`Image warning: ${warning}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error.stack || error.message);
    process.exitCode = 1;
  });
}
