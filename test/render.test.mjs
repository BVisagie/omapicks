import assert from "node:assert/strict";
import { readFile, stat } from "node:fs/promises";
import test from "node:test";
import { escapeHtml, render, renderFixtureHome } from "../build/render.mjs";

function fixtureCandidate(values = {}) {
  return {
    id: "safe.plugin",
    name: "Safe Plugin",
    description: "A useful plugin",
    author: "Author",
    repository: "https://github.com/example/safe",
    detailUrl: "https://plugins.omarchy.org/plugin.html?id=safe.plugin",
    installCommand: "omarchy plugin add https://github.com/example/safe.git",
    verificationStatus: "verified",
    localImage: null,
    metrics: { copies: 10, hearts: 4, stars: 3, views: 30 },
    normalized: { copies: 0.8, hearts: 0.7, stars: 0.6, views: 0.5, freshness: 0.9, verified: 1 },
    score: 0.77,
    ...values
  };
}

function fixtureRankings(candidate = fixtureCandidate()) {
  return {
    schemaVersion: 1,
    methodologyVersion: "1.0.0",
    week: "2026-W36",
    generatedAt: "2026-09-01T09:00:00Z",
    types: [
      {
        id: "weather",
        name: "Weather",
        description: "Forecasts",
        eligibleCount: 1,
        winner: candidate,
        runnerUp: null
      }
    ]
  };
}

test("HTML escaping covers text and attribute delimiters", () => {
  assert.equal(escapeHtml(`<script a="'">&</script>`), "&lt;script a=&quot;&#39;&quot;&gt;&amp;&lt;/script&gt;");
});

test("fixture rendering escapes remote data and rejects unsafe links", () => {
  const attack = `<img src=x onerror=alert(1)>`;
  const html = renderFixtureHome(
    fixtureRankings(
      fixtureCandidate({
        name: attack,
        description: attack,
        repository: "javascript:alert(1)",
        detailUrl: "http://insecure.example/plugin",
        installCommand: `install ${attack}`
      })
    )
  );
  assert.ok(!html.includes("<img src=x onerror=alert(1)>"));
  assert.ok(html.includes("&lt;img src=x onerror=alert(1)&gt;"));
  assert.ok(!html.includes("javascript:"));
  assert.ok(!html.includes("http://insecure.example"));
  assert.ok(!html.includes("</script><script>"));
});

test("production render emits the offline site, SEO files, RSS, and immutable badges", async () => {
  const result = await render();
  assert.equal(result.typeCount, 26);
  const rankings = JSON.parse(await readFile(new URL("../data/rankings.json", import.meta.url), "utf8"));
  const weather = rankings.types.find((type) => type.id === "weather");
  const [home, methodology, pick, sitemap, feed, headers, badge] = await Promise.all([
    readFile(new URL("../dist/index.html", import.meta.url), "utf8"),
    readFile(new URL("../dist/methodology/index.html", import.meta.url), "utf8"),
    readFile(new URL("../dist/picks/weather/index.html", import.meta.url), "utf8"),
    readFile(new URL("../dist/sitemap.xml", import.meta.url), "utf8"),
    readFile(new URL("../dist/feed.xml", import.meta.url), "utf8"),
    readFile(new URL("../dist/_headers", import.meta.url), "utf8"),
    readFile(new URL(`../dist/badges/${rankings.week}/weather/${encodeURIComponent(weather.winner.id)}.svg`, import.meta.url), "utf8")
  ]);
  assert.match(home, /OmaPicks/);
  assert.match(home, /data-pick-filter/);
  assert.match(home, /Plugin metadata, engagement signals, and previews come from/);
  assert.match(home, /Open-source code/);
  assert.match(home, /og:image" content="https:\/\/omapicks\.com\/og\/home\.jpg"/);
  assert.match(methodology, /Opinionated picks, auditable math/);
  assert.match(methodology, /id="data-sources"/);
  assert.match(methodology, /https:\/\/plugins\.omarchy\.org\/catalog\.json/);
  assert.match(methodology, /https:\/\/api\.omarchyplugins\.com\/v1\/stats/);
  assert.match(pick, /Best Weather plugins for Omarchy/);
  assert.match(pick, />Original listing<\/a>/);
  assert.match(sitemap, /https:\/\/omapicks\.com\/picks\/weather\//);
  assert.match(feed, /<rss version="2.0">/);
  assert.match(headers, /immutable/);
  assert.ok(badge.includes(escapeHtml(weather.winner.name)));
  await stat(new URL("../dist/og/home.jpg", import.meta.url));
  for (const output of [home, methodology, pick, sitemap, feed, badge]) {
    assert.ok(!output.includes("undefined"));
  }
  const localLinks = [...home.matchAll(/href="(\/[^"#?]*)"/g)].map((match) => match[1]);
  for (const href of localLinks) {
    const target = href.endsWith("/") ? `${href}index.html` : href;
    assert.ok((await stat(new URL(`../dist${target}`, import.meta.url))).isFile(), `Missing local target: ${href}`);
  }
});
