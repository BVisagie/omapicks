import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fetchJson, formatRefreshLog, refresh, validateFeeds } from "../build/refresh.mjs";

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

  assert.deepEqual(formatRefreshLog(result), [
    "OmaPicks 2026-W37: ranked 2 app types; 0 champion changes; 1156 unclassified."
  ]);
  assert.deepEqual(formatRefreshLog(result, { dryRun: true }), [
    "OmaPicks 2026-W37: ranked 2 app types; 0 champion changes; 1156 unclassified.",
    "Catalog 2599 (was 2599, +0); unclassified 1156 (was 1021, +135).",
    "1 runner-up change; 1 type where the raw-score leader is not champion (held by 10% hysteresis).",
    "  Runner-up Brightness: Hyprsunset Night Light -> Night Light",
    "  Themes & Appearance: Themes Gallery 0.952667 leads champion Omarchy Theme Manager 0.881828 by 8.0%."
  ]);
  assert.deepEqual(
    formatRefreshLog(
      {
        ...result,
        runnerUpChanges: [],
        invertedRaces: [],
        deltas: {
          catalog: { previous: null, current: 10, delta: null },
          unclassified: { previous: null, current: 3, delta: null }
        },
        report: { uniqueUnclassifiedCount: 3 }
      },
      { dryRun: true }
    ),
    [
      "OmaPicks 2026-W37: ranked 2 app types; 0 champion changes; 3 unclassified.",
      "Catalog 10 (no prior snapshot); unclassified 3 (no prior snapshot).",
      "0 runner-up changes; 0 types where the raw-score leader is not champion."
    ]
  );
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
    plugins: [
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
      notes: { views: 3, copies: 1, hearts: 0 }
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
  assert.equal(result.deltas.catalog.current, 3);
  assert.equal(result.deltas.catalog.delta, 1);
  assert.equal(result.deltas.unclassified.previous, 4);
  assert.equal(result.deltas.unclassified.current, 1);
  assert.equal(result.deltas.unclassified.delta, -3);

  const persisted = JSON.parse(await readFile(path.join(root, "data", "rankings.json"), "utf8"));
  assert.deepEqual(persisted, previousRankings);
  await assert.rejects(readFile(path.join(root, "data", "history", "2026-W37.json")), /ENOENT/);

  const lines = formatRefreshLog(result, { dryRun: true });
  assert.match(lines[0], /0 champion changes; 1 unclassified/);
  assert.match(lines[1], /Catalog 3 \(was 2, \+1\); unclassified 1 \(was 4, -3\)/);
  assert.match(lines[2], /1 runner-up change/);
  assert.match(lines.join("\n"), /Runner-up Weather: Old Runner -> Challenger/);
});
