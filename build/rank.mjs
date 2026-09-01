const DAY_MS = 86_400_000;

export const METHODOLOGY = Object.freeze({
  version: "1.0.0",
  hysteresis: 0.1,
  priorStrength: 12,
  freshnessHalfLifeDays: 180,
  weights: Object.freeze({
    copies: 0.36,
    hearts: 0.2,
    stars: 0.18,
    views: 0.08,
    freshness: 0.13,
    verified: 0.05
  })
});

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function finiteCount(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : 0;
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
      excludePatterns: (type.exclude ?? []).map((pattern, patternIndex) => {
        try {
          return new RegExp(pattern, "iu");
        } catch (error) {
          throw new Error(`${label}.exclude[${patternIndex}] is invalid: ${error.message}`);
        }
      })
    };
  });

  const overrides = taxonomy.overrides ?? {};
  for (const group of ["include", "exclude"]) {
    assert(overrides[group] == null || typeof overrides[group] === "object", `overrides.${group} must be an object`);
    for (const [pluginId, typeIds] of Object.entries(overrides[group] ?? {})) {
      assert(pluginId.length > 0 && Array.isArray(typeIds), `Invalid overrides.${group} entry`);
      for (const typeId of typeIds) assert(ids.has(typeId), `Unknown override type: ${typeId}`);
    }
  }
  return { types, overrides: { include: overrides.include ?? {}, exclude: overrides.exclude ?? {} } };
}

function searchableText(plugin) {
  return [
    plugin.name,
    plugin.description,
    plugin.category,
    plugin.kind,
    ...(Array.isArray(plugin.tags) ? plugin.tags : [])
  ]
    .filter((value) => typeof value === "string")
    .join(" ");
}

export function classifyPlugin(plugin, preparedTaxonomy) {
  const text = searchableText(plugin);
  const forced = new Set(preparedTaxonomy.overrides.include[plugin.id] ?? []);
  const blocked = new Set(preparedTaxonomy.overrides.exclude[plugin.id] ?? []);
  const matches = [];

  for (const type of preparedTaxonomy.types) {
    if (blocked.has(type.id)) continue;
    const included = forced.has(type.id) || type.includePatterns.some((pattern) => pattern.test(text));
    const excluded = !forced.has(type.id) && type.excludePatterns.some((pattern) => pattern.test(text));
    if (included && !excluded) matches.push(type.id);
  }
  return matches;
}

export function eligibilityReason(plugin) {
  if (!plugin || typeof plugin.id !== "string" || !plugin.id) return "invalid-id";
  if (plugin.installAvailable !== true || typeof plugin.installCommand !== "string" || !plugin.installCommand.trim()) {
    return "not-installable";
  }
  if (["retired", "delisted"].includes(String(plugin.status).toLowerCase())) return "retired";
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

function normalizedSignalMap(valuesById) {
  const logged = new Map([...valuesById].map(([id, value]) => [id, Math.log1p(value)]));
  const percentiles = percentileMap(logged);
  const scale = quantile([...logged.values()].sort((a, b) => a - b), 0.95);
  return new Map(
    [...logged].map(([id, value]) => {
      const robustScale = scale > 0 ? Math.min(1, value / scale) : 0.5;
      return [id, 0.7 * percentiles.get(id) + 0.3 * robustScale];
    })
  );
}

function freshnessScore(updatedAt, now) {
  const timestamp = Date.parse(updatedAt);
  if (!Number.isFinite(timestamp)) return 0;
  const ageDays = Math.max(0, (now.getTime() - timestamp) / DAY_MS);
  return Math.exp((-Math.log(2) * ageDays) / METHODOLOGY.freshnessHalfLifeDays);
}

function round(value, places = 6) {
  const scale = 10 ** places;
  return Math.round(value * scale) / scale;
}

function publicCandidate(plugin, metrics, score, normalized, contributions, now) {
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
    license: String(plugin.license || "Unknown"),
    repositoryUpdatedAt: Number.isFinite(Date.parse(plugin.repositoryUpdatedAt))
      ? new Date(plugin.repositoryUpdatedAt).toISOString()
      : null,
    previewSource,
    previewWidth: finiteCount(plugin.previewThumbnailWidth || plugin.previewWidth) || null,
    previewHeight: finiteCount(plugin.previewThumbnailHeight || plugin.previewHeight) || null,
    localImage: null,
    metrics,
    normalized,
    contributions,
    evidence: round(
      (metrics.copies + metrics.hearts + Math.min(metrics.views * 0.05, 50)) /
        (metrics.copies + metrics.hearts + Math.min(metrics.views * 0.05, 50) + METHODOLOGY.priorStrength)
    ),
    freshnessDays: Number.isFinite(Date.parse(plugin.repositoryUpdatedAt))
      ? Math.max(0, Math.floor((now.getTime() - Date.parse(plugin.repositoryUpdatedAt)) / DAY_MS))
      : null,
    score: round(score)
  };
}

function scoreCohort(plugins, stats, now) {
  const raw = new Map();
  for (const plugin of plugins) {
    const engagement = stats[plugin.id] ?? {};
    raw.set(plugin.id, {
      copies: finiteCount(engagement.copies),
      hearts: finiteCount(engagement.hearts),
      stars: finiteCount(plugin.stars),
      views: finiteCount(engagement.views)
    });
  }

  const percentiles = {};
  for (const metric of ["copies", "hearts", "stars", "views"]) {
    percentiles[metric] = normalizedSignalMap(new Map([...raw].map(([id, metrics]) => [id, metrics[metric]])));
  }

  return plugins
    .map((plugin) => {
      const metrics = raw.get(plugin.id);
      const evidenceCount = metrics.copies + metrics.hearts + Math.min(metrics.views * 0.05, 50);
      const reliability = evidenceCount / (evidenceCount + METHODOLOGY.priorStrength);
      const normalized = {};
      for (const metric of ["copies", "hearts", "stars", "views"]) {
        normalized[metric] = round(0.5 + reliability * (percentiles[metric].get(plugin.id) - 0.5));
      }
      normalized.freshness = round(freshnessScore(plugin.repositoryUpdatedAt, now));
      normalized.verified = plugin.verificationStatus === "verified" ? 1 : 0;

      const contributions = {};
      let score = 0;
      for (const [metric, weight] of Object.entries(METHODOLOGY.weights)) {
        contributions[metric] = round(normalized[metric] * weight);
        score += contributions[metric];
      }
      return publicCandidate(plugin, metrics, score, normalized, contributions, now);
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

export function pickWithHysteresis(candidates, incumbentId, excludedIds = new Set()) {
  const available = candidates.filter((candidate) => !excludedIds.has(candidate.id));
  const challenger = available[0] ?? null;
  const incumbent = available.find((candidate) => candidate.id === incumbentId);
  if (!incumbent || !challenger || incumbent.id === challenger.id) return challenger;
  return challenger.score > incumbent.score * (1 + METHODOLOGY.hysteresis) ? challenger : incumbent;
}

export function isoWeek(date) {
  const target = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const day = target.getUTCDay() || 7;
  target.setUTCDate(target.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(target.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((target - yearStart) / DAY_MS + 1) / 7);
  return `${target.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

export function rankPlugins({ catalog, stats, taxonomy, previous = null, now = new Date(), source = null }) {
  assert(Array.isArray(catalog), "Catalog must be an array");
  assert(stats && typeof stats === "object" && !Array.isArray(stats), "Stats must be an object");
  assert(now instanceof Date && Number.isFinite(now.getTime()), "now must be a valid Date");
  const prepared = prepareTaxonomy(taxonomy);
  const cohorts = new Map(prepared.types.map((type) => [type.id, []]));
  const classifiedIds = new Set();
  const unclassified = [];
  const excluded = {};

  for (const plugin of catalog) {
    const reason = eligibilityReason(plugin);
    if (reason) {
      excluded[reason] = (excluded[reason] ?? 0) + 1;
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
  const types = prepared.types.map((type) => {
    const candidates = scoreCohort(cohorts.get(type.id), stats, now);
    const prior = previousByType.get(type.id);
    const winner = pickWithHysteresis(candidates, prior?.winner?.id);
    const winnerIds = new Set(winner ? [winner.id] : []);
    const runnerUp = pickWithHysteresis(candidates, prior?.runnerUp?.id, winnerIds);
    return {
      id: type.id,
      name: type.name,
      description: type.description ?? "",
      eligibleCount: candidates.length,
      winner,
      runnerUp
    };
  });

  return {
    rankings: {
      schemaVersion: 1,
      methodologyVersion: METHODOLOGY.version,
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
      unclassified
    }
  };
}

export function changesBetween(previous, current) {
  const prior = new Map((previous?.types ?? []).map((type) => [type.id, type]));
  const changes = [];
  for (const type of current.types) {
    const before = prior.get(type.id);
    const oldId = before?.winner?.id ?? null;
    const newId = type.winner?.id ?? null;
    if (oldId === newId) continue;
    changes.push({
      typeId: type.id,
      typeName: type.name,
      kind: oldId ? (newId ? "displaced" : "vacated") : "new-champion",
      previous: before?.winner ? { id: before.winner.id, name: before.winner.name } : null,
      current: type.winner ? { id: type.winner.id, name: type.winner.name } : null
    });
  }
  return changes;
}
