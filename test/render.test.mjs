import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import test from "node:test";
import {
  escapeHtml,
  featuredDayIndex,
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

test("featured day index rotates by UTC date without depending on local timezone", () => {
  assert.equal(featuredDayIndex(0), 0);
  assert.equal(featuredDayIndex(5, new Date("1970-01-01T00:00:00Z")), 0);
  assert.equal(featuredDayIndex(5, new Date("1970-01-02T00:00:00Z")), 1);
  assert.equal(featuredDayIndex(5, new Date("1970-01-06T00:00:00Z")), 0);
  assert.equal(featuredDayIndex(5, new Date("1970-01-08T12:00:00Z")), 2);
  const pacificEvening = new Date("2026-09-03T23:00:00-07:00");
  const utcNextDay = new Date("2026-09-04T06:00:00Z");
  const pacificSameCalendarDay = new Date("2026-09-03T12:00:00-07:00");
  assert.equal(featuredDayIndex(5, pacificEvening), featuredDayIndex(5, utcNextDay));
  assert.notEqual(featuredDayIndex(5, pacificSameCalendarDay), featuredDayIndex(5, pacificEvening));
  const today = featuredDayIndex(5);
  assert.ok(today >= 0 && today < 5);
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
  assert.match(html, /<article class="showdown" data-slot="0">/);
  assert.match(html, /Featured today/);
  assert.doesNotMatch(html, /Featured this week/);
  assert.doesNotMatch(html, /dataset\.featuredIndex/);
  assert.equal([...html.matchAll(/<article class="showdown" data-slot="/g)].length, 1);
  assert.equal([...html.matchAll(/data-feature data-slot="/g)].length, 0);
  assert.match(html, /01 Champion/);
  assert.match(html, /02 Runner-up/);
  assert.match(html, /No runner-up this week/);
  assert.match(html, /Find a category/);
  assert.match(html, /Browse 1 category/);
  assert.match(html, /alt="&lt;img src=x onerror=alert\(1\)&gt; preview"/);
  const pick = renderFixtureType(
    fixtureRankings(fixtureCandidate({ name: attack })).types[0],
    fixtureRankings(fixtureCandidate({ name: attack }))
  );
  assert.ok(!pick.includes("<img src=x onerror=alert(1)>"));
  assert.ok(pick.includes(xShareHref(`${attack} is this week's Weather champion on OmaPicks.`, "https://omapicks.com/picks/weather/")));
});

function catalogNames(html) {
  return [...html.matchAll(/class="catalog-row"[^>]*>\s*<span class="type">([^<]*)<\/span>/g)].map((match) => match[1]);
}

function xShareHref(text, url) {
  return `https://x.com/intent/post?${new URLSearchParams({ text: `${text} ${url}` })}`;
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
  assert.match(two, /\$<\/span> omapicks rank --week 2026-W36/);
  assert.match(two, /# no votes\. no sponsorships\. just a reproducible weekly snapshot from omarchy plugins/);
  assert.match(two, /rescored every Monday from Omarchy Plugins/);
  assert.match(two, /data-filter-status data-total="2"/);
  assert.match(two, /Browse 2 categories/);
  assert.match(two, /Browse all 2 categories/);
  assert.match(two, /href="\/methodology\/">How rankings work/);
  assert.match(two, /Compare champion and runner-up/);
  assert.match(two, /Best <a href="\/picks\/vpn\/">VPN<\/a> plugin this week/);
  assert.match(two, /Best <a href="\/picks\/weather\/">Weather<\/a> plugin this week/);
  assert.match(two, /Featured today/);
  assert.doesNotMatch(two, /Featured this week/);
  assert.match(two, /A different category each day\. Rankings refresh Monday\./);
  assert.match(two, /dataset\.featuredIndex/);
  assert.match(two, /html\[data-featured-index="0"\]/);
  assert.match(two, /html\[data-featured-index="1"\]/);
  assert.deepEqual(
    [...two.matchAll(/<article class="showdown" data-slot="(\d+)">[\s\S]*?Best <a href="\/picks\/([^/]+)\/">/g)].map((match) => [match[1], match[2]]),
    [["0", "vpn"], ["1", "weather"]]
  );
  assert.equal([...two.matchAll(/<article class="showdown" data-slot="/g)].length, 2);
  assert.equal([...two.matchAll(/data-feature data-slot="/g)].length, 2);
  assert.match(two, /alt="Tunnel preview"/);
  assert.equal([...two.matchAll(/data-catalog-row/g)].length, 2);
  assert.equal([...two.matchAll(/data-finder-item/g)].length, 2);
  assert.equal([...two.matchAll(/data-suggested/g)].length, 2);
  assert.equal([...two.matchAll(/data-pick-section/g)].length, 0);
  assert.deepEqual(catalogNames(two), ["VPN", "Weather"]);

  const one = renderFixtureHome(fixtureRankings());
  assert.match(one, /Browse 1 category/);
  assert.match(one, /Browse all 1 category/);
  assert.match(one, /<article class="showdown" data-slot="0">/);
  assert.doesNotMatch(one, /dataset\.featuredIndex/);
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
  assert.equal([...three.matchAll(/<article class="showdown" data-slot="/g)].length, 2);
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

test("home and champion pick pages expose X intent links without third-party scripts", () => {
  const rankings = fixtureRankings();
  const home = renderFixtureHome(rankings);
  const pick = renderFixtureType(rankings.types[0], rankings);
  const vacantRankings = fixtureRankings();
  vacantRankings.types[0] = { ...vacantRankings.types[0], winner: null, runnerUp: null, eligibleCount: 0 };
  const vacant = renderFixtureType(vacantRankings.types[0], vacantRankings);

  assert.ok(
    home.includes(
      xShareHref(
        "This week's Omarchy plugin rankings, independently scored from Omarchy Plugins.",
        "https://omapicks.com/"
      )
    )
  );
  assert.match(home, /Share this week on X/);
  assert.ok(
    pick.includes(
      xShareHref("Safe Plugin is this week's Weather champion on OmaPicks.", "https://omapicks.com/picks/weather/")
    )
  );
  assert.match(pick, /Share this ranking on X/);
  assert.doesNotMatch(vacant, /Share this ranking on X/);
  assert.doesNotMatch(vacant, /x\.com\/intent\/post/);
  for (const html of [home, pick, vacant]) {
    assert.doesNotMatch(html, /platform\.twitter\.com/);
    assert.doesNotMatch(html, /widgets\.js/);
    assert.doesNotMatch(html, /beacon\.min\.js/);
  }
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
  const [home, methodology, changelog, privacy, pick, sitemap, feed, feedXsl, headers, routes, manifestSource, badge] = await Promise.all([
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
    readFile(new URL("../dist/site.webmanifest", import.meta.url), "utf8"),
    readFile(new URL(`../dist/badges/${rankings.week}/weather/${encodeURIComponent(weather.winner.id)}.svg`, import.meta.url), "utf8")
  ]);
  const typeCount = rankings.types.length;
  const featured = featuredTypes(rankings, 5);
  assert.match(home, /rel="icon" href="\/assets\/icon\.svg" type="image\/svg\+xml" sizes="any"/);
  assert.match(home, /rel="icon" href="\/assets\/icon-192\.png" type="image\/png" sizes="192x192"/);
  assert.match(home, /rel="icon" href="\/favicon\.ico" sizes="48x48"/);
  assert.match(home, /rel="apple-touch-icon" href="\/apple-touch-icon\.png" sizes="180x180"/);
  assert.match(feedXsl, /rel="icon" href="\/assets\/icon-192\.png" type="image\/png" sizes="192x192"/);
  assert.match(feedXsl, /rel="icon" href="\/favicon\.ico" sizes="48x48"/);
  assert.match(feedXsl, /rel="apple-touch-icon" href="\/apple-touch-icon\.png" sizes="180x180"/);
  assert.match(home, /Find the best Omarchy plugin for the job/);
  assert.match(home, /Find a category/);
  assert.match(home, new RegExp(`Browse ${typeCount} categories`));
  assert.match(home, new RegExp(`Browse all ${typeCount} categories`));
  assert.match(home, /Compare champion and runner-up/);
  assert.match(home, /data-pick-filter/);
  assert.match(home, /catalog-row/);
  assert.match(home, /showdown/);
  assert.match(home, /Featured today/);
  assert.doesNotMatch(home, /Featured this week/);
  assert.match(home, /A different category each day\. Rankings refresh Monday\./);
  assert.match(home, /01 Champion/);
  assert.match(home, /02 Runner-up/);
  assert.match(home, /runner-up /);
  assert.match(home, /Week of [A-Z][a-z]+ \d{1,2}, \d{4}/);
  assert.match(home, /eligible_entries/);
  assert.equal([...home.matchAll(/data-catalog-row/g)].length, typeCount);
  assert.equal([...home.matchAll(/data-finder-item/g)].length, typeCount);
  assert.equal([...home.matchAll(/data-suggested/g)].length, featured.length);
  assert.equal([...home.matchAll(/<article class="showdown" data-slot="/g)].length, featured.length);
  assert.equal([...home.matchAll(/data-feature data-slot="/g)].length, featured.length > 1 ? featured.length : 0);
  assert.match(home, /dataset\.featuredIndex/);
  assert.match(home, /html\[data-featured-index="0"\]/);
  assert.doesNotMatch(methodology, /dataset\.featuredIndex/);
  assert.doesNotMatch(methodology, /html\[data-featured-index/);
  assert.doesNotMatch(changelog, /dataset\.featuredIndex/);
  assert.doesNotMatch(privacy, /dataset\.featuredIndex/);
  assert.doesNotMatch(pick, /dataset\.featuredIndex/);
  assert.doesNotMatch(pick, /<article class="showdown"/);
  assert.ok(home.includes(`<article class="showdown" data-slot="0">`));
  assert.ok(home.includes(`Best <a href="/picks/${featured[0].id}/">${escapeHtml(featured[0].name)}</a> plugin this week`));
  assert.deepEqual(
    catalogNames(home),
    rankings.types
      .slice()
      .sort((a, b) => a.name.localeCompare(b.name, "en"))
      .map((type) => escapeHtml(type.name))
  );
  assert.ok(home.includes(`alt="${escapeHtml(featured[0].winner.name)} preview"`));
  assert.match(home, /og:image" content="https:\/\/omapicks\.com\/og\/terminal\.jpg"/);
  assert.match(pick, /og:image" content="https:\/\/omapicks\.com\/og\/terminal\.jpg"/);
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
  assert.match(privacy, /does not load an X script/);
  assert.match(privacy, /one-way identifier that is salted for that day/);
  assert.match(privacy, /href="https:\/\/github\.com\/BVisagie\/omapicks\/issues\/new" target="_blank" rel="noopener noreferrer"/);
  assert.match(privacy, /Do not post sensitive personal information/);
  assert.doesNotMatch(privacy, /beacon\.min\.js/);
  assert.doesNotMatch(privacy, /cookie (popup|banner|consent)/i);
  assert.ok(
    home.includes(
      xShareHref(
        "This week's Omarchy plugin rankings, independently scored from Omarchy Plugins.",
        "https://omapicks.com/"
      )
    )
  );
  assert.match(home, /Share this week on X/);
  assert.ok(
    pick.includes(
      xShareHref(
        `${weather.winner.name} is this week's Weather champion on OmaPicks.`,
        "https://omapicks.com/picks/weather/"
      )
    )
  );
  assert.match(pick, /Share this ranking on X/);
  assert.doesNotMatch(methodology, /x\.com\/intent\/post/);
  assert.doesNotMatch(privacy, /x\.com\/intent\/post/);
  assert.doesNotMatch(changelog, /x\.com\/intent\/post/);
  assert.doesNotMatch(home, /platform\.twitter\.com/);
  assert.doesNotMatch(pick, /platform\.twitter\.com/);
  assert.doesNotMatch(home, /widgets\.js/);
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
  assert.match(feedXsl, /href="\/assets\/styles-[a-f0-9]{10}\.css"/);
  assert.match(feedXsl, /href="\/feed\.xml" aria-current="page">RSS/);
  assert.match(feedXsl, /data-theme-toggle/);
  assert.match(feedXsl, /xsl:attribute name="href"/);
  assert.match(feedXsl, /substring-after\(\$item-link, ':\/\/omapicks\.com'\)/);
  assert.match(feedXsl, /local-name\(\)='link'/);
  assert.doesNotMatch(feedXsl, /href="\{link\}"/);
  assert.doesNotMatch(feedXsl, /min\(760px/);
  assert.match(headers, /\/feed\.xsl\n  Content-Type: text\/xsl; charset=utf-8/);
  assert.match(headers, /immutable/);

  // Cache busting: styles.css and app.js ship under content-hashed names so they can be
  // served immutable without ever pinning a returning visitor to stale CSS/JS.
  const stylesHref = home.match(/href="(\/assets\/styles-[a-f0-9]{10}\.css)"/)?.[1];
  const appSrc = home.match(/src="(\/assets\/app-[a-f0-9]{10}\.js)"/)?.[1];
  assert.ok(stylesHref, "home should link a fingerprinted stylesheet");
  assert.ok(appSrc, "home should load a fingerprinted script");

  // The hash must be derived from the file's bytes, otherwise it cannot bust anything.
  const digestOf = async (file) =>
    createHash("sha256")
      .update(await readFile(new URL(`../site/${file}`, import.meta.url)))
      .digest("hex")
      .slice(0, 10);
  assert.equal(stylesHref, `/assets/styles-${await digestOf("styles.css")}.css`);
  assert.equal(appSrc, `/assets/app-${await digestOf("app.js")}.js`);

  // The hashed files are the ones actually published, and the unhashed names are gone.
  await stat(new URL(`../dist${stylesHref}`, import.meta.url));
  await stat(new URL(`../dist${appSrc}`, import.meta.url));
  await assert.rejects(() => stat(new URL("../dist/assets/styles.css", import.meta.url)));
  await assert.rejects(() => stat(new URL("../dist/assets/app.js", import.meta.url)));

  // The RSS stylesheet is templated too, so it cannot drift from the markup.
  assert.ok(feedXsl.includes(stylesHref));
  assert.ok(feedXsl.includes(appSrc));
  assert.doesNotMatch(feedXsl, /\/assets\/(styles\.css|app\.js)/);

  assert.match(headers, /\/assets\/styles-\*\.css\n  Cache-Control: public, max-age=31536000, immutable/);
  assert.match(headers, /\/assets\/app-\*\.js\n  Cache-Control: public, max-age=31536000, immutable/);
  // Cloudflare merges every matching rule's headers instead of taking the most specific one,
  // so a broad /assets/* rule would attach a second Cache-Control to the immutable files.
  assert.doesNotMatch(headers, /^\/assets\/\*$/m);
  const publishedRoutes = JSON.parse(routes);
  assert.deepEqual(publishedRoutes.include, ["/*"]);
  assert.ok(publishedRoutes.exclude.includes("/assets/*"));
  assert.ok(publishedRoutes.exclude.includes("/favicon.ico"));
  assert.ok(publishedRoutes.exclude.includes("/apple-touch-icon.png"));
  assert.match(headers, /\/favicon\.ico\n  Cache-Control: public, max-age=604800/);
  assert.match(headers, /\/apple-touch-icon\.png\n  Cache-Control: public, max-age=604800/);
  const manifest = JSON.parse(manifestSource);
  assert.deepEqual(manifest.icons, [
    { src: "/assets/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
    { src: "/assets/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
    { src: "/assets/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" }
  ]);
  assert.doesNotMatch(home, /beacon\.min\.js/);
  assert.doesNotMatch(home, /cookie (popup|banner|consent)/i);
  assert.ok(badge.includes(escapeHtml(weather.winner.name)));
  assert.match(badge, /height="20"/);
  await stat(new URL("../dist/og/home.jpg", import.meta.url));
  await stat(new URL("../dist/og/terminal.jpg", import.meta.url));
  await stat(new URL("../dist/feed.xsl", import.meta.url));
  await stat(new URL("../dist/favicon.ico", import.meta.url));
  await stat(new URL("../dist/apple-touch-icon.png", import.meta.url));
  await stat(new URL("../dist/assets/icon-192.png", import.meta.url));
  await stat(new URL("../dist/assets/icon-512.png", import.meta.url));
  await stat(new URL("../dist/assets/icon-maskable-512.png", import.meta.url));
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
