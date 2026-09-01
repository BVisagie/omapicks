import { cp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { METHODOLOGY, changesBetween } from "./rank.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DIST = path.join(ROOT, "dist");
const ORIGIN = "https://omapicks.com";

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

function nav() {
  return `<header class="site-header">
    <a class="brand" href="/" aria-label="OmaPicks home"><span aria-hidden="true">&gt;_</span> OmaPicks</a>
    <nav aria-label="Primary navigation">
      <a href="/methodology/">Methodology</a>
      <a href="/changelog/">Changelog</a>
      <a href="/feed.xml">RSS</a>
      <button class="theme-toggle" type="button" data-theme-toggle aria-label="Switch color theme">◐</button>
    </nav>
  </header>`;
}

function shell({ title, description, pathname, body, structuredData = null }) {
  const canonical = `${ORIGIN}${pathname}`;
  const fullTitle = title === "OmaPicks" ? title : `${title} · OmaPicks`;
  return `<!doctype html>
<html lang="en" data-theme="dark">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(fullTitle)}</title>
  <meta name="description" content="${escapeHtml(description)}">
  <meta name="color-scheme" content="dark light">
  <meta name="theme-color" content="#0f1221">
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
  <meta name="twitter:card" content="summary">
  ${structuredData ? `<script type="application/ld+json">${jsonLd(structuredData)}</script>` : ""}
  <script src="/assets/app.js" defer></script>
</head>
<body>
  <a class="skip-link" href="#main">Skip to content</a>
  <div class="page-wrap">
    ${nav()}
    <main id="main">${body}</main>
    <footer>
      <p>Independent rankings built from public registry data. Not affiliated with Omarchy, 37signals, or omarchyplugins.com.</p>
      <p><a href="/methodology/">How picks are calculated</a> · <a href="https://github.com/BVisagie/omapicks">Source</a></p>
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

function metricBars(candidate) {
  return `<div class="metrics" aria-label="Score components">
    ${["copies", "hearts", "stars", "views", "freshness"]
      .map((metric) => {
        const normalized = Math.max(0, Math.min(1, Number(candidate.normalized?.[metric] ?? 0)));
        const raw = candidate.metrics?.[metric];
        const display = metric === "freshness" ? `${Math.round(normalized * 100)}%` : Number(raw ?? 0).toLocaleString("en-US");
        return `<div class="metric">
          <span>${metricLabel(metric)}</span>
          <span>${escapeHtml(display)}</span>
          <span class="bar" aria-hidden="true"><span style="width:${Math.round(normalized * 100)}%"></span></span>
        </div>`;
      })
      .join("")}
  </div>`;
}

function candidateCard(candidate, place, type, week) {
  if (!candidate) return `<article class="pick-card empty"><p>No eligible pick this week.</p></article>`;
  const badgePath = `/badges/${encodeURIComponent(week)}/${encodeURIComponent(type.id)}/${encodeURIComponent(candidate.id)}.svg`;
  return `<article class="pick-card ${place === "winner" ? "champion" : ""}">
    <div class="card-label"><span>${place === "winner" ? "01 / champion" : "02 / runner-up"}</span>${statusPill(candidate)}</div>
    <img class="preview" src="${safeLocalImage(candidate.localImage)}" alt="" width="720" height="405" loading="lazy">
    <div class="card-body">
      <h3><a href="${safeUrl(candidate.detailUrl)}">${escapeHtml(candidate.name)}</a></h3>
      <p class="byline">by ${escapeHtml(candidate.author || "unknown")} · ${escapeHtml(candidate.license || "license unknown")} · score ${candidate.score.toFixed(3)}</p>
      <p>${escapeHtml(candidate.description)}</p>
      ${metricBars(candidate)}
      <div class="command-row">
        <code>${escapeHtml(candidate.installCommand)}</code>
        <button type="button" data-copy-command>Copy</button>
      </div>
      <div class="card-links">
        <a href="${safeUrl(candidate.repository)}">Repository</a>
        ${place === "winner" ? `<a href="${badgePath}">Award badge</a>` : ""}
      </div>
    </div>
  </article>`;
}

function typeSection(type, week, headingLevel = 2) {
  const Heading = `h${headingLevel}`;
  return `<section class="pick-section" id="${escapeHtml(type.id)}" data-pick-section data-search="${escapeHtml(
    [type.name, type.description, type.winner?.name, type.runnerUp?.name].filter(Boolean).join(" ").toLowerCase()
  )}">
    <div class="section-heading">
      <div>
        <span class="prompt" aria-hidden="true">~/picks/${escapeHtml(type.id)} $</span>
        <${Heading}><a href="/picks/${encodeURIComponent(type.id)}/">${escapeHtml(type.name)}</a></${Heading}>
        <p>${escapeHtml(type.description)}</p>
      </div>
      <span>${type.eligibleCount} eligible</span>
    </div>
    <div class="podium">
      ${candidateCard(type.winner, "winner", type, week)}
      ${candidateCard(type.runnerUp, "runner-up", type, week)}
    </div>
  </section>`;
}

function homePage(rankings) {
  const populated = rankings.types.filter((type) => type.winner);
  const heroItems = populated.map((type) => ({
    type: type.name.toLowerCase(),
    name: type.winner.name,
    href: `/picks/${type.id}/`
  }));
  const hero = heroItems[0];
  const body = `<section class="hero">
    <p class="eyebrow">Independent · weekly · transparent</p>
    <h1>The shortest path to the best Omarchy plugins.</h1>
    <p class="hero-pick" data-hero-pick data-items="${escapeHtml(JSON.stringify(heroItems))}">
      ${hero ? `The best ${escapeHtml(hero.type)} is <a href="${hero.href}">${escapeHtml(hero.name)}</a>.` : "The first picks are being prepared."}
    </p>
    <p>OmaPicks compares adoption, community support, maintenance, and verification across focused app types. No votes. No sponsorships. Just reproducible public data.</p>
    <div class="hero-meta"><span>Week ${escapeHtml(rankings.week ?? "pending")}</span><span>${populated.length} ranked app types</span></div>
  </section>
  <section class="finder" aria-label="Filter picks">
    <label for="pick-filter">Find a pick</label>
    <input id="pick-filter" type="search" placeholder="Try weather, clipboard, Spotify…" autocomplete="off" data-pick-filter>
    <p data-filter-status aria-live="polite"></p>
  </section>
  <div data-pick-list>
    ${rankings.types.map((type) => typeSection(type, rankings.week)).join("")}
  </div>`;
  return shell({
    title: "OmaPicks",
    description: "Independent weekly rankings of the best Omarchy plugins by app type.",
    pathname: "/",
    body,
    structuredData: {
      "@context": "https://schema.org",
      "@type": "WebSite",
      name: "OmaPicks",
      url: ORIGIN,
      description: "Independent weekly rankings of the best Omarchy plugins by app type."
    }
  });
}

function typePage(type, rankings) {
  const description = `The best ${type.name.toLowerCase()} plugins for Omarchy, ranked from public adoption and maintenance signals.`;
  const itemList = [type.winner, type.runnerUp].filter(Boolean).map((candidate, index) => ({
    "@type": "ListItem",
    position: index + 1,
    name: candidate.name,
    url: candidate.detailUrl
  }));
  const body = `<nav class="breadcrumbs" aria-label="Breadcrumb"><a href="/">Picks</a> / ${escapeHtml(type.name)}</nav>
    <section class="type-intro">
      <p class="eyebrow">OmaPicks · ${escapeHtml(rankings.week ?? "pending")}</p>
      <h1>Best ${escapeHtml(type.name)} plugins for Omarchy</h1>
      <p>${escapeHtml(type.description)}. Ranked weekly from public registry signals, with a 10% stability margin to prevent churn.</p>
    </section>
    ${typeSection(type, rankings.week, 2)}
    <aside class="method-note"><h2>Why these picks?</h2><p>The score combines command copies, hearts, GitHub stars, views, repository freshness, and registry verification. Low-sample entries are damped toward the cohort average.</p><a href="/methodology/">Read the complete methodology →</a></aside>`;
  return shell({
    title: `Best ${type.name} plugins for Omarchy`,
    description,
    pathname: `/picks/${type.id}/`,
    body,
    structuredData: {
      "@context": "https://schema.org",
      "@type": "ItemList",
      name: `Best ${type.name} plugins for Omarchy`,
      numberOfItems: itemList.length,
      itemListElement: itemList
    }
  });
}

function methodologyPage(rankings) {
  const weights = Object.entries(METHODOLOGY.weights)
    .map(([metric, weight]) => `<li><strong>${escapeHtml(metricLabel(metric))}</strong><span>${Math.round(weight * 100)}%</span></li>`)
    .join("");
  const body = `<section class="prose">
    <p class="eyebrow">Methodology v${escapeHtml(rankings.methodologyVersion)}</p>
    <h1>Opinionated picks, auditable math.</h1>
    <p>OmaPicks refreshes once per ISO week. The site itself never fetches data in your browser; each page is rendered from a validated, committed snapshot.</p>
    <h2>Eligibility and classification</h2>
    <p>A plugin must have an install command and a valid HTTPS repository. Retired and delisted entries are excluded. Curated regular-expression rules can place a plugin in every app type where it legitimately competes.</p>
    <h2>Score</h2>
    <p>Cumulative counts are transformed with <code>log1p</code>. Each signal combines a 70% within-type percentile with a 30% scale capped at the cohort's 95th percentile. Every result is then damped toward 50% based on copies, hearts, and a capped portion of views. This prevents a nearly unseen plugin from jumping to first place on tiny numbers.</p>
    <ul class="weight-list">${weights}</ul>
    <p>Repository freshness decays with a 180-day half-life. Missing timestamps receive no freshness points. Verification is a small bonus, not a requirement.</p>
    <h2>Stability</h2>
    <p>An eligible incumbent remains in place until a challenger scores more than 10% higher. If an incumbent becomes unavailable, the highest-scoring eligible plugin takes its place immediately. Ties fall back to copies, hearts, stars, then plugin ID.</p>
    <h2>Data provenance</h2>
    <p>Source timestamps, response metadata, SHA-256 checksums, metric contributions, and methodology version are included in the published <a href="/rankings.json">ranking snapshot</a>. A failed or suspiciously small feed cannot replace the previous week.</p>
  </section>`;
  return shell({
    title: "Methodology",
    description: "How OmaPicks classifies and ranks Omarchy plugins.",
    pathname: "/methodology/",
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
  const body = `<section class="prose">
    <p class="eyebrow">Weekly log</p>
    <h1>Champions change. The record stays.</h1>
    <p>Every displacement is preserved in an immutable weekly snapshot.</p>
    <div class="timeline">
      ${
        weeks.length
          ? weeks
              .map(
                (entry) => `<section>
                  <h2>${escapeHtml(entry.week)}</h2>
                  <time datetime="${escapeHtml(entry.generatedAt)}">${escapeHtml(
                    new Date(entry.generatedAt).toLocaleDateString("en-US", { dateStyle: "long", timeZone: "UTC" })
                  )}</time>
                  ${
                    entry.changes.length
                      ? `<ul>${entry.changes
                          .map((change) => {
                            if (change.kind === "displaced") {
                              return `<li><strong>${escapeHtml(change.current.name)}</strong> displaced ${escapeHtml(change.previous.name)} for ${escapeHtml(change.typeName)}.</li>`;
                            }
                            if (change.current) {
                              return `<li><strong>${escapeHtml(change.current.name)}</strong> became the first ${escapeHtml(change.typeName)} champion.</li>`;
                            }
                            return `<li>The ${escapeHtml(change.typeName)} champion spot became vacant.</li>`;
                          })
                          .join("")}</ul>`
                      : "<p>No champion changes.</p>"
                  }
                </section>`
              )
              .join("")
          : "<p>No weekly history has been published yet.</p>"
      }
    </div>
  </section>`;
  return shell({
    title: "Changelog",
    description: "Weekly OmaPicks champion changes.",
    pathname: "/changelog/",
    body
  });
}

function badgeSvg(type, candidate, week) {
  const label = `Best ${type.name} · ${week}`;
  const width = Math.max(360, Math.min(720, 210 + (label.length + candidate.name.length) * 7));
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="64" role="img" aria-label="${escapeHtml(label)}: ${escapeHtml(candidate.name)}">
  <title>${escapeHtml(label)}: ${escapeHtml(candidate.name)}</title>
  <rect width="100%" height="100%" rx="8" fill="#0f1221"/>
  <rect x="1" y="1" width="${width - 2}" height="62" rx="7" fill="none" stroke="#4c567a"/>
  <text x="18" y="25" fill="#8bd5ca" font-family="ui-monospace,monospace" font-size="13">${escapeHtml(label)}</text>
  <text x="18" y="47" fill="#e6e9f5" font-family="ui-monospace,monospace" font-size="16" font-weight="700">${escapeHtml(candidate.name)}</text>
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
        ? `${entry.current?.name ?? "No plugin"} displaced ${entry.previous.name}.`
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
  await cp(path.join(ROOT, "site", "styles.css"), path.join(DIST, "assets", "styles.css"));
  await cp(path.join(ROOT, "site", "app.js"), path.join(DIST, "assets", "app.js"));
  await cp(path.join(ROOT, "site", "icon.svg"), path.join(DIST, "assets", "icon.svg"));
  await cp(path.join(ROOT, "site", "placeholder.svg"), path.join(DIST, "assets", "placeholder.svg"));
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

  const urls = [
    "/",
    "/methodology/",
    "/changelog/",
    ...rankings.types.map((type) => `/picks/${type.id}/`)
  ];
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
    `${JSON.stringify({ name: "OmaPicks", short_name: "OmaPicks", start_url: "/", display: "standalone", background_color: "#0f1221", theme_color: "#0f1221" }, null, 2)}\n`
  );
  await write(
    "_headers",
    `/assets/*\n  Cache-Control: public, max-age=604800\n/badges/*\n  Cache-Control: public, max-age=31536000, immutable\n/*.xml\n  Content-Type: application/xml; charset=utf-8\n`
  );
  await write(
    "404.html",
    shell({
      title: "Not found",
      description: "This OmaPicks page does not exist.",
      pathname: "/404.html",
      body: `<section class="prose"><p class="eyebrow">404</p><h1>That pick is off the board.</h1><p><a href="/">Return to all picks →</a></p></section>`
    })
  );
  return { typeCount: rankings.types.length, historyCount: history.length, output: DIST };
}

export function renderFixtureHome(rankings) {
  return homePage(rankings);
}

export function deriveChanges(previous, current) {
  return changesBetween(previous, current);
}
