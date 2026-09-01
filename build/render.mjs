import { cp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { METHODOLOGY, changesBetween } from "./rank.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DIST = path.join(ROOT, "dist");
const ORIGIN = "https://omapicks.com";
const SIGNAL_METRICS = ["copies", "hearts", "stars", "views", "freshness"];
const PALETTE = Object.freeze({
  bg: "#f3eee4",
  ink: "#1a1612",
  muted: "#5c564c",
  accent: "#b53415"
});

export function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function xml(value) {
  return escapeHtml(value);
}

function safeUrl(value, fallback = "#") {
  try {
    const url = new URL(value);
    return url.protocol === "https:" ? url.href : fallback;
  } catch {
    return fallback;
  }
}

function safeLocalImage(value) {
  return /^assets\/plugins\/[a-zA-Z0-9.-]+\.(?:webp|png|jpg)$/.test(value ?? "")
    ? `/${value}`
    : "/assets/placeholder.svg";
}

function jsonLd(value) {
  return JSON.stringify(value).replaceAll("<", "\\u003c");
}

function metricLabel(metric) {
  return new Map([
    ["copies", "Copies"],
    ["hearts", "Hearts"],
    ["stars", "Stars"],
    ["views", "Views"],
    ["freshness", "Freshness"],
    ["verified", "Verified"]
  ]).get(metric) ?? metric;
}

function clamp01(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return 0;
  return Math.max(0, Math.min(1, number));
}

function dateLabel(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleDateString("en-US", { dateStyle: "long", timeZone: "UTC" });
}

export function weekLabel(week, generatedAt) {
  const label = dateLabel(generatedAt);
  const iso = week ? escapeHtml(week) : "pending";
  return label
    ? `<time datetime="${escapeHtml(generatedAt)}">Week of ${escapeHtml(label)} <span>(${iso})</span></time>`
    : `Week ${iso}`;
}

function scoreLead(winner, runnerUp) {
  if (!winner || !runnerUp || !Number.isFinite(winner.score) || !Number.isFinite(runnerUp.score) || runnerUp.score <= 0) {
    return null;
  }
  return Math.max(0, ((winner.score - runnerUp.score) / runnerUp.score) * 100);
}

function searchBlob(type) {
  return [
    type.name,
    type.description,
    type.winner?.name,
    type.winner?.author,
    type.runnerUp?.name,
    type.runnerUp?.author
  ].filter(Boolean).join(" ").toLowerCase();
}

export function featuredTypes(rankings, count = 6) {
  const selected = [];
  const seenWinners = new Set();
  const ranked = (rankings.types ?? [])
    .filter((type) => type.winner)
    .slice()
    .sort((a, b) => b.eligibleCount - a.eligibleCount || a.id.localeCompare(b.id));
  for (const type of ranked) {
    if (seenWinners.has(type.winner.id)) continue;
    seenWinners.add(type.winner.id);
    selected.push(type);
    if (selected.length >= count) break;
  }
  return selected;
}

function themeBoot() {
  return `<script>
(() => {
  try {
    const stored = localStorage.getItem("omapicks-theme");
    const theme = stored === "light" || stored === "dark"
      ? stored
      : (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
    document.documentElement.dataset.theme = theme;
  } catch {
    document.documentElement.dataset.theme = "light";
  }
})();
</script>`;
}

function nav() {
  return `<header class="site-header">
    <a class="brand" href="/" aria-label="OmaPicks home">OmaPicks</a>
    <nav aria-label="Primary navigation">
      <a href="/methodology/">Method</a>
      <a href="/changelog/">Changes</a>
      <a href="/feed.xml">RSS</a>
      <button class="theme-toggle" type="button" data-theme-toggle aria-label="Switch to dark theme" aria-pressed="false">
        <span class="theme-label-dark" aria-hidden="true">Dark</span>
        <span class="theme-label-light" aria-hidden="true">Light</span>
      </button>
    </nav>
  </header>`;
}

function shell({ title, description, pathname, image, body, structuredData = null }) {
  const canonical = `${ORIGIN}${pathname}`;
  const fullTitle = title === "OmaPicks" ? "OmaPicks — weekly Omarchy plugin rankings" : `${title} · OmaPicks`;
  const ogImage = `${ORIGIN}${image.url}`;
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  ${themeBoot()}
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(fullTitle)}</title>
  <meta name="description" content="${escapeHtml(description)}">
  <meta name="color-scheme" content="light dark">
  <meta name="theme-color" content="${PALETTE.bg}">
  <link rel="canonical" href="${canonical}">
  <link rel="icon" href="/assets/icon.svg" type="image/svg+xml">
  <link rel="manifest" href="/site.webmanifest">
  <link rel="alternate" type="application/rss+xml" title="OmaPicks weekly changes" href="/feed.xml">
  <link rel="stylesheet" href="/assets/styles.css">
  <meta property="og:type" content="website">
  <meta property="og:site_name" content="OmaPicks">
  <meta property="og:title" content="${escapeHtml(fullTitle)}">
  <meta property="og:description" content="${escapeHtml(description)}">
  <meta property="og:url" content="${canonical}">
  <meta property="og:image" content="${ogImage}">
  <meta property="og:image:type" content="${escapeHtml(image.type)}">
  <meta property="og:image:width" content="${escapeHtml(image.width)}">
  <meta property="og:image:height" content="${escapeHtml(image.height)}">
  <meta property="og:image:alt" content="${escapeHtml(image.alt ?? "OmaPicks weekly Omarchy plugin rankings")}">
  <meta name="twitter:card" content="summary_large_image">
  <meta name="twitter:image" content="${ogImage}">
  <meta name="twitter:image:alt" content="${escapeHtml(image.alt ?? "OmaPicks weekly Omarchy plugin rankings")}">
  ${structuredData ? `<script type="application/ld+json">${jsonLd(structuredData)}</script>` : ""}
  <script src="/assets/app.js" defer></script>
</head>
<body>
  <a class="skip-link" href="#main">Skip to content</a>
  <div class="page-wrap">
    ${nav()}
    <main id="main">${body}</main>
    <footer>
      <p>Plugin metadata, engagement signals, and previews come from <a href="https://plugins.omarchy.org/?sort=copies">Omarchy Plugins</a>. OmaPicks calculates the rankings independently and is not affiliated with Omarchy, 37signals, or omarchyplugins.com.</p>
      <p><a href="/methodology/#data-sources">Data and methodology</a> · <a href="https://github.com/BVisagie/omapicks">Open-source code</a></p>
    </footer>
  </div>
</body>
</html>
`;
}

function statusPill(candidate) {
  const verified = candidate.verificationStatus === "verified";
  return `<span class="status ${verified ? "verified" : ""}">${verified ? "Verified" : "Community"}</span>`;
}

function mediaImage(candidate) {
  const src = safeLocalImage(candidate?.localImage);
  const width = candidate?.previewWidth || 720;
  const height = candidate?.previewHeight || 405;
  return `<img src="${src}" alt="" width="${escapeHtml(width)}" height="${escapeHtml(height)}" loading="lazy">`;
}

function metricValue(candidate, metric) {
  if (metric === "freshness") return clamp01(candidate?.normalized?.freshness);
  const value = Number(candidate?.metrics?.[metric] ?? 0);
  return Number.isFinite(value) ? Math.max(0, value) : 0;
}

function metricDisplay(candidate, metric) {
  const value = metricValue(candidate, metric);
  if (value === 0) return "—";
  return metric === "freshness"
    ? `${Math.round(value * 100)}%`
    : value.toLocaleString("en-US");
}

function comparisonBar(candidate, metric, max) {
  const value = metricValue(candidate, metric);
  const width = value === 0 ? 0 : Math.round((value / max) * 100);
  return `<span class="comparison-value">
    <span class="signal-bar" aria-hidden="true"><span style="width:${width}%"></span></span>
    <span>${escapeHtml(metricDisplay(candidate, metric))}</span>
  </span>`;
}

function scoreComparison(winner, runnerUp) {
  if (!winner) return "";
  const candidates = [winner, runnerUp].filter(Boolean);
  return `<section class="score-comparison" aria-labelledby="comparison-heading">
    <div class="comparison-heading">
      <div>
        <p class="kicker">Raw evidence</p>
        <h2 id="comparison-heading">Head-to-head</h2>
      </div>
      <p>Bars compare these finalists only. Freshness is the repository's recency score. <a href="/methodology/">How the ranking is calculated</a></p>
    </div>
    <div class="comparison-table">
      <div class="comparison-head" aria-hidden="true">
        <span>Signal</span>
        <span>${escapeHtml(winner.name)}</span>
        ${runnerUp ? `<span>${escapeHtml(runnerUp.name)}</span>` : ""}
      </div>
      ${SIGNAL_METRICS.map((metric) => {
        const values = candidates.map((candidate) => metricValue(candidate, metric));
        const max = Math.max(...values, metric === "freshness" ? 0.01 : 1);
        return `<div class="comparison-row">
          <span class="comparison-metric">${metricLabel(metric)}</span>
          ${comparisonBar(winner, metric, max)}
          ${runnerUp ? comparisonBar(runnerUp, metric, max) : ""}
        </div>`;
      }).join("")}
    </div>
  </section>`;
}

function previewFrame(candidate) {
  return `<div class="preview-frame">${mediaImage(candidate)}</div>`;
}

function candidateCard(candidate, place, type, week, lead = null) {
  if (!candidate) return `<article class="pick-card empty"><p>No eligible plugin this week.</p></article>`;
  const badgePath = `/badges/${encodeURIComponent(week)}/${encodeURIComponent(type.id)}/${encodeURIComponent(candidate.id)}.svg`;
  const rank = place === "winner" ? "01 Champion" : "02 Runner-up";
  const extras = [statusPill(candidate)];
  if (place === "winner" && lead != null) extras.push(`<span class="delta">${lead.toFixed(1)}% ahead</span>`);
  const badgeMarkdown = `[![OmaPicks ${type.name} champion](${ORIGIN}${badgePath})](${ORIGIN}/picks/${type.id}/)`;
  return `<article class="pick-card ${place === "winner" ? "champion" : ""}">
    <div class="card-label"><span>${rank}</span><span class="card-flags">${extras.join("")}</span></div>
    ${previewFrame(candidate)}
    <div class="card-body">
      <h3><a href="${safeUrl(candidate.detailUrl)}">${escapeHtml(candidate.name)}</a></h3>
      <p class="byline">${escapeHtml(candidate.author || "Unknown author")} · ${escapeHtml(candidate.license || "license unknown")} · Score ${candidate.score.toFixed(3)} of 1.00 within ${escapeHtml(type.name)}</p>
      <p>${escapeHtml(candidate.description)}</p>
      <div class="command-row">
        <code>${escapeHtml(candidate.installCommand)}</code>
        <button type="button" data-copy-command data-copy-label="install command">Copy</button>
      </div>
      <div class="card-links">
        <a href="${safeUrl(candidate.detailUrl)}">Original listing</a>
        <a href="${safeUrl(candidate.repository)}">Repository</a>
        ${place === "winner" ? `<a href="#winner-badge">Winner badge</a>` : `<span class="card-link-spacer" aria-hidden="true"></span>`}
      </div>
      ${place === "winner" ? `<div class="badge-embed" id="winner-badge">
        <a href="${badgePath}" aria-label="Open the ${escapeHtml(type.name)} winner badge"><img src="${badgePath}" alt="OmaPicks ${escapeHtml(type.name)} champion: ${escapeHtml(candidate.name)}" loading="lazy"></a>
        <p>Show the win in a README:</p>
        <div class="command-row">
          <code>${escapeHtml(badgeMarkdown)}</code>
          <button type="button" data-copy-command data-copy-label="badge markdown">Copy</button>
        </div>
      </div>` : ""}
    </div>
  </article>`;
}

function showdownEntry(candidate, place, href) {
  if (!candidate) {
    return `<div class="showdown-entry empty"><p class="rank">02 Runner-up</p><p>No runner-up this week.</p></div>`;
  }
  const champion = place === "winner";
  return `<div class="showdown-entry${champion ? " champion" : ""}">
    <p class="rank">${champion ? "01 Champion" : "02 Runner-up"}</p>
    <a class="feature-media" href="${href}" tabindex="-1" aria-hidden="true">${mediaImage(candidate)}</a>
    <h3><a href="${href}">${escapeHtml(candidate.name)}</a></h3>
    <p class="byline">By ${escapeHtml(candidate.author || "Unknown author")}</p>
    <p class="lede">${escapeHtml(candidate.description)}</p>
  </div>`;
}

function showdownSection(type) {
  const href = `/picks/${encodeURIComponent(type.id)}/`;
  const lead = scoreLead(type.winner, type.runnerUp);
  return `<article class="showdown" data-pick-section data-search="${escapeHtml(searchBlob(type))}">
    <header class="showdown-head">
      <p class="kicker">${escapeHtml(type.name)}</p>
      <h2>${escapeHtml(type.winner.name)} wins <a href="${href}">${escapeHtml(type.name)}</a></h2>
    </header>
    <div class="showdown-pair">
      ${showdownEntry(type.winner, "winner", href)}
      ${showdownEntry(type.runnerUp, "runner-up", href)}
    </div>
    <p class="showdown-gap">
      ${lead != null ? `<span class="delta">${lead.toFixed(1)}% ahead</span>` : ""}
      <span>${type.eligibleCount} eligible</span>
      <a class="text-link" href="${href}">Open the shortlist</a>
    </p>
  </article>`;
}

function featureArticle(type) {
  const winner = type.winner;
  const href = `/picks/${encodeURIComponent(type.id)}/`;
  const runner = type.runnerUp?.name
    ? ` · runner-up ${type.runnerUp.name} by ${type.runnerUp.author || "Unknown author"}`
    : "";
  return `<a class="feature support" href="${href}" data-feature data-pick-section data-search="${escapeHtml(searchBlob(type))}">
    <span class="feature-media" aria-hidden="true">${mediaImage(winner)}</span>
    <div class="support-copy">
      <p class="kicker">${escapeHtml(type.name)}</p>
      <h3>${escapeHtml(winner.name)}</h3>
      <p class="support-meta">Champion by ${escapeHtml(winner.author || "Unknown author")}${escapeHtml(runner)}</p>
    </div>
  </a>`;
}

function catalogRow(type) {
  const winner = type.winner
    ? `${type.winner.name} · ${type.winner.author || "Unknown author"}`
    : "No pick yet";
  const runnerUp = type.runnerUp
    ? `${type.runnerUp.name} · ${type.runnerUp.author || "Unknown author"}`
    : "—";
  const aria = `${type.name}: champion ${winner}; runner-up ${runnerUp}; ${type.eligibleCount} eligible`;
  return `<a class="catalog-row" href="/picks/${encodeURIComponent(type.id)}/" aria-label="${escapeHtml(aria)}" data-catalog-row data-pick-section data-search="${escapeHtml(searchBlob(type))}">
    <span class="type">${escapeHtml(type.name)}</span>
    <span class="champ">${escapeHtml(winner)}</span>
    <span class="runner">${escapeHtml(runnerUp)}</span>
    <span class="count">${type.eligibleCount}</span>
  </a>`;
}

function otherCategoryLink(type) {
  return `<a href="/picks/${encodeURIComponent(type.id)}/">
    <span>${escapeHtml(type.name)}</span>
    <strong>${escapeHtml(type.winner?.name ?? "No pick yet")}</strong>
  </a>`;
}

function categoryNavigation(type, rankings) {
  const index = rankings.types.findIndex((candidate) => candidate.id === type.id);
  const previous = index > 0 ? rankings.types[index - 1] : null;
  const next = index >= 0 && index < rankings.types.length - 1 ? rankings.types[index + 1] : null;
  const others = rankings.types.filter((candidate) => candidate.id !== type.id);
  return `<section class="category-directory" aria-labelledby="other-categories-heading">
    <div class="category-directory-head">
      <h2 id="other-categories-heading">Other categories</h2>
      <a href="/">See all picks</a>
    </div>
    <div class="category-grid">${others.map((candidate) => otherCategoryLink(candidate)).join("")}</div>
    <nav class="category-pagination" aria-label="Adjacent categories">
      ${previous ? `<a rel="prev" href="/picks/${encodeURIComponent(previous.id)}/"><span>Previous</span><strong>${escapeHtml(previous.name)}</strong></a>` : "<span></span>"}
      ${next ? `<a rel="next" href="/picks/${encodeURIComponent(next.id)}/"><span>Next</span><strong>${escapeHtml(next.name)}</strong></a>` : "<span></span>"}
    </nav>
  </section>`;
}

function homePage(rankings) {
  const populated = rankings.types.filter((type) => type.winner);
  const eligibleEntries = rankings.types.reduce((sum, type) => sum + Number(type.eligibleCount || 0), 0);
  const featured = featuredTypes(rankings, 5);
  const [lead, ...supporting] = featured;
  const body = `<section class="hero">
    <div class="hero-copy">
      <p class="eyebrow">${weekLabel(rankings.week, rankings.generatedAt)}</p>
      <h1>Weekly picks for Omarchy plugins</h1>
      <p>One champion and one runner-up per category, rescored every Monday from public registry data.</p>
    </div>
    <aside class="hero-aside">
      <p>No votes. No sponsorships. Just a reproducible weekly snapshot of public registry evidence.</p>
      <dl class="hero-meta">
        <div><dt>Categories</dt><dd>${populated.length}</dd></div>
        <div><dt>Eligible entries</dt><dd>${eligibleEntries.toLocaleString("en-US")}</dd></div>
        <div><dt>Snapshot</dt><dd>${escapeHtml(dateLabel(rankings.generatedAt) ?? rankings.week ?? "Pending")}</dd></div>
      </dl>
    </aside>
  </section>
  ${
    lead
      ? `<section class="showcase" aria-label="Featured picks">
    ${showdownSection(lead)}
    <div class="supporting">
      ${supporting.map((type) => featureArticle(type)).join("")}
    </div>
  </section>`
      : ""
  }
  <section class="catalog" aria-labelledby="catalog-heading">
    <div class="catalog-header">
      <h2 id="catalog-heading">All categories</h2>
      <div class="finder">
        <label for="pick-filter">Search</label>
        <input id="pick-filter" type="search" placeholder="Weather, clipboard, Spotify…" autocomplete="off" data-pick-filter>
        <p data-filter-status aria-live="polite"></p>
      </div>
    </div>
    <div class="catalog-table">
      <div class="catalog-head" aria-hidden="true" data-catalog-head><span>Category</span><span>Champion · Author</span><span>Runner-up · Author</span><span>Eligible</span></div>
      ${rankings.types.map((type) => catalogRow(type)).join("")}
    </div>
    <p class="filter-empty" data-filter-empty hidden>No categories match.</p>
  </section>`;
  return shell({
    title: "OmaPicks",
    description: "Independent weekly rankings of Omarchy plugins, one champion and one runner-up per app type.",
    pathname: "/",
    image: { url: "/og/home.jpg", type: "image/jpeg", width: 1200, height: 630, alt: "OmaPicks weekly picks for Omarchy plugins" },
    body,
    structuredData: {
      "@context": "https://schema.org",
      "@type": "WebSite",
      name: "OmaPicks",
      url: ORIGIN,
      description: "Independent weekly rankings of Omarchy plugins, one champion and one runner-up per app type."
    }
  });
}

function typePage(type, rankings) {
  const description = `${type.winner ? type.winner.name : "No champion yet"} leads this week's ${type.name.toLowerCase()} ranking for Omarchy.`;
  const itemList = [type.winner, type.runnerUp].filter(Boolean).map((candidate, index) => ({
    "@type": "ListItem",
    position: index + 1,
    name: candidate.name,
    url: candidate.detailUrl
  }));
  const lead = scoreLead(type.winner, type.runnerUp);
  const body = `<nav class="breadcrumbs" aria-label="Breadcrumb"><a href="/">All picks</a> / ${escapeHtml(type.name)}</nav>
    <section class="type-intro">
      <div>
        <p class="eyebrow">${weekLabel(rankings.week, rankings.generatedAt)}</p>
        <h1>${escapeHtml(type.name)}</h1>
      </div>
      <p>${escapeHtml(type.description)}. ${type.eligibleCount} plugins were eligible. A challenger needs more than a 10% score lead to take the champion slot.</p>
    </section>
    <div class="podium">
      ${candidateCard(type.winner, "winner", type, rankings.week, lead)}
      ${candidateCard(type.runnerUp, "runner-up", type, rankings.week)}
    </div>
    ${scoreComparison(type.winner, type.runnerUp)}
    <aside class="method-note">
      <h2>Why these two</h2>
      <p>The score mixes command copies, hearts, GitHub stars, views, repository freshness, and a small verified-listing bonus. Plugins with little evidence are pulled toward the middle of the pack so a brand-new listing cannot win on three copies. <a href="/methodology/">Full scoring notes</a></p>
    </aside>
    ${categoryNavigation(type, rankings)}`;
  return shell({
    title: `${type.name} plugins for Omarchy`,
    description,
    pathname: `/picks/${type.id}/`,
    image: {
      url: "/og/home.jpg",
      type: "image/jpeg",
      width: 1200,
      height: 630,
      alt: `${type.winner?.name ?? "This week's champion"} leads the ${type.name} ranking on OmaPicks`
    },
    body,
    structuredData: {
      "@context": "https://schema.org",
      "@type": "ItemList",
      name: `${type.name} plugins for Omarchy`,
      numberOfItems: itemList.length,
      itemListElement: itemList
    }
  });
}

function methodologyPage(rankings) {
  const weights = Object.entries(METHODOLOGY.weights)
    .map(
      ([metric, weight]) =>
        `<li><span>${escapeHtml(metricLabel(metric))}</span><span class="weight-track" aria-hidden="true"><span style="width:${Math.round(weight * 100)}%"></span></span><span class="pct">${Math.round(weight * 100)}%</span></li>`
    )
    .join("");
  const body = `<section class="prose">
    <p class="eyebrow">Methodology v${escapeHtml(rankings.methodologyVersion)}</p>
    <h1>How the rankings work</h1>
    <p>OmaPicks refreshes once per ISO week. Your browser never calls the source APIs. Each page is built from a committed snapshot that already passed schema and size checks.</p>
    <p class="pullout">A plugin can win on evidence, not on being first to the registry.</p>
    <h2>Who can compete</h2>
    <p>A plugin needs an install command and an HTTPS repository. Retired and delisted listings are out. A plugin can appear in more than one app type when it genuinely belongs in both.</p>
    <h2>The score</h2>
    <p>Raw counts are logged with <code>log1p</code>. Each signal is 70% a within-type percentile and 30% a scale capped at the 95th percentile. Sparse evidence pulls that result toward 50%.</p>
    <ul class="weight-list">${weights}</ul>
    <p>Repository freshness decays with a 180-day half-life. Missing timestamps receive no freshness points. Verification is a small bonus, not a requirement.</p>
    <h2>Stability</h2>
    <p>An eligible incumbent remains in place until a challenger scores more than 10% higher. If an incumbent becomes unavailable, the highest-scoring eligible plugin takes its place immediately. Ties fall back to copies, hearts, stars, then plugin ID.</p>
    <h2 id="data-sources">Data sources</h2>
    <p>OmaPicks calculates its rankings from two public feeds operated by Omarchy Plugins. The source services do not select, approve, or sponsor OmaPicks winners.</p>
    <ul class="source-list">
      <li><strong><a href="https://plugins.omarchy.org/catalog.json">Plugin catalog</a></strong> — names, descriptions, authors, repositories, licenses, GitHub stars, maintenance dates, verification status, install availability, and preview locations.</li>
      <li><strong><a href="https://api.omarchyplugins.com/v1/stats">Engagement statistics</a></strong> — install-command copies, hearts, and views by plugin ID.</li>
      <li><strong><a href="https://plugins.omarchy.org/?sort=copies">Browsable marketplace</a></strong> — the human-readable original listings behind the catalog data.</li>
    </ul>
    <p>The feeds are fetched once during the weekly refresh; visitors never call them. Source timestamps, response metadata, SHA-256 checksums, metric contributions, and methodology version are included in the published <a href="/rankings.json">ranking snapshot</a>. Preview images remain attributable to their plugin authors and source marketplace. A failed or suspiciously small feed cannot replace the previous week.</p>
  </section>`;
  return shell({
    title: "How the rankings work",
    description: "Eligibility, scoring weights, damping, and the weekly freeze used by OmaPicks.",
    pathname: "/methodology/",
    image: { url: "/og/home.jpg", type: "image/jpeg", width: 1200, height: 630 },
    body
  });
}

function historyChanges(history) {
  return history
    .slice()
    .sort((a, b) => String(b.week).localeCompare(String(a.week)))
    .map((snapshot) => ({
      week: snapshot.week,
      generatedAt: snapshot.generatedAt,
      changes: snapshot.changes ?? []
    }));
}

function changelogPage(history) {
  const weeks = historyChanges(history);
  const changeList = (entry) => {
    if (!entry.changes.length) return "<p>No champion changes.</p>";
    const firsts = entry.changes.filter((change) => change.current && change.kind !== "displaced" && !change.previous);
    const updates = entry.changes.filter((change) => !firsts.includes(change));
    return `${firsts.length ? `<p class="timeline-summary">${firsts.length} categories received their first champion.</p>
      <dl class="first-champions">${firsts.map((change) => `<div>
        <dt>${escapeHtml(change.typeName)}</dt>
        <dd><strong>${escapeHtml(change.current.name)}</strong></dd>
      </div>`).join("")}</dl>` : ""}
      ${updates.length ? `<ul class="change-list">${updates.map((change) => {
        if (change.kind === "displaced") {
          return `<li><strong>${escapeHtml(change.current.name)}</strong> replaced ${escapeHtml(change.previous.name)} in ${escapeHtml(change.typeName)}.</li>`;
        }
        if (change.current) {
          return `<li><strong>${escapeHtml(change.current.name)}</strong> became the ${escapeHtml(change.typeName)} champion.</li>`;
        }
        return `<li>${escapeHtml(change.typeName)} has no champion this week.</li>`;
      }).join("")}</ul>` : ""}`;
  };
  const body = `<section class="prose">
    <p class="eyebrow">Change log</p>
    <h1>What changed</h1>
    <p>When a champion is replaced, the previous week stays on disk. This page is built from those snapshots.</p>
    <div class="timeline">
      ${
        weeks.length
          ? weeks
              .map(
                (entry) => `<section>
                  <h2>${weekLabel(entry.week, entry.generatedAt)}</h2>
                  ${changeList(entry)}
                </section>`
              )
              .join("")
          : "<p>No weekly history has been published yet.</p>"
      }
    </div>
    <aside class="rss-callout">
      <p class="kicker">Follow the ranking</p>
      <h2>Get champion changes in your reader</h2>
      <p>The RSS feed only publishes meaningful changes, so quiet weeks stay quiet.</p>
      <a class="text-link" href="/feed.xml">Subscribe via RSS</a>
    </aside>
  </section>`;
  return shell({
    title: "What changed",
    description: "Champion replacements in the weekly OmaPicks rankings.",
    pathname: "/changelog/",
    image: { url: "/og/home.jpg", type: "image/jpeg", width: 1200, height: 630 },
    body
  });
}

function badgeSvg(type, candidate, week) {
  const label = `${type.name} · ${week}`;
  const width = Math.max(360, Math.min(720, 210 + (label.length + candidate.name.length) * 7));
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="64" role="img" aria-label="${escapeHtml(label)}: ${escapeHtml(candidate.name)}">
  <title>${escapeHtml(label)}: ${escapeHtml(candidate.name)}</title>
  <rect width="100%" height="100%" fill="${PALETTE.bg}"/>
  <rect x="0" y="0" width="8" height="64" fill="${PALETTE.accent}"/>
  <text x="24" y="25" fill="${PALETTE.accent}" font-family="ui-sans-serif,system-ui,sans-serif" font-size="13">${escapeHtml(label)}</text>
  <text x="24" y="47" fill="${PALETTE.ink}" font-family="Liberation Serif,Georgia,serif" font-size="16" font-weight="700">${escapeHtml(candidate.name)}</text>
</svg>
`;
}

async function write(relative, content) {
  const destination = path.join(DIST, relative);
  await mkdir(path.dirname(destination), { recursive: true });
  await writeFile(destination, content);
}

async function readHistory() {
  const directory = path.join(ROOT, "data", "history");
  try {
    const files = (await readdir(directory)).filter((file) => /^\d{4}-W\d{2}\.json$/.test(file)).sort();
    return Promise.all(files.map(async (file) => JSON.parse(await readFile(path.join(directory, file), "utf8"))));
  } catch (error) {
    if (error.code === "ENOENT") return [];
    throw error;
  }
}

function rss(history) {
  const entries = historyChanges(history)
    .flatMap((snapshot) =>
      snapshot.changes.map((change) => ({
        ...change,
        week: snapshot.week,
        generatedAt: snapshot.generatedAt
      }))
    )
    .slice(0, 50);
  return `<?xml version="1.0" encoding="UTF-8"?>
<?xml-stylesheet type="text/xsl" href="/feed.xsl"?>
<rss version="2.0"><channel>
  <title>OmaPicks weekly changes</title>
  <link>${ORIGIN}/changelog/</link>
  <description>Champion changes in the weekly OmaPicks rankings.</description>
  <language>en</language>
  ${entries
    .map((entry) => {
      const title = entry.current
        ? `${entry.current.name} is the ${entry.typeName} champion`
        : `${entry.typeName} champion spot is vacant`;
      const description = entry.previous
        ? `${entry.current?.name ?? "No plugin"} replaced ${entry.previous.name}.`
        : `${entry.current?.name ?? "No plugin"} became the first champion.`;
      const guid = `${entry.week}:${entry.typeId}:${entry.current?.id ?? "vacant"}`;
      return `<item><title>${xml(title)}</title><link>${ORIGIN}/picks/${encodeURIComponent(entry.typeId)}/</link><guid isPermaLink="false">${xml(guid)}</guid><pubDate>${new Date(entry.generatedAt).toUTCString()}</pubDate><description>${xml(description)}</description></item>`;
    })
    .join("")}
</channel></rss>
`;
}

async function copyOptionalDirectory(source, destination) {
  try {
    await cp(source, destination, { recursive: true });
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
}

export async function render({ root = ROOT } = {}) {
  if (root !== ROOT) throw new Error("Custom render roots are not supported; pass fixture data to exported helpers instead");
  const rankings = JSON.parse(await readFile(path.join(ROOT, "data", "rankings.json"), "utf8"));
  if (!Array.isArray(rankings.types)) throw new Error("data/rankings.json has no types array");
  if (rankings.week !== null && !/^\d{4}-W\d{2}$/.test(rankings.week)) throw new Error(`Unsafe week: ${rankings.week}`);
  for (const type of rankings.types) {
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(type.id)) throw new Error(`Unsafe app type id: ${type.id}`);
    for (const candidate of [type.winner, type.runnerUp]) {
      if (candidate && !/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(candidate.id)) {
        throw new Error(`Unsafe plugin id: ${candidate.id}`);
      }
    }
  }
  const history = await readHistory();
  await rm(DIST, { recursive: true, force: true });
  await mkdir(path.join(DIST, "assets"), { recursive: true });
  await mkdir(path.join(DIST, "og"), { recursive: true });
  await cp(path.join(ROOT, "site", "styles.css"), path.join(DIST, "assets", "styles.css"));
  await cp(path.join(ROOT, "site", "app.js"), path.join(DIST, "assets", "app.js"));
  await cp(path.join(ROOT, "site", "icon.svg"), path.join(DIST, "assets", "icon.svg"));
  await cp(path.join(ROOT, "site", "placeholder.svg"), path.join(DIST, "assets", "placeholder.svg"));
  await cp(path.join(ROOT, "site", "og-home.jpg"), path.join(DIST, "og", "home.jpg"));
  await cp(path.join(ROOT, "site", "feed.xsl"), path.join(DIST, "feed.xsl"));
  await copyOptionalDirectory(path.join(ROOT, "data", "assets", "plugins"), path.join(DIST, "assets", "plugins"));

  await write("index.html", homePage(rankings));
  await write("methodology/index.html", methodologyPage(rankings));
  await write("changelog/index.html", changelogPage(history));
  for (const type of rankings.types) {
    await write(`picks/${encodeURIComponent(type.id)}/index.html`, typePage(type, rankings));
  }
  for (const snapshot of history) {
    for (const type of snapshot.types ?? []) {
      if (!type.winner) continue;
      await write(
        `badges/${encodeURIComponent(snapshot.week)}/${encodeURIComponent(type.id)}/${encodeURIComponent(type.winner.id)}.svg`,
        badgeSvg(type, type.winner, snapshot.week)
      );
    }
  }
  if (rankings.week && !history.some((snapshot) => snapshot.week === rankings.week)) {
    for (const type of rankings.types) {
      if (type.winner) {
        await write(
          `badges/${encodeURIComponent(rankings.week)}/${encodeURIComponent(type.id)}/${encodeURIComponent(type.winner.id)}.svg`,
          badgeSvg(type, type.winner, rankings.week)
        );
      }
    }
  }

  const urls = ["/", "/methodology/", "/changelog/", ...rankings.types.map((type) => `/picks/${type.id}/`)];
  await write(
    "sitemap.xml",
    `<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${urls
      .map((url) => `<url><loc>${ORIGIN}${xml(url)}</loc></url>`)
      .join("")}</urlset>\n`
  );
  await write("robots.txt", `User-agent: *\nAllow: /\nSitemap: ${ORIGIN}/sitemap.xml\n`);
  await write("feed.xml", rss(history));
  await write("rankings.json", `${JSON.stringify(rankings, null, 2)}\n`);
  await write(
    "site.webmanifest",
    `${JSON.stringify({ name: "OmaPicks", short_name: "OmaPicks", start_url: "/", display: "standalone", background_color: PALETTE.bg, theme_color: PALETTE.bg }, null, 2)}\n`
  );
  await write(
    "_headers",
    `/assets/*\n  Cache-Control: public, max-age=604800\n/og/*\n  Cache-Control: public, max-age=86400\n/badges/*\n  Cache-Control: public, max-age=31536000, immutable\n/feed.xsl\n  Content-Type: text/xsl; charset=utf-8\n  Cache-Control: public, max-age=604800\n/*.xml\n  Content-Type: application/xml; charset=utf-8\n`
  );
  await write(
    "404.html",
    shell({
      title: "Not found",
      description: "This OmaPicks page does not exist.",
      pathname: "/404.html",
      image: { url: "/og/home.jpg", type: "image/jpeg", width: 1200, height: 630 },
      body: `<section class="prose"><p class="eyebrow">404</p><h1>This page isn't here</h1><p><a href="/">Back to this week's picks</a></p></section>`
    })
  );
  return { typeCount: rankings.types.length, historyCount: history.length, output: DIST };
}

export function renderFixtureHome(rankings) {
  return homePage(rankings);
}

export function renderFixtureType(type, rankings) {
  return typePage(type, rankings);
}

export function deriveChanges(previous, current) {
  return changesBetween(previous, current);
}
