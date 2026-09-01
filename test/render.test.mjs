import assert from "node:assert/strict";
import { readFile, stat } from "node:fs/promises";
import test from "node:test";
import {
  escapeHtml,
  featuredTypes,
  render,
  renderFixtureHome,
  renderFixtureType,
  weekLabel,
  winningReason
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
  assert.match(html, /Find a category/);
  assert.match(html, /Browse 1 category/);
  assert.match(html, /alt="&lt;img src=x onerror=alert\(1\)&gt; preview"/);
});

function catalogNames(html) {
  return [...html.matchAll(/class="catalog-row"[^>]*>\s*<span class="type">([^<]*)<\/span>/g)].map((match) => match[1]);
}

test("homepage discovery chrome follows the ranking taxonomy", () => {
  const two = renderFixtureHome({
    ...fixtureRankings(),
    types: [
      {
        id: "weather",
        name: "Weather",
        description: "Forecasts",
        eligibleCount: 4,
        winner: fixtureCandidate({ id: "rain.plugin", name: "Rain" }),
        runnerUp: null
      },
      {
        id: "vpn",
        name: "VPN",
        description: "Tunnels",
        eligibleCount: 9,
        winner: fixtureCandidate({ id: "vpn.plugin", name: "Tunnel" }),
        runnerUp: null
      }
    ]
  });
  assert.match(two, /Find the best Omarchy plugin for the job/);
  assert.match(two, /Browse 2 categories/);
  assert.match(two, /Browse all 2 categories/);
  assert.match(two, /href="\/methodology\/">How rankings work/);
  assert.match(two, /Compare champion and runner-up/);
  assert.match(two, /Best <a href="\/picks\/vpn\/">VPN<\/a> plugin this week/);
  assert.match(two, /alt="Tunnel preview"/);
  assert.equal([...two.matchAll(/data-catalog-row/g)].length, 2);
  assert.equal([...two.matchAll(/data-finder-item/g)].length, 2);
  assert.equal([...two.matchAll(/data-suggested/g)].length, 2);
  assert.equal([...two.matchAll(/data-pick-section/g)].length, 0);
  assert.deepEqual(catalogNames(two), ["VPN", "Weather"]);

  const one = renderFixtureHome(fixtureRankings());
  assert.match(one, /Browse 1 category/);
  assert.match(one, /Browse all 1 category/);
  assert.equal([...one.matchAll(/data-catalog-row/g)].length, 1);
  assert.equal([...one.matchAll(/data-finder-item/g)].length, 1);
  assert.deepEqual(catalogNames(one), ["Weather"]);

  const three = renderFixtureHome({
    ...fixtureRankings(),
    types: [
      {
        id: "weather",
        name: "Weather",
        description: "Forecasts",
        eligibleCount: 2,
        winner: fixtureCandidate({ id: "rain.plugin", name: "Rain" }),
        runnerUp: null
      },
      {
        id: "clipboard",
        name: "Clipboard",
        description: "Paste history",
        eligibleCount: 0,
        winner: null,
        runnerUp: null
      },
      {
        id: "vpn",
        name: "VPN",
        description: "Tunnels",
        eligibleCount: 9,
        winner: fixtureCandidate({ id: "vpn.plugin", name: "Tunnel" }),
        runnerUp: null
      }
    ]
  });
  assert.match(three, /Browse 3 categories/);
  assert.match(three, /Browse all 3 categories/);
  assert.equal([...three.matchAll(/data-catalog-row/g)].length, 3);
  assert.equal([...three.matchAll(/data-finder-item/g)].length, 3);
  assert.equal([...three.matchAll(/data-suggested/g)].length, 2);
  assert.match(three, /data-finder-item data-search="clipboard paste history"[^>]* hidden>/);
  assert.deepEqual(catalogNames(three), ["Clipboard", "VPN", "Weather"]);
});

test("homepage client script filters the finder and catalog without touching featured picks", async () => {
  const js = await readFile(new URL("../site/app.js", import.meta.url), "utf8");
  assert.match(js, /data-finder-item/);
  assert.match(js, /data-catalog-row/);
  assert.match(js, /data-suggested/);
  assert.doesNotMatch(js, /data-pick-section/);
});

test("winning reasons describe the score gap in plain language", () => {
  const winner = fixtureCandidate({
    verificationStatus: "unverified",
    contributions: { copies: 0.3, hearts: 0.1, stars: 0.05, views: 0.02, freshness: 0.1, verified: 0 }
  });
  const runnerUp = fixtureCandidate({
    id: "runner.plugin",
    verificationStatus: "unverified",
    contributions: { copies: 0.12, hearts: 0.12, stars: 0.08, views: 0.04, freshness: 0.1, verified: 0 }
  });
  assert.equal(winningReason(winner, runnerUp), "It won mainly because more people copied the install command.");
  assert.equal(winningReason(winner, null), "It was the only eligible plugin in this category this week.");
  const close = fixtureCandidate({
    contributions: { copies: 0.2, hearts: 0.2, stars: 0.1, views: 0.05, freshness: 0.1, verified: 0.05 }
  });
  const closeRunner = fixtureCandidate({
    id: "runner.plugin",
    verificationStatus: "unverified",
    contributions: { copies: 0.2, hearts: 0.2, stars: 0.1, views: 0.05, freshness: 0.1, verified: 0 }
  });
  assert.equal(
    winningReason(close, closeRunner),
    "The two were close on public activity; a verified listing tipped this week's score."
  );
});

test("type rendering explains the ranking in plain language", () => {
  const winner = fixtureCandidate({
    id: "winner",
    name: "Winner",
    score: 0.75,
    metrics: { copies: 0, hearts: 8, stars: 0, views: 20 },
    normalized: { copies: 0.9, hearts: 0.8, stars: 0.7, views: 0.6, freshness: 0, verified: 1 },
    contributions: { copies: 0.3, hearts: 0.1, stars: 0.05, views: 0.02, freshness: 0.1, verified: 0.05 }
  });
  const runnerUp = fixtureCandidate({
    id: "runner",
    name: "Runner",
    score: 0.6,
    metrics: { copies: 12, hearts: 4, stars: 6, views: 0 },
    normalized: { copies: 0.2, hearts: 0.3, stars: 0.4, views: 0.5, freshness: 0.5, verified: 0 },
    contributions: { copies: 0.12, hearts: 0.12, stars: 0.1, views: 0.04, freshness: 0.1, verified: 0 }
  });
  const rankings = fixtureRankings(winner);
  rankings.types[0].eligibleCount = 2;
  rankings.types[0].runnerUp = runnerUp;
  const html = renderFixtureType(rankings.types[0], rankings);

  assert.match(html, /2 plugins competed this week/);
  assert.match(html, /This page shows the champion and runner-up/);
  assert.match(html, /It won mainly because more people copied the install command/);
  assert.match(html, /25\.0% apart/);
  assert.match(html, /These bars are raw public counts/);
  assert.match(html, /Install-command copies count most/);
  assert.match(html, /style="width:0%"><\/span><\/span>\s*<span>—<\/span>/);
  assert.doesNotMatch(html, /Score 0\.750 of 1\.00 within Weather/);
  assert.match(html, /How we pick/);
  assert.match(html, /A ranking is not an endorsement or a safety review/);
  assert.match(html, /href="\/methodology\/#safety"/);
  assert.match(html, /For plugin authors/);
  assert.match(html, /Copy this markdown into your README/);
  assert.match(html, /src="\/badges\/2026-W36\/weather\/winner\.svg"/);
  assert.doesNotMatch(html, /Winner badge/);
  assert.doesNotMatch(html, /href="#winner-badge"/);
  assert.doesNotMatch(html, /href="\/badges\/[^"]+"/);
  assert.match(html, /Other categories/);
  assert.match(
    html,
    /<a href="https:\/\/plugins\.omarchy\.org\/plugin\.html\?id=safe\.plugin" target="_blank" rel="noopener noreferrer">Winner<\/a>/
  );
  assert.match(
    html,
    /<a href="https:\/\/plugins\.omarchy\.org\/plugin\.html\?id=safe\.plugin" target="_blank" rel="noopener noreferrer">Original listing<\/a>/
  );
  assert.match(
    html,
    /<a href="https:\/\/github\.com\/example\/safe" target="_blank" rel="noopener noreferrer">Repository<\/a>/
  );
});

test("rejected plugin URLs stay as inert in-page hashes", () => {
  const rankings = fixtureRankings(
    fixtureCandidate({
      repository: "javascript:alert(1)",
      detailUrl: "http://insecure.example/plugin"
    })
  );
  const html = renderFixtureType(rankings.types[0], rankings);
  assert.match(html, /<a href="#">Original listing<\/a>/);
  assert.match(html, /<a href="#">Repository<\/a>/);
  assert.doesNotMatch(html, /href="#" target="_blank"/);
});

test("production render emits the offline site, SEO files, RSS, and immutable badges", async () => {
  const rankings = JSON.parse(await readFile(new URL("../data/rankings.json", import.meta.url), "utf8"));
  const result = await render();
  assert.equal(result.typeCount, rankings.types.length);
  const weather = rankings.types.find((type) => type.id === "weather");
  const [home, methodology, changelog, privacy, pick, sitemap, feed, feedXsl, headers, routes, badge] = await Promise.all([
    readFile(new URL("../dist/index.html", import.meta.url), "utf8"),
    readFile(new URL("../dist/methodology/index.html", import.meta.url), "utf8"),
    readFile(new URL("../dist/changelog/index.html", import.meta.url), "utf8"),
    readFile(new URL("../dist/privacy/index.html", import.meta.url), "utf8"),
    readFile(new URL("../dist/picks/weather/index.html", import.meta.url), "utf8"),
    readFile(new URL("../dist/sitemap.xml", import.meta.url), "utf8"),
    readFile(new URL("../dist/feed.xml", import.meta.url), "utf8"),
    readFile(new URL("../dist/feed.xsl", import.meta.url), "utf8"),
    readFile(new URL("../dist/_headers", import.meta.url), "utf8"),
    readFile(new URL("../dist/_routes.json", import.meta.url), "utf8"),
    readFile(new URL(`../dist/badges/${rankings.week}/weather/${encodeURIComponent(weather.winner.id)}.svg`, import.meta.url), "utf8")
  ]);
  const typeCount = rankings.types.length;
  const featured = featuredTypes(rankings, 5);
  assert.match(home, /OmaPicks/);
  assert.match(home, /Find the best Omarchy plugin for the job/);
  assert.match(home, /Find a category/);
  assert.match(home, new RegExp(`Browse ${typeCount} categories`));
  assert.match(home, new RegExp(`Browse all ${typeCount} categories`));
  assert.match(home, /Compare champion and runner-up/);
  assert.match(home, /data-pick-filter/);
  assert.match(home, /catalog-row/);
  assert.match(home, /showdown/);
  assert.match(home, /01 Champion/);
  assert.match(home, /02 Runner-up/);
  assert.match(home, /runner-up /);
  assert.match(home, /Week of [A-Z][a-z]+ \d{1,2}, \d{4}/);
  assert.match(home, /Eligible entries/);
  assert.equal([...home.matchAll(/data-catalog-row/g)].length, typeCount);
  assert.equal([...home.matchAll(/data-finder-item/g)].length, typeCount);
  assert.equal([...home.matchAll(/data-suggested/g)].length, featured.length);
  assert.deepEqual(
    catalogNames(home),
    rankings.types
      .slice()
      .sort((a, b) => a.name.localeCompare(b.name, "en"))
      .map((type) => escapeHtml(type.name))
  );
  assert.ok(home.includes(`alt="${escapeHtml(featured[0].winner.name)} preview"`));
  assert.match(home, /og:image" content="https:\/\/omapicks\.com\/og\/home\.jpg"/);
  assert.match(home, /Plugin metadata, engagement signals, and previews come from/);
  assert.match(home, /target="_blank" rel="noopener noreferrer">Open-source code<\/a>/);
  assert.match(feedXsl, /target="_blank" rel="noopener noreferrer">Open-source code<\/a>/);
  assert.match(home, /href="\/privacy\/"/);
  assert.match(methodology, /class="page-section prose"/);
  assert.match(methodology, /aria-current="page">Method/);
  assert.match(methodology, /In plain terms/);
  assert.match(methodology, /Copying the install command counts most/);
  assert.match(methodology, /weight-track/);
  assert.match(methodology, /id="data-sources"/);
  assert.match(methodology, /id="safety"/);
  assert.match(methodology, /not an endorsement/);
  assert.match(methodology, /https:\/\/plugins\.omarchy\.org\/catalog\.json/);
  assert.match(methodology, /https:\/\/api\.omarchyplugins\.com\/v1\/stats/);
  assert.match(changelog, /class="page-section"/);
  assert.match(changelog, /aria-current="page">Changes/);
  assert.match(changelog, /first-champions/);
  assert.match(changelog, /Subscribe via RSS/);
  assert.doesNotMatch(home, /aria-current="page"/);
  assert.match(privacy, /How OmaPicks treats visitors/);
  assert.match(privacy, /does not receive an analytics script/);
  assert.match(privacy, /one-way identifier that is salted for that day/);
  assert.match(privacy, /github.com\/BVisagie\/omapicks\/issues\/new/);
  assert.match(privacy, /Do not post sensitive personal information/);
  assert.doesNotMatch(privacy, /beacon\.min\.js/);
  assert.doesNotMatch(privacy, /cookie (popup|banner|consent)/i);
  assert.match(pick, /Weather/);
  assert.match(pick, /How they compare/);
  assert.match(pick, /These bars are raw public counts/);
  assert.match(pick, /It won mainly because/);
  assert.match(pick, /How we pick/);
  assert.match(pick, /01 Champion/);
  assert.match(pick, /target="_blank" rel="noopener noreferrer">Original listing<\/a>/);
  assert.match(pick, /target="_blank" rel="noopener noreferrer">Repository<\/a>/);
  assert.match(pick, /For plugin authors/);
  assert.match(pick, /Copy this markdown into your README/);
  assert.doesNotMatch(pick, /Winner badge/);
  assert.doesNotMatch(pick, /href="#winner-badge"/);
  assert.doesNotMatch(pick, /<a href="\/badges\//);
  assert.match(pick, /og:image:type" content="image\/jpeg"/);
  assert.match(pick, /A ranking is not an endorsement or a safety review/);
  assert.match(sitemap, /https:\/\/omapicks\.com\/privacy\//);
  assert.match(feed, /<\?xml-stylesheet type="text\/xsl" href="\/feed\.xsl"\?>/);
  assert.match(feed, /<rss version="2.0">/);
  assert.match(feed, /<\/channel><\/rss>/);
  assert.match(feedXsl, /<xsl:stylesheet/);
  assert.match(feedXsl, /Weekly champion changes/);
  assert.match(feedXsl, /class="page-section"/);
  assert.match(feedXsl, /class="page-lede"/);
  assert.match(feedXsl, /class="page-wrap"/);
  assert.match(feedXsl, /href="\/assets\/styles\.css"/);
  assert.match(feedXsl, /href="\/feed\.xml" aria-current="page">RSS/);
  assert.match(feedXsl, /data-theme-toggle/);
  assert.match(feedXsl, /xsl:attribute name="href"/);
  assert.match(feedXsl, /substring-after\(\$item-link, ':\/\/omapicks\.com'\)/);
  assert.match(feedXsl, /local-name\(\)='link'/);
  assert.doesNotMatch(feedXsl, /href="\{link\}"/);
  assert.doesNotMatch(feedXsl, /min\(760px/);
  assert.match(headers, /\/feed\.xsl\n  Content-Type: text\/xsl; charset=utf-8/);
  assert.match(headers, /immutable/);
  const publishedRoutes = JSON.parse(routes);
  assert.deepEqual(publishedRoutes.include, ["/*"]);
  assert.ok(publishedRoutes.exclude.includes("/assets/*"));
  assert.doesNotMatch(home, /beacon\.min\.js/);
  assert.doesNotMatch(home, /cookie (popup|banner|consent)/i);
  assert.ok(badge.includes(escapeHtml(weather.winner.name)));
  assert.match(badge, /height="20"/);
  await stat(new URL("../dist/og/home.jpg", import.meta.url));
  await stat(new URL("../dist/feed.xsl", import.meta.url));
  for (const output of [home, methodology, changelog, privacy, pick, sitemap, feed, feedXsl, badge]) {
    assert.ok(!output.includes("undefined"));
  }

  const pages = [home, methodology, changelog, privacy, pick];
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
