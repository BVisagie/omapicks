import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { classifyPlugin, prepareTaxonomy, rankPlugins } from "../build/rank.mjs";
import { methodologyFor } from "../build/methodology.mjs";
import { explainTaskFit, prepareTaskReviews, taskMetadataHash } from "../build/task-fit.mjs";

const taxonomy = JSON.parse(await readFile(new URL("../data/app-types.json", import.meta.url)));
const reviews = JSON.parse(await readFile(new URL("../data/task-reviews.json", import.meta.url)));
const byType = new Map(taxonomy.types.map((type) => [type.id, type]));
const byReview = new Map(reviews.assignments.map((review) => [`${review.pluginId}/${review.typeId}`, review]));
const now = new Date("2026-11-01T12:00:00Z");

// Counterfactual engagement isolates task eligibility from the production source observer.
// The 1.2 engine has the same contract gate but no external-observation prerequisite;
// source freshness, profiles and revision binding are tested in evidence.test.mjs.
function scopedRanking(typeId, pluginIds, popularId) {
  const type = byType.get(typeId);
  const assignments = pluginIds.map((id) => byReview.get(`${id}/${typeId}`)).filter(Boolean);
  const catalog = pluginIds.map((id) => {
    const reference = assignments.find((review) => review.pluginId === id) ?? reviews.assignments.find((review) => review.pluginId === id);
    assert.ok(reference, `Missing reviewed fixture plugin ${id}`);
    const url = new URL(reference.source.url);
    const [, owner, repository] = url.pathname.split("/");
    return { id, name: id, description: type.description, repo: `https://github.com/${owner}/${repository}`,
      installAvailable: true, installCommand: `install ${id}`, repositoryUpdatedAt: "2026-10-29T00:00:00Z" };
  });
  const records = assignments.map((review) => ({ ...review, metadataHash: taskMetadataHash(catalog.find((plugin) => plugin.id === review.pluginId)) }));
  return rankPlugins({ taxonomy: { schemaVersion: 1, types: [type] }, taskReviews: { schemaVersion: 2, assignments: records },
    catalog, stats: Object.fromEntries(pluginIds.map((id) => [id, id === popularId
      ? { copies: 1000000, hearts: 100000, views: 2000000 }
      : { copies: 5, hearts: 1, views: 30 }])), now, methodology: methodologyFor("1.2.0") });
}

test("popular specialist features cannot displace the complete common task", () => {
  const counterexamples = [
    ["system-monitor", "harshith.system-monitor", "agnibha.diskspace"],
    ["system-monitor", "harshith.system-monitor", "abdullahmansoor.omapodman"],
    ["music", "crmne.mpris", "omaconnect"],
    ["weather", "io.github.calebhat.weather", "eduardodallecort.weather-radar"],
    ["network", "community.network", "io.github.shivamnarkar47.omarchy-hotspot"],
    ["audio", "ssupt.audio-control", "ssupt.bluetooth-audio"],
    ["notes", "io.github.huligabuliga.omasticky", "luca.obsidian-daily"],
    ["containers", "io.github.majkelll.omarchy-docker", "io.github.randazraik.xray"],
    ["containers", "io.github.majkelll.omarchy-docker", "devgtv.docker"],
    ["timers-alarms", "io.github.pjgeutjens.clockwork", "pnkm0nk.omodoro"],
    ["firewall", "io.github.sahzudin.omawall", "io.github.chris.snitch"]
  ];
  for (const [typeId, complete, specialist] of counterexamples) {
    const result = scopedRanking(typeId, [complete, specialist], specialist);
    const type = result.rankings.types[0];
    assert.equal(type.winner?.id, complete, `${typeId}: popular ${specialist} is not a substitute`);
    assert.equal(type.runnerUp, null, `${typeId}: do not manufacture a second reviewed option`);
    assert.equal(type.eligibleCount, 1);
    assert.ok(type.relatedTools.some((plugin) => plugin.id === specialist));
    const alone = scopedRanking(typeId, [specialist], specialist).rankings.types[0];
    assert.equal(alone.winner, null, `${typeId}: abstain when only the specialist is available`);
    assert.equal(alone.runnerUp, null);
  }
});

test("split categories do not inherit qualification for the other user task", () => {
  const pairs = [
    ["lock-screen", "io.github.sirjul1337.lock-explorer", "onlyvishesh.power-manager"],
    ["idle-sleep", "onlyvishesh.power-manager", "io.github.sirjul1337.lock-explorer"],
    ["desktop-clocks", "ubeyidah.omaclock", "io.github.sspaeti.timezones"],
    ["world-clocks", "io.github.sspaeti.timezones", "ubeyidah.omaclock"],
    ["agent-monitoring", "meviusisback.agent-orchestr", "sid.sessions"],
    ["agent-history", "sid.sessions", "meviusisback.agent-orchestr"],
    ["endpoint-monitoring", "io.github.dupontbertrand.omastatus", "bottelet.is-it-down"],
    ["service-status", "bottelet.is-it-down", "io.github.dupontbertrand.omastatus"]
  ];
  for (const [typeId, complete, otherTask] of pairs) {
    const type = scopedRanking(typeId, [complete, otherTask], otherTask).rankings.types[0];
    assert.equal(type.winner?.id, complete, typeId);
    assert.equal(type.runnerUp, null, typeId);
  }
});

test("complete native capabilities can qualify separately without preserving wrong placements", () => {
  for (const [pluginId, typeId] of [
    ["luca.obsidian-daily", "tasks"], ["abdullahmansoor.omapodman", "containers"],
    ["community.network", "network"], ["community.network", "hotspots"],
    ["io.github.chris.snitch", "app-network-blocking"], ["ssupt.bluetooth-audio", "bluetooth"]
  ]) {
    const record = byReview.get(`${pluginId}/${typeId}`);
    assert.equal(record?.decision, "qualified", `${pluginId}/${typeId}`);
    assert.equal(scopedRanking(typeId, [pluginId], pluginId).rankings.types[0].winner?.id, pluginId);
  }
  assert.equal(byReview.get("luca.obsidian-daily/notes").decision, "related");
  assert.equal(byReview.get("abdullahmansoor.omapodman/system-monitor").decision, "related");
});

test("the stricter contracts reject generic labels and incomplete operations", () => {
  const partialClaims = [
    ["system-monitor", ["inspect-resource-usage"]],
    ["music", ["read-now-playing", "control-playback"]],
    ["network", ["manage-network-connections"]],
    ["audio", ["configure-headset-audio", "select-audio-devices"]],
    ["notes", ["capture-notes", "read-notes"]],
    ["containers", ["list-containers", "restart-container-target"]],
    ["firewall", ["manage-firewall"]],
    ["workspaces", ["show-workspace-state"]],
    ["window-management", ["configure-window-behavior"]],
    ["ai-chat", ["manage-ai-models"]],
    ["gaming", ["launch-games"]],
    ["timers-alarms", ["schedule-alarm", "run-stopwatch"]],
    ["keyboard-layouts", ["read-keyboard-layout"]],
    ["plugin-manager", ["manage-installed-plugins"]],
    ["world-clocks", ["read-time"]],
    ["keep-awake", ["configure-idle-timeouts", "configure-idle-actions"]],
    ["app-network-blocking", ["inspect-app-connections"]]
  ];
  const template = reviews.assignments.find((review) => review.provenance === "repository-evidence" && review.decision === "qualified");
  for (const [typeId, capabilities] of partialClaims) {
    const type = byType.get(typeId);
    const claim = { ...template, typeId, contractVersion: type.contract.version, capabilities };
    assert.throws(() => prepareTaskReviews({ schemaVersion: 2, assignments: [claim] }, [type]), /does not meet task contract/, typeId);
  }
});

test("legacy judgments retain their old date and require a new scoped review", () => {
  for (const [pluginId, typeId] of [["io.github.deunnis.lacquer", "idle-sleep"],
    ["io.github.ofa14-prog.dynamic-island", "agent-monitoring"],
    ["io.github.guiestrela.omarchy-google-calendar-clock", "desktop-clocks"]]) {
    const record = byReview.get(`${pluginId}/${typeId}`);
    assert.equal(record.contractVersion, 1);
    assert.equal(record.reviewedAt, "2026-10-12");
    const prepared = prepareTaskReviews({ schemaVersion: 2, assignments: [record] }, [byType.get(typeId)]);
    assert.equal(explainTaskFit({ id: pluginId }, byType.get(typeId), prepared).status, "stale-contract");
  }
  const retired = new Set(["lock-idle", "clock-timer", "ai-assistant", "uptime-monitoring"]);
  assert.ok(taxonomy.types.every((type) => !retired.has(type.id)));
  assert.ok(reviews.assignments.every((review) => !retired.has(review.typeId)));
  for (const group of ["include", "exclude", "review"]) {
    assert.ok(Object.values(taxonomy.overrides[group] ?? {}).flat().every((id) => !retired.has(id)));
  }
});

test("discovery separates actual user tasks without qualifying incidental words", () => {
  const prepared = prepareTaxonomy(taxonomy);
  const matches = (name, description) => classifyPlugin({ id: "coherence-fixture", name, description }, prepared);
  assert.ok(matches("Lock Designs", "Choose lock-screen designs and apply a new lock screen.").includes("lock-screen"));
  assert.ok(matches("Idle Controls", "Configure idle timeouts and sleep actions.").includes("idle-sleep"));
  assert.ok(matches("Stay Awake", "Temporarily prevent idle lock, then restore normal behavior.").includes("keep-awake"));
  assert.ok(!matches("OmaCaffeine", "Track your caffeine intake and daily coffee consumption.").includes("keep-awake"));
  assert.ok(matches("World Clock", "Compare time zones and local business hours.").includes("world-clocks"));
  assert.ok(matches("Desktop Clock", "A clock widget on the desktop wallpaper.").includes("desktop-clocks"));
  assert.ok(matches("Service Incidents", "Read service status pages and incident reports.").includes("service-status"));
  assert.ok(matches("Endpoint Monitor", "Probe configured endpoints with HTTP health checks.").includes("endpoint-monitoring"));
});
