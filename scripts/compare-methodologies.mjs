import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { checksum } from "../build/classification-audit.mjs";
import { CURRENT_METHODOLOGY_VERSION, LEGACY_METHODOLOGY_VERSION, deriveMethodology, methodologyFor } from "../build/methodology.mjs";
import { freshnessDetail, rankPlugins } from "../build/rank.mjs";
import { codeRevision, validateFeeds } from "../build/refresh.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const REPORT_VERSION = 1;

// Scoring proposals from docs/marketplace-alignment-plan.md, each applied alone to the published rules
// plus health eligibility (their immediate baseline) before the combined current methodology.
export const PROPOSALS = Object.freeze([
  ["verification-0", "Graded verification, update-unverified credit 0", { verification: { rule: "coverage", updateUnverifiedCredit: 0 } }],
  ["verification-0.6", "Graded verification, update-unverified credit 0.6", { verification: { rule: "coverage", updateUnverifiedCredit: 0.6 } }],
  ["verification-1", "Graded verification, update-unverified credit 1", { verification: { rule: "coverage", updateUnverifiedCredit: 1 } }],
  ["install-rate-0.05", "Copy/view lower bound 5%, views 3%", { installRate: { minimumViews: 20, z: 1.96 }, weights: { views: 0.03, installRateLowerBound: 0.05 } }],
  ["freshness-bonus", "Shipping bonus 0.15, 90-day half-life and window", { freshness: { shippingBonus: { amount: 0.15, halfLifeDays: 90, windowDays: 90 } } }]
]);

// Each variant names its immediate baseline so a proposal is judged alone before the combination.
// Research variants are never registered methodologies and can never appear in a snapshot.
export function defaultVariants() {
  const legacy = methodologyFor(LEGACY_METHODOLOGY_VERSION);
  const current = methodologyFor(CURRENT_METHODOLOGY_VERSION);
  const health = deriveMethodology(legacy, { eligibility: { upstreamHealth: true } }, "health");
  const variants = [
    { id: legacy.version, label: `Published ${legacy.version} rules`, methodology: legacy, baselines: [] },
    { id: "health", label: "Published rules plus health eligibility", methodology: health, baselines: [legacy.version] },
    ...PROPOSALS.map(([id, label, overrides]) => ({ id, label, methodology: deriveMethodology(health, overrides, id), baselines: ["health"] }))
  ];
  if (current.version !== legacy.version) {
    variants.push({ id: current.version, label: `Current ${current.version} rules (combined)`, methodology: current, baselines: [legacy.version, "health"] });
  }
  return variants;
}

const round = (value, places = 6) => (Number.isFinite(value) ? Math.round(value * 10 ** places) / 10 ** places : null);

function scored(candidate) {
  return candidate ? { score: candidate.score, contributions: candidate.contributions } : null;
}

function pickId(pick) {
  return pick?.id ?? null;
}

function compareRuns(before, after) {
  const beforeTypes = new Map(before.rankings.types.map((type) => [type.id, type]));
  const beforeDecisions = new Map(before.decisions.map((decision) => [decision.typeId, decision]));
  const afterDecisions = new Map(after.decisions.map((decision) => [decision.typeId, decision]));
  const scoreDeltas = [];
  const types = after.rankings.types.map((type) => {
    const prior = beforeTypes.get(type.id);
    const beforeCohort = new Map((before.cohorts[type.id] ?? []).map((candidate, index) => [candidate.id, { ...candidate, rank: index + 1 }]));
    const afterCohort = new Map((after.cohorts[type.id] ?? []).map((candidate, index) => [candidate.id, { ...candidate, rank: index + 1 }]));
    for (const [id, candidate] of afterCohort) {
      const old = beforeCohort.get(id);
      if (old) scoreDeltas.push({ delta: candidate.score - old.score, rankChanged: candidate.rank !== old.rank });
    }
    const slots = {
      champion: [pickId(prior?.winner), pickId(type.winner)],
      runnerUp: [pickId(prior?.runnerUp), pickId(type.runnerUp)],
      rawLeader: [pickId(prior?.topScorer), pickId(type.topScorer)]
    };
    const changed = Object.values(slots).some(([a, b]) => a !== b) || (prior?.eligibleCount ?? 0) !== type.eligibleCount;
    const ids = [...new Set(Object.values(slots).flat().filter(Boolean))].sort();
    return {
      typeId: type.id,
      typeName: type.name,
      changed,
      eligible: { before: prior?.eligibleCount ?? 0, after: type.eligibleCount },
      champion: { before: slots.champion[0], after: slots.champion[1], changed: slots.champion[0] !== slots.champion[1] },
      runnerUp: { before: slots.runnerUp[0], after: slots.runnerUp[1], changed: slots.runnerUp[0] !== slots.runnerUp[1] },
      rawLeader: { before: slots.rawLeader[0], after: slots.rawLeader[1], changed: slots.rawLeader[0] !== slots.rawLeader[1] },
      decisions: changed ? { before: beforeDecisions.get(type.id) ?? null, after: afterDecisions.get(type.id) ?? null } : null,
      candidates: changed ? ids.map((id) => {
        const old = beforeCohort.get(id);
        const current = afterCohort.get(id);
        return {
          id,
          name: current?.name ?? old?.name ?? id,
          before: old ? { rank: old.rank, ...scored(old) } : null,
          after: current ? { rank: current.rank, ...scored(current) } : null,
          scoreDelta: old && current ? round(current.score - old.score) : null
        };
      }) : []
    };
  });
  const absolute = scoreDeltas.map((entry) => Math.abs(entry.delta));
  return {
    summary: {
      championChanges: types.filter((type) => type.champion.changed).length,
      runnerUpChanges: types.filter((type) => type.runnerUp.changed).length,
      rawLeaderChanges: types.filter((type) => type.rawLeader.changed).length,
      eligibleCountChanges: types.filter((type) => type.eligible.before !== type.eligible.after).length,
      comparableAssignments: scoreDeltas.length,
      assignmentsWithRankChange: scoreDeltas.filter((entry) => entry.rankChanged).length,
      meanAbsoluteScoreDelta: absolute.length ? round(absolute.reduce((sum, value) => sum + value, 0) / absolute.length) : null,
      maxAbsoluteScoreDelta: absolute.length ? round(Math.max(...absolute)) : null
    },
    types: types.filter((type) => type.changed)
  };
}

function tally(values) {
  const counts = {};
  for (const value of values) counts[String(value)] = (counts[String(value)] ?? 0) + 1;
  return Object.fromEntries(Object.entries(counts).sort(([a], [b]) => a.localeCompare(b)));
}

// Facts about one variant's scored cohorts that parameter decisions depend on.
function diagnostics(result, methodology, pluginsById, now) {
  const unique = new Map();
  for (const cohort of Object.values(result.cohorts)) for (const candidate of cohort) unique.set(candidate.id, candidate);
  const candidates = [...unique.values()];
  const count = (predicate) => candidates.filter(predicate).length;
  const rated = (candidate) => candidate.metrics.installRateLowerBound !== null;
  const freshness = candidates.map((candidate) => freshnessDetail(pluginsById.get(candidate.id), now, methodology));
  return {
    uniqueCandidates: candidates.length,
    assignments: Object.values(result.cohorts).reduce((sum, cohort) => sum + cohort.length, 0),
    excluded: result.report.excluded,
    coverage: tally(candidates.map((candidate) => candidate.verificationCoverage)),
    verifiedCredit: tally(candidates.map((candidate) => candidate.normalized.verified)),
    installRate: methodology.installRate ? {
      rated: count(rated),
      unrated: count((candidate) => !rated(candidate)),
      nineteenViews: count((candidate) => candidate.metrics.views === 19),
      twentyViews: count((candidate) => candidate.metrics.views === 20),
      ratedBelowNeutralPrior: count((candidate) => rated(candidate) && candidate.normalized.installRateLowerBound < 0.5),
      categoriesWithFewerThanThreeRated: Object.values(result.cohorts).filter((cohort) => cohort.length && cohort.filter(rated).length < 3).length
    } : null,
    freshness: {
      withBonus: freshness.filter((detail) => detail.bonus > 0).length,
      saturatedByBonus: freshness.filter((detail) => detail.bonus > 0 && detail.uncapped > 1).length,
      alreadyFullBeforeBonus: freshness.filter((detail) => detail.bonus > 0 && detail.base >= 0.999).length,
      meanBonusApplied: freshness.length ? round(freshness.reduce((sum, detail) => sum + detail.value - detail.base, 0) / freshness.length) : null
    }
  };
}

export function compareMethodologies(inputs, { variants = defaultVariants(), revision = null } = {}) {
  validateFeeds(inputs.catalog.body, inputs.stats.body, 1, inputs.previous);
  const now = new Date(inputs.now);
  if (!Number.isFinite(now.getTime())) throw new Error("Comparison inputs need a valid analysis time");
  const ids = new Set();
  for (const variant of variants) {
    if (ids.has(variant.id)) throw new Error(`Duplicate comparison variant: ${variant.id}`);
    ids.add(variant.id);
    for (const baseline of variant.baselines) if (!ids.has(baseline)) throw new Error(`Variant ${variant.id} compares against unknown or later baseline ${baseline}`);
  }
  const pluginsById = new Map(inputs.catalog.body.plugins.map((plugin) => [plugin.id, plugin]));
  const runs = new Map(variants.map((variant) => [variant.id, rankPlugins({
    catalog: inputs.catalog.body.plugins,
    stats: inputs.stats.body.plugins,
    taxonomy: inputs.taxonomy,
    previous: inputs.previous,
    now,
    methodology: variant.methodology,
    detail: true
  })]));
  return {
    schemaVersion: REPORT_VERSION,
    kind: "fixed-input methodology comparison (research artifact, not a snapshot)",
    inputs: {
      hash: checksum(inputs),
      now: inputs.now,
      captureRevision: inputs.codeRevision ?? null,
      catalog: { generatedAt: inputs.catalog.body.generatedAt ?? null, sha256: checksum(inputs.catalog.body), count: inputs.catalog.body.plugins.length },
      stats: { sha256: checksum(inputs.stats.body), count: Object.keys(inputs.stats.body.plugins).length },
      taxonomy: checksum(inputs.taxonomy),
      previous: inputs.previous ? { week: inputs.previous.week ?? null, methodologyVersion: inputs.previous.methodologyVersion ?? null } : null
    },
    comparisonRevision: revision,
    variants: variants.map((variant) => ({
      id: variant.id,
      label: variant.label,
      methodologyVersion: variant.methodology.version,
      methodology: variant.methodology,
      diagnostics: diagnostics(runs.get(variant.id), variant.methodology, pluginsById, now)
    })),
    comparisons: variants.flatMap((variant) => variant.baselines.map((baseline) => ({
      baseline,
      candidate: variant.id,
      ...compareRuns(runs.get(baseline), runs.get(variant.id))
    })))
  };
}

const cell = (value) => String(value ?? "none").replace(/[\u0000-\u001f\u007f]/g, " ").replaceAll("|", "\\|");

export function renderComparison(report) {
  const lines = [
    "# Fixed-input methodology comparison",
    "",
    "Every variant ranks the same captured catalog, stats, taxonomy, previous snapshot and analysis time. This is a research artifact: it publishes nothing and changes no snapshot.",
    "",
    `Inputs ${report.inputs.hash.slice(0, 12)} captured at ${report.inputs.now} by revision ${report.inputs.captureRevision ?? "unknown"}; compared by revision ${report.comparisonRevision ?? "unknown"}. Catalog ${report.inputs.catalog.generatedAt ?? "undated"} (${report.inputs.catalog.count} listings); previous snapshot ${report.inputs.previous?.week ?? "none"} on methodology ${report.inputs.previous?.methodologyVersion ?? "none"}.`,
    "",
    "## Variants",
    "",
    "| Variant | Methodology | Candidates | Verification credit | Copy/view rating | Shipping bonus |",
    "| --- | --- | --- | --- | --- | --- |",
    ...report.variants.map((variant) => {
      const d = variant.diagnostics;
      const credit = Object.entries(d.verifiedCredit).map(([value, count]) => `${value}: ${count}`).join(", ");
      const rate = d.installRate
        ? `${d.installRate.rated} rated, ${d.installRate.unrated} unrated (${d.installRate.nineteenViews} at 19 views, ${d.installRate.twentyViews} at 20); ${d.installRate.ratedBelowNeutralPrior} rated below the unrated prior; ${d.installRate.categoriesWithFewerThanThreeRated} categories with fewer than 3 rated`
        : "not scored";
      const bonus = d.freshness.withBonus
        ? `${d.freshness.withBonus} receive it; ${d.freshness.saturatedByBonus} capped at 1; ${d.freshness.alreadyFullBeforeBonus} already full; mean +${d.freshness.meanBonusApplied}`
        : "none";
      return `| ${cell(variant.label)} | ${cell(variant.methodologyVersion)} | ${d.uniqueCandidates} (${d.assignments} assignments) | ${cell(credit)} | ${cell(rate)} | ${cell(bonus)} |`;
    }),
    ""
  ];
  for (const comparison of report.comparisons) {
    const s = comparison.summary;
    lines.push(
      `## ${cell(comparison.candidate)} against ${cell(comparison.baseline)}`,
      "",
      `${s.championChanges} champion changes; ${s.runnerUpChanges} runner-up changes; ${s.rawLeaderChanges} raw-score leader changes; ${s.eligibleCountChanges} categories with a different cohort size. ` +
        `${s.assignmentsWithRankChange} of ${s.comparableAssignments} comparable assignments moved within their category; mean absolute score change ${s.meanAbsoluteScoreDelta ?? "n/a"}, maximum ${s.maxAbsoluteScoreDelta ?? "n/a"}.`,
      ""
    );
    if (!comparison.types.length) {
      lines.push("No category changed.", "");
      continue;
    }
    lines.push("| Category | Cohort | Champion | Runner-up | Raw-score leader |", "| --- | --- | --- | --- | --- |");
    for (const type of comparison.types) {
      const slot = (value) => (value.changed ? `${cell(value.before)} → **${cell(value.after)}**` : cell(value.after));
      lines.push(`| ${cell(type.typeName)} | ${type.eligible.before} → ${type.eligible.after} | ${slot(type.champion)} | ${slot(type.runnerUp)} | ${slot(type.rawLeader)} |`);
    }
    lines.push("");
    for (const type of comparison.types.filter((entry) => entry.champion.changed || entry.runnerUp.changed)) {
      lines.push(`### ${cell(type.typeName)}`, "", `- Champion: ${cell(type.decisions.after?.champion)}`, `- Runner-up: ${cell(type.decisions.after?.runnerUp)}`);
      for (const candidate of type.candidates) {
        const place = (value) => (value ? `#${value.rank} ${value.score}` : "absent");
        lines.push(`- ${cell(candidate.name)} (${cell(candidate.id)}): ${place(candidate.before)} → ${place(candidate.after)}${candidate.scoreDelta == null ? "" : ` (${candidate.scoreDelta >= 0 ? "+" : ""}${candidate.scoreDelta})`}`);
      }
      lines.push("");
    }
  }
  return `${lines.join("\n")}\n`;
}

export async function runComparison({ inputFile, output = path.join(ROOT, "tmp", "methodology-comparison"), variants, revision = codeRevision() } = {}) {
  if (!inputFile) throw new Error("--input <inputs.json> is required; comparisons never fetch live feeds");
  const inputs = JSON.parse(await readFile(inputFile, "utf8"));
  const report = compareMethodologies(inputs, { variants, revision });
  await mkdir(output, { recursive: true });
  await writeFile(path.join(output, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
  await writeFile(path.join(output, "report.md"), renderComparison(report));
  return report;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const options = {};
  for (let i = 0; i < args.length; i += 2) {
    if (!["--input", "--output"].includes(args[i]) || !args[i + 1] || args[i + 1].startsWith("--")) {
      throw new Error(`Unknown or incomplete option: ${args[i]}`);
    }
    options[args[i]] = args[i + 1];
  }
  const report = await runComparison({ inputFile: options["--input"], output: options["--output"] });
  for (const comparison of report.comparisons) {
    const s = comparison.summary;
    console.log(`${comparison.candidate} vs ${comparison.baseline}: ${s.championChanges} champion, ${s.runnerUpChanges} runner-up, ${s.rawLeaderChanges} raw-leader changes.`);
  }
  console.log(`Full report: ${options["--output"] ?? "tmp/methodology-comparison"}/report.md`);
}
