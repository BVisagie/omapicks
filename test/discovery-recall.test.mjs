import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { auditDiscoveryRecall, discoveryListingHash, readDiscoveryFixture } from "../scripts/audit-discovery-recall.mjs";
import { classifyPlugin, prepareTaxonomy, rankPlugins, discoveryCurationStatus } from "../build/rank.mjs";
import { methodologyFor } from "../build/methodology.mjs";

const fixture = await readDiscoveryFixture();
const taxonomy = JSON.parse(await readFile(new URL("../data/app-types.json", import.meta.url)));
const reviews = JSON.parse(await readFile(new URL("../data/task-reviews.json", import.meta.url)));
const report = JSON.parse(await readFile(new URL("../docs/analysis/2026-10-30-discovery-recall.json", import.meta.url)));
const expectations = JSON.parse(await readFile(new URL("./fixtures/discovery-expectations.json", import.meta.url))).assignments;
const prepared = prepareTaxonomy(taxonomy);
const plugins = new Map(fixture.plugins.map((plugin) => [plugin.id, plugin]));
const matches = (id) => {
  assert.ok(plugins.has(id), `Missing captured listing ${id}`);
  return classifyPlugin(plugins.get(id), prepared);
};

test("independent destination expectations cover every split lead and discovery regression", () => {
  const actual = auditDiscoveryRecall(fixture, taxonomy, expectations, reviews);
  assert.deepEqual(actual, report);
  assert.equal(actual.summary.unresolvedAssignments, 0);
  assert.equal(actual.summary.missingRoutes, 0);
  assert.equal(actual.summary.unexpectedRoutes, 0);
  assert.deepEqual(actual.obsoleteExpectations, []);
  const baseline = prepareTaxonomy(fixture.baselineTaxonomy);
  const baselineMatches = fixture.plugins.flatMap((plugin) => classifyPlugin(plugin, baseline).map((typeId) => `${plugin.id}/${typeId}`)).sort();
  const recordedMatches = fixture.baselineAssignments.filter((assignment) => assignment.origins.includes("same-catalog-baseline-classifier"))
    .map((assignment) => `${assignment.pluginId}/${assignment.typeId}`).sort();
  assert.deepEqual(recordedMatches, baselineMatches, "every same-catalog baseline classifier match is retained");
  const withoutDecision = auditDiscoveryRecall(fixture, taxonomy, expectations.slice(1), reviews);
  assert.equal(withoutDecision.summary.unresolvedAssignments, 1);
});

test("reaching one successor cannot hide a missing correct route or an unwanted route", () => {
  const plugin = { id: "example.idle", name: "Idle settings", description: "Idle timings and keep awake" };
  const old = structuredClone(fixture.baselineTaxonomy);
  const minimal = { ...fixture, plugins: [plugin], baselineTaxonomy: old, regressionAssignments: [],
    proposalDiscoveries: [], baselineAssignments: [{ pluginId: plugin.id, typeId: "lock-idle", origins: ["same-catalog-baseline-classifier"] }] };
  const judgment = { pluginId: plugin.id, typeId: "lock-idle", expectedTargets: ["idle-sleep", "keep-awake"],
    listingSha256: discoveryListingHash(plugin), reason: "The listing advertises idle timings and an awake hold.",
    evidence: [{ field: "description", quote: plugin.description }] };
  const rules = structuredClone(taxonomy);
  rules.overrides = { include: { [plugin.id]: ["keep-awake", "lock-screen"] }, exclude: { [plugin.id]: ["idle-sleep"] } };
  const result = auditDiscoveryRecall(minimal, rules, [judgment]);
  assert.equal(result.decisions.length, 1, "split leads remain in scope when a successor still matches");
  assert.deepEqual(result.decisions[0].missingTargets, ["idle-sleep"]);
  assert.deepEqual(result.decisions[0].unexpectedTargets, ["lock-screen"]);
  assert.equal(result.summary.unresolvedAssignments, 1);
  const alternativeJudgment = { ...judgment, expectedTargets: ["keep-awake"] };
  const changed = auditDiscoveryRecall(minimal, rules, [alternativeJudgment]);
  assert.deepEqual(changed.decisions[0].missingTargets, []);
  assert.deepEqual(changed.decisions[0].unexpectedTargets, ["lock-screen"]);
});

test("expectations detect listing drift and invalid evidence", () => {
  const altered = structuredClone(expectations);
  altered[0].evidence = [{ field: "description", quote: "invented source passage" }];
  let result = auditDiscoveryRecall(fixture, taxonomy, altered, reviews);
  assert.ok(result.decisions.find((row) => row.pluginId === altered[0].pluginId && row.typeId === altered[0].typeId).issues.includes("invalid-listing-evidence"));
  const drift = structuredClone(fixture);
  const plugin = drift.plugins.find((p) => p.id === altered[0].pluginId);
  plugin.description += " Changed upstream.";
  result = auditDiscoveryRecall(drift, taxonomy, expectations, reviews);
  assert.ok(result.decisions.find((row) => row.pluginId === plugin.id && row.typeId === altered[0].typeId).issues.includes("listing-changed"));
  assert.throws(() => auditDiscoveryRecall(fixture, taxonomy, [...expectations, expectations[0]]), /Duplicate discovery expectation/);
});

test("actual marketplace spellings and descriptions remain discoverable after category splits", () => {
  const positives = [
    ["io.github.jramiresbrito.idle-timings", "idle-sleep"],
    ["azterisk.idle", "idle-sleep"],
    ["io.github.franck.omapower", "idle-sleep"],
    ["io.github.bodhiblues.idle-toggle", "keep-awake"],
    ["nomdelasociete.dsmn", "keep-awake"],
    ["keis.vibe", "agent-history"],
    ["zen.awake", "keep-awake"],
    ["chupe.lid-suspend", "keep-awake"],
    ["io.github.manateelazycat.power-awake", "keep-awake"],
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
    ["io.github.deunnis.lacquer", "lock-screen"]
  ];
  for (const [id, typeId] of positives) assert.ok(matches(id).includes(typeId), `${id}/${typeId}`);
});

test("wider discovery does not confuse hardware clocks, session types or admin controls with the target task", () => {
  const negatives = [
    ["brightwalker25.mac-fan", "desktop-clocks"],
    ["io.github.bblicke1.omarkdash", "desktop-clocks"],
    ["io.github.prostratepossum.starwatch-lock", "desktop-clocks"],
    ["io.github.bodhiblues.idle-toggle", "lock-screen"],
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

test("multipurpose listings retain real capabilities alongside narrower features", () => {
  for (const [typeId, description] of [
    ["weather", "Current conditions, hourly forecast, air quality, pollen and sun times."],
    ["weather", "Current conditions and hourly forecast with National Weather Service alerts."],
    ["weather", "Weather forecast and rain radar."],
    ["network", "Connect, disconnect and forget Wi-Fi networks, with captive portal support."],
    ["idle-sleep", "Set idle timeouts and actions, or prevent sleep temporarily."],
    ["agent-monitoring", "Monitor busy Claude and Codex sessions live; launch and resume them."],
    ["endpoint-monitoring", "Uptime Kuma monitors configured endpoints with status pages."],
    ["lock-screen", "Lock screen themes with face unlock support."],
    ["desktop-clocks", "Desktop clock widget with date, weather and temperature."]
  ]) assert.ok(classifyPlugin({ id: "example.multi", name: "Utility", description }, prepared).includes(typeId), description);
});

test("session history means coding conversations, not incidental usage or unrelated histories", () => {
  assert.ok(matches("riclib.agentsview").includes("agent-history"));
  for (const id of ["io.github.thisisgm.omapods", "io.github.dharmapurikar.otter", "gg.arkship.ssh-mic-bridge",
    "io.github.ludoplex.omamarket", "cheapseatsecon.laya-attention", "io.github.viganogabriele.agent-usage-plus",
    "local.opencode-go", "io.github.ericyhm80.agent-pipeline", "io.github.daventhedude.omarchief"]) {
    assert.ok(!matches(id).includes("agent-history"), id);
  }
  // Fresh IDs bypass curated exceptions, exercising the general language rules.
  for (const description of ["AirPods with conversation awareness.", "Air quality history.",
    "AI token history and reset times.", "Browse marketplaces with Claude plugins.",
    "AI agent requests and notification history.", "Claude Code voice conversations over SSH."]) {
    assert.ok(!classifyPlugin({ id: "example.history", name: "Utility", description }, prepared).includes("agent-history"), description);
  }
});

test("non-coding sessions and agents are rejected without listing-specific exceptions", () => {
  const raw = prepareTaxonomy({ ...taxonomy, overrides: {} });
  for (const subject of ["Pomodoro tracker", "Workout tracker", "tmux", "VPN", "Screen recording indicator", "Backup agent", "SSH agent", "Jenkins agent", "Wazuh agent"]) {
    for (const action of ["past sessions", "recent sessions", "restore saved sessions", "recent session history", "pause and resume", "past sessions and click to resume"]) {
      const description = `${subject} with ${action}.`;
      assert.ok(!classifyPlugin({ id: "fresh.subject", name: "Utility", description }, raw).includes("agent-history"), description);
    }
  }
  for (const description of ["Backup agent fails and waits", "Jenkins agents finish or fail", "Wazuh agents running and reporting status", "SSH agent status and monitoring", "Jenkins dashboard with live agents", "A backup console lists working agents", "Monitor busy agents on an SSH server"]) {
    assert.ok(!classifyPlugin({ id: "fresh.monitor", name: "Utility", description }, raw).includes("agent-monitoring"), description);
  }
  for (const description of ["Microsoft 365 service health", "Read Office 365 service health incidents"]){
    const matches = classifyPlugin({ id: "fresh.provider", name: "Utility", description }, raw);
    assert.ok(!matches.includes("endpoint-monitoring"), description);
    assert.ok(matches.includes("service-status"), description);
  }
  for (const description of ["Claude Code with past sessions", "Browse Codex session history", "OpenCode with resume saved sessions", "Herdr agent resume"]) {
    assert.ok(classifyPlugin({ id: "fresh.coding", name: "Utility", description }, raw).includes("agent-history"), description);
  }
});

test("hardware and lock-only clocks are rejected by rules while civil-time displays survive", () => {
  const raw = prepareTaxonomy({ ...taxonomy, overrides: {} });
  for (const id of ["brightwalker25.mac-fan", "io.github.bblicke1.omarkdash", "io.github.prostratepossum.starwatch-lock", "dansmith888.cpu"]) {
    assert.ok(!classifyPlugin({ ...plugins.get(id), id: `fresh.${id}` }, raw).includes("desktop-clocks"), id);
  }
  for (const description of ["CPU load, per-core activity, temperature and clock in the Omarchy bar", "Fan control, CPU temperature, clock and throttling", "Lock screen reskinned with a glowing digital clock", "GPU clock frequency and utilization"]) {
    assert.ok(!classifyPlugin({ id: "fresh.clock", name: "Utility", description }, raw).includes("desktop-clocks"), description);
  }
  for (const description of ["Desktop clock widget with date, weather and temperature", "CPU load and a desktop clock showing local time", "Desktop clock widget with CPU telemetry", "Digital clock with date and weather"]) {
    assert.ok(classifyPlugin({ id: "fresh.clock", name: "Utility", description }, raw).includes("desktop-clocks"), description);
  }
});

test("rules-only diagnostics expose curation and expired decisions are visible", () => {
  assert.ok(report.rulesOnly.unexpectedRoutes > 0, "curated correctness is not presented as rule precision");
  const first = taxonomy.overrides.discoveryExclude[0];
  const changed = fixture.plugins.map((p) => p.id === first.pluginId ? { ...p, description: p.description + " Updated." } : p);
  const status = discoveryCurationStatus(changed, prepared);
  assert.ok(status.expired.some((r) => r.pluginId === first.pluginId && r.typeId === first.typeId && r.reason === "listing-changed"));
  const missing = discoveryCurationStatus(changed.filter((p) => p.id !== first.pluginId), prepared);
  assert.ok(missing.expired.some((r) => r.pluginId === first.pluginId && r.reason === "listing-unavailable"));
});

test("successor-only gains and losses cannot fall outside the inventory", () => {
  const plugin = { id: "example.sessions", name: "History", description: "Browse past Claude coding sessions." };
  const sample = { ...fixture, plugins: [plugin], baselineAssignments: [], regressionAssignments: [],
    initialTaxonomy: { schemaVersion: 1, types: [{ id: "unrelated", name: "Unrelated", include: ["impossible-example-token"] }] },
    proposalDiscoveries: [{ revision: "prior", assignments: [{ pluginId: plugin.id, typeIds: ["agent-history"] }] }] };
  const rules = structuredClone(taxonomy);
  rules.overrides = { exclude: { [plugin.id]: ["agent-history", "agent-monitoring"] } };
  let result = auditDiscoveryRecall(sample, rules, []);
  assert.ok(result.decisions.some((r) => r.typeId === "ai-assistant" && r.issues.includes("missing-expectation")));
  sample.proposalDiscoveries = [];
  result = auditDiscoveryRecall(sample, rules, []);
  assert.ok(result.decisions.some((r) => r.typeId === "ai-assistant" && r.rulesOnlyTargets.includes("agent-history") && r.issues.includes("missing-expectation")), "an exception cannot remove a new raw match from the split inventory");
  result = auditDiscoveryRecall(sample, taxonomy, []);
  assert.ok(result.decisions.some((r) => r.typeId === "ai-assistant" && r.issues.includes("missing-expectation")), "new current matches enter the inventory without a baseline assignment");
});

test("recovered discovery and a broad old override cannot supply missing source qualification", () => {
  const catalog = ["grivera.agents", "berat.analog-clock", "io.github.deunnis.lacquer", "io.github.jramiresbrito.idle-timings"].map((id) => ({ ...plugins.get(id),
    repo: `https://github.com/example/${id}`, installAvailable: true, installCommand: `install ${id}` }));
  const ranked = rankPlugins({ catalog, stats: {}, taxonomy, taskReviews: { schemaVersion: 2, assignments: [] },
    pluginProfiles: { schemaVersion: 1, plugins: {} }, evidenceObservations: { schemaVersion: 1, plugins: {} },
    now: new Date(fixture.capturedAt), methodology: methodologyFor("1.4.0") });
  for (const typeId of ["agent-monitoring", "desktop-clocks", "lock-screen", "idle-sleep", "keep-awake"]) {
    const type = ranked.rankings.types.find((type) => type.id === typeId);
    assert.ok(type.pendingCount > 0, typeId);
    assert.equal(type.eligibleCount, 0, typeId);
    assert.equal(type.winner, null, typeId);
  }
});
