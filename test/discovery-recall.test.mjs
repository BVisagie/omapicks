import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { auditDiscoveryRecall, readDiscoveryFixture } from "../scripts/audit-discovery-recall.mjs";
import { classifyPlugin, prepareTaxonomy, rankPlugins } from "../build/rank.mjs";
import { methodologyFor } from "../build/methodology.mjs";

const fixture = await readDiscoveryFixture();
const taxonomy = JSON.parse(await readFile(new URL("../data/app-types.json", import.meta.url)));
const reviews = JSON.parse(await readFile(new URL("../data/task-reviews.json", import.meta.url)));
const report = JSON.parse(await readFile(new URL("../docs/analysis/2026-10-30-discovery-recall.json", import.meta.url)));
const prepared = prepareTaxonomy(taxonomy);
const plugins = new Map(fixture.plugins.map((plugin) => [plugin.id, plugin]));
const matches = (id) => {
  assert.ok(plugins.has(id), `Missing captured listing ${id}`);
  return classifyPlugin(plugins.get(id), prepared);
};

test("every lost baseline discovery route has a reproducible repair or explicit disposition", () => {
  const actual = auditDiscoveryRecall(fixture, taxonomy, report.decisions, reviews);
  assert.deepEqual(actual, report);
  assert.equal(actual.summary.unexplainedAssignments, 0);
  assert.equal(actual.summary.newlyLostAssignments, 0);
  assert.deepEqual(actual.obsoleteDecisions, []);
  // The fixture includes both same-catalog classifier leads and durable editorial work.
  const origins = new Set(fixture.baselineAssignments.flatMap((assignment) => assignment.origins));
  assert.deepEqual([...origins].sort(), ["published-review-queue", "published-shortlist", "same-catalog-baseline-classifier"]);
  const baseline = prepareTaxonomy(fixture.baselineTaxonomy);
  const baselineMatches = fixture.plugins.flatMap((plugin) => classifyPlugin(plugin, baseline).map((typeId) => `${plugin.id}/${typeId}`)).sort();
  const recordedMatches = fixture.baselineAssignments.filter((assignment) => assignment.origins.includes("same-catalog-baseline-classifier"))
    .map((assignment) => `${assignment.pluginId}/${assignment.typeId}`).sort();
  assert.deepEqual(recordedMatches, baselineMatches, "the recall fixture must account for every baseline classifier match");
  const withoutDecision = auditDiscoveryRecall(fixture, taxonomy, report.decisions.slice(1), reviews);
  assert.equal(withoutDecision.summary.unexplainedAssignments, 1);
});

test("actual marketplace spellings and descriptions remain discoverable after category splits", () => {
  const positives = [
    ["io.github.hugorolimf.alttab", "window-management"],
    ["io.github.jfdnet.super-switcher", "window-management"],
    ["io.github.rohan-patnaik.window-switcher", "window-management"],
    ["jesperfiltenborg.glassdock", "window-management"],
    ["io.github.sirmenef.workspace-overview", "window-management"],
    ["io.github.maajix.spotlight", "window-management"],
    ["gdeyoung.timepiece", "world-clocks"],
    ["io.github.aryan-techie.clock", "world-clocks"],
    ["angelv.clock", "world-clocks"],
    ["io.github.nousd.chime", "timers-alarms"],
    ["io.github.nousd.chime", "world-clocks"],
    ["io.github.dkgamer02ai.lock", "lock-screen"],
    ["burninc0de.lock", "lock-screen"],
    ["io.github.jesutov2.eclipse-ember-lock", "lock-screen"],
    ["io.github.jfdnet.auto-power", "idle-sleep"],
    ["io.github.jfdnet.auto-power", "keep-awake"],
    ["berat.analog-clock", "desktop-clocks"],
    ["binaryclock.clock", "desktop-clocks"],
    ["ronnie.swissclock", "desktop-clocks"],
    ["grivera.agents", "agent-monitoring"],
    ["io.github.jeremylongshore.crew-chief", "agent-monitoring"],
    ["com.mwhuss.omarchy-hermes-api", "agent-monitoring"],
    ["io.github.dayruke.dashbots", "agent-monitoring"],
    ["io.github.tnep4.recast", "ai-chat"],
    ["robson.agent-chat", "ai-chat"],
    ["clickety-clacks.ask", "ai-chat"],
    ["io.github.comapilot", "ai-chat"],
    ["karamble.sitesentinel", "endpoint-monitoring"],
    ["io.github.ejames-dev.honcho", "endpoint-monitoring"],
    ["ram-devv1.focus-island", "music"],
    ["io.github.hugorolimf.audio", "audio"],
    ["io.github.deunnis.lacquer", "lock-screen"],
    ["io.github.deunnis.lacquer", "idle-sleep"]
  ];
  for (const [id, typeId] of positives) assert.ok(matches(id).includes(typeId), `${id}/${typeId}`);
});

test("wider discovery does not confuse hardware clocks, session types or admin controls with the target task", () => {
  const negatives = [
    ["dansmith888.cpu", "desktop-clocks"], ["kmudiam.debt-clock", "desktop-clocks"],
    ["io.github.adamtcroft.pipewire-control", "desktop-clocks"],
    ["io.github.dkgamer02ai.lock", "desktop-clocks"],
    ["io.github.alkin.screenshare", "desktop-clocks"],
    ["sid.sessions", "agent-monitoring"], ["dimitar.openvpn", "agent-monitoring"],
    ["so.agent-notch", "agent-monitoring"], ["io.github.niraj-envision.touch-bar", "agent-monitoring"],
    ["ssandys.colophon", "ai-chat"], ["skal.swap", "ai-chat"],
    ["ericvrp.floating-window-overrides", "window-management"],
    ["io.github.tlun0911.stopwatch", "timers-alarms"], ["org.omarchy.keycontroller", "timers-alarms"],
    ["ksolomon.omasolid", "timers-alarms"]
  ];
  for (const [id, typeId] of negatives) assert.ok(!matches(id).includes(typeId), `${id}/${typeId}`);
});

test("recovered discovery and a broad old override cannot supply missing source qualification", () => {
  const catalog = ["grivera.agents", "berat.analog-clock", "io.github.deunnis.lacquer"].map((id) => ({ ...plugins.get(id),
    repo: `https://github.com/example/${id}`, installAvailable: true, installCommand: `install ${id}` }));
  const ranked = rankPlugins({ catalog, stats: {}, taxonomy, taskReviews: { schemaVersion: 2, assignments: [] },
    pluginProfiles: { schemaVersion: 1, plugins: {} }, evidenceObservations: { schemaVersion: 1, plugins: {} },
    now: new Date(fixture.capturedAt), methodology: methodologyFor("1.4.0") });
  for (const typeId of ["agent-monitoring", "desktop-clocks", "lock-screen", "idle-sleep"]) {
    const type = ranked.rankings.types.find((type) => type.id === typeId);
    assert.ok(type.pendingCount > 0, typeId);
    assert.equal(type.eligibleCount, 0, typeId);
    assert.equal(type.winner, null, typeId);
  }
});
