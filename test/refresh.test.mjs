import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fetchJson, formatRefreshLog, refresh, upstreamWarningCodes, validateFeeds } from "../build/refresh.mjs";

function jsonResponse(value, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json", etag: '"fixture"' }
  });
}

test("feed validation rejects suspicious truncation, duplicates, and malformed stats", () => {
  const plugin = { id: "example" };
  assert.throws(() => validateFeeds({ plugins: [plugin] }, { schemaVersion: 1, plugins: {} }, 2), /expected at least 2/);
  assert.throws(
    () => validateFeeds({ plugins: [plugin, plugin] }, { schemaVersion: 1, plugins: {} }, 1),
    /duplicate id/
  );
  assert.throws(
    () => validateFeeds({ plugins: [plugin] }, { schemaVersion: 1, plugins: { example: { views: -1, copies: 0, hearts: 0 } } }, 1),
    /non-negative/
  );
});

test("feed validation accepts catalog state schema 2 and rejects unknown shapes", () => {
  const stats = { schemaVersion: 1, plugins: { example: { views: 1, copies: 0, hearts: 0 } } };
  const catalog = (values) => ({ plugins: [{ id: "example" }], ...values });
  assert.doesNotThrow(() => validateFeeds(catalog({}), stats, 1));
  assert.doesNotThrow(() => validateFeeds(catalog({ stateSchemaVersion: 2, warnings: [] }), stats, 1));
  assert.doesNotThrow(() => validateFeeds(catalog({ stateSchemaVersion: 2, warnings: ["https://github.com/a/b: repository-unreachable"] }), stats, 1));
  assert.throws(() => validateFeeds(catalog({ stateSchemaVersion: 3 }), stats, 1), /stateSchemaVersion: 3/);
  assert.throws(() => validateFeeds(catalog({ stateSchemaVersion: "2" }), stats, 1), /stateSchemaVersion: "2"/);
  assert.throws(() => validateFeeds(catalog({ warnings: "repository-unreachable" }), stats, 1), /warnings must be an array/);
  assert.throws(() => validateFeeds(catalog({ warnings: [{ code: "x" }] }), stats, 1), /warnings must be an array/);
});

test("upstream warning codes are counted by the text after the last separator", () => {
  assert.deepEqual(upstreamWarningCodes([
    "https://github.com/a/one: repository-unreachable",
    "https://github.com/a/two: manifest-invalid",
    "https://github.com/a/three: repository-unreachable",
    "no separator"
  ]), { "repository-unreachable": 2, "manifest-invalid": 1, unspecified: 1 });
  assert.deepEqual(upstreamWarningCodes(undefined), {});
});

test("fetchJson retries transient responses and preserves response metadata", async () => {
  let calls = 0;
  const result = await fetchJson("https://example.test/data", {
    attempts: 2,
    fetchImpl: async () => {
      calls += 1;
      return calls === 1 ? jsonResponse({ error: true }, 503) : jsonResponse({ ok: true });
    }
  });
  assert.equal(calls, 2);
  assert.deepEqual(result.body, { ok: true });
  assert.equal(result.etag, '"fixture"');
});

test("refresh appends weekly history and leaves prior weeks intact", async (context) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "omapicks-refresh-"));
  context.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(path.join(root, "data"), { recursive: true });
  await writeFile(
    path.join(root, "data", "app-types.json"),
    JSON.stringify({
      schemaVersion: 1,
      types: [{ id: "weather", name: "Weather", description: "Forecasts", include: ["\\bweather\\b"] }],
      overrides: { include: {}, exclude: {} }
    })
  );
  await writeFile(
    path.join(root, "data", "rankings.json"),
    JSON.stringify({ schemaVersion: 1, week: null, types: [] })
  );

  const catalog = {
    generatedAt: "2026-09-01T00:00:00Z",
    plugins: [
      {
        id: "weather",
        name: "Weather",
        description: "Weather forecast",
        installAvailable: true,
        installCommand: "omarchy plugin add https://github.com/example/weather.git",
        repo: "https://github.com/example/weather",
        repositoryUpdatedAt: "2026-08-31T00:00:00Z",
        verificationStatus: "verified",
        stars: 10
      }
    ]
  };
  const stats = { schemaVersion: 1, plugins: { weather: { views: 20, copies: 5, hearts: 2 } } };
  let fetchCalls = 0;
  const fetchImpl = async (url) => {
    fetchCalls += 1;
    return url.includes("/stats") ? jsonResponse(stats) : jsonResponse(catalog);
  };

  await refresh({
    root,
    now: new Date("2026-09-01T09:00:00Z"),
    minimumCatalogSize: 1,
    fetchImpl
  });
  const firstHistory = JSON.parse(await readFile(path.join(root, "data", "history", "2026-W36.json"), "utf8"));
  assert.equal(firstHistory.week, "2026-W36");
  assert.equal(firstHistory.types[0].winner.localImage, null);

  const noChange = await refresh({
    root,
    now: new Date("2026-09-02T09:00:00Z"),
    minimumCatalogSize: 1,
    fetchImpl
  });
  assert.equal(noChange.changed, false);
  assert.equal(fetchCalls, 2);

  await mkdir(path.join(root, "data", "assets", "plugins"), { recursive: true });
  await writeFile(path.join(root, "data", "assets", "plugins", "stale.webp"), "stale");
  await refresh({
    root,
    now: new Date("2026-09-08T09:00:00Z"),
    minimumCatalogSize: 1,
    fetchImpl
  });
  assert.equal(JSON.parse(await readFile(path.join(root, "data", "history", "2026-W36.json"), "utf8")).week, "2026-W36");
  assert.equal(JSON.parse(await readFile(path.join(root, "data", "history", "2026-W37.json"), "utf8")).week, "2026-W37");
  await assert.rejects(readFile(path.join(root, "data", "assets", "plugins", "stale.webp")), /ENOENT/);
});

test("refresh retains a matching cached preview when its download fails", async (context) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "omapicks-image-fallback-"));
  context.after(() => rm(root, { recursive: true, force: true }));
  const assetDirectory = path.join(root, "data", "assets", "plugins");
  await mkdir(assetDirectory, { recursive: true });
  await writeFile(
    path.join(root, "data", "app-types.json"),
    JSON.stringify({
      schemaVersion: 1,
      types: [{ id: "weather", name: "Weather", description: "Forecasts", include: ["\\bweather\\b"] }],
      overrides: { include: {}, exclude: {} }
    })
  );

  const previewSource = "https://plugins.omarchy.org/assets/weather.webp";
  const localImage = "assets/plugins/weather-cached.webp";
  await writeFile(path.join(root, "data", localImage), "cached preview");
  await writeFile(
    path.join(root, "data", "rankings.json"),
    JSON.stringify({
      schemaVersion: 1,
      week: "2026-W35",
      types: [
        {
          id: "weather",
          winner: { id: "weather", previewSource, localImage },
          runnerUp: null
        }
      ]
    })
  );

  const catalog = {
    generatedAt: "2026-09-08T00:00:00Z",
    plugins: [
      {
        id: "weather",
        name: "Weather",
        description: "Weather forecast",
        installAvailable: true,
        installCommand: "omarchy plugin add https://github.com/example/weather.git",
        repo: "https://github.com/example/weather",
        repositoryUpdatedAt: "2026-09-07T00:00:00Z",
        verificationStatus: "verified",
        previewThumbnail: "/assets/weather.webp",
        stars: 10
      }
    ]
  };
  const stats = { schemaVersion: 1, plugins: { weather: { views: 20, copies: 5, hearts: 2 } } };
  const fetchImpl = async (url) => {
    if (String(url).endsWith(".webp")) return new Response(null, { status: 503 });
    return String(url).includes("/stats") ? jsonResponse(stats) : jsonResponse(catalog);
  };

  const result = await refresh({
    root,
    now: new Date("2026-09-08T09:00:00Z"),
    minimumCatalogSize: 1,
    fetchImpl
  });
  assert.equal(result.rankings.types[0].winner.localImage, localImage);
  assert.match(result.imageWarnings[0], /retained cached preview/);
  assert.equal(await readFile(path.join(root, "data", localImage), "utf8"), "cached preview");
  const persisted = JSON.parse(await readFile(path.join(root, "data", "rankings.json"), "utf8"));
  assert.equal(persisted.types[0].winner.localImage, localImage);
});

test("same-week refresh stays frozen unless the taxonomy checksum changes", async (context) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "omapicks-taxonomy-"));
  context.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(path.join(root, "data"), { recursive: true });
  const taxonomy = {
    schemaVersion: 1,
    types: [{ id: "weather", name: "Weather", description: "Forecasts", include: ["\\bweather\\b"] }],
    overrides: { include: {}, exclude: {} }
  };
  await writeFile(path.join(root, "data", "app-types.json"), JSON.stringify(taxonomy));
  await writeFile(
    path.join(root, "data", "rankings.json"),
    JSON.stringify({ schemaVersion: 1, week: null, types: [] })
  );

  const catalog = {
    generatedAt: "2026-09-01T00:00:00Z",
    plugins: [
      {
        id: "weather",
        name: "Weather",
        description: "Weather forecast",
        installAvailable: true,
        installCommand: "omarchy plugin add https://github.com/example/weather.git",
        repo: "https://github.com/example/weather",
        repositoryUpdatedAt: "2026-08-31T00:00:00Z",
        verificationStatus: "verified",
        stars: 10
      }
    ]
  };
  const stats = { schemaVersion: 1, plugins: { weather: { views: 20, copies: 5, hearts: 2 } } };
  let fetchCalls = 0;
  const fetchImpl = async (url) => {
    fetchCalls += 1;
    return url.includes("/stats") ? jsonResponse(stats) : jsonResponse(catalog);
  };
  const now = new Date("2026-09-01T09:00:00Z");

  const first = await refresh({ root, now, minimumCatalogSize: 1, fetchImpl });
  assert.equal(first.changed, true);
  assert.equal(typeof first.rankings.source.taxonomy.sha256, "string");
  assert.equal(first.rankings.source.taxonomy.typeCount, 1);
  assert.equal(fetchCalls, 2);

  const frozen = await refresh({ root, now, minimumCatalogSize: 1, fetchImpl });
  assert.equal(frozen.changed, false);
  assert.equal(frozen.reason, "already-refreshed");
  assert.equal(fetchCalls, 2);

  taxonomy.types[0].include = ["\\b(weather|forecast)\\b"];
  await writeFile(path.join(root, "data", "app-types.json"), JSON.stringify(taxonomy));
  const reranked = await refresh({ root, now, minimumCatalogSize: 1, fetchImpl });
  assert.equal(reranked.changed, true);
  assert.equal(fetchCalls, 4);
  assert.notEqual(reranked.rankings.source.taxonomy.sha256, first.rankings.source.taxonomy.sha256);
  assert.deepEqual(reranked.changes, first.changes);
  assert.ok(reranked.changes.length > 0);
  const rewrittenHistory = JSON.parse(await readFile(path.join(root, "data", "history", "2026-W36.json"), "utf8"));
  assert.deepEqual(rewrittenHistory.changes, first.changes);
});

test("formatRefreshLog adds dry-run context for deltas, runner-ups, and inverted races", () => {
  const result = {
    week: "2026-W37",
    rankings: { types: [{ id: "weather" }, { id: "themes-appearance" }] },
    changes: [],
    report: { uniqueUnclassifiedCount: 1156 },
    runnerUpChanges: [
      {
        typeId: "brightness",
        typeName: "Brightness",
        previous: { id: "hyprsunset", name: "Hyprsunset Night Light" },
        current: { id: "nightlight", name: "Night Light" }
      }
    ],
    invertedRaces: [
      {
        typeId: "themes-appearance",
        typeName: "Themes & Appearance",
        champion: { id: "manager", name: "Omarchy Theme Manager", score: 0.881828 },
        leader: { id: "gallery", name: "Themes Gallery", score: 0.952667 },
        gapPercent: 8
      }
    ],
    deltas: {
      catalog: { previous: 2599, current: 2599, delta: 0 },
      unclassified: { previous: 1021, current: 1156, delta: 135 }
    }
  };

  for (const dryRun of [false, true]) {
    const log = formatRefreshLog(result, { dryRun }).join("\n");
    assert.match(log, /0 champion changes/);
    assert.match(log, /No champion identities changed/);
    assert.match(log, /Catalog 2599 \(was 2599, \+0\)/);
    assert.match(log, /Runner-up Brightness: Hyprsunset Night Light -> Night Light/);
    assert.match(log, /leads champion Omarchy Theme Manager 0.881828 by 8.0%/);
    assert.match(log, /strictly more than 10%/);
    assert.match(log, dryRun ? /no snapshot files written/ : /wrote the snapshot/);
  }
  const frozen = formatRefreshLog({ week: "2026-W37", reason: "already-refreshed" }).join("\n");
  assert.match(frozen, /Live feeds were not fetched or validated/);
  assert.match(frozen, /intentional weekly freeze/);
  const rerun = formatRefreshLog({ ...result, changes: [{ typeName: "Old event" }], computedChanges: [] }).join("\n");
  assert.match(rerun, /0 champion changes/);
  assert.match(rerun, /Weekly changelog retains 1 events/);

});

test("dry-run reports catalog deltas and runner-up changes without writing snapshots", async (context) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "omapicks-dry-run-"));
  context.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(path.join(root, "data"), { recursive: true });
  await writeFile(
    path.join(root, "data", "app-types.json"),
    JSON.stringify({
      schemaVersion: 1,
      types: [{ id: "weather", name: "Weather", description: "Forecasts", include: ["\\bweather\\b"] }],
      overrides: { include: {}, exclude: {} }
    })
  );
  const previousRankings = {
    schemaVersion: 1,
    week: "2026-W37",
    source: { catalog: { count: 2 }, stats: { count: 2 }, taxonomy: { sha256: "stale", typeCount: 1 } },
    types: [
      {
        id: "weather",
        name: "Weather",
        winner: { id: "champ", name: "Champ" },
        runnerUp: { id: "old-runner", name: "Old Runner" }
      }
    ]
  };
  await writeFile(path.join(root, "data", "rankings.json"), JSON.stringify(previousRankings));
  await writeFile(
    path.join(root, "data", "unclassified-report.json"),
    JSON.stringify({ schemaVersion: 1, uniqueUnclassifiedCount: 4 })
  );

  const catalog = {
    generatedAt: "2026-09-10T00:00:00Z",
    stateSchemaVersion: 2,
    mode: "production",
    warnings: [
      "https://github.com/example/gone: repository-unreachable",
      "https://github.com/example/broken: manifest-invalid",
      "https://github.com/example/other: repository-unreachable"
    ],
    plugins: [
      {
        id: "omarchy.weather",
        name: "Weather",
        description: "Weather forecast",
        repo: "https://github.com/omacom/omarchy",
        sourceType: "builtin",
        builtIn: true,
        installCommand: "",
        officialCommand: "omarchy bar plugin add omarchy.weather",
        status: "Built in"
      },
      {
        id: "champ",
        name: "Champ",
        description: "Weather forecast",
        installAvailable: true,
        installCommand: "omarchy plugin add https://github.com/example/champ.git",
        repo: "https://github.com/example/champ",
        repositoryUpdatedAt: "2026-08-31T00:00:00Z",
        verificationStatus: "verified",
        stars: 10
      },
      {
        id: "challenger",
        name: "Challenger",
        description: "Weather forecast",
        installAvailable: true,
        installCommand: "omarchy plugin add https://github.com/example/challenger.git",
        repo: "https://github.com/example/challenger",
        repositoryUpdatedAt: "2026-08-31T00:00:00Z",
        verificationStatus: "verified",
        stars: 8
      },
      {
        id: "notes",
        name: "Notes",
        description: "Sticky notes",
        installAvailable: true,
        installCommand: "omarchy plugin add https://github.com/example/notes.git",
        repo: "https://github.com/example/notes",
        repositoryUpdatedAt: "2026-08-31T00:00:00Z",
        verificationStatus: "verified",
        stars: 1
      }
    ]
  };
  const stats = {
    schemaVersion: 1,
    plugins: {
      champ: { views: 50, copies: 20, hearts: 5 },
      challenger: { views: 40, copies: 10, hearts: 2 },
      notes: { views: 3, copies: 1, hearts: 0 },
      "retired.plugin": { views: 3, copies: 1, hearts: 0 }
    }
  };
  const fetchImpl = async (url) => (url.includes("/stats") ? jsonResponse(stats) : jsonResponse(catalog));

  const result = await refresh({
    root,
    dryRun: true,
    now: new Date("2026-09-10T11:00:00Z"),
    minimumCatalogSize: 1,
    fetchImpl
  });

  assert.equal(result.changed, true);
  assert.equal(result.changes.length, 0);
  assert.equal(result.rankings.types[0].winner.id, "champ");
  assert.equal(result.rankings.types[0].runnerUp.id, "challenger");
  assert.deepEqual(
    result.runnerUpChanges.map((change) => ({ typeId: change.typeId, from: change.previous.id, to: change.current.id })),
    [{ typeId: "weather", from: "old-runner", to: "challenger" }]
  );
  assert.equal(result.deltas.catalog.previous, 2);
  assert.equal(result.deltas.catalog.current, 4);
  assert.equal(result.deltas.catalog.delta, 2);
  assert.deepEqual(
    (({ stateSchemaVersion, mode, warningCount, builtInCount }) => ({ stateSchemaVersion, mode, warningCount, builtInCount }))(result.rankings.source.catalog),
    { stateSchemaVersion: 2, mode: "production", warningCount: 3, builtInCount: 1 }
  );
  assert.equal(result.deltas.unclassified.previous, 4);
  assert.equal(result.deltas.unclassified.current, 1);
  assert.equal(result.deltas.unclassified.delta, -3);

  const persisted = JSON.parse(await readFile(path.join(root, "data", "rankings.json"), "utf8"));
  assert.deepEqual(persisted, previousRankings);
  await assert.rejects(readFile(path.join(root, "data", "history", "2026-W37.json")), /ENOENT/);

  const lines = formatRefreshLog(result, { dryRun: true });
  assert.match(lines[0], /0 champion changes; 1 unclassified/);
  assert.match(lines.join("\n"), /Catalog 4 \(was 2, \+2\); unclassified 1 \(was 4, -3\)/);
  assert.match(lines.join("\n"), /Catalog schema 2; 3 upstream warnings; 1 built-in listing excluded\./);
  assert.match(lines.join("\n"), /1 stats ID absent from the catalog/);
  assert.match(lines.join("\n"), /Upstream catalog warnings: repository-unreachable 2; manifest-invalid 1\./);
  assert.match(lines.join("\n"), /1 runner-up change/);
  assert.match(lines.join("\n"), /Runner-up Weather: Old Runner -> Challenger/);
});

test("stats require catalog overlap and preserve most of the previous feed", () => {
  const catalog = { plugins: Array.from({ length: 10 }, (_, i) => ({ id: `p${i}` })) };
  const metrics = { views: 0, copies: 0, hearts: 0 };
  const stats = (ids) => ({ schemaVersion: 1, plugins: Object.fromEntries(ids.map((id) => [id, metrics])) });
  for (const plugins of [{}, [], "invalid", 123]) {
    assert.throws(() => validateFeeds(catalog, { schemaVersion: 1, plugins }, 1), /Stats/);
  }
  assert.throws(() => validateFeeds(catalog, stats(["unrelated"]), 1), /overlap/);
  const partial = stats(["p0", "p1", "p2", "p3", "p4"]);
  assert.doesNotThrow(() => validateFeeds(catalog, partial, 1)); // New listings can lack engagement.
  assert.throws(() => validateFeeds(catalog, partial, 1, { source: { stats: { count: 10 } } }), /75%/);
  assert.doesNotThrow(() => validateFeeds(catalog, stats(catalog.plugins.slice(0, 8).map((p) => p.id)), 1,
    { source: { stats: { count: 10 } } }));
});

test("a rejected stats refresh leaves all published snapshot files untouched", async (context) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "omapicks-rejected-feed-"));
  context.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(path.join(root, "data", "history"), { recursive: true });
  const previous = { week: "2026-W36", types: [], source: { stats: { count: 2 } } };
  const files = {
    "rankings.json": JSON.stringify(previous),
    "changelog.json": '{"changes":[]}',
    "unclassified-report.json": '{"catalogCount":2}',
    "history/2026-W36.json": JSON.stringify(previous)
  };
  for (const [file, content] of Object.entries(files)) await writeFile(path.join(root, "data", file), content);
  await writeFile(path.join(root, "data", "app-types.json"), JSON.stringify({ schemaVersion: 1, types: [] }));
  await assert.rejects(refresh({
    root, now: new Date("2026-09-14T07:00:00Z"), minimumCatalogSize: 1,
    fetchImpl: async (url) => jsonResponse(url.includes("/stats")
      ? { schemaVersion: 1, plugins: {} } : { plugins: [{ id: "a" }, { id: "b" }] })
  }), /Stats overlap/);
  for (const [file, content] of Object.entries(files)) assert.equal(await readFile(path.join(root, "data", file), "utf8"), content);
  await assert.rejects(readFile(path.join(root, "data", "history", "2026-W38.json")), { code: "ENOENT" });
});

test("classification state publishes with refresh, dry runs are read-only, and classifier upgrades rerun the week", async (context) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "omapicks-classification-state-"));
  context.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(path.join(root, "data"), { recursive: true });
  const taxonomy = { schemaVersion: 1, types: [{ id: "battery", name: "Battery", include: ["battery health"] }] };
  await writeFile(path.join(root, "data", "app-types.json"), JSON.stringify(taxonomy));
  const catalog = { plugins: [{ id: "real", name: "Power", description: "Computer battery health", repo: "https://github.com/a/power", installAvailable: true, installCommand: "install" }] };
  const stats = { schemaVersion: 1, plugins: { real: { views: 1, copies: 1, hearts: 1 } } };
  const options = { root, now: new Date("2026-09-21T12:00:00Z"), minimumCatalogSize: 1, fetchImpl: async (url) => jsonResponse(url.endsWith("/stats") ? stats : catalog) };
  const first = await refresh(options);
  const stateFile = path.join(root, "data", "classification-state.json");
  const original = await readFile(stateFile, "utf8");
  assert.deepEqual(JSON.parse(original).plugins[0].types, ["battery"]);
  assert.equal(first.classificationAudit.picks[0].eligibility.accepted, true);
  assert.deepEqual(first.auditInputs.catalog.body, catalog);
  assert.equal((await refresh(options)).changed, false);
  const rankingFile = path.join(root, "data", "rankings.json");
  const ranking = JSON.parse(await readFile(rankingFile, "utf8"));
  ranking.source.taxonomy.classificationVersion = 1;
  await writeFile(rankingFile, JSON.stringify(ranking));
  assert.equal((await refresh(options)).changed, true);
  taxonomy.overrides = { review: { real: ["battery"] }, reasons: { real: { battery: "Verify computer battery capability" } } };
  await writeFile(path.join(root, "data", "app-types.json"), JSON.stringify(taxonomy));
  const dry = await refresh({ ...options, dryRun: true });
  assert.equal(dry.rankings.types[0].winner, null);
  assert.equal(dry.classificationAudit.counts.unresolved, 1);
  assert.equal(await readFile(stateFile, "utf8"), original);
  const changed = await refresh(options);
  assert.equal(changed.rankings.types[0].winner, null);
  assert.deepEqual(JSON.parse(await readFile(stateFile, "utf8")).plugins[0].types, []);
});

test("a methodology-only change keeps the weekly freeze; --republish recalculates with validation and keeps weekly events", async (context) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "omapicks-republish-"));
  context.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(path.join(root, "data"), { recursive: true });
  const taxonomy = { schemaVersion: 1, types: [{ id: "weather", name: "Weather", description: "Forecasts", include: ["\\bweather\\b"] }] };
  await writeFile(path.join(root, "data", "app-types.json"), JSON.stringify(taxonomy));
  await writeFile(path.join(root, "data", "rankings.json"), JSON.stringify({ schemaVersion: 1, week: null, types: [] }));
  const entry = (id, stars) => ({
    id, name: id, description: "Weather forecast", installAvailable: true,
    installCommand: `omarchy plugin add https://github.com/example/${id}.git`, repo: `https://github.com/example/${id}`,
    repositoryUpdatedAt: "2026-08-31T00:00:00Z", stars
  });
  let catalog = { plugins: [entry("first", 10)] };
  let stats = { schemaVersion: 1, plugins: { first: { views: 20, copies: 5, hearts: 2 } } };
  let fetchCalls = 0;
  const fetchImpl = async (url) => {
    fetchCalls += 1;
    return url.includes("/stats") ? jsonResponse(stats) : jsonResponse(catalog);
  };
  const options = { root, now: new Date("2026-09-01T09:00:00Z"), minimumCatalogSize: 1, fetchImpl };
  const first = await refresh(options);
  assert.equal(first.changes.length, 1);
  assert.equal(first.republished, false);

  // Simulate code that moved to a newer methodology after this week's snapshot was published.
  const rankingsFile = path.join(root, "data", "rankings.json");
  const published = JSON.parse(await readFile(rankingsFile, "utf8"));
  published.methodologyVersion = "0.9.0";
  await writeFile(rankingsFile, JSON.stringify(published));
  const frozen = await refresh(options);
  assert.equal(frozen.changed, false);
  assert.equal(fetchCalls, 2);
  const frozenLog = formatRefreshLog(frozen).join("\n");
  assert.match(frozenLog, /keeps methodology 0\.9\.0/);
  assert.match(frozenLog, /Code now defines methodology 1\.\d+\.\d+; it takes effect at the next weekly refresh, or earlier through a deliberate --republish/);

  // Republishing still validates: a broken stats feed cannot replace the snapshot.
  stats = { schemaVersion: 1, plugins: {} };
  await assert.rejects(refresh({ ...options, republish: true }), /Stats overlap/);
  assert.equal(JSON.parse(await readFile(rankingsFile, "utf8")).methodologyVersion, "0.9.0");

  // A dry run combined with republish calculates but never writes.
  stats = { schemaVersion: 1, plugins: { first: { views: 20, copies: 5, hearts: 2 }, second: { views: 900, copies: 400, hearts: 90 } } };
  catalog = { plugins: [entry("first", 10), entry("second", 500)] };
  const dry = await refresh({ ...options, dryRun: true, republish: true });
  assert.equal(dry.rankings.types[0].winner.id, "second");
  assert.match(formatRefreshLog(dry, { dryRun: true }).join("\n"), /this dry run still writes nothing/);
  assert.equal(JSON.parse(await readFile(rankingsFile, "utf8")).methodologyVersion, "0.9.0");

  const republished = await refresh({ ...options, republish: true });
  assert.equal(republished.changed, true);
  assert.equal(republished.republished, true);
  assert.equal(republished.rankings.types[0].winner.id, "second");
  const log = formatRefreshLog(republished).join("\n");
  assert.match(log, /Deliberate republish/);
  assert.match(log, /Methodology 1\.\d+\.\d+ replaces published methodology 0\.9\.0/);
  const history = JSON.parse(await readFile(path.join(root, "data", "history", "2026-W36.json"), "utf8"));
  assert.deepEqual(history.changes.map((change) => change.kind), ["new-champion", "displaced"]);
  assert.equal(JSON.parse(await readFile(rankingsFile, "utf8")).methodologyVersion, republished.rankings.methodologyVersion);
});

test("refresh logs exclusion reasons and names the incumbents they removed", async (context) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "omapicks-health-"));
  context.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(path.join(root, "data"), { recursive: true });
  await writeFile(path.join(root, "data", "app-types.json"), JSON.stringify({ schemaVersion: 1, types: [{ id: "music", name: "Music", include: ["\\bmusic\\b"] }] }));
  await writeFile(path.join(root, "data", "rankings.json"), JSON.stringify({
    schemaVersion: 1, methodologyVersion: "1.0.0", week: "2026-W39", source: { taxonomy: { sha256: "old" } },
    types: [{ id: "music", name: "Music", winner: { id: "player", name: "Player" }, runnerUp: { id: "quickshell.ytmusic", name: "Omarchy YouTube Music" } }]
  }));
  const entry = (id, values = {}) => ({ id, name: id, description: "Music player", installAvailable: true, installCommand: `install ${id}`, repo: `https://github.com/example/${id}`, ...values });
  const catalog = { stateSchemaVersion: 2, plugins: [
    entry("player"), entry("flow"),
    entry("quickshell.ytmusic", { name: "Omarchy YouTube Music", status: "Status unknown", upstreamCheckStatus: "unreachable", upstreamCheckError: "repository-unreachable" })
  ] };
  const stats = { schemaVersion: 1, plugins: { player: { views: 50, copies: 20, hearts: 5 }, flow: { views: 40, copies: 10, hearts: 2 }, "quickshell.ytmusic": { views: 400, copies: 100, hearts: 30 } } };
  const result = await refresh({ root, dryRun: true, now: new Date("2026-09-28T06:17:00Z"), minimumCatalogSize: 1,
    fetchImpl: async (url) => jsonResponse(url.includes("/stats") ? stats : catalog) });
  assert.equal(result.rankings.types[0].runnerUp.id, "flow");
  const log = formatRefreshLog(result, { dryRun: true }).join("\n");
  assert.match(log, /Excluded listings by reason: repository-unreachable 1\./);
  assert.match(log, /Excluded incumbent: Music runner-up Omarchy YouTube Music \(quickshell\.ytmusic\): repository-unreachable\./);
  assert.match(log, /Methodology 1\.1\.0 replaces published methodology 1\.0\.0/);
});

test("new-listing intervals start at the earlier week's snapshot and survive same-week republishes", async (context) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "omapicks-new-listings-"));
  context.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(path.join(root, "data", "history"), { recursive: true });
  await writeFile(path.join(root, "data", "app-types.json"), JSON.stringify({ schemaVersion: 1, types: [{ id: "weather", name: "Weather", include: ["\\bweather\\b"] }] }));
  await writeFile(path.join(root, "data", "rankings.json"), JSON.stringify({ schemaVersion: 1, week: null, types: [] }));
  const entry = (id, listedAt) => ({ id, name: id, description: "Weather forecast", installAvailable: true, installCommand: `install ${id}`, repo: `https://github.com/example/${id}`, listedAt });
  const catalog = { plugins: [entry("old", "2026-08-01T00:00:00Z"), entry("fresh", "2026-09-03T00:00:00Z")] };
  const stats = { schemaVersion: 1, plugins: { old: { views: 1, copies: 1, hearts: 0 }, fresh: { views: 1, copies: 1, hearts: 0 } } };
  const fetchImpl = async (url) => jsonResponse(url.includes("/stats") ? stats : catalog);

  const first = await refresh({ root, now: new Date("2026-09-01T09:00:00Z"), minimumCatalogSize: 1, fetchImpl });
  assert.equal(first.rankings.newListings, null);
  assert.equal(first.rankings.newListingsInterval, null);

  const next = { root, now: new Date("2026-09-08T09:00:00Z"), minimumCatalogSize: 1, fetchImpl };
  const weekly = await refresh(next);
  assert.deepEqual(weekly.rankings.newListings.map((listing) => listing.id), ["fresh"]);
  assert.deepEqual(weekly.rankings.newListingsInterval, { since: "2026-09-01T09:00:00.000Z", until: "2026-09-08T09:00:00.000Z", baselineWeek: "2026-W36" });
  assert.match(formatRefreshLog(weekly).join("\n"), /1 new listing in ranked categories since the 2026-W36 snapshot/);

  const rerun = await refresh({ ...next, now: new Date("2026-09-10T09:00:00Z"), republish: true });
  assert.equal(rerun.rankings.newListingsInterval.since, "2026-09-01T09:00:00.000Z");
  assert.equal(rerun.rankings.newListingsInterval.until, "2026-09-10T09:00:00.000Z");
});
