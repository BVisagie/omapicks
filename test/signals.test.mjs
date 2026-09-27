import assert from "node:assert/strict";
import test from "node:test";
import { deriveMethodology, methodologyFor } from "../build/methodology.mjs";
import {
  copyViewRatio,
  freshnessDetail,
  installRateLowerBound,
  rankPlugins,
  shippedAt,
  verificationCoverage,
  verificationCredit
} from "../build/rank.mjs";
import { renderFixtureType, winningReason } from "../build/render.mjs";

const current = methodologyFor("1.1.0");
const published = methodologyFor("1.0.0");
const taxonomy = { schemaVersion: 1, types: [{ id: "weather", name: "Weather", description: "Forecasts", include: ["\\bweather\\b"] }] };
const now = new Date("2026-09-28T06:17:00Z");
const plugin = (id, values = {}) => ({
  id, name: id, description: "Weather widget", installAvailable: true, installCommand: `install ${id}`,
  repo: `https://github.com/example/${id}`, repositoryUpdatedAt: "2026-09-01T00:00:00Z", stars: 5, ...values
});
const close = (actual, expected, epsilon = 1e-4) => assert.ok(Math.abs(actual - expected) <= epsilon, `${actual} ≉ ${expected}`);

test("verification coverage resolves explicit, legacy and unknown values consistently", () => {
  const cases = [
    [{ verificationCoverage: "snapshot-verified" }, "snapshot-verified", 1],
    [{ verificationCoverage: "update-unverified", verificationStatus: "unverified" }, "update-unverified", 0.6],
    [{ verificationCoverage: "unverified" }, "unverified", 0],
    [{ verificationCoverage: "something-new", verificationStatus: "verified" }, "unverified", 0],
    [{ verificationStatus: "verified" }, "snapshot-verified", 1],
    [{ verificationStatus: "unverified" }, "unverified", 0],
    [{}, "unverified", 0]
  ];
  for (const [values, coverage, credit] of cases) {
    assert.equal(verificationCoverage(values), coverage, JSON.stringify(values));
    assert.equal(verificationCredit(values, current), credit, JSON.stringify(values));
  }
  // Maintainer review describes the same exact-commit fact: no extra credit.
  assert.equal(verificationCredit({ verificationCoverage: "snapshot-verified", verificationMethod: "maintainer-reviewed" }, current), 1);
  // The published 1.0.0 rules only ever looked at the effective status.
  assert.equal(verificationCredit({ verificationCoverage: "update-unverified", verificationStatus: "unverified" }, published), 0);
  assert.equal(verificationCredit({ verificationStatus: "verified" }, published), 1);
});

test("graded verification moves identical plugins by exactly its weighted credit", () => {
  const stats = { a: { copies: 10, hearts: 2, views: 50 }, b: { copies: 10, hearts: 2, views: 50 }, c: { copies: 10, hearts: 2, views: 50 } };
  const { rankings, cohorts } = rankPlugins({
    catalog: [
      plugin("a", { verificationCoverage: "snapshot-verified", verificationStatus: "verified" }),
      plugin("b", { verificationCoverage: "update-unverified", verificationStatus: "unverified" }),
      plugin("c", { verificationCoverage: "unverified", verificationStatus: "unverified" })
    ],
    stats, taxonomy, now, detail: true
  });
  const score = Object.fromEntries(cohorts.weather.map((candidate) => [candidate.id, candidate.score]));
  close(score.a - score.b, 0.05 * (1 - 0.6), 2e-6);
  close(score.a - score.c, 0.05, 2e-6);
  assert.equal(rankings.types[0].winner.id, "a");
});

test("a legacy verified plugin keeps full credit and a matching badge through rank, JSON and render", () => {
  const legacy = plugin("legacy", { verificationStatus: "verified" });
  const states = ["snapshot-verified", "update-unverified", "unverified"].map((coverage) => plugin(coverage, { verificationCoverage: coverage, stars: 1 }));
  const { rankings } = rankPlugins({ catalog: [legacy, ...states], stats: { legacy: { copies: 90, hearts: 9, views: 400 } }, taxonomy, now });
  const snapshot = JSON.parse(JSON.stringify(rankings));
  const winner = snapshot.types[0].winner;
  assert.equal(winner.id, "legacy");
  assert.equal(winner.verificationCoverage, "snapshot-verified");
  assert.equal(winner.normalized.verified, 1);
  assert.equal(winner.contributions.verified, 0.05);
  const html = renderFixtureType(snapshot.types[0], snapshot);
  assert.match(html, /<span class="status verified">Snapshot verified<\/span>/);
  const badge = (candidate) => renderFixtureType({ ...snapshot.types[0], winner: candidate, runnerUp: null }, snapshot).match(/<span class="status[^"]*">([^<]+)<\/span>/)[1];
  assert.equal(badge({ ...winner, verificationCoverage: "update-unverified" }), "Verified snapshot; update unverified");
  assert.equal(badge({ ...winner, verificationCoverage: "unverified" }), "Community");
  // A snapshot from before coverage existed falls back to its effective status.
  const { verificationCoverage: _, ...historical } = winner;
  assert.equal(badge({ ...historical, verificationStatus: "verified" }), "Snapshot verified");
  assert.equal(badge({ ...historical, verificationStatus: "unverified" }), "Community");
  assert.match(html, /The command installs the repository's current code, not a verified snapshot\./);
});

test("fallback explanations use the snapshot's verification rule, not today's credit", () => {
  const base = { metrics: { copies: 5, hearts: 1, stars: 1, views: 30 }, normalized: { freshness: 0.5 }, score: 0.6 };
  const winner = { ...base, id: "w", name: "W", verificationStatus: "unverified", verificationCoverage: "update-unverified" };
  const runnerUp = { ...base, id: "r", name: "R", verificationStatus: "unverified", verificationCoverage: "unverified", score: 0.59 };
  assert.equal(winningReason(winner, runnerUp, null, published), "It led this week's combined public-registry score in a close race.");
  assert.match(winningReason(winner, runnerUp, null, current), /stronger verification evidence tipped/);
});

test("copy/view ratio and Wilson lower bound match hand-checked values", () => {
  assert.equal(copyViewRatio(17, 64), 0.265625);
  close(installRateLowerBound(17, 64), 0.1730);
  assert.equal(installRateLowerBound(0, 20), 0);
  assert.equal(copyViewRatio(0, 20), 0);
  close(installRateLowerBound(20, 20), 0.83887);
  assert.equal(copyViewRatio(30, 25), 1);
  assert.equal(installRateLowerBound(30, 25), installRateLowerBound(25, 25));
  assert.equal(installRateLowerBound(5, 5), null);
  for (let copies = 0; copies <= 19; copies += 1) assert.equal(installRateLowerBound(copies, 19), null);
  assert.equal(copyViewRatio(19, 19), 1);
  assert.ok(installRateLowerBound(19, 20) > 0);
  assert.equal(copyViewRatio(3, 0), null);
  assert.equal(installRateLowerBound(3, 0), null);
  // Counts are sanitized like the marketplace: truncated, non-negative safe integers.
  assert.equal(copyViewRatio(2.9, 20.7), 0.1);
  assert.equal(copyViewRatio(-3, 20), 0);
  assert.equal(copyViewRatio("abc", 20), 0);
  assert.equal(installRateLowerBound(5, Number.NaN), null);
});

function rateCohort(stats) {
  const catalog = Object.keys(stats).map((id) => plugin(id));
  return rankPlugins({ catalog, stats, taxonomy, now, detail: true }).cohorts.weather;
}

test("copy/view normalization handles empty, singleton, all-zero and mixed cohorts without NaN", () => {
  const cohorts = {
    none: rateCohort({ a: { copies: 3, hearts: 0, views: 10 }, b: { copies: 1, hearts: 0, views: 5 } }),
    single: rateCohort({ a: { copies: 30, hearts: 0, views: 100 }, b: { copies: 1, hearts: 0, views: 5 } }),
    zero: rateCohort({ a: { copies: 0, hearts: 4, views: 100 }, b: { copies: 0, hearts: 3, views: 60 } }),
    mixed: rateCohort({ a: { copies: 40, hearts: 0, views: 100 }, b: { copies: 5, hearts: 0, views: 100 }, c: { copies: 2, hearts: 0, views: 10 } })
  };
  for (const [name, cohort] of Object.entries(cohorts)) {
    for (const candidate of cohort) {
      assert.ok(Number.isFinite(candidate.score), `${name}/${candidate.id} score`);
      assert.ok(Number.isFinite(candidate.normalized.installRateLowerBound), `${name}/${candidate.id} rate`);
      close(candidate.contributions.installRateLowerBound, candidate.normalized.installRateLowerBound * 0.05, 1e-6);
    }
  }
  const byId = (cohort) => Object.fromEntries(cohort.map((candidate) => [candidate.id, candidate]));
  for (const candidate of cohorts.none) assert.equal(candidate.normalized.installRateLowerBound, 0.5);
  for (const candidate of cohorts.zero) assert.equal(candidate.normalized.installRateLowerBound, 0.5);
  assert.equal(byId(cohorts.single).b.normalized.installRateLowerBound, 0.5);
  assert.ok(byId(cohorts.single).a.normalized.installRateLowerBound > 0.5);
  const mixed = byId(cohorts.mixed);
  assert.equal(mixed.c.metrics.installRateLowerBound, null);
  assert.equal(mixed.c.normalized.installRateLowerBound, 0.5);
  assert.ok(mixed.a.normalized.installRateLowerBound > 0.5 && mixed.b.normalized.installRateLowerBound < 0.5);
  assert.equal(mixed.a.metrics.copyViewRatio, 0.4);
  close(mixed.a.metrics.installRateLowerBound, 0.3094);
  // Count normalization is untouched by the new signal.
  const withoutRate = deriveMethodology(current, { installRate: null, weights: { views: 0.08, installRateLowerBound: 0 } }, "no-rate");
  const baseline = rankPlugins({ catalog: Object.keys(mixed).map((id) => plugin(id)), stats: { a: { copies: 40, hearts: 0, views: 100 }, b: { copies: 5, hearts: 0, views: 100 }, c: { copies: 2, hearts: 0, views: 10 } }, taxonomy, now, detail: true, methodology: withoutRate }).cohorts.weather;
  for (const candidate of baseline) {
    for (const metric of ["copies", "hearts", "stars", "views"]) assert.equal(mixed[candidate.id].normalized[metric], candidate.normalized[metric]);
  }
});

test("shipping observations use the latest valid version change or dated release", () => {
  assert.equal(shippedAt({ versionUpdatedAt: "2026-09-01T00:00:00Z", repositoryRelease: { tag: "v2", publishedAt: "2026-09-10T00:00:00Z" } }), "2026-09-10T00:00:00.000Z");
  assert.equal(shippedAt({ versionUpdatedAt: "2026-09-20T00:00:00Z", repositoryRelease: { tag: "v2", publishedAt: "2026-09-10T00:00:00Z" } }), "2026-09-20T00:00:00.000Z");
  assert.equal(shippedAt({ versionUpdatedAt: "not a date", repositoryRelease: { tag: "v1" } }), null);
  assert.equal(shippedAt({ repositoryRelease: { tag: "v1" } }), null);
  assert.equal(shippedAt({}), null);
  assert.equal(shippedAt(null), null);
});

test("the evaluated shipping bonus is bounded, capped and cut off after 90 days", () => {
  const bonus = deriveMethodology(current, { freshness: { shippingBonus: { amount: 0.15, halfLifeDays: 90, windowDays: 90 } } }, "bonus");
  const at = (days) => new Date(now.getTime() - days * 86_400_000).toISOString();
  const detail = (values) => freshnessDetail(values, now, bonus);
  const release = detail({ repositoryUpdatedAt: at(200), repositoryRelease: { publishedAt: at(30) } });
  close(release.base, Math.exp(-Math.log(2) * 30 / 180), 1e-9);
  close(release.bonus, 0.15 * Math.exp(-Math.log(2) * 30 / 90), 1e-9);
  assert.equal(detail({ repositoryUpdatedAt: at(0), versionUpdatedAt: at(0) }).value, 1);
  assert.ok(detail({ versionUpdatedAt: at(10) }).value > 0);
  assert.equal(detail({}).value, 0);
  assert.equal(detail({ repositoryUpdatedAt: at(-5), versionUpdatedAt: at(-5) }).value, 1);
  assert.ok(detail({ repositoryUpdatedAt: at(400), versionUpdatedAt: at(89.9) }).bonus > 0);
  assert.equal(detail({ repositoryUpdatedAt: at(400), versionUpdatedAt: at(90.1) }).bonus, 0);
  for (const days of [0, 1, 30, 89, 91, 365]) {
    const value = detail({ repositoryUpdatedAt: at(days), versionUpdatedAt: at(days) }).value;
    assert.ok(value >= 0 && value <= 1);
  }
  // Methodology 1.1.0 did not adopt it: freshness remains push-only.
  assert.equal(freshnessDetail({ repositoryUpdatedAt: at(200), versionUpdatedAt: at(1) }, now, current).bonus, 0);
});
