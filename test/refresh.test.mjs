import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fetchJson, refresh, validateFeeds } from "../build/refresh.mjs";

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
