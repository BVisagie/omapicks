import assert from "node:assert/strict";
import { readFile, stat } from "node:fs/promises";
import test from "node:test";
import {
  escapeHtml,
  featuredTypes,
  render,
  renderFixtureHome,
  renderFixtureType,
  weekLabel
} from "../build/render.mjs";

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

test("featured types favor category depth while keeping winners unique", () => {
  const featured = featuredTypes({
    types: [
      { id: "mail", name: "Mail", eligibleCount: 30, winner: { id: "a", score: 0.2, name: "A" } },
      { id: "vpn", name: "VPN", winner: null },
      { id: "weather", name: "Weather", eligibleCount: 2, winner: { id: "b", score: 0.99, name: "B" } },
      { id: "clock", name: "Clock", eligibleCount: 10, winner: { id: "c", score: 0.4, name: "C" } },
      { id: "focus", name: "Focus", eligibleCount: 40, winner: { id: "b", score: 0.9, name: "B" } }
    ]
  }, 3);
  assert.deepEqual(featured.map((type) => type.id), ["focus", "mail", "clock"]);
});

test("readable week labels retain the machine-readable snapshot date", () => {
  assert.equal(
    weekLabel("2026-W36", "2026-09-01T09:00:00Z"),
    '<time datetime="2026-09-01T09:00:00Z">Week of September 1, 2026 <span>(2026-W36)</span></time>'
  );
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
  assert.match(html, /catalog-row/);
  assert.match(html, /showdown/);
  assert.match(html, /01 Champion/);
  assert.match(html, /02 Runner-up/);
  assert.match(html, /No runner-up this week/);
});

test("type rendering compares raw finalist evidence honestly", () => {
  const winner = fixtureCandidate({
    id: "winner",
    name: "Winner",
    score: 0.75,
    metrics: { copies: 0, hearts: 8, stars: 0, views: 20 },
    normalized: { copies: 0.9, hearts: 0.8, stars: 0.7, views: 0.6, freshness: 0, verified: 1 }
  });
  const runnerUp = fixtureCandidate({
    id: "runner",
    name: "Runner",
    score: 0.6,
    metrics: { copies: 12, hearts: 4, stars: 6, views: 0 },
    normalized: { copies: 0.2, hearts: 0.3, stars: 0.4, views: 0.5, freshness: 0.5, verified: 0 }
  });
  const rankings = fixtureRankings(winner);
  rankings.types[0].eligibleCount = 2;
  rankings.types[0].runnerUp = runnerUp;
  const html = renderFixtureType(rankings.types[0], rankings);

  assert.match(html, /25\.0% ahead/);
  assert.match(html, /Bars compare these finalists only/);
  assert.match(html, /style="width:0%"><\/span><\/span>\s*<span>—<\/span>/);
  assert.match(html, /Score 0\.750 of 1\.00 within Weather/);
  assert.match(html, /Show the win in a README/);
  assert.match(html, /Other categories/);
});

test("production render emits the offline site, SEO files, RSS, and immutable badges", async () => {
  const result = await render();
  assert.equal(result.typeCount, 26);
  const rankings = JSON.parse(await readFile(new URL("../data/rankings.json", import.meta.url), "utf8"));
  const weather = rankings.types.find((type) => type.id === "weather");
  const [home, methodology, changelog, pick, sitemap, feed, feedXsl, headers, badge] = await Promise.all([
    readFile(new URL("../dist/index.html", import.meta.url), "utf8"),
    readFile(new URL("../dist/methodology/index.html", import.meta.url), "utf8"),
    readFile(new URL("../dist/changelog/index.html", import.meta.url), "utf8"),
    readFile(new URL("../dist/picks/weather/index.html", import.meta.url), "utf8"),
    readFile(new URL("../dist/sitemap.xml", import.meta.url), "utf8"),
    readFile(new URL("../dist/feed.xml", import.meta.url), "utf8"),
    readFile(new URL("../dist/feed.xsl", import.meta.url), "utf8"),
    readFile(new URL("../dist/_headers", import.meta.url), "utf8"),
    readFile(new URL(`../dist/badges/${rankings.week}/weather/${encodeURIComponent(weather.winner.id)}.svg`, import.meta.url), "utf8")
  ]);
  assert.match(home, /OmaPicks/);
  assert.match(home, /data-pick-filter/);
  assert.match(home, /catalog-row/);
  assert.match(home, /showdown/);
  assert.match(home, /01 Champion/);
  assert.match(home, /02 Runner-up/);
  assert.match(home, /runner-up /);
  assert.match(home, /Week of [A-Z][a-z]+ \d{1,2}, \d{4}/);
  assert.match(home, /Eligible entries/);
  assert.equal([...home.matchAll(/data-catalog-row/g)].length, 26);
  assert.match(home, /og:image" content="https:\/\/omapicks\.com\/og\/home\.jpg"/);
  assert.match(home, /Plugin metadata, engagement signals, and previews come from/);
  assert.match(home, /Open-source code/);
  assert.match(methodology, /How the rankings work/);
  assert.match(methodology, /weight-track/);
  assert.match(methodology, /id="data-sources"/);
  assert.match(methodology, /https:\/\/plugins\.omarchy\.org\/catalog\.json/);
  assert.match(methodology, /https:\/\/api\.omarchyplugins\.com\/v1\/stats/);
  assert.match(changelog, /first-champions/);
  assert.match(changelog, /Subscribe via RSS/);
  assert.match(pick, /Weather/);
  assert.match(pick, /score-comparison/);
  assert.match(pick, /Bars compare these finalists only/);
  assert.match(pick, /01 Champion/);
  assert.match(pick, />Original listing<\/a>/);
  assert.match(pick, /og:image:type" content="image\/jpeg"/);
  assert.match(sitemap, /https:\/\/omapicks\.com\/picks\/weather\//);
  assert.match(feed, /<\?xml-stylesheet type="text\/xsl" href="\/feed\.xsl"\?>/);
  assert.match(feed, /<rss version="2.0">/);
  assert.match(feed, /<\/channel><\/rss>/);
  assert.match(feedXsl, /<xsl:stylesheet/);
  assert.match(feedXsl, /Weekly champion changes/);
  assert.match(headers, /\/feed\.xsl\n  Content-Type: text\/xsl; charset=utf-8/);
  assert.match(headers, /immutable/);
  assert.ok(badge.includes(escapeHtml(weather.winner.name)));
  await stat(new URL("../dist/og/home.jpg", import.meta.url));
  await stat(new URL("../dist/feed.xsl", import.meta.url));
  for (const output of [home, methodology, changelog, pick, sitemap, feed, feedXsl, badge]) {
    assert.ok(!output.includes("undefined"));
  }

  const pages = [home, methodology, changelog, pick];
  for (const html of pages) {
    const ids = [...html.matchAll(/\sid="([^"]+)"/g)].map((match) => match[1]);
    assert.equal(new Set(ids).size, ids.length, "Generated page contains duplicate IDs");
    const localTargets = [...html.matchAll(/(?:href|src)="(\/[^"#?]*)"/g)].map((match) => match[1]);
    for (const href of localTargets) {
      const target = href.endsWith("/") ? `${href}index.html` : href;
      assert.ok((await stat(new URL(`../dist${target}`, import.meta.url))).isFile(), `Missing local target: ${href}`);
    }
  }
});
