import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  changesBetween,
  classifyPlugin,
  eligibilityReason,
  isoWeek,
  pickWithHysteresis,
  prepareTaxonomy,
  rankPlugins
} from "../build/rank.mjs";

const taxonomy = {
  schemaVersion: 1,
  types: [
    { id: "weather", name: "Weather", description: "Forecasts", include: ["\\bweather\\b"] },
    { id: "clock", name: "Clock", description: "Time", include: ["\\bclock\\b"] }
  ],
  overrides: { include: {}, exclude: {} }
};

function plugin(id, values = {}) {
  return {
    id,
    name: values.name ?? id,
    description: values.description ?? "Weather widget",
    category: "Widgets",
    tags: values.tags ?? [],
    installAvailable: values.installAvailable ?? true,
    installCommand: values.installCommand ?? `omarchy plugin add https://github.com/example/${id}.git`,
    repo: values.repo ?? `https://github.com/example/${id}`,
    repositoryUpdatedAt: values.repositoryUpdatedAt ?? "2026-08-01T00:00:00.000Z",
    verificationStatus: values.verificationStatus ?? "unverified",
    stars: values.stars ?? 0,
    previewThumbnail: null,
    ...values
  };
}

test("the production taxonomy is valid and intentionally broad", async () => {
  const source = JSON.parse(await readFile(new URL("../data/app-types.json", import.meta.url)));
  const prepared = prepareTaxonomy(source);
  assert.equal(prepared.types.length, 26);
  assert.equal(new Set(prepared.types.map((type) => type.id)).size, prepared.types.length);
});

test("production taxonomy keeps real overlap and rejects accidental keyword hits", async () => {
  const source = JSON.parse(await readFile(new URL("../data/app-types.json", import.meta.url)));
  const prepared = prepareTaxonomy(source);
  const typesOf = (values) => classifyPlugin(plugin(values.id, values), prepared);

  assert.deepEqual(
    typesOf({
      id: "io.github.r-witz.nothing-ear",
      name: "Nothing Audio",
      description:
        "Nothing earbuds and headphones in the Omarchy bar: battery, noise control, codec selection, and low-latency mode."
    }),
    ["battery", "audio"]
  );
  assert.deepEqual(
    typesOf({
      id: "nixfred.internet-latency",
      name: "Internet Latency",
      description: "Live color-coded internet latency with target selection, packet loss, jitter, and history."
    }),
    ["network"]
  );
  assert.deepEqual(
    typesOf({
      id: "jackzasian.clash-verge",
      name: "Clash Verge",
      description: "Clash Verge proxy status, node switching, latency testing and traffic in the Omarchy bar."
    }),
    ["network"]
  );
  assert.deepEqual(
    typesOf({
      id: "vitals",
      name: "Vitals",
      description: "Native Linux CPU, memory, GPU, storage, network, and process monitor"
    }),
    ["system-monitor", "network"]
  );
  assert.ok(
    !typesOf({
      id: "cam-stream",
      name: "Cam Stream",
      description: "Cam Stream keeps its low-latency camera preview as a normal movable window."
    }).includes("network")
  );
  assert.ok(
    !typesOf({
      id: "crueber.omacoin",
      name: "OmaCoin",
      description: "CoinGecko crypto tracker: USD price, volume, and 1h/1d/1w trend lines."
    }).includes("audio")
  );
  assert.ok(
    !typesOf({
      id: "stay-awake",
      name: "Stay Awake Indicators",
      description: "A Stay Awake cup that shows steam when another program is holding idle or sleep."
    }).includes("gaming")
  );
});

test("classification supports multiple legitimate app types and overrides", () => {
  const prepared = prepareTaxonomy(taxonomy);
  assert.deepEqual(
    classifyPlugin(plugin("combo", { description: "A weather clock for the bar" }), prepared),
    ["weather", "clock"]
  );

  const overridden = prepareTaxonomy({
    ...taxonomy,
    overrides: { include: { special: ["clock"] }, exclude: { special: ["weather"] } }
  });
  assert.deepEqual(classifyPlugin(plugin("special"), overridden), ["clock"]);
});

test("eligibility fails closed for unavailable plugins and unsafe repositories", () => {
  assert.equal(eligibilityReason(plugin("ok")), null);
  assert.equal(eligibilityReason(plugin("missing", { installAvailable: false })), "not-installable");
  assert.equal(eligibilityReason(plugin("unsafe", { repo: "http://example.test/plugin" })), "invalid-repository");
  assert.equal(eligibilityReason(plugin("retired", { status: "retired" })), "retired");
});

test("ISO weeks handle year boundaries", () => {
  assert.equal(isoWeek(new Date("2026-01-01T00:00:00Z")), "2026-W01");
  assert.equal(isoWeek(new Date("2027-01-01T00:00:00Z")), "2026-W53");
});

test("ranking is deterministic, dampens sparse entries, and permits a one-item cohort", () => {
  const catalog = [
    plugin("popular", { stars: 80 }),
    plugin("sparse", { stars: 1 }),
    plugin("clock-only", { description: "Minimal clock" })
  ];
  const stats = {
    popular: { copies: 100, hearts: 40, views: 1000 },
    sparse: { copies: 1, hearts: 0, views: 3 },
    "clock-only": { copies: 4, hearts: 1, views: 20 }
  };
  const input = { catalog, stats, taxonomy, now: new Date("2026-09-01T09:00:00Z") };
  const first = rankPlugins(input);
  const second = rankPlugins(input);
  assert.deepEqual(first, second);
  const weather = first.rankings.types.find((type) => type.id === "weather");
  const clock = first.rankings.types.find((type) => type.id === "clock");
  assert.equal(weather.winner.id, "popular");
  assert.ok(weather.winner.evidence > weather.runnerUp.evidence);
  assert.equal(clock.winner.id, "clock-only");
  assert.equal(clock.runnerUp, null);
});

test("hysteresis retains close incumbents and replaces clearly beaten ones", () => {
  const close = [{ id: "challenger", score: 0.75 }, { id: "incumbent", score: 0.7 }];
  assert.equal(pickWithHysteresis(close, "incumbent").id, "incumbent");
  const decisive = [{ id: "challenger", score: 0.79 }, { id: "incumbent", score: 0.7 }];
  assert.equal(pickWithHysteresis(decisive, "incumbent").id, "challenger");
  assert.equal(pickWithHysteresis(close, "missing").id, "challenger");
});

test("champion changes distinguish first picks, displacement, and vacancy", () => {
  const previous = {
    types: [
      { id: "weather", name: "Weather", winner: { id: "old", name: "Old" } },
      { id: "clock", name: "Clock", winner: { id: "clock", name: "Clock" } }
    ]
  };
  const current = {
    types: [
      { id: "weather", name: "Weather", winner: { id: "new", name: "New" } },
      { id: "clock", name: "Clock", winner: null },
      { id: "mail", name: "Mail", winner: { id: "mail", name: "Mail" } }
    ]
  };
  assert.deepEqual(
    changesBetween(previous, current).map((change) => change.kind),
    ["displaced", "vacated", "new-champion"]
  );
});
