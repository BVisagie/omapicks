import { createHash } from "node:crypto";
import { CURRENT_METHODOLOGY_VERSION, methodologyFor, snapshotMethodology } from "./methodology.mjs";
import { explainTaskFit, prepareTaskReviews, preserveTaskReviewHistory, taskMetadataHash, validateTaskContracts } from "./task-fit.mjs";
import { taskDefinitionChanged } from "./category-migrations.mjs";

export { methodologyFor, snapshotMethodology } from "./methodology.mjs";

const DAY_MS = 86_400_000;
export const CLASSIFICATION_VERSION = 3;

// The rules new snapshots are calculated with. Rendering uses the snapshot's own definition.
export const METHODOLOGY = methodologyFor(CURRENT_METHODOLOGY_VERSION);

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function finiteCount(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : 0;
}

// Coverage relates a verified snapshot to the upstream commit the marketplace last observed.
const COVERAGE_STATES = new Set(["snapshot-verified", "update-unverified", "unverified"]);

// Shared by scoring, snapshots and rendering so a plugin's credit and badge always agree. Older
// feeds and snapshots carry only verificationStatus; unknown explicit values earn nothing.
export function verificationCoverage(plugin) {
  const explicit = plugin?.verificationCoverage;
  if (explicit != null) return COVERAGE_STATES.has(explicit) ? explicit : "unverified";
  return plugin?.verificationStatus === "verified" ? "snapshot-verified" : "unverified";
}

export function verificationCredit(plugin, methodology = METHODOLOGY) {
  if (methodology.verification.rule === "status") return plugin?.verificationStatus === "verified" ? 1 : 0;
  const coverage = verificationCoverage(plugin);
  if (coverage === "snapshot-verified") return 1;
  return coverage === "update-unverified" ? methodology.verification.updateUnverifiedCredit : 0;
}

// Mirrors engagementCount in the marketplace's site/assets/js/shared.js (commit fec33e6b).
function engagementCount(value) {
  const count = Math.trunc(Number(value));
  return Number.isSafeInteger(count) && count >= 0 ? count : 0;
}

// Install-command copies per detail view, capped at 100%: copies can also come from cards
// without a detail view. An engagement proxy, not a measured installation rate.
export function copyViewRatio(copies, views) {
  const viewCount = engagementCount(views);
  return viewCount ? Math.min(engagementCount(copies), viewCount) / viewCount : null;
}

// Lower bound of the 95% Wilson interval for the capped ratio, matching the rated values of the
// marketplace's installRateScore (fec33e6b). Unrated observations are null rather than -1.
export function installRateLowerBound(copies, views, { minimumViews = 20, z = 1.96 } = {}) {
  const viewCount = engagementCount(views);
  if (viewCount < Math.max(1, minimumViews)) return null;
  const copyCount = Math.min(engagementCount(copies), viewCount);
  if (!copyCount) return 0;
  const rate = copyCount / viewCount;
  const center = rate + (z * z) / (2 * viewCount);
  const margin = z * Math.sqrt((rate * (1 - rate) + (z * z) / (4 * viewCount)) / viewCount);
  return (center - margin) / (1 + (z * z) / viewCount);
}

function timestamp(value) {
  return typeof value === "string" ? Date.parse(value) : Number.NaN;
}

// The latest observation that something shipped: a manifest version change seen by the catalog
// refresh, or a dated repository release (which may cover other plugins in a shared repository).
export function shippedAt(plugin) {
  const times = [plugin?.versionUpdatedAt, plugin?.repositoryRelease?.publishedAt].map(timestamp).filter(Number.isFinite);
  return times.length ? new Date(Math.max(...times)).toISOString() : null;
}

function compilePatterns(patterns, label) {
  assert(Array.isArray(patterns) && patterns.length > 0, `${label} must be a non-empty array`);
  return patterns.map((pattern, index) => {
    assert(typeof pattern === "string" && pattern.length > 0, `${label}[${index}] must be a string`);
    try {
      return new RegExp(pattern, "iu");
    } catch (error) {
      throw new Error(`${label}[${index}] is invalid: ${error.message}`);
    }
  });
}

export function prepareTaxonomy(taxonomy) {
  assert(taxonomy?.schemaVersion === 1, "Unsupported taxonomy schemaVersion");
  assert(Array.isArray(taxonomy.types), "Taxonomy types must be an array");
  const ids = new Set();
  const types = taxonomy.types.map((type, index) => {
    const label = `types[${index}]`;
    assert(/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(type.id), `${label}.id must be a slug`);
    assert(!ids.has(type.id), `Duplicate taxonomy id: ${type.id}`);
    ids.add(type.id);
    assert(typeof type.name === "string" && type.name.length > 0, `${label}.name is required`);
    assert(type.exclusionScope == null || ["field", "clause"].includes(type.exclusionScope), `${label}.exclusionScope is invalid`);
    // Omarchy built-ins shown beside a category's picks. Display only: never classified or ranked.
    assert(type.builtIns == null || (Array.isArray(type.builtIns) &&
      type.builtIns.every((id) => typeof id === "string" && id.length > 0)), `${label}.builtIns must be an array of plugin IDs`);
    return {
      ...type,
      includePatterns: compilePatterns(type.include, `${label}.include`),
      namePatterns: type.nameInclude == null || (Array.isArray(type.nameInclude) && !type.nameInclude.length) ? [] : compilePatterns(type.nameInclude, `${label}.nameInclude`),
      excludePatterns: type.exclude == null || (Array.isArray(type.exclude) && type.exclude.length === 0)
        ? [] : compilePatterns(type.exclude, `${label}.exclude`)
    };
  });

  const overrides = taxonomy.overrides ?? {};
  for (const group of ["include", "exclude", "review"]) {
    assert(overrides[group] == null || (typeof overrides[group] === "object" && !Array.isArray(overrides[group])), `overrides.${group} must be an object`);
    for (const [pluginId, typeIds] of Object.entries(overrides[group] ?? {})) {
      assert(pluginId.length > 0 && Array.isArray(typeIds), `Invalid overrides.${group} entry`);
      for (const typeId of typeIds) assert(ids.has(typeId), `Unknown override type: ${typeId}`);
    }
  }
  for (const [pluginId, reasons] of Object.entries(overrides.reasons ?? {})) {
    assert(reasons && typeof reasons === "object" && !Array.isArray(reasons), `Invalid reasons for ${pluginId}`);
    for (const [typeId, reason] of Object.entries(reasons)) {
      assert(ids.has(typeId), `Unknown reason type: ${typeId}`);
      assert(typeof reason === "string" && reason.trim().length > 0, `Missing reason for ${pluginId}/${typeId}`);
    }
  }
  const discoveryExclusions = new Map(), discoveryInclusions = new Map();
  for (const [field, destination] of [["discoveryExclude", discoveryExclusions], ["discoveryInclude", discoveryInclusions]]) {
    assert(overrides[field] == null || Array.isArray(overrides[field]), `overrides.${field} must be an array`);
    for (const entry of overrides[field] ?? []) {
      assert(typeof entry.pluginId === "string" && entry.pluginId.length && ids.has(entry.typeId), "Invalid discovery override target");
      assert(/^[a-f0-9]{64}$/.test(entry.listingSha256), "Discovery override requires a listing hash");
      assert(typeof entry.reason === "string" && entry.reason.trim().length, "Discovery override requires a reason");
      const key = `${entry.pluginId}/${entry.typeId}`;
      assert(!discoveryExclusions.has(key) && !discoveryInclusions.has(key), `Duplicate discovery override: ${key}`);
      destination.set(key, entry);
    }
  }
  return { types, discoveryExclusions, discoveryInclusions, overrides: { include: overrides.include ?? {}, exclude: overrides.exclude ?? {}, review: overrides.review ?? {}, reasons: overrides.reasons ?? {} } };
}

function matchedEvidence(patterns, fields, rule, version = CLASSIFICATION_VERSION) {
  const evidence = [];
  for (const [field, value] of Object.entries(fields)) {
    if (typeof value !== "string") continue;
    const captions = version >= 3 && rule !== "exclude"
      ? [...value.matchAll(/\b(?:(?:the|this)\s+)?(?:screenshots?|preview(?: image)?|images?)\s+(?:shows?|depicts?|illustrates?)\b/giu)] : [];
    for (const pattern of patterns) {
      const matches = version < 3 ? [pattern.exec(value)].filter(Boolean) : [...value.matchAll(new RegExp(pattern.source, "giu"))];
      for (const match of matches) {
        const start = match.index;
        const before = value.slice(0, start);
        const clauseStart = Math.max(before.lastIndexOf(","), before.lastIndexOf(";"), before.lastIndexOf("."), before.lastIndexOf("\n")) + 1;
        const after = value.slice(start + match[0].length);
        const end = after.search(/[,;.\n]/);
        const context = value.slice(clauseStart, end < 0 ? value.length : start + match[0].length + end);
        const negated = rule !== "exclude" && /\b(?:no|not|without|never|does(?:n['’]t| not)|do(?:n['’]t| not))\s+(?:any\s+)?$/iu.test(before.slice(-50));
        const preview = captions.some((caption) => start >= caption.index && start + match[0].length <= caption.index + caption[0].length);
        evidence.push({ rule, pattern: pattern.source, field, match: match[0], ...(version >= 3 ? { context: context.trim(), ignored: negated ? "negated-capability" : preview ? "preview-reference" : null } : {}) });
      }
    }
  }
  return evidence;
}

// Catalog-only editorial overrides expire on any name/description change. They only
// change raw discovery, never grant qualification or veto a source-qualified/related task.
export const discoveryListingHash = (plugin) => createHash("sha256")
  .update(JSON.stringify(plugin ? { id: plugin.id, name: plugin.name, description: plugin.description } : null)).digest("hex");

export function discoveryCurationStatus(catalog, preparedTaxonomy) {
  const plugins = new Map(catalog.map((plugin) => [plugin.id, plugin]));
  const result = { activeIncludes: 0, activeExcludes: 0, expired: [] };
  for (const [action, records] of [["include", preparedTaxonomy.discoveryInclusions], ["exclude", preparedTaxonomy.discoveryExclusions]]) {
    for (const entry of records.values()) {
      const plugin = plugins.get(entry.pluginId);
      if (plugin && discoveryListingHash(plugin) === entry.listingSha256) {
        result[action === "include" ? "activeIncludes" : "activeExcludes"]++;
      } else result.expired.push({ pluginId: entry.pluginId, typeId: entry.typeId, action,
        reason: plugin ? "listing-changed" : "listing-unavailable" });
    }
  }
  return result;
}

// Match fields separately: concatenation can manufacture phrases across field boundaries.
// Tags, kind and upstream category are context for reviewers, never eligibility evidence.
export function explainClassification(plugin, preparedTaxonomy, version = CLASSIFICATION_VERSION, taskReviews = null) {
  assert([2, 3].includes(version), `Unsupported classifier version: ${version}`);
  const fields = { name: plugin.name, description: plugin.description };
  const forced = new Set(preparedTaxonomy.overrides.include[plugin.id] ?? []);
  const blocked = new Set(preparedTaxonomy.overrides.exclude[plugin.id] ?? []);
  const review = new Set(preparedTaxonomy.overrides.review[plugin.id] ?? []);
  const listingHash = (preparedTaxonomy.discoveryExclusions.size || preparedTaxonomy.discoveryInclusions.size) ? discoveryListingHash(plugin) : null;
  return preparedTaxonomy.types.map((type) => {
    const exclusion = preparedTaxonomy.discoveryExclusions.get(`${plugin.id}/${type.id}`);
    const discoveryExclusion = exclusion?.listingSha256 === listingHash ? exclusion : null;
    const inclusion = preparedTaxonomy.discoveryInclusions.get(`${plugin.id}/${type.id}`);
    const discoveryInclusion = inclusion?.listingSha256 === listingHash ? inclusion : null;
    const evidence = [
      ...matchedEvidence(type.includePatterns, fields, "include", version),
      ...matchedEvidence(type.namePatterns, { name: plugin.name }, "nameInclude", version)
    ];
    const positive = evidence.filter((match) => !match.ignored);
    const exclusions = matchedEvidence(type.excludePatterns, fields, "exclude", version);
    const allowed = version >= 3 && type.exclusionScope === "clause"
      ? positive.filter((match) => !type.excludePatterns.some((pattern) => pattern.test(match.context))) : exclusions.length ? [] : positive;
    const taskFit = taskReviews ? explainTaskFit(plugin, type, taskReviews) : null;
    const decision = review.has(type.id) ? "review" : blocked.has(type.id) ? "override-exclude"
      : taskFit?.status === "rejected" ? "task-rejected"
        : taskFit?.qualified || taskFit?.status === "related" ? "reviewed-task"
          : discoveryExclusion ? "discovery-exclude" : discoveryInclusion ? "discovery-include" : forced.has(type.id) ? "override-include" : allowed.length ? "task-match"
        : exclusions.length ? "excluded" : "no-task-evidence";
    return {
      typeId: type.id,
      accepted: ["override-include", "discovery-include", "task-match", "reviewed-task"].includes(decision),
      decision,
      evidence,
      exclusions,
      reason: decision === "discovery-exclude" ? discoveryExclusion.reason : decision === "discovery-include" ? discoveryInclusion.reason : preparedTaxonomy.overrides.reasons[plugin.id]?.[type.id] ?? taskFit?.reason ?? null,
      ...(taskFit ? { taskFit } : {})
    };
  });
}

export function classifyPlugin(plugin, preparedTaxonomy, version = CLASSIFICATION_VERSION, taskReviews = null) {
  return explainClassification(plugin, preparedTaxonomy, version, taskReviews).filter((match) => match.accepted).map((match) => match.typeId);
}

// Health and built-in checks precede installability: failed listings also lose their install
// command upstream, and built-ins never had one, so "not-installable" would hide the real reason.
export function eligibilityReason(plugin, methodology = METHODOLOGY) {
  if (!plugin || typeof plugin.id !== "string" || !plugin.id) return "invalid-id";
  if (plugin.sourceType === "builtin" || plugin.builtIn === true) return "built-in";
  if (methodology.eligibility.upstreamHealth) {
    // A missing check result (older feeds) is not evidence of a problem, nor of a passed check.
    if (plugin.upstreamCheckStatus === "failed") return "compatibility-failed";
    if (plugin.upstreamCheckStatus === "unreachable") return "repository-unreachable";
  }
  if (["retired", "delisted"].includes(String(plugin.status).toLowerCase())) return "retired";
  if (plugin.installAvailable !== true || typeof plugin.installCommand !== "string" || !plugin.installCommand.trim()) {
    return "not-installable";
  }
  if (typeof plugin.repo !== "string" || !plugin.repo.startsWith("https://")) return "invalid-repository";
  return null;
}

function percentileMap(valuesById) {
  const entries = [...valuesById.entries()].sort((a, b) => a[1] - b[1] || a[0].localeCompare(b[0]));
  if (entries.length <= 1) return new Map(entries.map(([id]) => [id, 0.5]));
  const result = new Map();
  let start = 0;
  while (start < entries.length) {
    let end = start;
    while (end + 1 < entries.length && entries[end + 1][1] === entries[start][1]) end += 1;
    const averageIndex = (start + end) / 2;
    const percentile = averageIndex / (entries.length - 1);
    for (let index = start; index <= end; index += 1) result.set(entries[index][0], percentile);
    start = end + 1;
  }
  return result;
}

function quantile(sortedValues, percentile) {
  if (sortedValues.length === 0) return 0;
  const index = (sortedValues.length - 1) * percentile;
  const lower = Math.floor(index);
  const fraction = index - lower;
  return sortedValues[lower] + (sortedValues[Math.min(lower + 1, sortedValues.length - 1)] - sortedValues[lower]) * fraction;
}

function normalizedSignalMap(valuesById, methodology) {
  const logged = new Map([...valuesById].map(([id, value]) => [id, Math.log1p(value)]));
  const { percentileShare, scaleQuantile } = methodology.normalization;
  const percentiles = percentileMap(logged);
  const scale = quantile([...logged.values()].sort((a, b) => a - b), scaleQuantile);
  return new Map(
    [...logged].map(([id, value]) => {
      const robustScale = scale > 0 ? Math.min(1, value / scale) : 0.5;
      return [id, percentileShare * percentiles.get(id) + (1 - percentileShare) * robustScale];
    })
  );
}

function decay(time, now, halfLifeDays) {
  const ageDays = Math.max(0, (now.getTime() - time) / DAY_MS);
  return Math.exp((-Math.log(2) * ageDays) / halfLifeDays);
}

export function freshnessDetail(plugin, now, methodology = METHODOLOGY) {
  const { halfLifeDays, shippingBonus } = methodology.freshness;
  const pushed = timestamp(plugin?.repositoryUpdatedAt);
  if (!shippingBonus) {
    const value = Number.isFinite(pushed) ? decay(pushed, now, halfLifeDays) : 0;
    return { base: value, bonus: 0, uncapped: value, value };
  }
  const shipped = timestamp(shippedAt(plugin));
  const latest = Math.max(...[pushed, shipped].filter(Number.isFinite));
  const base = Number.isFinite(latest) ? decay(latest, now, halfLifeDays) : 0;
  const withinWindow = Number.isFinite(shipped) && Math.max(0, (now.getTime() - shipped) / DAY_MS) <= shippingBonus.windowDays;
  const bonus = withinWindow ? shippingBonus.amount * decay(shipped, now, shippingBonus.halfLifeDays) : 0;
  return { base, bonus, uncapped: base + bonus, value: Math.min(1, base + bonus) };
}

function evidenceCount(metrics, methodology) {
  const { viewWeight, viewCap } = methodology.evidence;
  return metrics.copies + metrics.hearts + Math.min(metrics.views * viewWeight, viewCap);
}

function round(value, places = 6) {
  const scale = 10 ** places;
  return Math.round(value * scale) / scale;
}

function isoOrNull(value) {
  const time = timestamp(value);
  return Number.isFinite(time) ? new Date(time).toISOString() : null;
}

function publicCandidate(plugin, metrics, score, normalized, contributions, now, methodology) {
  const preview = typeof plugin.previewThumbnail === "string" ? plugin.previewThumbnail : plugin.previewImage;
  const previewSource = preview
    ? new URL(preview, "https://plugins.omarchy.org/").href
    : null;
  return {
    id: plugin.id,
    name: String(plugin.name || plugin.id),
    description: String(plugin.description || ""),
    author: String(plugin.author || ""),
    category: String(plugin.category || ""),
    repository: plugin.repo,
    upstreamObservedCommit: plugin.upstreamObservedCommit ?? null,
    detailUrl: `https://plugins.omarchy.org/plugin.html?id=${encodeURIComponent(plugin.id)}`,
    installCommand: plugin.installCommand.trim(),
    verificationStatus: String(plugin.verificationStatus || "unverified"),
    verificationCoverage: verificationCoverage(plugin),
    verificationMethod: typeof plugin.verificationMethod === "string" ? plugin.verificationMethod : null,
    upstreamCheckStatus: typeof plugin.upstreamCheckStatus === "string" ? plugin.upstreamCheckStatus : null,
    version: typeof plugin.version === "string" && plugin.version.trim() ? plugin.version.trim() : null,
    releaseTag: typeof plugin.repositoryRelease?.tag === "string" && plugin.repositoryRelease.tag.trim() ? plugin.repositoryRelease.tag.trim() : null,
    shippedAt: shippedAt(plugin),
    listedAt: isoOrNull(plugin.listedAt),
    license: String(plugin.license || "Unknown"),
    repositoryUpdatedAt: Number.isFinite(Date.parse(plugin.repositoryUpdatedAt))
      ? new Date(plugin.repositoryUpdatedAt).toISOString()
      : null,
    previewSource,
    previewWidth: finiteCount(plugin.previewThumbnailWidth || plugin.previewWidth) || null,
    previewHeight: finiteCount(plugin.previewThumbnailHeight || plugin.previewHeight) || null,
    localImage: null,
    metrics: {
      ...metrics,
      copyViewRatio: metrics.copyViewRatio == null ? null : round(metrics.copyViewRatio, 4),
      installRateLowerBound: metrics.installRateLowerBound == null ? null : round(metrics.installRateLowerBound, 4)
    },
    normalized,
    contributions,
    evidence: round(evidenceCount(metrics, methodology) / (evidenceCount(metrics, methodology) + methodology.priorStrength)),
    freshnessDays: Number.isFinite(Date.parse(plugin.repositoryUpdatedAt))
      ? Math.max(0, Math.floor((now.getTime() - Date.parse(plugin.repositoryUpdatedAt)) / DAY_MS))
      : null,
    score: round(score)
  };
}

// Rates are already on [0, 1], so no log1p. Only rated observations enter the percentile and scale
// maps; unrated candidates sit at the neutral midpoint before reliability damping.
function rateSignalMap(valuesById, methodology) {
  const rated = new Map([...valuesById].filter(([, value]) => value !== null));
  const { percentileShare, scaleQuantile } = methodology.normalization;
  const percentiles = percentileMap(rated);
  const scale = quantile([...rated.values()].sort((a, b) => a - b), scaleQuantile);
  return new Map([...valuesById].map(([id, value]) => {
    if (value === null) return [id, 0.5];
    const robustScale = scale > 0 ? Math.min(1, value / scale) : 0.5;
    return [id, percentileShare * percentiles.get(id) + (1 - percentileShare) * robustScale];
  }));
}

function scoreCohort(plugins, stats, now, methodology) {
  const raw = new Map();
  for (const plugin of plugins) {
    const engagement = stats[plugin.id] ?? {};
    raw.set(plugin.id, {
      copies: finiteCount(engagement.copies),
      hearts: finiteCount(engagement.hearts),
      stars: finiteCount(plugin.stars),
      views: finiteCount(engagement.views),
      copyViewRatio: copyViewRatio(engagement.copies, engagement.views),
      installRateLowerBound: installRateLowerBound(engagement.copies, engagement.views, methodology.installRate ?? undefined)
    });
  }

  const percentiles = {};
  for (const metric of ["copies", "hearts", "stars", "views"]) {
    percentiles[metric] = normalizedSignalMap(new Map([...raw].map(([id, metrics]) => [id, metrics[metric]])), methodology);
  }
  const scoredRates = methodology.installRate
    ? rateSignalMap(new Map([...raw].map(([id, metrics]) => [id, metrics.installRateLowerBound])), methodology)
    : null;

  return plugins
    .map((plugin) => {
      const metrics = raw.get(plugin.id);
      const evidence = evidenceCount(metrics, methodology);
      const reliability = evidence / (evidence + methodology.priorStrength);
      const normalized = {};
      for (const metric of ["copies", "hearts", "stars", "views"]) {
        normalized[metric] = round(0.5 + reliability * (percentiles[metric].get(plugin.id) - 0.5));
      }
      if (scoredRates) normalized.installRateLowerBound = round(0.5 + reliability * (scoredRates.get(plugin.id) - 0.5));
      normalized.freshness = round(freshnessDetail(plugin, now, methodology).value);
      normalized.verified = verificationCredit(plugin, methodology);

      const contributions = {};
      let score = 0;
      for (const [metric, weight] of Object.entries(methodology.weights)) {
        contributions[metric] = round(normalized[metric] * weight);
        score += contributions[metric];
      }
      return publicCandidate(plugin, metrics, score, normalized, contributions, now, methodology);
    })
    .sort(
      (a, b) =>
        b.score - a.score ||
        b.metrics.copies - a.metrics.copies ||
        b.metrics.hearts - a.metrics.hearts ||
        b.metrics.stars - a.metrics.stars ||
        a.id.localeCompare(b.id)
    );
}

export function pickWithHysteresis(candidates, incumbentId, excludedIds = new Set(), methodology = METHODOLOGY) {
  const available = candidates.filter((candidate) => !excludedIds.has(candidate.id));
  const challenger = available[0] ?? null;
  if (methodology.hysteresis === 0) return challenger;
  const incumbent = available.find((candidate) => candidate.id === incumbentId);
  if (!incumbent || !challenger || incumbent.id === challenger.id) return challenger;
  return challenger.score > incumbent.score * (1 + methodology.hysteresis) ? challenger : incumbent;
}

export function explainPick(candidates, incumbentId, selected, excludedIds = new Set(), methodology = METHODOLOGY) {
  const available = candidates.filter((candidate) => !excludedIds.has(candidate.id));
  const incumbent = available.find((candidate) => candidate.id === incumbentId);
  const challenger = available[0];
  const threshold = methodology.hysteresis * 100;
  if (!selected) return "No eligible candidates remain for this place.";
  if (methodology.hysteresis === 0) return `${selected.name} (${selected.score}) is the highest-ranked available candidate; ties use copies, hearts, stars, then ID. Weekly publication provides stability.`;
  if (!incumbent) return `${selected.name} (${selected.score}) is the highest-ranked available candidate; ${incumbentId ? "the previous pick is no longer available for this place" : "there was no previous pick"}.`;
  if (incumbent.id === challenger.id) return `${selected.name} (${selected.score}) remains highest-ranked${available.length === 1 ? " and is the only available candidate" : "; score ties use copies, hearts, stars, then ID"}.`;
  const comparison = `${challenger.name} (${challenger.score}) versus incumbent ${incumbent.name} (${incumbent.score}); replacement requires a score strictly above ${incumbent.score * (1 + methodology.hysteresis)} (+${threshold}%)`;
  return `${selected.id === incumbent.id ? "Incumbent retained" : "Challenger replaces incumbent"}: ${comparison}.`;
}

export function isoWeek(date) {
  const target = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const day = target.getUTCDay() || 7;
  target.setUTCDate(target.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(target.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((target - yearStart) / DAY_MS + 1) / 7);
  return `${target.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

function builtInRef(plugin) {
  const sourceUrl = typeof plugin.sourceUrl === "string" && plugin.sourceUrl.startsWith("https://") ? plugin.sourceUrl : null;
  return {
    id: plugin.id,
    name: String(plugin.name || plugin.id),
    description: String(plugin.description || ""),
    officialCommand: typeof plugin.officialCommand === "string" && plugin.officialCommand.trim() ? plugin.officialCommand.trim() : null,
    sourceUrl
  };
}

// `methodology` defaults to the current rules; offline comparisons pass alternatives. `detail`
// additionally returns every scored cohort for research reports; snapshots never contain it.
// `newListingsBaseline` is the latest snapshot from an earlier ISO week ({ week, generatedAt }).
export function rankPlugins({ catalog, stats, taxonomy, taskReviews = { schemaVersion: 1, assignments: [] }, pluginProfiles = { schemaVersion: 1, plugins: {} }, evidenceObservations = { schemaVersion: 1, plugins: {} }, classificationVersion = CLASSIFICATION_VERSION, previous = null, previousReviewQueue = null, now = new Date(), source = null, methodology = METHODOLOGY, detail = false, newListingsBaseline = null }) {
  assert(Array.isArray(catalog), "Catalog must be an array");
  assert(stats && typeof stats === "object" && !Array.isArray(stats), "Stats must be an object");
  assert(now instanceof Date && Number.isFinite(now.getTime()), "now must be a valid Date");
  const prepared = prepareTaxonomy(taxonomy);
  const reviewed = methodology.eligibility.reviewedTaskEvidence === true;
  if (reviewed) validateTaskContracts(prepared.types);
  const reviews = reviewed ? prepareTaskReviews(taskReviews, prepared.types, { methodology, pluginProfiles, evidenceObservations, now }) : null;
  const fits = new Map();
  const reviewQueue = [];
  const cohorts = new Map(prepared.types.map((type) => [type.id, []]));
  const classifiedIds = new Set();
  const unclassified = [];
  const excluded = {};
  const exclusions = new Map();
  const typeIdsById = new Map();
  const qualifiedTypeIdsById = new Map();
  const repositories = new Map();
  const builtInsById = new Map(catalog
    .filter((plugin) => plugin && typeof plugin.id === "string" && (plugin.sourceType === "builtin" || plugin.builtIn === true))
    .map((plugin) => [plugin.id, plugin]));

  for (const plugin of catalog) {
    const reason = eligibilityReason(plugin, methodology);
    if (reason) {
      excluded[reason] = (excluded[reason] ?? 0) + 1;
      if (typeof plugin?.id === "string") exclusions.set(plugin.id, reason);
      continue;
    }
    // Stars and push dates are repository-level, so plugins in one repository share them.
    const repository = plugin.repo.toLowerCase().replace(/\.git$/, "").replace(/\/+$/, "");
    repositories.set(repository, [...(repositories.get(repository) ?? []), plugin.id]);
    const typeIds = classifyPlugin(plugin, prepared, classificationVersion, reviews);
    if (typeIds.length === 0) {
      unclassified.push({ id: plugin.id, name: String(plugin.name || plugin.id), category: plugin.category ?? null });
      continue;
    }
    classifiedIds.add(plugin.id);
    typeIdsById.set(plugin.id, typeIds);
    for (const typeId of typeIds) cohorts.get(typeId).push(plugin);
  }

  const previousByType = new Map((previous?.types ?? []).map((type) => [type.id, type]));
  const decisions = [];
  const builtInWarnings = [];
  const scoredCohorts = {};
  const types = prepared.types.map((type) => {
    const members = cohorts.get(type.id);
    const qualified = reviewed ? members.filter((plugin) => {
      const fit = explainTaskFit(plugin, type, reviews);
      fits.set(`${plugin.id}/${type.id}`, fit);
      if (fit.qualified) qualifiedTypeIdsById.set(plugin.id, [...(qualifiedTypeIdsById.get(plugin.id) ?? []), type.id]);
      return fit.qualified;
    }) : members;
    const candidates = scoreCohort(qualified, stats, now, methodology);
    if (reviewed) {
      for (const candidate of candidates) candidate.taskFit = fits.get(`${candidate.id}/${type.id}`);
      // Prospective activity scores prioritize research; they cannot confer headline eligibility.
      const research = scoreCohort(members.filter((plugin) => !["related", "rejected"].includes(fits.get(`${plugin.id}/${type.id}`).status)), stats, now, methodology);
      for (const candidate of research) {
        const fit = fits.get(`${candidate.id}/${type.id}`);
        if ((fit.status === "qualified" && fit.evidenceStatus !== "metadata-reconciliation") || fit.status === "rejected" || fit.status === "related") continue;
        const prior = previousByType.get(type.id);
        reviewQueue.push({ pluginId: candidate.id, name: candidate.name, repository: candidate.repository, description: candidate.description,
          typeId: type.id, typeName: type.name, status: fit.evidenceStatus === "metadata-reconciliation" ? "metadata-reconciliation" : fit.status, reason: fit.evidenceStatus === "metadata-reconciliation" ? "Listing metadata changed; reviewed repository evidence remains unchanged. Reconcile the description without inferring a lost capability." : fit.reason, prospectiveScore: candidate.score,
          contractVersion: type.contract.version, metadataHash: taskMetadataHash(members.find((p) => p.id === candidate.id)),
          previousPick: [prior?.winner?.id, prior?.runnerUp?.id].includes(candidate.id),
          wouldEnterPodium: research.slice(0, 2).some((p) => p.id === candidate.id),
          evidence: explainClassification(members.find((p) => p.id === candidate.id), prepared, classificationVersion, reviews).find((e) => e.typeId === type.id) });
      }
    }
    if (detail) scoredCohorts[type.id] = candidates;
    const prior = previousByType.get(type.id);
    const winner = pickWithHysteresis(candidates, prior?.winner?.id, new Set(), methodology);
    const winnerIds = new Set(winner ? [winner.id] : []);
    const runnerUp = pickWithHysteresis(candidates, prior?.runnerUp?.id, winnerIds, methodology);
    decisions.push({
      typeId: type.id,
      typeName: type.name,
      eligibleCount: candidates.length,
      champion: explainPick(candidates, prior?.winner?.id, winner, new Set(), methodology),
      runnerUp: explainPick(candidates, prior?.runnerUp?.id, runnerUp, winnerIds, methodology)
    });
    // Legacy methods retain both slots; current recommendations always expose the leader.
    const top = candidates[0];
    const builtIns = [];
    for (const id of type.builtIns ?? []) {
      if (builtInsById.has(id)) builtIns.push(builtInRef(builtInsById.get(id)));
      else builtInWarnings.push(`${type.id}: ${id} is not a built-in listing in this catalog`);
    }
    return {
      id: type.id,
      name: type.name,
      description: type.description ?? "",
      eligibleCount: candidates.length,
      ...(reviewed ? { matchedCount: members.length, pendingCount: members.filter((p) => !["qualified", "related", "rejected"].includes(fits.get(`${p.id}/${type.id}`).status)).length,
        taskContract: type.contract, alternatives: candidates.filter((p) => ![winner?.id, runnerUp?.id].includes(p.id)).slice(0, 5),
        relatedTools: members.filter((p) => fits.get(`${p.id}/${type.id}`).status === "related").map((p) => ({ id: p.id, name: p.name,
          detailUrl: `https://plugins.omarchy.org/plugin.html?id=${encodeURIComponent(p.id)}`, taskFit: fits.get(`${p.id}/${type.id}`) })).slice(0, 5) } : {}),
      builtIns,
      winner,
      runnerUp,
      topScorer: top ? { id: top.id, name: top.name, score: top.score } : null
    };
  });

  if (reviewed) {
    // A changed description can stop matching every discovery rule. Its old review still needs
    // attention, especially when it used to supply a recommendation; do not lose it from the queue.
    for (const plugin of catalog.filter((p) => !eligibilityReason(p, methodology))) {
      for (const type of prepared.types) {
        const key = `${plugin.id}/${type.id}`;
        const held = prepared.overrides.review[plugin.id]?.includes(type.id);
        if (fits.has(key) || prepared.overrides.exclude[plugin.id]?.includes(type.id) || (!held && !reviews.has(key))) continue;
        const fit = explainTaskFit(plugin, type, reviews);
        if (!held && !fit.status.startsWith("stale-") && !["pending-source", "pending-requirements", "source-unavailable"].includes(fit.status)) continue;
        const prior = previousByType.get(type.id);
        reviewQueue.push({ pluginId: plugin.id, name: plugin.name, repository: plugin.repo, description: plugin.description,
          typeId: type.id, typeName: type.name, status: held ? "held" : fit.status,
          reason: held ? prepared.overrides.reasons[plugin.id]?.[type.id] ?? "Assignment held for editorial review." : fit.reason,
          prospectiveScore: null, contractVersion: type.contract.version, metadataHash: taskMetadataHash(plugin),
          previousPick: [prior?.winner?.id, prior?.runnerUp?.id].includes(plugin.id), wouldEnterPodium: false,
          evidence: explainClassification(plugin, prepared, classificationVersion, reviews).find((e) => e.typeId === type.id) });
      }
    }
  }

  // Previous picks that are still listed but no longer eligible, for logs and change reasons.
  const excludedIncumbents = (previous?.types ?? []).flatMap((type) => [["winner", "champion"], ["runnerUp", "runner-up"]]
    .filter(([slot]) => type[slot]?.id && exclusions.has(type[slot].id))
    .map(([slot, place]) => ({ typeId: type.id, typeName: type.name ?? type.id, place, id: type[slot].id, name: type[slot].name ?? type[slot].id, reason: exclusions.get(type[slot].id) })));

  // Eligible, classified plugins listed after the previous week's snapshot. A same-week
  // republish keeps the earlier week as its baseline, so the interval never shrinks.
  const since = Date.parse(newListingsBaseline?.generatedAt);
  const newListings = Number.isFinite(since)
    ? catalog
      .filter((plugin) => (reviewed ? qualifiedTypeIdsById : typeIdsById).has(plugin.id))
      .map((plugin) => ({ plugin, listed: Date.parse(plugin.listedAt) }))
      .filter(({ listed }) => Number.isFinite(listed) && listed > since && listed <= now.getTime())
      .sort((a, b) => a.listed - b.listed || a.plugin.id.localeCompare(b.plugin.id))
      .map(({ plugin }) => ({ id: plugin.id, name: String(plugin.name || plugin.id), typeIds: (reviewed ? qualifiedTypeIdsById : typeIdsById).get(plugin.id) }))
    : null;

  return {
    decisions,
    exclusions,
    typeIdsById,
    qualifiedTypeIdsById: reviewed ? qualifiedTypeIdsById : typeIdsById,
    taskStatusByAssignment: new Map([...fits].map(([key, fit]) => [key, fit.status])
      .concat(reviewQueue.map((p) => [`${p.pluginId}/${p.typeId}`, p.status]))),
    reviewQueue: preserveTaskReviewHistory(reviewQueue, previousReviewQueue, now.toISOString()),
    ...(detail ? { cohorts: scoredCohorts } : {}),
    rankings: {
      schemaVersion: 1,
      methodologyVersion: methodology.version,
      site: "https://omapicks.com",
      week: isoWeek(now),
      generatedAt: now.toISOString(),
      source,
      newListings,
      newListingsInterval: newListings
        ? { since: new Date(since).toISOString(), until: now.toISOString(), baselineWeek: newListingsBaseline.week ?? null }
        : null,
      types
    },
    report: {
      schemaVersion: 1,
      generatedAt: now.toISOString(),
      catalogCount: catalog.length,
      eligibleClassifiedCount: classifiedIds.size,
      classificationAssignments: [...cohorts.values()].reduce((sum, cohort) => sum + cohort.length, 0),
      ...(reviewed ? { qualifiedAssignments: [...qualifiedTypeIdsById.values()].reduce((n, ids) => n + ids.length, 0), pendingAssignments: reviewQueue.length } : {}),
      uniqueUnclassifiedCount: unclassified.length,
      excluded,
      excludedIncumbents,
      builtInWarnings,
      sharedRepositories: [...repositories]
        .filter(([, ids]) => ids.length > 1)
        .map(([repository, ids]) => ({ repository, pluginIds: [...ids].sort() }))
        .sort((a, b) => a.repository.localeCompare(b.repository)),
      unclassified
    }
  };
}

function pickRef(pick) {
  return pick ? { id: pick.id, name: pick.name } : null;
}

// Why a previous pick left its place, phrased to follow the plugin's name.
export const REMOVAL_REASONS = Object.freeze({
  retired: "was retired by the marketplace",
  delisted: "was delisted from the marketplace",
  "missing-from-catalog": "is no longer in the marketplace catalog",
  "repository-unreachable": "could not be reached in the latest marketplace check",
  "compatibility-failed": "failed the latest marketplace compatibility check",
  "built-in": "is now listed as an Omarchy built-in",
  "not-installable": "no longer has a marketplace install command",
  "invalid-repository": "no longer has a valid HTTPS repository",
  "invalid-id": "has an invalid catalog ID",
  "no-longer-in-category": "no longer matches this category",
  "related-task-scope": "remains a related tool with a narrower task scope",
  "awaiting-task-qualification": "is awaiting task qualification before it can compete",
  "task-definition-changed": "was reviewed against a different task definition"
});

export function removalSentence(change, { atPublication = false } = {}) {
  const historical = {
    "missing-from-catalog": "was no longer in the marketplace catalog",
    "built-in": "was listed as an Omarchy built-in",
    "not-installable": "had no marketplace install command",
    "invalid-repository": "had no valid HTTPS repository",
    "invalid-id": "had an invalid catalog ID",
    "no-longer-in-category": "did not match this category",
    "related-task-scope": "was recorded as a related tool with a narrower task scope",
    "awaiting-task-qualification": "was awaiting task qualification before it could compete"
  };
  const phrase = (atPublication && historical[change?.reason]) || REMOVAL_REASONS[change?.reason];
  return phrase && change.previous ? `${atPublication ? "At that publication, " : ""}${change.previous.name} ${phrase}.` : "";
}

// `context` explains removals with catalog/retirement IDs, global exclusions,
// discovered typeIdsById and taskStatusByAssignment (including unresolved reviews).
// Without it (older call sites and rendering), changes carry no reason.
function removalReason(oldId, typeId, context) {
  if (!context) return null;
  if (!context.catalogIds.has(oldId)) {
    // Only a successfully fetched registry can distinguish retirement from delisting.
    if (!context.retirement?.available) return "missing-from-catalog";
    return context.retirement.ids.has(oldId) ? "retired" : "delisted";
  }
  // A live listing is judged by the current catalog even if the registry also lists it as retired.
  if (context.exclusions?.has(oldId)) return context.exclusions.get(oldId);
  const taskStatus = context.taskStatusByAssignment?.get(`${oldId}/${typeId}`);
  if (taskStatus === "related") return "related-task-scope";
  if (["pending", "stale-metadata", "stale-contract", "stale-source", "pending-source", "pending-requirements", "source-unavailable", "held"].includes(taskStatus)) return "awaiting-task-qualification";
  if (context.typeIdsById && !(context.typeIdsById.get(oldId) ?? []).includes(typeId)) return "no-longer-in-category";
  return null;
}

function leadershipChanges(previous, current, slot, context) {
  const prior = new Map((previous?.types ?? []).map((type) => [type.id, type]));
  const changes = [];
  for (const type of current.types) {
    const before = prior.get(type.id);
    const oldPick = before?.[slot] ?? null;
    const newPick = type[slot] ?? null;
    const oldId = oldPick?.id ?? null;
    const newId = newPick?.id ?? null;
    if (oldId === newId) continue;
    const change = {
      typeId: type.id,
      typeName: type.name,
      kind: oldId ? (newId ? "displaced" : "vacated") : slot === "winner" ? "new-champion" : "new-runner-up",
      previous: pickRef(oldPick),
      current: pickRef(newPick)
    };
    let reason = oldId ? removalReason(oldId, type.id, context) : null;
    if (oldId && snapshotMethodology(current).eligibility.taskCoherence && taskDefinitionChanged(before, type) &&
        (!reason || ["related-task-scope", "awaiting-task-qualification", "no-longer-in-category"].includes(reason))) {
      reason = "task-definition-changed";
    }
    if (reason) change.reason = reason;
    changes.push(change);
  }
  return changes;
}

export function changesBetween(previous, current, context = null) {
  return leadershipChanges(previous, current, "winner", context);
}

export function runnerUpChangesBetween(previous, current, context = null) {
  return leadershipChanges(previous, current, "runnerUp", context);
}

// The plugin that outscored a retained champion this week, if any. Snapshots written before
// topScorer existed fall back to the runner-up, the only other score they recorded.
export function scoreLeader(type) {
  if (!type?.winner) return null;
  const leader = [type.topScorer, type.runnerUp]
    .filter((candidate) => candidate && Number.isFinite(candidate.score))
    .sort((a, b) => b.score - a.score)[0];
  return leader && leader.id !== type.winner.id && leader.score > type.winner.score ? leader : null;
}

export function invertedRawScoreRaces(rankings) {
  const races = [];
  for (const type of rankings?.types ?? []) {
    const leader = scoreLeader(type);
    if (!leader) continue;
    races.push({
      typeId: type.id,
      typeName: type.name,
      champion: { id: type.winner.id, name: type.winner.name, score: type.winner.score },
      leader: { id: leader.id, name: leader.name, score: leader.score },
      gapPercent: round((leader.score / type.winner.score - 1) * 100, 1)
    });
  }
  return races.sort((a, b) => b.gapPercent - a.gapPercent || a.typeId.localeCompare(b.typeId));
}
