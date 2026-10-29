import assert from "node:assert/strict";
import test from "node:test";
import {
  renderFixtureBadge, renderFixtureChangelog, renderFixtureFeed, renderFixtureHome,
  renderFixtureMethodology, renderFixtureType, withAvailability
} from "../build/render.mjs";

const revision = "a".repeat(40);
function candidate(id = "forecast") {
  const source = {
    url: "https://github.com/example/weather", revision, path: "docs/Weather setup.md",
    evidence: "Shows current conditions and a forecast. <script>untrusted()</script>"
  };
  return {
    id, name: `Forecast ${id}`, author: "Example", description: "Weather and forecast",
    repository: "https://github.com/example/weather", detailUrl: `https://plugins.omarchy.org/plugin.html?id=${id}`,
    installCommand: `omarchy plugin add https://github.com/example/${id}.git`,
    verificationCoverage: "snapshot-verified", score: 0.8, metrics: { copies: 12, hearts: 4, views: 40, stars: 7 },
    normalized: { freshness: 0.8 },
    taskFit: {
      qualified: true, role: "core", provenance: "repository-evidence", reviewedAt: "2026-10-26",
      reason: "Shows local conditions and a multi-day forecast.", constraints: ["Requires a weather API key."],
      pluginRequirements: ["Requires a weather API key.", "Requires Omarchy 4."], requirementsStatus: "reviewed",
      source, sources: [source], profileSources: [{ ...source, evidence: "Requires Omarchy 4 and a weather API key." }],
      lastValidatedAt: "2026-10-28T06:00:00Z", evidenceStatus: "current"
    }
  };
}

function snapshot() {
  return {
    methodologyVersion: "1.3.0", week: "2026-W44", generatedAt: "2026-10-26T06:00:00Z",
    types: [{ id: "weather", name: "Weather", description: "Current conditions and forecasts", eligibleCount: 3,
      pendingCount: 8, winner: candidate(), runnerUp: { ...candidate("rain"), score: 0.7 },
      alternatives: [candidate("snow")],
      builtIns: [{ id: "omarchy.weather", name: "Weather pill", description: "Displays current conditions", sourceUrl: "https://github.com/omacom/omarchy" }]
    }]
  };
}

function observation(rankings, plugins) {
  return { schemaVersion: 1, generatedAt: "2026-10-29T06:00:00Z", rankingsGeneratedAt: rankings.generatedAt,
    catalogGeneratedAt: "2026-10-29T05:00:00Z", plugins };
}

test("reviewed shortlists foreground requirements, pinned evidence and honest coverage before popularity", () => {
  const rankings = snapshot();
  const type = rankings.types[0];
  const html = renderFixtureType(type, rankings);
  assert.match(html, /01 Leading reviewed option/);
  assert.match(html, /02 Another reviewed option/);
  assert.match(html, /3 qualified options/);
  assert.match(html, /8 pending research leads/);
  assert.match(html, /Pending matches have not been established as suitable alternatives/);
  assert.match(html, /Repository evidence reviewed · Reviewed 2026-10-26/);
  assert.match(html, /Evidence checked October 28, 2026/);
  assert.match(html, /Known installation requirements reviewed/);
  assert.match(html, /Requires a weather API key\. Requires Omarchy 4\./);
  assert.doesNotMatch(html, /Requires a weather API key\. Requires a weather API key\./);
  assert.match(html, /<details class="capability-evidence"><summary>Read the supporting evidence/);
  assert.ok(html.includes(`/blob/${revision}/docs/Weather%20setup.md`));
  assert.match(html, /Requirements evidence/);
  assert.match(html, /&lt;script&gt;untrusted\(\)&lt;\/script&gt;/);
  assert.doesNotMatch(html, /<script>untrusted/);
  assert.match(html, /Installation and task completion have not been tested/);
  assert.match(html, /Compare the documented built-in capabilities/);
  assert.ok(html.indexOf("More choices for this task") < html.indexOf('id="comparison-heading"'));
  assert.match(html, /not a quality grade, confidence percentage, or measure of task success/);
  assert.doesNotMatch(html, /01 Champion|02 Runner-up|class="why-won"|It won mainly/);
  const home = renderFixtureHome(rankings);
  assert.match(home, /Find an Omarchy plugin that fits your task/);
  assert.match(home, /Reviewed options for/);
  assert.doesNotMatch(home, /Best <a|Compare champion and runner-up/);
  assert.match(renderFixtureMethodology(rankings), /Requirements establish suitability/);
});

test("missing requirements and evidence that needs review remain explicit", () => {
  const rankings = snapshot();
  const fit = rankings.types[0].winner.taskFit;
  delete fit.requirementsStatus;
  delete fit.pluginRequirements;
  fit.evidenceStatus = "changed";
  fit.sources[0].url = "javascript:alert(1)";
  const html = renderFixtureType(rankings.types[0], rankings);
  assert.match(html, /Installation requirements have not been fully reviewed/);
  assert.match(html, /Source evidence changed; re-review is pending/);
  assert.doesNotMatch(html, /href="javascript:/);
});

test("related scope keeps setup disclosures and review evidence without claiming task qualification", () => {
  const rankings = snapshot();
  const related = candidate("related");
  related.taskFit = { ...related.taskFit, qualified: false, status: "related", role: "integration", reason: "Only displays reports from a separate weather service.", pluginRequirements: ["Requires a paid service account."] };
  rankings.types[0].relatedTools = [related];
  const html = renderFixtureType(rankings.types[0], rankings);
  assert.match(html, /Narrower scope:<\/strong> Only displays reports/);
  assert.match(html, /Requires a paid service account/);
});

test("current availability suppresses only unavailable installs, without changing weekly selection or badges", () => {
  const rankings = snapshot();
  const before = structuredClone(rankings);
  const badge = renderFixtureBadge(rankings.types[0], rankings);
  const current = withAvailability(rankings, observation(rankings, {
    forecast: { status: "unavailable", reason: "Repository could not be reached", checkedAt: "2026-10-29T05:00:00Z", verificationCoverage: "update-unverified" },
    rain: { status: "available", reason: "Latest check passed", checkedAt: "2026-10-29T05:00:00Z", verificationCoverage: "update-unverified" },
    snow: { status: "unavailable", reason: "No longer listed", checkedAt: "2026-10-29T05:00:00Z" }
  }));
  assert.deepEqual(rankings, before);
  assert.equal(current.types[0].winner.id, rankings.types[0].winner.id);
  assert.equal(current.types[0].winner.score, rankings.types[0].winner.score);
  assert.equal(renderFixtureBadge(current.types[0], current), badge);
  const html = renderFixtureType(current.types[0], current);
  assert.match(html, /Current availability observed <time datetime="2026-10-29T06:00:00Z"/);
  assert.match(html, /Currently unavailable/);
  assert.match(html, /Weekly selection is unchanged/);
  assert.match(html, /Verified snapshot; update unverified/);
  assert.doesNotMatch(html, /<code>omarchy plugin add https:\/\/github\.com\/example\/forecast\.git<\/code>/);
  assert.match(html, /<code>omarchy plugin add https:\/\/github\.com\/example\/rain\.git<\/code>/);
  assert.match(html, /No longer listed/);
  assert.match(renderFixtureHome(current), /Forecast forecast · Example · Currently unavailable/);
});

test("mismatched, absent or malformed observations cannot masquerade as current passed checks", () => {
  const rankings = snapshot();
  const passed = { status: "available", checkedAt: "2026-10-29T05:00:00Z", verificationCoverage: "snapshot-verified" };
  const stale = { ...observation(rankings, { forecast: passed }), rankingsGeneratedAt: "2026-10-19T06:00:00Z" };
  for (const artifact of [null, stale, observation(rankings, {}), observation(rankings, { forecast: { ...passed, checkedAt: "bad date" } })]) {
    const current = withAvailability(rankings, artifact);
    assert.equal(current.types[0].winner.availability.status, "unknown");
    const html = renderFixtureType(current.types[0], current);
    assert.match(html, /Current availability unknown/);
    assert.doesNotMatch(html, /Marketplace check passed/);
  }
});

test("history keeps its original labels and never acquires a current availability overlay", () => {
  const legacy = { ...snapshot(), methodologyVersion: "1.2.0", week: "2026-W43", changes: [
    { typeId: "weather", typeName: "Weather", current: { id: "old", name: "Old Pick" }, previous: null }
  ] };
  const modern = { ...snapshot(), changes: [
    { typeId: "weather", typeName: "Weather", current: { id: "new", name: "New Pick" }, previous: { id: "old", name: "Old Pick" } }
  ] };
  const projected = withAvailability(legacy, observation(legacy, { forecast: { status: "unavailable", checkedAt: "2026-10-29T05:00:00Z" } }));
  assert.deepEqual(projected, legacy);
  assert.match(renderFixtureBadge(legacy.types[0], legacy), /Weather champion:/);
  assert.match(renderFixtureBadge(modern.types[0], modern), /Weather leading reviewed option:/);
  assert.match(renderFixtureChangelog([modern, legacy]), /categories received their first champion/);
  const { page, rss } = renderFixtureFeed([modern, legacy]);
  assert.match(page, /Weekly selection changes/);
  for (const output of [page, rss]) {
    assert.match(output, /Old Pick is the Weather champion/);
    assert.match(output, /New Pick is the Weather leading reviewed option/);
  }
});

test("retained modern history describes qualification holds at their publication, not as current state", () => {
  const rankings = snapshot();
  rankings.runnerUpChanges = [
    { typeId: "weather", typeName: "Weather", kind: "displaced", previous: { id: "rain", name: "Rain" }, current: { id: "other", name: "Other" }, reason: "awaiting-task-qualification" },
    { typeId: "weather", typeName: "Weather", kind: "displaced", previous: { id: "other", name: "Other" }, current: { id: "rain", name: "Rain" } }
  ];
  const html = renderFixtureChangelog([rankings]);
  assert.match(html, /At that publication, Rain was awaiting task qualification before it could compete/);
  assert.doesNotMatch(html, /Rain is awaiting/);
  assert.match(html, /Rain<\/strong> replaced Other/);
});
