import { appendFile, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { boundedFetch, fetchJson } from "./refresh.mjs";
import { verificationCoverage } from "./rank.mjs";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const CATALOG_URL = "https://plugins.omarchy.org/catalog.json";
const DAY = 86400000;
const repository = (value) => String(value ?? "").toLowerCase().replace(/\.git\/?$/, "").replace(/\/+$/, "");

export function availabilityFor(rankings, catalog, { now = new Date(), minimumCatalogSize = 1000 } = {}) {
  if (!Array.isArray(rankings?.types)) throw new Error("Availability requires a ranking snapshot");
  if (catalog?.stateSchemaVersion !== 2 || !Array.isArray(catalog.plugins)) throw new Error("Unsupported availability catalog");
  const generated = Date.parse(catalog.generatedAt);
  if (!Number.isFinite(generated) || generated > now.getTime() + 300000 || generated < now.getTime() - 3 * DAY) throw new Error("Availability catalog timestamp is missing, stale or in the future");
  const minimum = Math.max(minimumCatalogSize, Math.ceil((rankings.source?.catalog?.count ?? 0) * 0.75));
  if (catalog.plugins.length < minimum) throw new Error(`Availability catalog has ${catalog.plugins.length} entries; expected at least ${minimum}`);
  const listings = new Map();
  for (const plugin of catalog.plugins) {
    if (!plugin || typeof plugin.id !== "string" || !/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(plugin.id) || listings.has(plugin.id)) throw new Error("Availability catalog contains an invalid or duplicate ID");
    listings.set(plugin.id, plugin);
  }
  const picks = new Map(rankings.types.flatMap((type) => [type.winner, type.runnerUp, ...(type.alternatives ?? [])].filter(Boolean)).map((pick) => [pick.id, pick]));
  const checkedAt = now.toISOString();
  const plugins = Object.fromEntries([...picks].sort(([a], [b]) => a.localeCompare(b)).map(([id, pick]) => {
    const plugin = listings.get(id);
    let reason = null;
    let status = "available";
    if (!plugin) reason = "missing-from-catalog";
    else if (repository(plugin.repo) !== repository(pick.repository)) reason = "repository-changed";
    else if (plugin.upstreamCheckStatus === "failed") reason = "compatibility-failed";
    else if (plugin.upstreamCheckStatus === "unreachable") reason = "repository-unreachable";
    else if (plugin.installAvailable !== true || typeof plugin.installCommand !== "string" || !plugin.installCommand.trim()) reason = "not-installable";
    else if (plugin.upstreamCheckStatus !== "passed") { status = "unknown"; reason = "check-unavailable"; }
    if (reason && status !== "unknown") status = "unavailable";
    return [id, { status, reason, checkedAt, verificationCoverage: plugin ? verificationCoverage(plugin) : "unverified" }];
  }));
  return { schemaVersion: 1, generatedAt: checkedAt, catalogGeneratedAt: catalog.generatedAt, rankingsGeneratedAt: rankings.generatedAt,
    source: CATALOG_URL, plugins };
}

export async function refreshAvailability({ root = ROOT, now = new Date(), fetchImpl = fetch, minimumCatalogSize = 1000, summaryFile = process.env.GITHUB_STEP_SUMMARY } = {}) {
  const rankings = JSON.parse(await readFile(path.join(root, "data/rankings.json"), "utf8"));
  const result = await fetchJson(CATALOG_URL, { fetchImpl: (url, options) => boundedFetch(fetchImpl, url, options) });
  const current = availabilityFor(rankings, result.body, { now, minimumCatalogSize });
  const file = path.join(root, "data/availability.json");
  let previous;
  try { previous = JSON.parse(await readFile(file, "utf8")); } catch (error) { if (error.code !== "ENOENT") throw error; }
  if (previous?.catalogGeneratedAt && Date.parse(previous.catalogGeneratedAt) > Date.parse(current.catalogGeneratedAt)) throw new Error("Availability catalog moved backwards; preserving the last observation");
  // Repeated reads of the same upstream snapshot add no new observation and need no commit.
  const unchanged = previous?.rankingsGeneratedAt === current.rankingsGeneratedAt && previous?.catalogGeneratedAt === current.catalogGeneratedAt &&
    JSON.stringify(Object.entries(previous.plugins ?? {}).map(([id, { checkedAt, ...observation }]) => [id, observation])) ===
    JSON.stringify(Object.entries(current.plugins).map(([id, { checkedAt, ...observation }]) => [id, observation]));
  if (!unchanged) {
    await mkdir(path.dirname(file), { recursive: true });
    const temporary = `${file}.${process.pid}.tmp`;
    await writeFile(temporary, JSON.stringify(current, null, 2) + "\n");
    await rename(temporary, file);
  }
  const counts = Object.values(current.plugins).reduce((result, observation) => ({ ...result, [observation.status]: (result[observation.status] ?? 0) + 1 }), {});
  const summary = `Availability ${unchanged ? "unchanged" : "updated"}: ${counts.available ?? 0} available, ${counts.unavailable ?? 0} unavailable, ${counts.unknown ?? 0} unknown. Catalog observed ${current.catalogGeneratedAt}. Weekly rankings and history are unchanged.`;
  if (summaryFile) await appendFile(summaryFile, `\n### Current availability\n\n${summary}\n`);
  return { changed: !unchanged, availability: unchanged ? previous : current, summary };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  refreshAvailability().then((result) => console.log(result.summary)).catch(async (error) => {
    console.error(error.message);
    if (process.env.GITHUB_STEP_SUMMARY) await appendFile(process.env.GITHUB_STEP_SUMMARY, "\n### Availability update failed\n\nThe previous observation remains published. This failure is not evidence that the plugins are unavailable. Inspect the failed step and the last observation time.\n");
    process.exitCode = 1;
  });
}
