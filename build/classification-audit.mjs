import { createHash } from "node:crypto";
import { CLASSIFICATION_VERSION, METHODOLOGY, classifyPlugin, eligibilityReason, explainClassification, prepareTaxonomy, rankPlugins, discoveryCurationStatus } from "./rank.mjs";
import { prepareTaskReviews } from "./task-fit.mjs";

export const checksum = (value) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const compare = (a, b) => a.id.localeCompare(b.id);
const same = (a, b) => JSON.stringify([...a].sort()) === JSON.stringify([...b].sort());
const metadata = (p) => ({ name: p.name, description: p.description, repo: p.repo, category: p.category, kind: p.kind, tags: p.tags });

// Only for explaining migration from the published v1 classifier. Never used for eligibility.
function legacyTypes(plugin, prepared) {
  const text = [plugin.name, plugin.description, plugin.category, plugin.kind, ...(Array.isArray(plugin.tags) ? plugin.tags : [])].filter((v) => typeof v === "string").join(" ");
  return prepared.types.filter((type) => {
    if (prepared.overrides.exclude[plugin.id]?.includes(type.id)) return false;
    if (prepared.overrides.include[plugin.id]?.includes(type.id)) return true;
    return type.includePatterns.some((p) => p.test(text)) && !type.excludePatterns.some((p) => p.test(text));
  }).map((type) => type.id);
}

// `methodology` decides eligibility and ranking. Replays pass the one recorded with their inputs so
// captured evidence is never silently reinterpreted under newer rules.
export function auditClassifications({ catalog, taxonomy, taskReviews = { schemaVersion: 1, assignments: [] }, pluginProfiles = { schemaVersion: 1, plugins: {} }, evidenceObservations = { schemaVersion: 1, plugins: {} }, classificationVersion = CLASSIFICATION_VERSION, previousState = null, baselineTaxonomy = null, baselineVersion = classificationVersion, stats = null, previous = null, previousReviewQueue = null, now = new Date(), methodology = METHODOLOGY }) {
  const prepared = prepareTaxonomy(taxonomy);
  const reviewed = methodology.eligibility.reviewedTaskEvidence === true;
  if (reviewed && baselineTaxonomy) throw new Error("Task qualification migrations require captured baseline decisions and methodology; use compare:task-fit with the baseline inputs.json");
  const reviews = reviewed ? prepareTaskReviews(taskReviews, prepared.types, { methodology, pluginProfiles, evidenceObservations, now }) : null;
  const baseline = baselineTaxonomy ? prepareTaxonomy(baselineTaxonomy) : null;
  const prior = new Map((previousState?.plugins ?? []).map((p) => [p.id, p]));
  const records = [...catalog].sort(compare).map((plugin) => {
    const ineligible = eligibilityReason(plugin, methodology);
    const explanations = ineligible ? [] : explainClassification(plugin, prepared, classificationVersion, reviews);
    const types = explanations.filter((e) => e.accepted).map((e) => e.typeId);
    const before = baseline ? (ineligible ? [] : baselineVersion === 1 ? legacyTypes(plugin, baseline) : classifyPlugin(plugin, baseline, baselineVersion)) : prior.get(plugin.id)?.types ?? null;
    const metadataHash = checksum(metadata(plugin));
    return {
      id: plugin.id, name: plugin.name, description: plugin.description, repository: plugin.repo,
      metadataHash, ineligible, types, before,
      changed: before != null && !same(before, types),
      metadataChanged: prior.has(plugin.id) && prior.get(plugin.id).metadataHash !== metadataHash,
      decision: ineligible ? "ineligible" : types.length ? "classified" : "unranked",
      // Unmentioned types all have the same decision: no task evidence. Keep the report compact.
      defaultDecision: "no-task-evidence",
      evidence: explanations.filter((e) => e.accepted || e.evidence.length || e.exclusions.length || e.decision.startsWith("override-") || e.decision === "review" || e.taskFit && e.taskFit.status !== "pending" || before?.includes(e.typeId))
    };
  });
  const eligible = records.filter((p) => !p.ineligible);
  const unresolved = records.flatMap((p) => p.evidence.filter((e) => e.decision === "review").map((e) => ({ id: p.id, typeId: e.typeId, reason: e.reason })));
  const changes = records.filter((p) => p.changed).map((p) => ({ id: p.id, name: p.name, added: p.types.filter((t) => !p.before.includes(t)), removed: p.before.filter((t) => !p.types.includes(t)) }));
  // A baseline replay classifies one catalog twice, so feed departures and arrivals are not taxonomy effects.
  const removed = baseline ? [] : [...prior.values()].filter((p) => !records.some((r) => r.id === p.id)).map((p) => ({ id: p.id, name: p.name, added: [], removed: p.types }));
  const newListings = previousState && !baseline ? records.filter((p) => !prior.has(p.id)).map((p) => p.id) : [];
  let rankingComparison = null;
  let picks = [];
  let reviewQueue = [];
  if (stats) {
    const ranked = rankPlugins({ catalog, stats, taxonomy, taskReviews, pluginProfiles, evidenceObservations, classificationVersion, previous, previousReviewQueue, now, methodology });
    const after = ranked.rankings;
    reviewQueue = ranked.reviewQueue;
    const byId = new Map(records.map((p) => [p.id, p]));
    picks = after.types.flatMap((type) => ["winner", "runnerUp"].filter((slot) => type[slot]).map((slot) => ({ typeId: type.id, slot, id: type[slot].id, name: type[slot].name, eligibility: byId.get(type[slot].id).evidence.find((e) => e.typeId === type.id) })));
    if (baseline) {
      // Identical feeds, clock and incumbents isolate classification effects from engagement changes.
      const fixedTaxonomy = {
        schemaVersion: 1,
        types: baselineTaxonomy.types.map((type) => ({ ...type, include: ["(?!)"], nameInclude: undefined, exclude: [] })),
        overrides: { include: Object.fromEntries(records.filter((p) => !p.ineligible).map((p) => [p.id, p.before])) }
      };
      const before = rankPlugins({ catalog, stats, taxonomy: fixedTaxonomy, taskReviews, classificationVersion, previous, now, methodology }).rankings;
      rankingComparison = compareRankings(before, after);
    } else if (previous) rankingComparison = compareRankings(previous, after);
  }
  return {
    schemaVersion: 1, classificationVersion, methodologyVersion: methodology.version, generatedAt: now.toISOString(),
    hashes: { catalog: checksum(catalog), taxonomy: checksum(taxonomy), baselineTaxonomy: baselineTaxonomy ? checksum(baselineTaxonomy) : null },
    comparison: baseline ? "same-input-taxonomy-replay" : previousState ? "previous-published-memberships" : "baseline-established",
    counts: { catalog: records.length, eligible: eligible.length, classified: eligible.filter((p) => p.types.length).length, unranked: eligible.filter((p) => !p.types.length).length, assignments: eligible.reduce((n, p) => n + p.types.length, 0), changed: changes.length + removed.length, unresolved: unresolved.length },
    ...(reviewed ? { taskQualification: { qualified: records.reduce((n, p) => n + p.evidence.filter((e) => e.accepted && e.taskFit?.qualified).length, 0), pending: reviewQueue.length }, reviewQueue } : {}),
    changes: [...changes, ...removed], newListings, unresolved, rankingComparison, picks, records,
    discoveryCuration: discoveryCurationStatus(catalog, prepared),
    state: { schemaVersion: 1, classificationVersion, generatedAt: now.toISOString(), taxonomyHash: checksum(taxonomy), plugins: records.map(({ id, name, metadataHash, types }) => ({ id, name, metadataHash, types })) }
  };
}

function compareRankings(before, after) {
  const prior = new Map(before.types.map((t) => [t.id, t]));
  const types = [...after.types, ...before.types.filter((t) => !after.types.some((current) => current.id === t.id)).map((t) => ({ id: t.id, eligibleCount: 0 }))];
  return types.map((type) => {
    const previous = prior.get(type.id);
    return { typeId: type.id, beforeCount: previous?.eligibleCount ?? 0, afterCount: type.eligibleCount,
      beforeWinner: previous?.winner?.id ?? null, afterWinner: type.winner?.id ?? null,
      beforeRunnerUp: previous?.runnerUp?.id ?? null, afterRunnerUp: type.runnerUp?.id ?? null };
  });
}

const escape = (s) => String(s ?? "").replace(/[\u0000-\u001f\u007f]/g, " ").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replace(/[\\`*_{}\[\]()#+.!|]/g, "\\$&");
export function renderClassificationAudit(report) {
  const c = report.counts;
  const lines = ["# Category eligibility audit", "", `${c.catalog} listings; ${c.eligible} eligible; ${c.classified} classified; ${c.unranked} unranked; ${c.assignments} discovered assignments. Eligibility and picks use methodology ${escape(report.methodologyVersion ?? "1.0.0")}.`, "",
    `${c.changed} changed listings; ${c.unresolved} assignments held for review. Comparison: ${report.comparison}.`, "",
    "Decisions are reproducible rule evaluations, not a claim of manual review of every repository. report.json contains each listing's accepted and rejected evidence, every published pick, and all membership changes. Unresolved assignments do not compete.", ""];
  if (report.discoveryCuration) {
    const d = report.discoveryCuration;
    lines.push("## Listing-specific discovery decisions", "", `${d.activeIncludes} active inclusions; ${d.activeExcludes} active exclusions; ${d.expired.length} expired records requiring cleanup or review. These records do not grant recommendation qualification.`, "");
    for (const row of d.expired) lines.push(`- ${escape(row.pluginId)} / ${escape(row.typeId)} (${escape(row.action)}): ${escape(row.reason)}.`);
    lines.push("");
  }
  if (report.rankingComparison) {
    lines.push("## Category and pick changes", "", "| Category | Candidates before → after | Champion before → after | Runner-up before → after |", "| --- | --- | --- | --- |");
    for (const t of report.rankingComparison) if (t.beforeCount !== t.afterCount || t.beforeWinner !== t.afterWinner || t.beforeRunnerUp !== t.afterRunnerUp) lines.push(`| ${escape(t.typeId)} | ${t.beforeCount} → ${t.afterCount} | ${escape(t.beforeWinner ?? "none")} → ${escape(t.afterWinner ?? "none")} | ${escape(t.beforeRunnerUp ?? "none")} → ${escape(t.afterRunnerUp ?? "none")} |`);
    lines.push("");
  }
  if (report.taskQualification) {
    lines.push("## Recommendation qualification", "", `${report.taskQualification.qualified} assignments meet their reviewed task contracts; ${report.taskQualification.pending} assignments need capability review. Unreviewed, stale, related and rejected evidence cannot enter recommendation cards.`, "",
      "## Priority task review queue", "", "Resolve these through data/task-reviews.json using the captured catalog and source documentation; scores prioritize research only. Existing picks and prospective podium entrants come first.", "");
    for (const p of report.reviewQueue.slice(0, 20)) lines.push(`- ${escape(p.typeName)} / ${escape(p.name)} (${escape(p.pluginId)}): ${escape(p.status)}; ${p.previousPick ? "former pick; " : ""}${p.wouldEnterPodium ? "prospective podium; " : ""}awaiting review since ${escape(p.firstSeenAt)}. ${escape(p.reason)} Repository: ${escape(p.repository)}.`);
    lines.push("", "## Why each recommendation fits", "");
    for (const p of report.picks) lines.push(`- ${escape(p.typeId)} / ${escape(p.name)}: ${escape(p.eligibility.taskFit?.reason)} (${escape(p.eligibility.taskFit?.role)}). ${escape(p.eligibility.taskFit?.source?.url)}.`);
    lines.push("");
  }
  if (report.newListings.length) lines.push("## New listings", "", ...report.newListings.map((id) => `- ${escape(id)}`), "");
  lines.push("## Membership changes", "");
  for (const p of report.changes) lines.push(`- ${escape(p.name ?? p.id)} (${escape(p.id)}): added ${escape(p.added.join(", ") || "none")}; removed ${escape(p.removed.join(", ") || "none")}.`);
  lines.push("", "## Held for review", "");
  if (!report.unresolved.length) lines.push("None.");
  for (const p of report.unresolved) lines.push(`- ${escape(p.id)} / ${escape(p.typeId)}: ${escape(p.reason ?? "Needs task evidence")}`);
  return lines.join("\n") + "\n";
}
