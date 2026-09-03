import { cp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { METHODOLOGY, changesBetween } from "./rank.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DIST = path.join(ROOT, "dist");
const ORIGIN = "https://omapicks.com";
const SIGNAL_METRICS = ["copies", "hearts", "stars", "views", "freshness"];
const FUNCTION_ROUTES = {
  version: 1,
  include: ["/*"],
  exclude: [
    "/assets/*",
    "/og/*",
    "/badges/*",
    "/feed.xml",
    "/feed.xsl",
    "/sitemap.xml",
    "/rankings.json",
    "/robots.txt",
    "/site.webmanifest",
    "/favicon.ico",
    "/apple-touch-icon.png"
  ]
};
const PALETTE = Object.freeze({
  bg: "#1a1b26",
  lightBg: "#e9e9ec",
  ink: "#c0caf5",
  muted: "#7f849c",
  accent: "#8bd5ca"
});
const SOCIAL_IMAGE = Object.freeze({
  url: "/og/terminal.jpg",
  type: "image/jpeg",
  width: 1200,
  height: 630
});
const MANIFEST_ICONS = Object.freeze([
  { src: "/assets/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
  { src: "/assets/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
  { src: "/assets/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" }
]);

function iconLinks() {
  return `<link rel="icon" href="/assets/icon.svg" type="image/svg+xml" sizes="any">
  <link rel="icon" href="/assets/icon-192.png" type="image/png" sizes="192x192">
  <link rel="icon" href="/favicon.ico" sizes="48x48">
  <link rel="apple-touch-icon" href="/apple-touch-icon.png" sizes="180x180">`;
}

function socialImage(alt) {
  return alt ? { ...SOCIAL_IMAGE, alt } : { ...SOCIAL_IMAGE };
}

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

function outboundLink(href, label, className) {
  const url = safeUrl(href);
  const extra = url === "#" ? "" : ` target="_blank" rel="noopener noreferrer"`;
  const cls = className ? ` class="${className}"` : "";
  return `<a href="${url}"${cls}${extra}>${label}</a>`;
}

function xShareLink(text, url, label) {
  return outboundLink(`https://x.com/intent/post?${new URLSearchParams({ text: `${text} ${url}` })}`, label, "text-link");
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

const WINNING_SIGNALS = Object.freeze({
  copies: "more people copied the install command",
  hearts: "it received more marketplace hearts",
  stars: "it had more GitHub stars",
  freshness: "its repository was updated more recently"
});

function signalDelta(winner, runnerUp, metric) {
  if (winner?.contributions && runnerUp?.contributions) {
    return Number(winner.contributions[metric] ?? 0) - Number(runnerUp.contributions[metric] ?? 0);
  }
  if (metric === "verified") {
    const flag = (candidate) => (candidate?.verificationStatus === "verified" ? 1 : 0);
    return flag(winner) - flag(runnerUp);
  }
  if (metric === "freshness") {
    return Number(winner?.normalized?.freshness ?? 0) - Number(runnerUp?.normalized?.freshness ?? 0);
  }
  return Number(winner?.metrics?.[metric] ?? 0) - Number(runnerUp?.metrics?.[metric] ?? 0);
}

function meaningfulLead(delta, metric, usedContributions) {
  if (usedContributions) return delta > 0.003;
  if (metric === "verified") return delta > 0;
  if (metric === "freshness") return delta > 0.05;
  return delta >= 1;
}

export function winningReason(winner, runnerUp) {
  if (!winner) return "No champion this week.";
  if (!runnerUp) return "It was the only eligible plugin in this category this week.";
  const usedContributions = Boolean(winner.contributions && runnerUp.contributions);
  const leads = Object.keys(WINNING_SIGNALS)
    .map((metric) => ({ metric, delta: signalDelta(winner, runnerUp, metric) }))
    .filter((entry) => meaningfulLead(entry.delta, entry.metric, usedContributions))
    .sort((a, b) => b.delta - a.delta);
  const verifiedLead = meaningfulLead(signalDelta(winner, runnerUp, "verified"), "verified", usedContributions);
  if (!leads.length) {
    return verifiedLead
      ? "The two were close on public activity; a verified listing tipped this week's score."
      : "It led this week's combined public-registry score in a close race.";
  }
  const copiesLead = leads.find((entry) => entry.metric === "copies");
  const primary = copiesLead ?? leads[0];
  const secondary = leads.find((entry) => entry.metric !== primary.metric);
  if (!secondary) {
    return verifiedLead
      ? `It won mainly because ${WINNING_SIGNALS[primary.metric]}, plus a small verified-listing bonus.`
      : `It won mainly because ${WINNING_SIGNALS[primary.metric]}.`;
  }
  return `It won mainly because ${WINNING_SIGNALS[primary.metric]}, and ${WINNING_SIGNALS[secondary.metric]}.`;
}

function competedLabel(count) {
  return `${count} ${Number(count) === 1 ? "plugin" : "plugins"} competed`;
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

function byCategoryName(a, b) {
  return String(a.name).localeCompare(String(b.name), "en");
}

function categoryNoun(count) {
  return Number(count) === 1 ? "category" : "categories";
}

function browseLabel(count, { all = false } = {}) {
  return `${all ? "Browse all" : "Browse"} ${count} ${categoryNoun(count)}`;
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

export function featuredDayIndex(count, date = new Date()) {
  if (!count) return 0;
  const utcDay = Math.floor(Date.UTC(
    date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()
  ) / 86400000);
  return ((utcDay % count) + count) % count;
}

function featuredBoot(count) {
  return `<script>
(() => {
  const count = ${Number(count)};
  if (!count) return;
  const now = new Date();
  const utcDay = Math.floor(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()) / 86400000);
  document.documentElement.dataset.featuredIndex = String(((utcDay % count) + count) % count);
})();
</script>`;
}

function featuredSlotStyle(count) {
  if (count < 2) return "";
  const rules = [];
  for (let slot = 0; slot < count; slot += 1) {
    rules.push(`html[data-featured-index="${slot}"] .showdown[data-slot]:not([data-slot="${slot}"]){display:none}`);
    rules.push(`html[data-featured-index="${slot}"] .showdown[data-slot="${slot}"]{display:block}`);
    rules.push(`html[data-featured-index="${slot}"] .support[data-slot="${slot}"]{display:none}`);
    rules.push(`html[data-featured-index="${slot}"] .support[data-slot]:not([data-slot="${slot}"]){display:block}`);
  }
  return `<style>${rules.join("")}</style>`;
}

function themeBoot() {
  return `<script>
(() => {
  try {
    const stored = localStorage.getItem("omapicks-theme");
    const theme = stored === "light" || stored === "dark"
      ? stored
      : (matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark");
    document.documentElement.dataset.theme = theme;
  } catch {
    document.documentElement.dataset.theme = "dark";
  }
})();
</script>`;
}

function navLink(href, label, pathname) {
  const current = pathname === href ? ` aria-current="page"` : "";
  return `<a href="${href}"${current}>${label}</a>`;
}

function nav(pathname = "/") {
  return `<header class="site-header">
    <a class="brand" href="/" aria-label="OmaPicks home">OmaPicks</a>
    <nav aria-label="Primary navigation">
      ${navLink("/methodology/", "Method", pathname)}
      ${navLink("/changelog/", "Changes", pathname)}
      ${navLink("/feed.xml", "RSS", pathname)}
      <button class="theme-toggle" type="button" data-theme-toggle aria-label="Switch to light theme" aria-pressed="true">
        <span class="theme-label-dark" aria-hidden="true">Dark</span>
        <span class="theme-label-light" aria-hidden="true">Light</span>
      </button>
    </nav>
  </header>`;
}

function shell({ title, description, pathname, image, body, structuredData = null, headExtra = "" }) {
  const canonical = `${ORIGIN}${pathname}`;
  const fullTitle = title === "OmaPicks" ? "OmaPicks — weekly Omarchy plugin rankings" : `${title} · OmaPicks`;
  const ogImage = `${ORIGIN}${image.url}`;
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  ${themeBoot()}${headExtra ? `\n  ${headExtra}` : ""}
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(fullTitle)}</title>
  <meta name="description" content="${escapeHtml(description)}">
  <meta name="color-scheme" content="light dark">
  <meta name="theme-color" content="${PALETTE.bg}" media="(prefers-color-scheme: dark)">
  <meta name="theme-color" content="${PALETTE.lightBg}" media="(prefers-color-scheme: light)">
  <link rel="canonical" href="${canonical}">
  ${iconLinks()}
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
    ${nav(pathname)}
    <main id="main">${body}</main>
    <footer>
      <p>Plugin metadata, engagement signals, and previews come from <a href="https://plugins.omarchy.org/?sort=copies">Omarchy Plugins</a>. OmaPicks calculates the rankings independently and is not affiliated with Omarchy, 37signals, or omarchyplugins.com.</p>
      <p><a href="/methodology/#data-sources">Data and methodology</a> · <a href="/privacy/">Privacy</a> · ${outboundLink("https://github.com/BVisagie/omapicks", "Open-source code")}</p>
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

function mediaImage(candidate, { decorative = false } = {}) {
  const src = safeLocalImage(candidate?.localImage);
  const width = candidate?.previewWidth || 720;
  const height = candidate?.previewHeight || 405;
  const alt = decorative || !candidate?.name ? "" : `${candidate.name} preview`;
  return `<img src="${src}" alt="${escapeHtml(alt)}" width="${escapeHtml(width)}" height="${escapeHtml(height)}" loading="lazy">`;
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
  const lead = scoreLead(winner, runnerUp);
  const scores = runnerUp
    ? `Combined scores in this category: ${escapeHtml(winner.name)} ${winner.score.toFixed(3)}, ${escapeHtml(runnerUp.name)} ${runnerUp.score.toFixed(3)}${lead != null ? ` (${lead.toFixed(1)}% apart)` : ""}.`
    : `Combined score in this category: ${winner.score.toFixed(3)} of 1.00.`;
  return `<section class="score-comparison" aria-labelledby="comparison-heading">
    <div class="comparison-heading">
      <div>
        <p class="kicker">Marketplace counts</p>
        <h2 id="comparison-heading">How they compare</h2>
      </div>
      <p>These bars are raw public counts for these two plugins, not the ranking itself. Install-command copies count most. Freshness is how recently the repository was updated. ${scores} <a href="/methodology/">How the ranking is calculated</a></p>
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

function candidateCard(candidate, place, type, week, { runnerUp = null } = {}) {
  if (!candidate) return `<article class="pick-card empty"><p>No eligible plugin this week.</p></article>`;
  const badgePath = `/badges/${encodeURIComponent(week)}/${encodeURIComponent(type.id)}/${encodeURIComponent(candidate.id)}.svg`;
  const rank = place === "winner" ? "01 Champion" : "02 Runner-up";
  const extras = [statusPill(candidate)];
  const badgeMarkdown = `[![OmaPicks ${type.name} champion](${ORIGIN}${badgePath})](${ORIGIN}/picks/${type.id}/)`;
  const reason = place === "winner" ? winningReason(candidate, runnerUp) : "";
  return `<article class="pick-card ${place === "winner" ? "champion" : ""}">
    <div class="card-label"><span>${rank}</span><span class="card-flags">${extras.join("")}</span></div>
    ${previewFrame(candidate)}
    <div class="card-body">
      <h3>${outboundLink(candidate.detailUrl, escapeHtml(candidate.name))}</h3>
      <p class="byline">${escapeHtml(candidate.author || "Unknown author")} · ${escapeHtml(candidate.license || "license unknown")}</p>
      ${reason ? `<p class="why-won">${escapeHtml(reason)}</p>` : ""}
      <p>${escapeHtml(candidate.description)}</p>
      <div class="command-row">
        <code>${escapeHtml(candidate.installCommand)}</code>
        <button type="button" data-copy-command data-copy-label="install command">Copy</button>
      </div>
      <div class="card-links">
        ${outboundLink(candidate.detailUrl, "Original listing")}
        ${outboundLink(candidate.repository, "Repository")}
      </div>
      <p class="install-disclaimer">A ranking is not an endorsement or a safety review. Inspect the plugin yourself and install it at your own risk. <a href="/methodology/#safety">Read the full note</a></p>
      ${place === "winner" ? `<div class="badge-embed">
        <p class="kicker">For plugin authors</p>
        <p>Copy this markdown into your README to show that you won this category this week.</p>
        <div class="badge-preview">
          <img src="${badgePath}" alt="OmaPicks ${escapeHtml(type.name)} champion: ${escapeHtml(candidate.name)}" loading="lazy">
        </div>
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
    <p class="rank">${champion ? "01 Champion" : "02 Runner-up"} ${statusPill(candidate)}</p>
    <a class="feature-media" href="${href}" tabindex="-1">${mediaImage(candidate)}</a>
    <h3><a href="${href}">${escapeHtml(candidate.name)}</a></h3>
    <p class="byline">By ${escapeHtml(candidate.author || "Unknown author")}</p>
    <p class="lede">${escapeHtml(candidate.description)}</p>
  </div>`;
}

function showdownSection(type, slot = 0) {
  const href = `/picks/${encodeURIComponent(type.id)}/`;
  const lead = scoreLead(type.winner, type.runnerUp);
  return `<article class="showdown" data-slot="${slot}">
    <header class="showdown-head">
      <p class="kicker">Featured today</p>
      <p class="showdown-note">A different category each day. Rankings refresh Monday.</p>
      <h2>Best <a href="${href}">${escapeHtml(type.name)}</a> plugin this week</h2>
    </header>
    <div class="showdown-pair">
      ${showdownEntry(type.winner, "winner", href)}
      ${showdownEntry(type.runnerUp, "runner-up", href)}
    </div>
    <p class="showdown-gap">
      ${lead != null ? `<span class="delta">${lead.toFixed(1)}% ahead on score</span>` : ""}
      <span>${competedLabel(type.eligibleCount)}</span>
      <a class="text-link" href="${href}">Compare champion and runner-up</a>
    </p>
  </article>`;
}

function featureArticle(type, slot = 0) {
  const winner = type.winner;
  const href = `/picks/${encodeURIComponent(type.id)}/`;
  const runner = type.runnerUp?.name
    ? ` · runner-up ${type.runnerUp.name} by ${type.runnerUp.author || "Unknown author"}`
    : "";
  return `<a class="feature support" href="${href}" data-feature data-slot="${slot}">
    <span class="feature-media" aria-hidden="true">${mediaImage(winner, { decorative: true })}</span>
    <div class="support-copy">
      <p class="kicker">${escapeHtml(type.name)}</p>
      <h3>${escapeHtml(winner.name)}</h3>
      <p class="support-meta">Champion by ${escapeHtml(winner.author || "Unknown author")}${escapeHtml(runner)}</p>
      <p class="feature-action">Compare champion and runner-up</p>
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
  const aria = `${type.name}: champion ${winner}; runner-up ${runnerUp}; ${competedLabel(type.eligibleCount)}`;
  return `<a class="catalog-row" href="/picks/${encodeURIComponent(type.id)}/" aria-label="${escapeHtml(aria)}" data-catalog-row data-search="${escapeHtml(searchBlob(type))}">
    <span class="type">${escapeHtml(type.name)}</span>
    <span class="champ"><span class="field-label">Champion</span> ${escapeHtml(winner)}</span>
    <span class="runner"><span class="field-label">Runner-up</span> ${escapeHtml(runnerUp)}</span>
    <span class="count">${type.eligibleCount}</span>
  </a>`;
}

function finderItem(type, suggested) {
  const champion = type.winner?.name ?? "No pick yet";
  const suggestedAttr = suggested ? " data-suggested" : "";
  const hiddenAttr = suggested ? "" : " hidden";
  return `<li data-finder-item data-search="${escapeHtml(searchBlob(type))}"${suggestedAttr}${hiddenAttr}>
    <a href="/picks/${encodeURIComponent(type.id)}/">
      <span>${escapeHtml(type.name)}</span>
      <strong>${escapeHtml(champion)}</strong>
    </a>
  </li>`;
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
  const types = rankings.types ?? [];
  const categoryCount = types.length;
  const eligibleEntries = types.reduce((sum, type) => sum + Number(type.eligibleCount || 0), 0);
  const featured = featuredTypes(rankings, 5);
  const suggestedIds = new Set(featured.map((type) => type.id));
  const catalogTypes = types.slice().sort(byCategoryName);
  const body = `<section class="hero">
    <div class="hero-copy">
      <p class="eyebrow command-prompt">
        <span aria-hidden="true"><span class="prompt-mark">$</span> omapicks rank --week ${escapeHtml(rankings.week ?? "pending")}<span class="terminal-cursor"></span></span>
        <span class="visually-hidden">${weekLabel(rankings.week, rankings.generatedAt)}</span>
      </p>
      <h1>Find the best Omarchy plugin for the job.</h1>
      <p class="hero-lede">A champion and a runner-up in each category, rescored every Monday from Omarchy Plugins.</p>
      <p class="hero-trust"># no votes. no sponsorships. just a reproducible weekly snapshot from omarchy plugins.</p>
      <p class="hero-actions">
        <a class="button" href="#catalog">${escapeHtml(browseLabel(categoryCount))}</a>
        <a class="text-link" href="/methodology/">How rankings work</a>
        ${xShareLink(
          "This week's Omarchy plugin rankings, independently scored from Omarchy Plugins.",
          `${ORIGIN}/`,
          "Share this week on X"
        )}
      </p>
    </div>
    <aside class="hero-aside">
      <div class="hero-finder" role="search">
        <label id="finder-label" for="pick-filter">Find a category</label>
        <div class="finder-command">
          <span class="finder-prompt" aria-hidden="true">&gt;</span>
          <input id="pick-filter" type="search" placeholder="weather, clipboard, spotify…" autocomplete="off" spellcheck="false" aria-describedby="filter-status" aria-controls="finder-results" data-pick-filter>
          <span id="filter-status" data-filter-status data-total="${categoryCount}" aria-live="polite"></span>
        </div>
        <ul class="finder-results" id="finder-results" data-finder-results aria-label="Suggested categories">
          ${catalogTypes.map((type) => finderItem(type, suggestedIds.has(type.id))).join("")}
        </ul>
        <p class="filter-empty" data-finder-empty hidden>No categories match.</p>
      </div>
      <dl class="hero-meta">
        <div><dt>categories</dt><dd>${categoryCount}</dd></div>
        <div><dt>eligible_entries</dt><dd>${eligibleEntries.toLocaleString("en-US")}</dd></div>
        <div><dt>snapshot</dt><dd>${escapeHtml(dateLabel(rankings.generatedAt) ?? rankings.week ?? "pending")}</dd></div>
      </dl>
    </aside>
  </section>
  ${
    featured.length
      ? `<section class="showcase" aria-label="Featured picks">
    ${featured.map((type, slot) => showdownSection(type, slot)).join("")}
    ${
      featured.length > 1
        ? `<div class="supporting">
      ${featured.map((type, slot) => featureArticle(type, slot)).join("")}
    </div>`
        : ""
    }
  </section>`
      : ""
  }
  <section class="catalog" id="catalog" aria-labelledby="catalog-heading">
    <div class="catalog-header">
      <h2 id="catalog-heading">${escapeHtml(browseLabel(categoryCount, { all: true }))}</h2>
    </div>
    <div class="catalog-table">
      <div class="catalog-head" aria-hidden="true" data-catalog-head><span>Category</span><span>Champion · Author</span><span>Runner-up · Author</span><span>Competed</span></div>
      ${catalogTypes.map((type) => catalogRow(type)).join("")}
    </div>
    <p class="filter-empty" data-filter-empty hidden>No categories match.</p>
  </section>`;
  return shell({
    title: "OmaPicks",
    description: "Independent weekly rankings of Omarchy plugins, one champion and one runner-up per app type.",
    pathname: "/",
    image: socialImage("OmaPicks weekly picks for Omarchy plugins"),
    body,
    headExtra: featured.length > 1 ? `${featuredBoot(featured.length)}\n  ${featuredSlotStyle(featured.length)}` : "",
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
  const body = `<nav class="breadcrumbs" aria-label="Breadcrumb"><a href="/">All picks</a> / ${escapeHtml(type.name)}</nav>
    <section class="type-intro">
      <div>
        <p class="eyebrow">${weekLabel(rankings.week, rankings.generatedAt)}</p>
        <h1>${escapeHtml(type.name)}</h1>
      </div>
      <div class="type-intro-copy">
        <p>${escapeHtml(type.description)}. ${competedLabel(type.eligibleCount)} this week. This page shows the champion and runner-up.</p>
        ${
          type.winner
            ? xShareLink(
                `${type.winner.name} is this week's ${type.name} champion on OmaPicks.`,
                `${ORIGIN}/picks/${encodeURIComponent(type.id)}/`,
                "Share this ranking on X"
              )
            : ""
        }
      </div>
    </section>
    <div class="podium">
      ${candidateCard(type.winner, "winner", type, rankings.week, { runnerUp: type.runnerUp })}
      ${candidateCard(type.runnerUp, "runner-up", type, rankings.week)}
    </div>
    ${scoreComparison(type.winner, type.runnerUp)}
    <aside class="method-note">
      <h2>How we pick</h2>
      <p>This is not a vote. Install-command copies count most, then hearts and GitHub stars. Listing views barely count. Recently updated repositories rank higher than abandoned ones, and a verified listing is only a small bonus. Plugins with little public evidence are pulled toward the middle, so a brand-new listing cannot win on three copies. A champion stays until a challenger is more than 10% ahead on the combined score. <a href="/methodology/">Full scoring notes</a></p>
    </aside>
    ${categoryNavigation(type, rankings)}`;
  return shell({
    title: `${type.name} plugins for Omarchy`,
    description,
    pathname: `/picks/${type.id}/`,
    image: socialImage(`${type.winner?.name ?? "This week's champion"} leads the ${type.name} ranking on OmaPicks`),
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
  const body = `<section class="page-section prose">
    <p class="eyebrow">Methodology v${escapeHtml(rankings.methodologyVersion)}</p>
    <h1>How the rankings work</h1>
    <p class="page-lede">In plain terms: we rank plugins by public evidence of use and upkeep, not votes. Copying the install command counts most, then hearts and GitHub stars. Listing views barely count. Abandoned repositories sink. A verified listing is a small bonus, not a win condition. A champion keeps the title until someone beats their score by more than 10%.</p>
    <p>OmaPicks refreshes once per ISO week. Your browser never calls the source APIs. Each page is built from that week's published snapshot.</p>
    <p class="pullout">A plugin can win on evidence, not on being first to the registry.</p>
    <h2>Who can compete</h2>
    <p>A plugin needs an install command and an HTTPS repository. Retired and delisted listings are out. Only plugins matching at least one focused app type compete; unmatched listings remain unranked instead of being forced into a catch-all category. A plugin can appear in more than one app type when it genuinely belongs in both.</p>
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
    <h2 id="safety">Safety and responsibility</h2>
    <p>OmaPicks ranks public evidence of use and upkeep. It does not audit plugin source code, maintainers, or install behavior, and it does not certify that a plugin is safe, high quality, compatible, licensed for your use, or still maintained.</p>
    <p>A champion or runner-up listing is not an endorsement, recommendation, or warranty. Before you install anything, inspect the repository, permissions, and marketplace listing yourself. You are responsible for what you run on your machine.</p>
  </section>`;
  return shell({
    title: "How the rankings work",
    description: "Eligibility, scoring weights, and weekly cadence used by OmaPicks.",
    pathname: "/methodology/",
    image: socialImage(),
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

function privacyPage() {
  const body = `<section class="page-section prose">
    <p class="eyebrow">Privacy</p>
    <h1>How OmaPicks treats visitors</h1>
    <p class="page-lede">OmaPicks has no accounts, comments, advertising, or marketing trackers. The published pages are static files. Your browser does not receive an analytics script, analytics cookie, or analytics storage from this site.</p>
    <p>Optional share links open X in a new tab after you leave OmaPicks; this site does not load an X script.</p>
    <h2>Theme preference</h2>
    <p>If you use the theme toggle, OmaPicks stores <code>light</code> or <code>dark</code> in your browser's <code>localStorage</code> so the choice can persist. That value is not sent to the server and is not used to measure traffic.</p>
    <h2>Traffic measurement</h2>
    <p>To understand how many people use the site and which category pages are popular, Cloudflare's edge records a small server-side event for successful HTML page views. The browser is not asked to run extra code for this.</p>
    <p>Each event keeps only the UTC date, the page path such as <code>/picks/network/</code>, and a one-way identifier that is salted for that day. Raw IP addresses, user-agent strings, query strings, referrers, and device fingerprints are not stored. The daily identifier cannot follow a visitor across days or websites, so weekly or monthly visitor totals are estimates, not an exact headcount.</p>
    <p>Measurement is skipped when a request sends Global Privacy Control or Do Not Track, looks like an automated crawler, or is not a successful HTML page. Events are processed by Cloudflare and retained for three months.</p>
    <h2>Contact</h2>
    <p>Questions about this page can go to the ${outboundLink("https://github.com/BVisagie/omapicks/issues/new", "OmaPicks GitHub repository")}. Do not post sensitive personal information in a public issue.</p>
  </section>`;
  return shell({
    title: "Privacy",
    description: "How OmaPicks measures traffic without analytics cookies or a browser tracker.",
    pathname: "/privacy/",
    image: socialImage(),
    body
  });
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
  const body = `<section class="page-section">
    <p class="eyebrow">Change log</p>
    <h1>What changed</h1>
    <p class="page-lede">When a champion is replaced, the previous week stays on disk. This page is built from those snapshots.</p>
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
    image: socialImage(),
    body
  });
}

function badgeSvg(type, candidate, week) {
  const left = "OmaPicks";
  const right = `${candidate.name} · ${type.name} · ${week}`;
  const leftWidth = 78;
  const rightWidth = Math.max(140, Math.min(520, Math.round(20 + right.length * 6.6)));
  const width = leftWidth + rightWidth;
  const label = `${left} ${type.name} champion: ${candidate.name}`;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="20" role="img" aria-label="${escapeHtml(label)}">
  <title>${escapeHtml(label)}</title>
  <defs>
    <clipPath id="badge">
      <rect width="${width}" height="20" rx="3"/>
    </clipPath>
  </defs>
  <g clip-path="url(#badge)">
    <rect width="${leftWidth}" height="20" fill="${PALETTE.ink}"/>
    <rect x="${leftWidth}" width="${rightWidth}" height="20" fill="${PALETTE.accent}"/>
  </g>
  <text x="10" y="14.5" fill="${PALETTE.bg}" font-family="'Cascadia Mono',ui-monospace,monospace" font-size="11" font-weight="700">${escapeHtml(left)}</text>
  <text x="${leftWidth + 8}" y="14.5" fill="${PALETTE.bg}" font-family="'Cascadia Mono',ui-monospace,monospace" font-size="11">${escapeHtml(right)}</text>
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
  await cp(path.join(ROOT, "site", "icon-192.png"), path.join(DIST, "assets", "icon-192.png"));
  await cp(path.join(ROOT, "site", "icon-512.png"), path.join(DIST, "assets", "icon-512.png"));
  await cp(path.join(ROOT, "site", "icon-maskable-512.png"), path.join(DIST, "assets", "icon-maskable-512.png"));
  await cp(path.join(ROOT, "site", "favicon.ico"), path.join(DIST, "favicon.ico"));
  await cp(path.join(ROOT, "site", "apple-touch-icon.png"), path.join(DIST, "apple-touch-icon.png"));
  await cp(path.join(ROOT, "site", "placeholder.svg"), path.join(DIST, "assets", "placeholder.svg"));
  await cp(path.join(ROOT, "site", "og-home.jpg"), path.join(DIST, "og", "home.jpg"));
  await cp(path.join(ROOT, "site", "og-home.jpg"), path.join(DIST, "og", "terminal.jpg"));
  await cp(path.join(ROOT, "site", "feed.xsl"), path.join(DIST, "feed.xsl"));
  await copyOptionalDirectory(path.join(ROOT, "data", "assets", "plugins"), path.join(DIST, "assets", "plugins"));

  await write("index.html", homePage(rankings));
  await write("methodology/index.html", methodologyPage(rankings));
  await write("privacy/index.html", privacyPage());
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

  const urls = ["/", "/methodology/", "/privacy/", "/changelog/", ...rankings.types.map((type) => `/picks/${type.id}/`)];
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
    `${JSON.stringify(
      {
        name: "OmaPicks",
        short_name: "OmaPicks",
        start_url: "/",
        display: "standalone",
        background_color: PALETTE.bg,
        theme_color: PALETTE.bg,
        icons: MANIFEST_ICONS
      },
      null,
      2
    )}\n`
  );
  await write(
    "_headers",
    `/assets/*\n  Cache-Control: public, max-age=604800\n/favicon.ico\n  Cache-Control: public, max-age=604800\n/apple-touch-icon.png\n  Cache-Control: public, max-age=604800\n/og/*\n  Cache-Control: public, max-age=86400\n/badges/*\n  Cache-Control: public, max-age=31536000, immutable\n/feed.xsl\n  Content-Type: text/xsl; charset=utf-8\n  Cache-Control: public, max-age=604800\n/*.xml\n  Content-Type: application/xml; charset=utf-8\n`
  );
  await write("_routes.json", `${JSON.stringify(FUNCTION_ROUTES, null, 2)}\n`);
  await write(
    "404.html",
    shell({
      title: "Not found",
      description: "This OmaPicks page does not exist.",
      pathname: "/404.html",
      image: socialImage(),
      body: `<section class="page-section prose"><p class="eyebrow">404</p><h1>This page isn't here</h1><p class="page-lede"><a href="/">Back to this week's picks</a></p></section>`
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
