import { CURRENT_METHODOLOGY_VERSION, methodologyFor } from "./methodology.mjs";

export { methodologyFor, snapshotMethodology } from "./methodology.mjs";

const DAY_MS = 86_400_000;
export const CLASSIFICATION_VERSION = 2;

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
    return {
      ...type,
      includePatterns: compilePatterns(type.include, `${label}.include`),
      namePatterns: type.nameInclude == null ? [] : compilePatterns(type.nameInclude, `${label}.nameInclude`),
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
  return { types, overrides: { include: overrides.include ?? {}, exclude: overrides.exclude ?? {}, review: overrides.review ?? {}, reasons: overrides.reasons ?? {} } };
}

function matchedEvidence(patterns, fields, rule) {
  const evidence = [];
  for (const [field, value] of Object.entries(fields)) {
    if (typeof value !== "string") continue;
    for (const pattern of patterns) {
      const match = pattern.exec(value);
      if (match) evidence.push({ rule, pattern: pattern.source, field, match: match[0] });
    }
  }
  return evidence;
}

// Match fields separately: concatenation can manufacture phrases across field boundaries.
// Tags, kind and upstream category are context for reviewers, never eligibility evidence.
export function explainClassification(plugin, preparedTaxonomy) {
  const fields = { name: plugin.name, description: plugin.description };
  const forced = new Set(preparedTaxonomy.overrides.include[plugin.id] ?? []);
  const blocked = new Set(preparedTaxonomy.overrides.exclude[plugin.id] ?? []);
  const review = new Set(preparedTaxonomy.overrides.review[plugin.id] ?? []);
  return preparedTaxonomy.types.map((type) => {
    const evidence = [
      ...matchedEvidence(type.includePatterns, fields, "include"),
      ...matchedEvidence(type.namePatterns, { name: plugin.name }, "nameInclude")
    ];
    const exclusions = matchedEvidence(type.excludePatterns, fields, "exclude");
    const decision = review.has(type.id) ? "review" : blocked.has(type.id) ? "override-exclude"
      : forced.has(type.id) ? "override-include" : exclusions.length ? "excluded"
        : evidence.length ? "task-match" : "no-task-evidence";
    return {
      typeId: type.id,
      accepted: decision === "override-include" || decision === "task-match",
      decision,
      evidence,
      exclusions,
      reason: preparedTaxonomy.overrides.reasons[plugin.id]?.[type.id] ?? null
    };
  });
}

export function classifyPlugin(plugin, preparedTaxonomy) {
  return explainClassification(plugin, preparedTaxonomy).filter((match) => match.accepted).map((match) => match.typeId);
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

// `methodology` defaults to the current rules; offline comparisons pass alternatives. `detail`
// additionally returns every scored cohort for research reports; snapshots never contain it.
export function rankPlugins({ catalog, stats, taxonomy, previous = null, now = new Date(), source = null, methodology = METHODOLOGY, detail = false }) {
  assert(Array.isArray(catalog), "Catalog must be an array");
  assert(stats && typeof stats === "object" && !Array.isArray(stats), "Stats must be an object");
  assert(now instanceof Date && Number.isFinite(now.getTime()), "now must be a valid Date");
  const prepared = prepareTaxonomy(taxonomy);
  const cohorts = new Map(prepared.types.map((type) => [type.id, []]));
  const classifiedIds = new Set();
  const unclassified = [];
  const excluded = {};
  const exclusions = new Map();

  for (const plugin of catalog) {
    const reason = eligibilityReason(plugin, methodology);
    if (reason) {
      excluded[reason] = (excluded[reason] ?? 0) + 1;
      if (typeof plugin?.id === "string") exclusions.set(plugin.id, reason);
      continue;
    }
    const typeIds = classifyPlugin(plugin, prepared);
    if (typeIds.length === 0) {
      unclassified.push({ id: plugin.id, name: String(plugin.name || plugin.id), category: plugin.category ?? null });
      continue;
    }
    classifiedIds.add(plugin.id);
    for (const typeId of typeIds) cohorts.get(typeId).push(plugin);
  }

  const previousByType = new Map((previous?.types ?? []).map((type) => [type.id, type]));
  const decisions = [];
  const scoredCohorts = {};
  const types = prepared.types.map((type) => {
    const candidates = scoreCohort(cohorts.get(type.id), stats, now, methodology);
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
    // Both slots are sticky; the raw-score leader may occupy neither place.
    const top = candidates[0];
    return {
      id: type.id,
      name: type.name,
      description: type.description ?? "",
      eligibleCount: candidates.length,
      winner,
      runnerUp,
      topScorer: top ? { id: top.id, name: top.name, score: top.score } : null
    };
  });

  // Previous picks that are still listed but no longer eligible, for logs and change reasons.
  const excludedIncumbents = (previous?.types ?? []).flatMap((type) => [["winner", "champion"], ["runnerUp", "runner-up"]]
    .filter(([slot]) => type[slot]?.id && exclusions.has(type[slot].id))
    .map(([slot, place]) => ({ typeId: type.id, typeName: type.name ?? type.id, place, id: type[slot].id, name: type[slot].name ?? type[slot].id, reason: exclusions.get(type[slot].id) })));

  return {
    decisions,
    exclusions,
    ...(detail ? { cohorts: scoredCohorts } : {}),
    rankings: {
      schemaVersion: 1,
      methodologyVersion: methodology.version,
      site: "https://omapicks.com",
      week: isoWeek(now),
      generatedAt: now.toISOString(),
      source,
      types
    },
    report: {
      schemaVersion: 1,
      generatedAt: now.toISOString(),
      catalogCount: catalog.length,
      eligibleClassifiedCount: classifiedIds.size,
      classificationAssignments: [...cohorts.values()].reduce((sum, cohort) => sum + cohort.length, 0),
      uniqueUnclassifiedCount: unclassified.length,
      excluded,
      excludedIncumbents,
      unclassified
    }
  };
}

function pickRef(pick) {
  return pick ? { id: pick.id, name: pick.name } : null;
}

function leadershipChanges(previous, current, slot) {
  const prior = new Map((previous?.types ?? []).map((type) => [type.id, type]));
  const changes = [];
  for (const type of current.types) {
    const before = prior.get(type.id);
    const oldPick = before?.[slot] ?? null;
    const newPick = type[slot] ?? null;
    const oldId = oldPick?.id ?? null;
    const newId = newPick?.id ?? null;
    if (oldId === newId) continue;
    changes.push({
      typeId: type.id,
      typeName: type.name,
      kind: oldId ? (newId ? "displaced" : "vacated") : slot === "winner" ? "new-champion" : "new-runner-up",
      previous: pickRef(oldPick),
      current: pickRef(newPick)
    });
  }
  return changes;
}

export function changesBetween(previous, current) {
  return leadershipChanges(previous, current, "winner");
}

export function runnerUpChangesBetween(previous, current) {
  return leadershipChanges(previous, current, "runnerUp");
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
