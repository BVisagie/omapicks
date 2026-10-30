import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { BADGE_PALETTE, PALETTE, renderFixtureBadge, renderFixtureHome, renderFixtureMethodology } from "../build/render.mjs";

const styles = readFileSync(new URL("../site/styles.css", import.meta.url), "utf8");

// The first `:root { … }` block holds the dark tokens; `:root[data-theme="light"]` holds the
// explicit light theme and `:root:not([data-theme="dark"])` (inside the prefers-color-scheme media
// query) the no-JavaScript light theme. Blocks are read by brace matching, so nested rules and
// selectors with parentheses work.
function block(selector) {
  const start = styles.indexOf(`${selector} {`);
  if (start < 0) return "";
  const open = styles.indexOf("{", start);
  let depth = 0;
  for (let i = open; i < styles.length; i += 1) {
    if (styles[i] === "{") depth += 1;
    else if (styles[i] === "}" && (depth -= 1) === 0) return styles.slice(open + 1, i);
  }
  return "";
}

function token(selector, name) {
  return block(selector).match(new RegExp(`${name}:\\s*([^;]+);`))?.[1].trim();
}

function customProperties(source) {
  return Object.fromEntries([...source.matchAll(/(--[\w-]+):\s*([^;]+);/g)].map(([, name, value]) => [name, value.trim()]));
}

function fixtureRankings() {
  return {
    schemaVersion: 1,
    methodologyVersion: "1.3.0",
    week: "2026-W44",
    generatedAt: "2026-10-26T06:00:00Z",
    types: [{
      id: "clipboard", name: "Clipboard", description: "Clipboard history", eligibleCount: 1,
      winner: { id: "spotlight", name: "Spotlight", description: "Launcher", author: "Max", repository: "https://github.com/maajix/omarchy-spotlight",
        detailUrl: "https://plugins.omarchy.org/plugin.html?id=spotlight", installCommand: "omarchy plugin add https://github.com/maajix/omarchy-spotlight.git",
        metrics: { copies: 10, hearts: 4, stars: 3, views: 30 }, normalized: { freshness: 0.9 }, score: 0.9,
        taskFit: { qualified: true, reason: "Browses clipboard history.", role: "core", provenance: "repository-evidence", reviewedAt: "2026-10-12", constraints: [],
          source: { url: "https://github.com/maajix/omarchy-spotlight", revision: "a".repeat(40), path: "README.md", evidence: "Clipboard history." } } },
      runnerUp: null
    }]
  };
}

test("site palette constants mirror the stylesheet tokens and drive theme-color", () => {
  assert.equal(token(":root", "--bg"), PALETTE.bg);
  assert.equal(token(":root", "--ink"), PALETTE.ink);
  assert.equal(token(":root", "--muted"), PALETTE.muted);
  assert.equal(token(":root", "--accent"), PALETTE.accent);
  assert.equal(token(':root[data-theme="light"]', "--bg"), PALETTE.lightBg);
  const html = renderFixtureHome(fixtureRankings());
  assert.match(html, new RegExp(`<meta name="theme-color" content="${PALETTE.bg}" media="\\(prefers-color-scheme: dark\\)">`));
  assert.match(html, new RegExp(`<meta name="theme-color" content="${PALETTE.lightBg}" media="\\(prefers-color-scheme: light\\)">`));
});

test("hero enhancements ship inert: plain heading, hidden radar, palette and triggers, finder intact", () => {
  const html = renderFixtureHome(fixtureRankings());
  assert.match(html, /<h1>Find an Omarchy plugin that fits your task\.<\/h1>/);
  assert.doesNotMatch(html, /class="decode"/);
  assert.match(html, /<div class="glass radar-panel" data-radar hidden>/);
  assert.match(html, /<canvas class="radar" role="img" aria-label="Radar of 1 category\. Move the pointer over a node to read its leading reviewed option; click to open the category\.">/);
  assert.match(html, /<div class="palette" role="dialog" aria-modal="true" aria-labelledby="finder-label" data-palette hidden>/);
  assert.equal([...html.matchAll(/data-open-palette hidden/g)].length, 3);
  assert.match(html, /<div class="hero-finder glass" role="search">/);
  assert.match(html, /<input id="pick-filter" type="search"[^>]*data-pick-filter>/);
  // Non-home pages carry neither the palette nor its trigger.
  assert.doesNotMatch(renderFixtureMethodology(fixtureRankings()), /data-palette|data-open-palette/);
});

test("the signal meter appears only where the legacy delta does, with the winner's share of the pair", () => {
  const candidate = (id, score) => ({ id, name: id, description: "d", author: "a", repository: "https://github.com/x/y", detailUrl: "https://plugins.omarchy.org/plugin.html?id=" + id,
    installCommand: "omarchy plugin add https://github.com/x/y.git", metrics: { copies: 1, hearts: 1, stars: 1, views: 30 }, normalized: { freshness: 0.5 }, score });
  const legacy = (winner, runnerUp) => ({ schemaVersion: 1, methodologyVersion: "1.2.0", week: "2026-W43", generatedAt: "2026-10-19T06:00:00Z",
    types: [{ id: "weather", name: "Weather", description: "Forecasts", eligibleCount: 2, winner, runnerUp,
      ...(winner ? { winner: { ...winner, taskFit: { qualified: true, reason: "r", source: { url: "https://github.com/x/y" }, reviewedAt: "2026-10-12", constraints: [] } } } : {}),
      ...(runnerUp ? { runnerUp: { ...runnerUp, taskFit: { qualified: true, reason: "r", source: { url: "https://github.com/x/y" }, reviewedAt: "2026-10-12", constraints: [] } } } : {}) }] });
  const pair = renderFixtureHome(legacy(candidate("lead", 0.9), candidate("second", 0.6)));
  assert.match(pair, /class="delta">50\.0% ahead on score</);
  assert.match(pair, /aria-label="lead holds 60% of the combined score"><span style="--v: 60%">/);
  assert.match(pair, /<div class="meter-legend"><span>lead<\/span><span>second<\/span><\/div>/);
  const tie = renderFixtureHome(legacy(candidate("lead", 0.7), candidate("second", 0.7)));
  assert.match(tie, /Equal combined scores/);
  assert.match(tie, /holds 50% of the combined score/);
  const solo = renderFixtureHome(legacy(candidate("lead", 0.7), null));
  assert.doesNotMatch(solo, /class="meter"|class="delta"/);
  const reviewed = renderFixtureHome({ ...fixtureRankings(), types: [{ ...fixtureRankings().types[0], eligibleCount: 2,
    runnerUp: { ...fixtureRankings().types[0].winner, id: "other", name: "Other", score: 0.5 } }] });
  assert.doesNotMatch(reviewed, /class="meter"|class="delta"/, "reviewed snapshots keep the score off the home page");
  assert.match(reviewed, /2 qualified options/);
  // A hidden top scorer changes the delta to "behind this week's top score"; that compares the
  // winner with the leader, so the pair's share bar would describe a different pair and is skipped.
  const hiddenLeader = legacy(candidate("lead", 0.9), candidate("second", 0.6));
  hiddenLeader.types[0].topScorer = { ...candidate("top", 0.95) };
  const behind = renderFixtureHome(hiddenLeader);
  assert.match(behind, /class="delta">[^<]*behind this week's top score</);
  assert.doesNotMatch(behind, /class="meter"/);
});

test("the no-JavaScript light palette matches the explicit light theme", () => {
  const explicit = customProperties(block(':root[data-theme="light"]'));
  const osLight = customProperties(block(':root:not([data-theme="dark"])'));
  assert.ok(Object.keys(explicit).length > 10, "light theme tokens were not found");
  assert.deepEqual(osLight, explicit);
});

test("the finder triggers are named for assistive tech and the weekly tile keeps a short heading", () => {
  const html = renderFixtureHome(fixtureRankings());
  assert.match(html, /<button class="finder-trigger" type="button" aria-label="Find a category" data-open-palette hidden><span class="finder-trigger-label" aria-hidden="true">find a category<\/span><kbd aria-hidden="true">Ctrl K<\/kbd><\/button>/);
  assert.doesNotMatch(html, /<kbd>[^<]*<\/kbd>/, "every shortcut hint is decorative");
  assert.match(html, /<h2 id="weekly-summary-heading">What changed this week<\/h2>\s*<p class="summary">/);
});

test("the atmosphere paints above the opaque body background", () => {
  // The fixed atmosphere layer sits at z-index -1. Without a stacking context on body it would be
  // painted beneath body's opaque background and never show.
  assert.match(block("body"), /isolation:\s*isolate;/);
  assert.match(block(".atmosphere"), /z-index:\s*-1;/);
});

test("contrast-probed tokens stay opaque in both themes", () => {
  // e2e reads --muted against --bg, --surface and --well as solid colours; translucent values
  // would be parsed as their first three channels and report a false contrast.
  for (const block of [":root", ':root[data-theme="light"]']) {
    for (const name of ["--bg", "--surface", "--surface-2", "--muted", "--ink"]) {
      assert.match(token(block, name), /^#[0-9a-f]{6}$/i, `${block} ${name}`);
    }
  }
  assert.equal(token(":root", "--well"), "var(--surface-2)");
});

test("badges are frozen artifacts: palette pinned and bytes unchanged from the pre-interface output", () => {
  assert.deepEqual(BADGE_PALETTE, { bg: "#1a1b26", ink: "#c0caf5", accent: "#8bd5ca" });
  assert.notEqual(BADGE_PALETTE.bg, PALETTE.bg, "badge colours must not follow the site theme");
  const type = { id: "clipboard", name: "Clipboard", winner: { id: "spotlight", name: "Spotlight" } };
  const expected = (week, label) => `<svg xmlns="http://www.w3.org/2000/svg" width="309" height="20" role="img" aria-label="OmaPicks Clipboard ${label}: Spotlight">
  <title>OmaPicks Clipboard ${label}: Spotlight</title>
  <defs>
    <clipPath id="badge">
      <rect width="309" height="20" rx="3"/>
    </clipPath>
  </defs>
  <g clip-path="url(#badge)">
    <rect width="78" height="20" fill="#c0caf5"/>
    <rect x="78" width="231" height="20" fill="#8bd5ca"/>
  </g>
  <text x="10" y="14.5" fill="#1a1b26" font-family="'Cascadia Mono',ui-monospace,monospace" font-size="11" font-weight="700">OmaPicks</text>
  <text x="86" y="14.5" fill="#1a1b26" font-family="'Cascadia Mono',ui-monospace,monospace" font-size="11">Spotlight · Clipboard · ${week}</text>
</svg>
`;
  assert.equal(renderFixtureBadge(type, { week: "2026-W44", methodologyVersion: "1.3.0" }), expected("2026-W44", "leading reviewed option"));
  assert.equal(renderFixtureBadge(type, { week: "2026-W43", methodologyVersion: "1.2.0" }), expected("2026-W43", "champion"));
});
