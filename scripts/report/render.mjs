// Renders the private site report as one self-contained HTML file: inline CSS and SVG, no
// external requests (enforced by its Content-Security-Policy), and a small optional script
// that adds hover readouts. Every value is escaped; every chart has a table view.

// Validated categorical slots (dataviz reference palette, checked against the site surfaces).
// Colour follows the entity: people are slot 1, filter reasons slots 2–5, visitors slot 6.
const SERIES = ["var(--series-1)", "var(--series-2)", "var(--series-3)", "var(--series-4)", "var(--series-5)"];
const VISITORS = "var(--series-6)";
const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const REASON_LABELS = {
  "crawler-list": "Known crawlers",
  "no-browser-headers": "No browser page-load headers",
  prefetch: "Prefetches",
  "cloud-network": "Cloud networks"
};
const INTEGER = new Intl.NumberFormat("en-GB", { maximumFractionDigits: 0 });
const COMPACT = new Intl.NumberFormat("en-GB", { notation: "compact", maximumFractionDigits: 1 });
const DECIMAL = new Intl.NumberFormat("en-GB", { minimumFractionDigits: 1, maximumFractionDigits: 1 });

export function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}
const esc = escapeHtml;

function num(value) {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  return Math.abs(value) >= 10000 ? COMPACT.format(value) : INTEGER.format(Math.round(value));
}
function dec(value) {
  return value === null || value === undefined || !Number.isFinite(value) ? "—" : DECIMAL.format(value);
}
function pct(value, digits = 1) {
  return value === null || value === undefined || !Number.isFinite(value) ? "—" : `${(value * 100).toFixed(digits)}%`;
}
function signed(value) {
  if (value === null || value === undefined || !Number.isFinite(value)) return null;
  const rounded = Math.round(value * 1000) / 10;
  return `${rounded > 0 ? "+" : rounded < 0 ? "−" : "±"}${Math.abs(rounded).toFixed(1)}%`;
}
function dayLabel(day, year = false) {
  const date = new Date(`${day}T00:00:00Z`);
  return date.toLocaleDateString("en-GB", { day: "numeric", month: "short", ...(year ? { year: "numeric" } : {}), timeZone: "UTC" });
}
function timeLabel(iso) {
  if (!iso) return "—";
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? "—" : date.toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "UTC" }) + " UTC";
}
function plural(count, one, many = `${one}s`) {
  return `${num(count)} ${count === 1 ? one : many}`;
}
function duration(seconds) {
  if (seconds === null || seconds === undefined) return "—";
  return seconds >= 90 ? `${Math.round(seconds / 60)} min` : `${Math.round(seconds)} s`;
}

function niceMax(value) {
  if (!(value > 0)) return 4;
  const step = 10 ** Math.floor(Math.log10(value / 4));
  const scaled = value / 4 / step;
  const nice = scaled <= 1 ? 1 : scaled <= 2 ? 2 : scaled <= 2.5 ? 2.5 : scaled <= 5 ? 5 : 10;
  return nice * step * 4;
}

function tile(label, value, { delta = null, note = "", upIsGood = true } = {}) {
  const direction = delta === null ? "" : delta.startsWith("+") ? (upIsGood ? "good" : "bad") : delta.startsWith("−") ? (upIsGood ? "bad" : "good") : "";
  return `<div class="tile"><p class="tile-label">${esc(label)}</p><p class="tile-value">${esc(value)}</p>${
    delta ? `<p class="tile-delta ${direction}">${esc(delta)} <span>vs previous period</span></p>` : ""
  }${note ? `<p class="tile-note">${esc(note)}</p>` : ""}</div>`;
}

function tableView(caption, columns, rows) {
  if (!rows.length) return "";
  return `<details class="table-view"><summary>Table view</summary><table><caption>${esc(caption)}</caption><thead><tr>${columns
    .map((column) => `<th scope="col">${esc(column)}</th>`)
    .join("")}</tr></thead><tbody>${rows.map((row) => `<tr>${row.map((cell) => `<td>${esc(cell)}</td>`).join("")}</tr>`).join("")}</tbody></table></details>`;
}

function legend(items, kind = "line") {
  if (items.length < 2) return "";
  return `<ul class="legend">${items.map((item) => `<li><span class="key ${kind}" style="--key:${item.color}"></span>${esc(item.name)}</li>`).join("")}</ul>`;
}

function columnPath(x, y, width, base) {
  const height = base - y;
  if (height <= 0) return "";
  const r = Math.min(4, height, width / 2);
  return `M${x},${base}V${y + r}Q${x},${y} ${x + r},${y}H${x + width - r}Q${x + width},${y} ${x + width},${y + r}V${base}Z`;
}

// Line chart for one measure family (all series share one unit and one axis).
function lineChart({ id, title, days, series, markers = [], height = 220, width = 720, note = "" }) {
  const pad = { left: 46, right: width < 500 ? 44 : 64, top: 14, bottom: 26 };
  const innerW = width - pad.left - pad.right;
  const innerH = height - pad.top - pad.bottom;
  const max = niceMax(Math.max(0, ...series.flatMap((entry) => entry.values)));
  const x = (index) => pad.left + (days.length <= 1 ? innerW / 2 : (index / (days.length - 1)) * innerW);
  const y = (value) => pad.top + innerH - (value / max) * innerH;
  const ticks = [0, 1, 2, 3, 4].map((step) => (max / 4) * step);
  const grid = ticks
    .map((tick) => `<line class="grid" x1="${pad.left}" x2="${width - pad.right}" y1="${y(tick)}" y2="${y(tick)}"/><text class="tick" x="${pad.left - 8}" y="${y(tick) + 4}" text-anchor="end">${esc(num(tick))}</text>`)
    .join("");
  const xLabels = [0, Math.floor((days.length - 1) / 2), days.length - 1]
    .filter((value, index, all) => all.indexOf(value) === index && days[value])
    .map((index) => `<text class="tick" x="${x(index)}" y="${height - 6}" text-anchor="middle">${esc(dayLabel(days[index]))}</text>`)
    .join("");
  const markerLines = markers
    .map((marker) => ({ ...marker, index: days.indexOf(marker.day) }))
    .filter((marker) => marker.index >= 0)
    .map((marker) => `<line class="marker ${marker.kind}" x1="${x(marker.index)}" x2="${x(marker.index)}" y1="${pad.top}" y2="${pad.top + innerH}"><title>${esc(marker.label)} · ${esc(dayLabel(marker.day))}</title></line>`)
    .join("");
  const ends = series.map((entry) => ({ entry, value: entry.values.at(-1) ?? 0 }));
  const labelsCollide = ends.length > 1 && Math.abs(y(ends[0].value) - y(ends[1].value)) < 14;
  const lines = series
    .map((entry, index) => {
      const points = entry.values.map((value, i) => `${x(i)},${y(value)}`).join(" L");
      const area = series.length === 1 ? `<path class="area" style="fill:${entry.color}" d="M${x(0)},${y(0)} L${points} L${x(entry.values.length - 1)},${y(0)}Z"/>` : "";
      const last = entry.values.length - 1;
      const endLabel = labelsCollide ? "" : `<text class="end-label" x="${x(last) + 9}" y="${y(entry.values[last] ?? 0) + 4}">${esc(num(entry.values[last]))}</text>`;
      return `${area}<path class="line" style="stroke:${entry.color}" d="M${points}"/><circle class="end-dot" cx="${x(last)}" cy="${y(entry.values[last] ?? 0)}" r="4" style="fill:${entry.color}"/>${index < 4 ? endLabel : ""}`;
    })
    .join("");
  const data = { days: days.map((day) => dayLabel(day, true)), series: series.map((entry) => ({ name: entry.name, color: entry.color, values: entry.values })) };
  return `<figure class="chart" id="${esc(id)}"><figcaption>${esc(title)}</figcaption>${legend(series.map((entry) => ({ name: entry.name, color: entry.color })))}<div class="plot" data-line-chart="${esc(
    JSON.stringify({ ...data, left: pad.left, right: width - pad.right, width })
  )}"><svg viewBox="0 0 ${width} ${height}" role="img" aria-label="${esc(title)}">${grid}<line class="axis" x1="${pad.left}" x2="${width - pad.right}" y1="${y(0)}" y2="${y(0)}"/>${markerLines}${lines}${xLabels}</svg><div class="tooltip" hidden></div></div>${note ? `<p class="caption">${esc(note)}</p>` : ""}${tableView(
    title,
    ["Day", ...series.map((entry) => entry.name)],
    days.map((day, index) => [dayLabel(day, true), ...series.map((entry) => num(entry.values[index]))])
  )}</figure>`;
}

function columnChart({ id, title, labels, values, color = SERIES[0], height = 180, format = num }) {
  const width = 720;
  const pad = { left: 46, right: 16, top: 18, bottom: 26 };
  const innerW = width - pad.left - pad.right;
  const innerH = height - pad.top - pad.bottom;
  const max = niceMax(Math.max(0, ...values));
  const slot = innerW / Math.max(1, values.length);
  const barW = Math.min(24, slot * 0.7);
  const base = pad.top + innerH;
  const y = (value) => base - (value / max) * innerH;
  const top = values.indexOf(Math.max(...values));
  const ticks = [0, 2, 4].map((step) => (max / 4) * step);
  const grid = ticks.map((tick) => `<line class="grid" x1="${pad.left}" x2="${width - pad.right}" y1="${y(tick)}" y2="${y(tick)}"/><text class="tick" x="${pad.left - 8}" y="${y(tick) + 4}" text-anchor="end">${esc(num(tick))}</text>`).join("");
  const every = Math.max(1, Math.ceil(values.length / 10));
  const bars = values
    .map((value, index) => {
      const x = pad.left + slot * index + (slot - barW) / 2;
      const label = index % every === 0 || index === values.length - 1 ? `<text class="tick" x="${x + barW / 2}" y="${height - 6}" text-anchor="middle">${esc(labels[index])}</text>` : "";
      const cap = index === top && value > 0 ? `<text class="end-label" x="${x + barW / 2}" y="${y(value) - 6}" text-anchor="middle">${esc(format(value))}</text>` : "";
      return `<g class="mark" tabindex="0"><rect class="hit" x="${pad.left + slot * index}" y="${pad.top}" width="${slot}" height="${innerH}"/><path style="fill:${color}" d="${columnPath(x, y(value), barW, base)}"/><title>${esc(labels[index])}: ${esc(format(value))}</title></g>${label}${cap}`;
    })
    .join("");
  return `<figure class="chart" id="${esc(id)}"><figcaption>${esc(title)}</figcaption><svg viewBox="0 0 ${width} ${height}" role="img" aria-label="${esc(title)}">${grid}<line class="axis" x1="${pad.left}" x2="${width - pad.right}" y1="${base}" y2="${base}"/>${bars}</svg>${tableView(
    title,
    ["", "Value"],
    labels.map((label, index) => [label, format(values[index])])
  )}</figure>`;
}

function stackedColumns({ id, title, labels, keys, rows, height = 200 }) {
  const width = 720;
  const pad = { left: 46, right: 16, top: 14, bottom: 26 };
  const innerW = width - pad.left - pad.right;
  const innerH = height - pad.top - pad.bottom;
  const totals = rows.map((row) => keys.reduce((sum, key) => sum + row[key.id], 0));
  const max = niceMax(Math.max(0, ...totals));
  const slot = innerW / Math.max(1, rows.length);
  const barW = Math.min(24, slot * 0.7);
  const base = pad.top + innerH;
  const scale = (value) => (value / max) * innerH;
  const ticks = [0, 2, 4].map((step) => (max / 4) * step);
  const grid = ticks.map((tick) => `<line class="grid" x1="${pad.left}" x2="${width - pad.right}" y1="${base - scale(tick)}" y2="${base - scale(tick)}"/><text class="tick" x="${pad.left - 8}" y="${base - scale(tick) + 4}" text-anchor="end">${esc(num(tick))}</text>`).join("");
  const every = Math.max(1, Math.ceil(rows.length / 10));
  const columns = rows
    .map((row, index) => {
      const x = pad.left + slot * index + (slot - barW) / 2;
      let cursor = base;
      const present = keys.filter((key) => row[key.id] > 0);
      const segments = present
        .map((key, position) => {
          const h = scale(row[key.id]);
          const gap = position === 0 ? 0 : 2;
          const segment = position === present.length - 1 ? columnPath(x, cursor - h, barW, cursor - gap) : `M${x},${cursor - gap}V${cursor - h}H${x + barW}V${cursor - gap}Z`;
          cursor -= h;
          return `<path style="fill:${key.color}" d="${segment}"/>`;
        })
        .join("");
      const tip = keys.map((key) => `${key.name}: ${num(row[key.id])}`).join(" · ");
      const label = index % every === 0 || index === rows.length - 1 ? `<text class="tick" x="${x + barW / 2}" y="${height - 6}" text-anchor="middle">${esc(labels[index])}</text>` : "";
      return `<g class="mark" tabindex="0"><rect class="hit" x="${pad.left + slot * index}" y="${pad.top}" width="${slot}" height="${innerH}"/>${segments}<title>${esc(labels[index])} — ${esc(tip)}</title></g>${label}`;
    })
    .join("");
  return `<figure class="chart" id="${esc(id)}"><figcaption>${esc(title)}</figcaption>${legend(keys, "rect")}<svg viewBox="0 0 ${width} ${height}" role="img" aria-label="${esc(title)}">${grid}<line class="axis" x1="${pad.left}" x2="${width - pad.right}" y1="${base}" y2="${base}"/>${columns}</svg>${tableView(
    title,
    ["", ...keys.map((key) => key.name), "Total"],
    rows.map((row, index) => [labels[index], ...keys.map((key) => num(row[key.id])), num(totals[index])])
  )}</figure>`;
}

function segmentedBar({ title, parts }) {
  const total = parts.reduce((sum, part) => sum + part.value, 0);
  if (!(total > 0)) return `<p class="empty">${esc(title)}: nothing recorded yet.</p>`;
  const blocks = parts
    .filter((part) => part.value > 0)
    .map((part) => {
      const share = part.value / total;
      return `<span class="segment" style="flex:${share} 1 0;--fill:${part.color}" tabindex="0" title="${esc(`${part.name}: ${num(part.value)} (${pct(share)})`)}"><b class="${part.dark ? "on-light" : ""}">${share >= 0.08 ? esc(pct(share, 0)) : ""}</b></span>`;
    })
    .join("");
  return `<figure class="chart"><figcaption>${esc(title)}</figcaption><div class="segmented" role="img" aria-label="${esc(
    parts.map((part) => `${part.name} ${pct(part.value / total)}`).join(", ")
  )}">${blocks}</div><ul class="legend">${parts.map((part) => `<li><span class="key rect" style="--key:${part.color}"></span>${esc(part.name)}</li>`).join("")}</ul>${tableView(
    title,
    ["Part", "Count", "Share"],
    parts.map((part) => [part.name, num(part.value), pct(part.value / total)])
  )}</figure>`;
}

function barTable({ caption, columns, rows, valueIndex = 1, max = null }) {
  if (!rows.length) return `<p class="empty">${esc(caption)}: nothing to show.</p>`;
  const top = max ?? Math.max(...rows.map((row) => row.value));
  return `<table class="bar-table"><caption>${esc(caption)}</caption><thead><tr>${columns.map((column) => `<th scope="col">${esc(column)}</th>`).join("")}</tr></thead><tbody>${rows
    .map(
      (row) =>
        `<tr>${row.cells
          .map((cell, index) =>
            index === valueIndex
              ? `<td class="bar-cell"><span class="bar" style="--w:${top > 0 ? Math.max(0, (row.value / top) * 100).toFixed(1) : 0}%"></span><span class="bar-value">${esc(cell)}</span></td>`
              : `<td>${esc(cell)}</td>`
          )
          .join("")}</tr>`
    )
    .join("")}</tbody></table>`;
}

function plainTable(caption, columns, rows) {
  if (!rows.length) return `<p class="empty">${esc(caption)}: nothing to show.</p>`;
  return `<table><caption>${esc(caption)}</caption><thead><tr>${columns.map((column) => `<th scope="col">${esc(column)}</th>`).join("")}</tr></thead><tbody>${rows
    .map((row) => `<tr>${row.map((cell) => `<td>${esc(cell)}</td>`).join("")}</tr>`)
    .join("")}</tbody></table>`;
}

function unavailable(name, section) {
  if (section.status === "not-configured") return `<p class="notice">${esc(name)} is not configured yet.${section.note ? ` ${esc(section.note)}` : ""} See docs/automation.md for setup.</p>`;
  if (section.status === "not-collected") return `<p class="notice">${esc(name)} was not collected in this run.</p>`;
  return `<p class="notice error"><span aria-hidden="true">✕</span> ${esc(name)} failed: ${esc(section.error ?? "unknown error")}</p>`;
}

function trafficSection(traffic, site) {
  if (traffic.status !== "ok") return `<section id="traffic"><h2>Traffic</h2>${unavailable("Cloudflare traffic", traffic)}</section>`;
  const { current, previous } = traffic;
  const days = traffic.daily.filter((entry) => entry.day >= current.start).map((entry) => entry.day);
  const daily = traffic.daily.filter((entry) => entry.day >= current.start);
  const markers = [
    ...(site.publications ?? []).map((day) => ({ day, label: "Weekly publication", kind: "publication" })),
    ...(traffic.filterLiveSince ? [{ day: traffic.filterLiveSince, label: "New bot filter live", kind: "filter" }] : [])
  ];
  const pages = traffic.pages.filter((entry) => entry.views > 0).slice(0, 15);
  return `<section id="traffic"><h2>Traffic</h2>
  <p class="lede">${esc(dayLabel(current.start, true))} – ${esc(dayLabel(current.end, true))} (${current.days} complete UTC days)${
    previous ? `, compared with the ${previous.days} days before.` : ". Analytics Engine keeps 90 days, so there is no earlier period to compare."
  }</p>
  <div class="tiles">
    ${tile("Page views by people", num(current.views), { delta: signed(traffic.change?.views) })}
    ${tile("Average daily visitors", dec(current.averageDailyVisitors), { delta: signed(traffic.change?.averageDailyVisitors) })}
    ${tile("Pages per visitor-day", dec(current.pagesPerVisitorDay))}
    ${tile("Removed as automated", pct(current.removedShare), { note: `${num(current.filteredTotal + current.crawlerLikeViews)} requests` })}
  </div>
  ${current.legacyViews > 0 ? `<p class="notice">${esc(num(current.legacyViews))} of these views were recorded before the new bot filter went live${traffic.filterLiveSince ? ` on ${esc(dayLabel(traffic.filterLiveSince, true))}` : ""}, with the older, looser filter. Compare across that date with care.</p>` : ""}
  ${lineChart({
    id: "traffic-daily",
    title: "Page views and visitors per day",
    days,
    series: [
      { name: "Page views", color: SERIES[0], values: daily.map((entry) => entry.views) },
      { name: "Visitors", color: VISITORS, values: daily.map((entry) => entry.visitorDays) }
    ],
    markers,
    note: "Thin vertical lines mark weekly publications; the accent line marks when the new bot filter went live."
  })}
  ${columnChart({ id: "traffic-weekday", title: "Average page views by weekday", labels: WEEKDAYS, values: traffic.weekdays.map((entry) => entry.averageViews), format: dec })}
  <h3>Top pages</h3>
  ${barTable({
    caption: "Most viewed pages",
    columns: ["Page", "Views", "Visitor-days", "Filtered share"],
    rows: pages.map((entry) => ({ value: entry.views, cells: [entry.path === "other" ? "Other pages" : `${entry.name} (${entry.path})`, num(entry.views), num(entry.visitorDays), pct(entry.filteredShare, 0)] }))
  })}
  <h3>Categories with no views</h3>
  ${traffic.zeroViewCategories.length ? `<p class="list">${traffic.zeroViewCategories.map((entry) => esc(entry.name)).join(" · ")}</p>` : `<p class="empty">Every category page was viewed at least once.</p>`}
  </section>`;
}

function filteringSection(traffic) {
  if (traffic.status !== "ok") return "";
  const { current } = traffic;
  const daily = traffic.daily.filter((entry) => entry.day >= current.start);
  const keys = Object.entries(REASON_LABELS).map(([id, name], index) => ({ id, name, color: SERIES[index + 1] }));
  return `<section id="filtering"><h2>Filtering</h2>
  <p class="lede">How many requests were kept out of the numbers above, and why. Filtered requests are sampled one in ten and scaled back up. Visitor-days with ${traffic.thresholds.dailyViews}+ views, or ${traffic.thresholds.pagesPerMinute}+ different pages within a minute, are treated as crawlers imitating a browser.</p>
  ${segmentedBar({
    title: "All page requests this period",
    parts: [
      { name: "People", value: current.views, color: SERIES[0] },
      ...keys.map((key) => ({ name: key.name, value: current.filtered[key.id], color: key.color, dark: key.id === "prefetch" })),
      { name: "Crawler-like visitor-days", value: current.crawlerLikeViews, color: "var(--muted-mark)" }
    ]
  })}
  ${stackedColumns({
    id: "filtering-daily",
    title: "Filtered requests per day, by reason",
    labels: daily.map((entry) => dayLabel(entry.day)),
    keys,
    rows: daily.map((entry) => entry.filtered)
  })}
  </section>`;
}

function searchSection(search) {
  if (search.status !== "ok") return `<section id="search"><h2>Google search</h2>${unavailable("Search Console", search)}</section>`;
  const { current } = search;
  const daily = search.daily.filter((entry) => entry.day >= current.start);
  const days = daily.map((entry) => entry.day);
  const failing = search.indexing.pages.filter((entry) => entry.verdict !== "PASS");
  return `<section id="search"><h2>Google search</h2>
  <p class="lede">${esc(dayLabel(current.start, true))} – ${esc(dayLabel(current.end, true))}. Search data runs about three days behind. Google omits rare searches for privacy, so per-search figures do not add up to the totals.</p>
  <div class="tiles">
    ${tile("Clicks from Google", num(current.clicks), { delta: signed(search.change.clicks) })}
    ${tile("Impressions", num(current.impressions), { delta: signed(search.change.impressions) })}
    ${tile("Click-through rate", pct(current.ctr))}
    ${tile("Average position", dec(current.position), { note: "lower is better" })}
  </div>
  <div class="pair">
    ${lineChart({ id: "search-clicks", title: "Clicks per day", days, series: [{ name: "Clicks", color: SERIES[0], values: daily.map((entry) => entry.clicks) }], height: 200, width: 360 })}
    ${lineChart({ id: "search-impressions", title: "Impressions per day", days, series: [{ name: "Impressions", color: SERIES[0], values: daily.map((entry) => entry.impressions) }], height: 200, width: 360 })}
  </div>
  <h3>Top searches</h3>
  ${barTable({
    caption: "Searches that showed OmaPicks",
    columns: ["Search", "Clicks", "Impressions", "CTR", "Position"],
    rows: search.queries.map((entry) => ({ value: entry.clicks, cells: [entry.query, num(entry.clicks), num(entry.impressions), pct(entry.ctr), dec(entry.position)] }))
  })}
  <h3>Pages people land on from Google</h3>
  ${barTable({
    caption: "Landing pages",
    columns: ["Page", "Clicks", "Impressions", "CTR", "Position"],
    rows: search.pages.slice(0, 15).map((entry) => ({ value: entry.clicks, cells: [entry.path === "other" ? "Other pages" : `${entry.name} (${entry.path})`, num(entry.clicks), num(entry.impressions), pct(entry.ctr), dec(entry.position)] }))
  })}
  <h3>Quick wins</h3>
  ${plainTable("Shown often but rarely clicked (title or description may need work)", ["Page", "Impressions", "CTR"], search.quickWins.lowClickPages.map((entry) => [`${entry.name} (${entry.path})`, num(entry.impressions), pct(entry.ctr)]))}
  ${plainTable("Searches ranking just off the first page (positions 5–20)", ["Search", "Impressions", "Position"], search.quickWins.nearFirstPage.map((entry) => [entry.query, num(entry.impressions), dec(entry.position)]))}
  ${plainTable("Searches that land on no category page (possible missing categories)", ["Search", "Impressions", "Clicks"], search.quickWins.withoutCategory.map((entry) => [entry.query, num(entry.impressions), num(entry.clicks)]))}
  <h3>Devices and countries</h3>
  ${segmentedBar({ title: "Clicks by device", parts: search.devices.map((entry, index) => ({ name: entry.device.toLowerCase().replace(/^\w/, (c) => c.toUpperCase()), value: entry.clicks, color: SERIES[index] })) })}
  ${plainTable("Top countries (Google's aggregate figures)", ["Country", "Clicks", "Impressions"], search.countries.map((entry) => [entry.country.toUpperCase(), num(entry.clicks), num(entry.impressions)]))}
  <h3>Indexing</h3>
  <p>${Object.entries(search.indexing.verdicts)
    .map(([verdict, total]) => `<span class="pill ${verdict === "PASS" ? "good" : verdict === "FAIL" ? "critical" : "neutral"}"><span aria-hidden="true">${verdict === "PASS" ? "✓" : verdict === "FAIL" ? "✕" : "•"}</span> ${esc(verdict.toLowerCase())}: ${esc(num(total))}</span>`)
    .join(" ")}</p>
  ${plainTable("Pages Google has not fully indexed", ["Page", "Verdict", "Coverage", "Last crawl", "Canonical differs"], failing.map((entry) => [entry.path, entry.verdict, entry.coverageState || "—", timeLabel(entry.lastCrawlTime), entry.canonicalMismatch ? "yes" : "no"]))}
  ${plainTable("Sitemaps", ["Sitemap", "Last read by Google", "URLs submitted", "Errors", "Warnings"], search.sitemaps.map((entry) => [entry.path, timeLabel(entry.lastDownloaded), num(entry.submitted), num(entry.errors), num(entry.warnings)]))}
  </section>`;
}

function demandSection({ traffic, search, site }) {
  const views = new Map((traffic.status === "ok" ? traffic.pages : []).map((entry) => [entry.path, entry]));
  const google = new Map((search.status === "ok" ? search.pages : []).map((entry) => [entry.path, entry]));
  const rows = site.categories.list
    .map((entry) => ({ ...entry, views: views.get(entry.path)?.views ?? 0, impressions: google.get(entry.path)?.impressions ?? 0 }))
    .sort((a, b) => b.views - a.views || b.impressions - a.impressions || b.pending - a.pending)
    .slice(0, 25);
  return `<section id="demand"><h2>Where review effort pays off</h2>
  <p class="lede">Categories people visit or find on Google, next to how many listings still await a source review there. A popular category with a large backlog is the best place to review next.</p>
  ${barTable({
    caption: "Demand and review backlog by category",
    columns: ["Category", "Page views", "Google impressions", "Awaiting review", "Leading pick", "Its marketplace copies"],
    rows: rows.map((entry) => ({ value: entry.views, cells: [entry.name, num(entry.views), num(entry.impressions), num(entry.pending), entry.winner ?? "—", num(entry.winnerCopies)] }))
  })}
  </section>`;
}

function catalogSection(site) {
  const { funnel, categories, picks, snapshot } = site;
  const excludedTotal = Object.values(funnel.excluded).reduce((sum, value) => sum + value, 0);
  const funnelRows = [
    ["Catalog listings", funnel.catalog],
    ["Excluded before review", excludedTotal],
    ["Classified into a category", funnel.classified],
    ["Qualified category entries", funnel.qualified],
    ["Category entries awaiting review", funnel.pending]
  ];
  return `<section id="catalog"><h2>Rankings and catalog</h2>
  <p class="lede">Snapshot ${esc(snapshot.week)} (methodology ${esc(snapshot.methodology)}), published ${esc(dec(snapshot.ageDays))} days ago. Availability last checked ${esc(dec(snapshot.availabilityAgeDays))} days ago.</p>
  <div class="tiles">
    ${tile("Categories", num(categories.total), { note: `${num(categories.withRunnerUp)} with a runner-up` })}
    ${tile("Single-option categories", num(categories.singleOption))}
    ${tile("Distinct picks", num(picks.distinct), { note: `${num(picks.unavailable.length)} unavailable` })}
    ${tile("Picks with stale repositories", num(picks.stale), { note: "no push in 180+ days" })}
  </div>
  ${barTable({ caption: "From catalog to recommendation", columns: ["Stage", "Count"], rows: funnelRows.map(([label, value]) => ({ value, cells: [label, num(value)] })) })}
  ${plainTable("Excluded before review, by reason", ["Reason", "Listings"], Object.entries(funnel.excluded).map(([reason, total]) => [reason.replaceAll("-", " "), num(total)]))}
  ${barTable({
    caption: "Largest review backlogs",
    columns: ["Category", "Awaiting review", "Eligible"],
    rows: [...categories.list].sort((a, b) => b.pending - a.pending).slice(0, 10).map((entry) => ({ value: entry.pending, cells: [entry.name, num(entry.pending), num(entry.eligible)] }))
  })}
  ${segmentedBar({ title: "Verification of current picks", parts: picks.verification.slice(0, 4).map((entry, index) => ({ name: entry.name.replaceAll("-", " "), value: entry.total, color: SERIES[index], dark: index === 3 })) })}
  ${plainTable("Authors with more than one leading pick", ["Author", "Leading picks"], picks.repeatAuthors.map((entry) => [entry.name, num(entry.total)]))}
  ${plainTable("Unavailable picks", ["Pick", "Status"], picks.unavailable.map((entry) => [entry.pick, entry.status]))}
  ${site.newListings.length ? `<p><strong>New listings this week:</strong> ${site.newListings.map(esc).join(", ")}</p>` : ""}
  </section>`;
}

function stabilitySection(site) {
  const { stability, engagement } = site;
  return `<section id="stability"><h2>Stability</h2>
  ${stackedColumns({
    id: "stability-weeks",
    title: "Pick changes per weekly snapshot",
    labels: stability.weeks.map((entry) => entry.week.replace(/^\d{4}-/, "")),
    keys: [
      { id: "displaced", name: "Leading pick replaced", color: SERIES[0] },
      { id: "newChampions", name: "First leading pick", color: SERIES[1] }
    ],
    rows: stability.weeks.map((entry) => ({ displaced: entry.displaced, newChampions: entry.newChampions })),
    height: 180
  })}
  ${plainTable("Weekly snapshots", ["Week", "Methodology", "Categories", "Changes"], stability.weeks.map((entry) => [entry.week, entry.methodology, num(entry.categories), num(entry.changes)]))}
  ${plainTable("Longest-held leading picks", ["Category", "Pick", "Consecutive weeks"], stability.longestHeld.map((entry) => [entry.category, entry.pick, num(entry.weeks)]))}
  ${plainTable("Categories whose leading pick changed most", ["Category", "Times replaced"], stability.mostDisplaced.map((entry) => [entry.name, num(entry.displaced)]))}
  ${
    engagement
      ? `<h3>Marketplace engagement of current picks</h3><p>Since ${esc(engagement.baselineWeek)}, the ${esc(num(engagement.picksCompared))} leading picks that were already listed went from ${esc(num(engagement.copiesThen))} to ${esc(num(engagement.copiesNow))} install-command copies and from ${esc(num(engagement.heartsThen))} to ${esc(num(engagement.heartsNow))} hearts. These figures show what happened alongside a pick, not that OmaPicks caused it.</p>${plainTable("Biggest gains in copies", ["Pick", "Copies now", "Gained"], engagement.topGrowth.map((entry) => [entry.pick, num(entry.copies), num(entry.gained)]))}`
      : ""
  }
  </section>`;
}

function automationSection(automation) {
  if (automation.status !== "ok") return `<section id="automation"><h2>Automation</h2>${unavailable("GitHub Actions history", automation)}</section>`;
  const state = (entry) => (entry.lastConclusion === "success" ? ["good", "✓", "passing"] : entry.lastConclusion === "failure" ? ["critical", "✕", "failing"] : ["neutral", "•", (entry.lastConclusion || "unknown").replaceAll("_", " ")]);
  return `<section id="automation"><h2>Automation</h2>
  <p class="lede">Workflow runs over the last ${automation.lookbackDays} days. Repository: ${esc(plural(automation.repository.stars, "star"))}, ${esc(plural(automation.repository.forks, "fork"))}, ${esc(plural(automation.repository.openIssues, "open issue or pull request", "open issues and pull requests"))}.</p>
  <table><caption>Workflow health</caption><thead><tr><th scope="col">Workflow</th><th scope="col">Latest</th><th scope="col">Runs</th><th scope="col">Success rate</th><th scope="col">Last success</th><th scope="col">Median duration</th></tr></thead><tbody>${automation.workflows
    .map((entry) => {
      const [kind, icon, label] = state(entry);
      return `<tr><td>${esc(entry.name)}</td><td><span class="pill ${kind}"><span aria-hidden="true">${icon}</span> ${esc(label)}</span></td><td>${esc(num(entry.runs))}</td><td>${esc(pct(entry.successRate, 0))}</td><td>${esc(timeLabel(entry.lastSuccess))}</td><td>${esc(duration(entry.medianSeconds))}</td></tr>`;
    })
    .join("")}</tbody></table>
  </section>`;
}

const DEFINITIONS = `<section id="definitions"><h2>Definitions and limits</h2><dl>
<dt>Page view</dt><dd>A successful HTML page load from a browser that passed every bot check. Requests sending Global Privacy Control or Do Not Track are never recorded.</dd>
<dt>Visitor-day</dt><dd>One visitor on one UTC day. Visitor identifiers are salted per day and cannot follow anyone across days, so totals over a period count visitor-days, not people. Several people behind one shared address count as one visitor that day.</dd>
<dt>Filtered request</dt><dd>A page load from a known crawler, a client without a browser's page-load headers, a prefetch, or a large cloud provider. One in ten is recorded and scaled back up. VPNs and Cloudflare WARP count as people.</dd>
<dt>Crawler-like visitor-day</dt><dd>A visitor-day that passed every header check but behaved like a crawler. It is removed from site totals and the daily chart; per-page tables are not adjusted for it.</dd>
<dt>Sampling</dt><dd>Analytics Engine may sample heavy traffic. View totals are weighted back up; visitor counts are then estimates.</dd>
<dt>Search figures</dt><dd>Google's aggregate Search Console statistics about OmaPicks results, about three days behind. OmaPicks sends Google nothing about visitors.</dd>
<dt>What this report cannot tell you</dt><dd>Referrers, devices or countries of site visitors, unique people across days, time on page, or whether anyone installed a pick. A headless browser that imitates a person from a home connection is indistinguishable server-side.</dd>
</dl></section>`;

const STYLE = `
:root{color-scheme:dark;--bg:#0b0d14;--surface:#141724;--surface-2:#1c2033;--ink:#c0caf5;--muted:#8a93b8;--line:rgba(192,202,245,.14);--line-strong:rgba(192,202,245,.34);--accent:#8bd5ca;--grid:#262a3d;--axis:#3a3f57;
--series-1:#3987e5;--series-2:#d95926;--series-3:#199e70;--series-4:#c98500;--series-5:#d55181;--series-6:#008300;--muted-mark:#5f6688;--good:#0ca30c;--critical:#e66767;--on-fill:#ffffff;--on-light:#ffffff;
font-family:system-ui,"Inter","Segoe UI",sans-serif;background:var(--bg);color:var(--ink)}
@media (prefers-color-scheme:light){:root:not([data-theme="dark"]){color-scheme:light;--bg:#f4f1ea;--surface:#fbfaf7;--surface-2:#f1eee6;--ink:#15151a;--muted:#5e5c58;--line:rgba(21,21,26,.12);--line-strong:rgba(21,21,26,.32);--accent:#166d67;--grid:#e6e2d8;--axis:#c3c2b7;
--series-1:#2a78d6;--series-2:#eb6834;--series-3:#1baf7a;--series-4:#eda100;--series-5:#e87ba4;--series-6:#008300;--muted-mark:#a9a69c;--good:#006300;--critical:#d03b3b;--on-light:#0b0b0b}}
:root[data-theme="light"]{color-scheme:light;--bg:#f4f1ea;--surface:#fbfaf7;--surface-2:#f1eee6;--ink:#15151a;--muted:#5e5c58;--line:rgba(21,21,26,.12);--line-strong:rgba(21,21,26,.32);--accent:#166d67;--grid:#e6e2d8;--axis:#c3c2b7;
--series-1:#2a78d6;--series-2:#eb6834;--series-3:#1baf7a;--series-4:#eda100;--series-5:#e87ba4;--series-6:#008300;--muted-mark:#a9a69c;--good:#006300;--critical:#d03b3b;--on-light:#0b0b0b}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);line-height:1.5}
main{max-width:1040px;margin:0 auto;padding:32px 16px 64px}
header{margin-bottom:24px}h1{font-size:2rem;margin:0 0 4px}h2{font-size:1.35rem;margin:0 0 8px}h3{font-size:1.05rem;margin:28px 0 8px}
.eyebrow{color:var(--accent);font-size:.8rem;letter-spacing:.08em;text-transform:uppercase;margin:0}
.lede,.caption{color:var(--muted)}.caption{font-size:.85rem;margin-top:-4px}
section{background:var(--surface);border:1px solid var(--line);border-radius:20px;padding:24px;margin:20px 0;overflow:hidden}
nav ul{display:flex;flex-wrap:wrap;gap:8px;list-style:none;padding:0;margin:12px 0 0}nav a{color:var(--ink);text-decoration:none;border:1px solid var(--line);border-radius:999px;padding:4px 12px;font-size:.9rem;display:inline-flex;gap:6px;align-items:center}
nav a:hover,nav a:focus-visible{border-color:var(--line-strong)}
.status{width:8px;height:8px;border-radius:50%;background:var(--muted)}.status.ok{background:var(--good)}.status.error{background:var(--critical)}
.tiles{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:12px;margin:16px 0}
.tile{background:var(--surface-2);border-radius:12px;padding:14px 16px}.tile p{margin:0}.tile-label{color:var(--muted);font-size:.85rem}.tile-value{font-size:1.75rem;font-weight:600}
.tile-delta{font-size:.85rem}.tile-delta span,.tile-note{color:var(--muted);font-size:.85rem}.tile-delta.good{color:var(--good)}.tile-delta.bad{color:var(--critical)}
.chart{margin:20px 0}.chart figcaption{font-weight:600;margin-bottom:6px}.chart svg{width:100%;height:auto;display:block}
.pair{display:grid;grid-template-columns:repeat(auto-fit,minmax(300px,1fr));gap:16px}
.plot{position:relative}
.grid{stroke:var(--grid);stroke-width:1}.axis{stroke:var(--axis);stroke-width:1}.tick{fill:var(--muted);font-size:11px;font-variant-numeric:tabular-nums}
.line{fill:none;stroke-width:2;stroke-linejoin:round;stroke-linecap:round}.area{opacity:.1}.end-dot{stroke:var(--surface);stroke-width:2}
.end-label{fill:var(--ink);font-size:12px;font-weight:600}
.marker{stroke:var(--line-strong);stroke-width:1}.marker.filter{stroke:var(--accent);stroke-width:1.5}
.mark .hit{fill:transparent}.mark:hover path,.mark:focus path{opacity:.8}.mark:focus{outline:none}.mark:focus .hit{stroke:var(--line-strong)}
.crosshair{stroke:var(--line-strong);stroke-width:1}
.tooltip{position:absolute;top:0;pointer-events:none;background:var(--surface-2);border:1px solid var(--line-strong);border-radius:8px;padding:6px 10px;font-size:.8rem;white-space:nowrap}
.tooltip .row{display:flex;align-items:center;gap:6px}.tooltip strong{font-variant-numeric:tabular-nums}.tooltip .k{width:12px;height:2px;border-radius:1px}
.legend{display:flex;flex-wrap:wrap;gap:6px 16px;list-style:none;padding:0;margin:0 0 8px;font-size:.85rem;color:var(--muted)}
.legend li{display:flex;align-items:center;gap:6px}.key{display:inline-block;background:var(--key)}.key.line{width:14px;height:2px;border-radius:1px}.key.rect{width:10px;height:10px;border-radius:3px}
.segmented{display:flex;gap:2px;height:28px;margin:6px 0 10px}.segment{background:var(--fill);border-radius:4px;display:flex;align-items:center;min-width:2px;padding-left:6px;overflow:visible}
.segment b{color:var(--on-fill);font-size:.8rem;font-weight:600}.segment b.on-light{color:var(--on-light)}
table{width:100%;border-collapse:collapse;margin:8px 0 16px;font-size:.9rem}caption{text-align:left;font-weight:600;padding-bottom:6px}
th,td{text-align:left;padding:6px 8px;border-bottom:1px solid var(--line);vertical-align:top}th{color:var(--muted);font-weight:500}td{font-variant-numeric:tabular-nums}
.bar-cell{position:relative;min-width:140px}.bar{display:block;height:8px;width:var(--w);background:var(--series-1);border-radius:0 4px 4px 0;margin:6px 0 2px}.bar-value{font-weight:600}
.table-view summary{cursor:pointer;color:var(--muted);font-size:.85rem}
.notice{background:var(--surface-2);border-radius:12px;padding:10px 14px}.notice.error{border:1px solid var(--critical)}
.pill{display:inline-flex;gap:4px;align-items:center;border:1px solid var(--line);border-radius:999px;padding:1px 10px;font-size:.85rem;margin:2px}
.pill.good{border-color:var(--good)}.pill.good span{color:var(--good)}.pill.critical{border-color:var(--critical)}.pill.critical span{color:var(--critical)}
.empty{color:var(--muted)}.list{line-height:1.9}
dl{margin:0}dt{font-weight:600;margin-top:12px}dd{margin:2px 0 0;color:var(--muted)}
@media (max-width:640px){section{padding:16px}.tile-value{font-size:1.4rem}}
@media print{section{break-inside:avoid}}`;

// Hover readout for line charts; reads its numbers from the chart's own data attribute and
// writes only text nodes. The report is complete without it.
const SCRIPT = `
for (const plot of document.querySelectorAll("[data-line-chart]")) {
  const data = JSON.parse(plot.dataset.lineChart);
  const svg = plot.querySelector("svg");
  const tip = plot.querySelector(".tooltip");
  const ns = "http://www.w3.org/2000/svg";
  const line = document.createElementNS(ns, "line");
  line.setAttribute("class", "crosshair");
  line.setAttribute("y1", "14"); line.setAttribute("y2", String(svg.viewBox.baseVal.height - 26));
  line.style.display = "none";
  svg.appendChild(line);
  const show = (event) => {
    const box = svg.getBoundingClientRect();
    const x = ((event.clientX - box.left) / box.width) * data.width;
    const span = data.right - data.left;
    const index = Math.max(0, Math.min(data.days.length - 1, Math.round(((x - data.left) / span) * (data.days.length - 1))));
    const px = data.days.length <= 1 ? data.left + span / 2 : data.left + (index / (data.days.length - 1)) * span;
    line.setAttribute("x1", String(px)); line.setAttribute("x2", String(px)); line.style.display = "";
    tip.replaceChildren();
    const day = document.createElement("div"); day.textContent = data.days[index]; tip.appendChild(day);
    for (const series of data.series) {
      const row = document.createElement("div"); row.className = "row";
      const key = document.createElement("span"); key.className = "k"; key.style.background = series.color;
      const value = document.createElement("strong"); value.textContent = Math.round(series.values[index] ?? 0).toLocaleString("en-GB");
      const name = document.createElement("span"); name.textContent = series.name;
      row.append(key, value, name); tip.appendChild(row);
    }
    tip.hidden = false;
    const left = (px / data.width) * box.width;
    tip.style.left = Math.min(Math.max(0, left + 12), box.width - tip.offsetWidth) + "px";
  };
  svg.addEventListener("pointermove", show);
  svg.addEventListener("pointerleave", () => { tip.hidden = true; line.style.display = "none"; });
}`;

export function renderReport(report) {
  const { traffic, search, site, automation } = report.sections;
  const status = (section) => (section.status === "ok" ? "ok" : section.status === "error" ? "error" : "off");
  const nav = [
    ["traffic", "Traffic", traffic],
    ["filtering", "Filtering", traffic],
    ["search", "Google search", search],
    ["demand", "Review effort", site],
    ["catalog", "Catalog", site],
    ["stability", "Stability", site],
    ["automation", "Automation", automation]
  ]
    .filter(([id, , section]) => id !== "filtering" || section.status === "ok")
    .map(([id, label, section]) => `<li><a href="#${id}"><span class="status ${status(section)}" aria-hidden="true"></span>${esc(label)}</a></li>`)
    .join("");
  return `<!doctype html>
<html lang="en-GB">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; img-src data:; base-uri 'none'; form-action 'none'">
<meta name="referrer" content="no-referrer">
<title>OmaPicks site report</title>
<style>${STYLE}</style>
</head>
<body>
<main>
<header>
<p class="eyebrow">Private report</p>
<h1>OmaPicks site report</h1>
<p class="lede">Last ${esc(report.days)} days · generated ${esc(timeLabel(report.generatedAt))}</p>
<nav aria-label="Sections"><ul>${nav}</ul></nav>
</header>
${trafficSection(traffic, site)}
${filteringSection(traffic)}
${searchSection(search)}
${demandSection({ traffic, search, site })}
${catalogSection(site)}
${stabilitySection(site)}
${automationSection(automation)}
${DEFINITIONS}
</main>
<script>${SCRIPT}</script>
</body>
</html>
`;
}
