import { boundedText, categoryPath, finite, isDay } from "./common.mjs";

const DAY_MS = 86400000;
const STALE_DAYS = 180;

function count(value) {
  return Array.isArray(value) ? value.length : finite(value);
}

function ageDays(iso, now) {
  const time = Date.parse(iso);
  return Number.isFinite(time) ? Math.max(0, (now.getTime() - time) / DAY_MS) : null;
}

function picksOf(snapshot) {
  return snapshot.types.flatMap((type) => [type.winner, type.runnerUp].filter(Boolean));
}

function longestHeld(rankings, history) {
  const newestFirst = [...history].sort((a, b) => b.week.localeCompare(a.week));
  return rankings.types
    .filter((type) => type.winner)
    .map((type) => {
      let weeks = 0;
      for (const snapshot of newestFirst) {
        const past = snapshot.types.find((entry) => entry.id === type.id);
        if (past?.winner?.id !== type.winner.id) break;
        weeks += 1;
      }
      return { path: categoryPath(type.id), category: boundedText(type.name, 60), pick: boundedText(type.winner.name, 60), weeks: Math.max(weeks, 1) };
    })
    .sort((a, b) => b.weeks - a.weeks || a.category.localeCompare(b.category))
    .slice(0, 10);
}

function engagementGrowth(rankings, history) {
  const ordered = [...history].sort((a, b) => a.week.localeCompare(b.week));
  const baseline = ordered.length > 4 ? ordered[ordered.length - 5] : ordered[0];
  if (!baseline) return null;
  const before = new Map(picksOf(baseline).map((pick) => [pick.id, pick.metrics ?? {}]));
  const winners = rankings.types.filter((type) => type.winner).map((type) => type.winner);
  const unique = [...new Map(winners.map((pick) => [pick.id, pick])).values()];
  const matched = unique.filter((pick) => before.has(pick.id));
  const growth = matched
    .map((pick) => ({ pick: boundedText(pick.name, 60), copies: finite(pick.metrics?.copies), gained: finite(pick.metrics?.copies) - finite(before.get(pick.id).copies) }))
    .sort((a, b) => b.gained - a.gained);
  return {
    baselineWeek: baseline.week,
    picksCompared: matched.length,
    copiesNow: matched.reduce((sum, pick) => sum + finite(pick.metrics?.copies), 0),
    copiesThen: matched.reduce((sum, pick) => sum + finite(before.get(pick.id).copies), 0),
    heartsNow: matched.reduce((sum, pick) => sum + finite(pick.metrics?.hearts), 0),
    heartsThen: matched.reduce((sum, pick) => sum + finite(before.get(pick.id).hearts), 0),
    topGrowth: growth.slice(0, 5)
  };
}

export function summarizeSite({ rankings, unclassified, availability, history, now = new Date() }) {
  const excluded = Object.fromEntries(Object.entries(unclassified.excluded ?? {}).map(([reason, value]) => [boundedText(reason, 40), count(value)]));
  const categories = rankings.types.map((type) => ({
    path: categoryPath(type.id),
    name: boundedText(type.name, 60),
    eligible: finite(type.eligibleCount),
    pending: finite(type.pendingCount),
    winner: type.winner ? boundedText(type.winner.name, 60) : null,
    winnerCopies: type.winner ? finite(type.winner.metrics?.copies) : 0,
    hasRunnerUp: Boolean(type.runnerUp)
  }));

  const picks = picksOf(rankings);
  const distinct = [...new Map(picks.map((pick) => [pick.id, pick])).values()];
  const statuses = availability?.plugins ?? {};
  const unavailable = distinct
    .filter((pick) => statuses[pick.id] && statuses[pick.id].status !== "available")
    .map((pick) => ({ pick: boundedText(pick.name, 60), status: boundedText(statuses[pick.id].status, 30) }));
  const tally = (values) =>
    Object.entries(values.reduce((acc, value) => ({ ...acc, [value]: (acc[value] ?? 0) + 1 }), {}))
      .map(([name, total]) => ({ name, total }))
      .sort((a, b) => b.total - a.total || a.name.localeCompare(b.name));
  const authors = tally(rankings.types.filter((type) => type.winner).map((type) => boundedText(type.winner.author, 60) || "Unknown")).filter((entry) => entry.total > 1);

  const weeks = [...history]
    .sort((a, b) => a.week.localeCompare(b.week))
    .map((snapshot) => {
      const changes = snapshot.changes ?? [];
      return {
        week: snapshot.week,
        methodology: boundedText(snapshot.methodologyVersion, 12),
        categories: snapshot.types.length,
        changes: changes.length,
        displaced: changes.filter((entry) => entry.kind === "displaced").length,
        newChampions: changes.filter((entry) => entry.kind === "new-champion").length
      };
    });
  const displacedBy = new Map();
  for (const snapshot of history) {
    for (const entry of snapshot.changes ?? []) {
      if (entry.kind !== "displaced") continue;
      const item = displacedBy.get(entry.typeId) ?? { path: categoryPath(entry.typeId), name: boundedText(entry.typeName, 60), displaced: 0 };
      item.displaced += 1;
      displacedBy.set(entry.typeId, item);
    }
  }

  return {
    status: "ok",
    snapshot: {
      week: rankings.week,
      methodology: rankings.methodologyVersion,
      generatedAt: rankings.generatedAt,
      ageDays: ageDays(rankings.generatedAt, now),
      availabilityCheckedAt: availability?.generatedAt ?? null,
      availabilityAgeDays: ageDays(availability?.generatedAt, now)
    },
    funnel: {
      catalog: finite(unclassified.catalogCount),
      excluded,
      classified: finite(unclassified.eligibleClassifiedCount),
      unclassified: finite(unclassified.uniqueUnclassifiedCount),
      qualified: count(unclassified.qualifiedAssignments),
      pending: count(unclassified.pendingAssignments)
    },
    categories: {
      total: categories.length,
      withRunnerUp: categories.filter((entry) => entry.hasRunnerUp).length,
      singleOption: categories.filter((entry) => entry.eligible === 1).length,
      withoutPick: categories.filter((entry) => !entry.winner).length,
      list: categories
    },
    publications: [...new Set(history.map((snapshot) => String(snapshot.generatedAt ?? "").slice(0, 10)).filter(isDay))].sort(),
    newListings: (rankings.newListings ?? []).map((entry) => boundedText(entry.name, 60)).filter(Boolean),
    picks: {
      distinct: distinct.length,
      unavailable,
      stale: distinct.filter((pick) => finite(pick.freshnessDays) > STALE_DAYS).length,
      verification: tally(distinct.map((pick) => boundedText(pick.verificationCoverage, 40) || "unknown")),
      licenses: tally(distinct.map((pick) => boundedText(pick.license, 40) || "unknown")).slice(0, 6),
      repeatAuthors: authors
    },
    stability: {
      weeks,
      longestHeld: longestHeld(rankings, history),
      mostDisplaced: [...displacedBy.values()].sort((a, b) => b.displaced - a.displaced || a.name.localeCompare(b.name)).slice(0, 5)
    },
    engagement: engagementGrowth(rankings, history)
  };
}
