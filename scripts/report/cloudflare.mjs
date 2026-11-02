import {
  ReportSectionError,
  TRAFFIC_RETENTION_DAYS,
  change,
  daysBetween,
  finite,
  isDay,
  ratio,
  reportPeriods,
  sanitizePath,
  sectionError,
  weekday
} from "./common.mjs";

export const DATASET = "omapicks_pages";
export const FILTER_REASONS = Object.freeze(["crawler-list", "no-browser-headers", "prefetch", "cloud-network"]);
// A visitor-day this busy is treated as a crawler that imitates a browser.
export const CRAWLER_DAILY_VIEWS = 30;
export const CRAWLER_PAGES_PER_MINUTE = 10;
const ACCOUNT_ID = /^[0-9a-f]{32}$/;
const DATASET_NAME = /^[A-Za-z0-9_]+$/;
// Version 1 rows carry no class; they were filtered by the original keyword list.
const PEOPLE = "(blob3 = 'human' OR blob3 = '')";

function dayWindow(start, end) {
  if (!isDay(start) || !isDay(end)) throw new ReportSectionError("Report dates are invalid.");
  return `index1 >= '${start}' AND index1 <= '${end}'`;
}

export function trafficQueries({ span, current, dataset = DATASET }) {
  if (!DATASET_NAME.test(dataset)) throw new ReportSectionError("The traffic dataset name is invalid.");
  const all = dayWindow(span.start, span.end);
  const recent = dayWindow(current.start, current.end);
  return {
    daily: `SELECT index1 AS day, blob3 AS class, sum(_sample_interval * double1) AS views, count(DISTINCT blob2) AS visitors
FROM ${dataset}
WHERE ${all}
GROUP BY day, class
ORDER BY day`,
    pages: `SELECT blob1 AS path, blob3 AS class, sum(_sample_interval * double1) AS views, count(DISTINCT blob2) AS visitors
FROM ${dataset}
WHERE ${recent}
GROUP BY path, class`,
    // Visitor identifiers stay inside Cloudflare: only per-day counts come back. Thresholds
    // count observed events, because a sampling weight is not evidence of a busy visitor;
    // the weighted views are what the totals subtract.
    crawlerLike: `SELECT day, count() AS visitor_days, sum(views) AS views
FROM (
  SELECT day, visitor, sum(minute_views) AS views, sum(minute_events) AS events, max(minute_pages) AS peak_pages
  FROM (
    SELECT index1 AS day, blob2 AS visitor, toStartOfInterval(timestamp, INTERVAL '1' MINUTE) AS minute,
      sum(_sample_interval * double1) AS minute_views, count() AS minute_events, count(DISTINCT blob1) AS minute_pages
    FROM ${dataset}
    WHERE ${all} AND ${PEOPLE}
    GROUP BY day, visitor, minute
  )
  GROUP BY day, visitor
  HAVING events >= ${CRAWLER_DAILY_VIEWS} OR peak_pages >= ${CRAWLER_PAGES_PER_MINUTE}
)
GROUP BY day
ORDER BY day`
  };
}

function errorCodes(text) {
  try {
    const codes = (JSON.parse(text).errors ?? []).map((entry) => Number(entry?.code)).filter(Number.isInteger);
    return codes.length ? ` (Cloudflare error ${codes.slice(0, 5).join(", ")})` : "";
  } catch {
    return "";
  }
}

export async function runSql({ accountId, token, sql, fetchImpl = fetch }) {
  const response = await fetchImpl(`https://api.cloudflare.com/client/v4/accounts/${accountId}/analytics_engine/sql`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "text/plain" },
    body: sql
  });
  const text = await response.text();
  if (!response.ok) throw new ReportSectionError(`Cloudflare SQL API returned HTTP ${response.status}${errorCodes(text)}.`);
  let payload;
  try {
    payload = JSON.parse(text);
  } catch {
    throw new ReportSectionError("Cloudflare SQL API returned a response that is not JSON.");
  }
  if (!Array.isArray(payload?.data)) throw new ReportSectionError("Cloudflare SQL API returned no data rows.");
  return payload.data;
}

function peopleClass(value) {
  return value === "human" || value === "";
}

export function summarizeTraffic({ periods, span, pages, dailyRows, pageRows, crawlerRows }) {
  const byDay = new Map(
    daysBetween(span.start, span.end).map((day) => [
      day,
      { day, people: 0, legacy: 0, visitors: 0, filtered: Object.fromEntries(FILTER_REASONS.map((reason) => [reason, 0])), crawlerLikeViews: 0, crawlerLikeVisitorDays: 0 }
    ])
  );
  let firstClassified = null;
  let hasLegacy = false;
  for (const row of dailyRows) {
    const entry = byDay.get(row.day);
    if (!entry) continue;
    const views = finite(row.views);
    if (peopleClass(row.class)) {
      entry.people += views;
      if (row.class === "") entry.legacy += views;
      entry.visitors += finite(row.visitors);
    } else if (FILTER_REASONS.includes(row.class)) {
      entry.filtered[row.class] += views;
    }
    if (row.class === "") hasLegacy = true;
    else if (firstClassified === null || row.day < firstClassified) firstClassified = row.day;
  }
  for (const row of crawlerRows) {
    const entry = byDay.get(row.day);
    if (!entry) continue;
    entry.crawlerLikeViews = Math.min(entry.people, finite(row.views));
    entry.crawlerLikeVisitorDays = Math.min(entry.visitors, finite(row.visitor_days));
  }
  const daily = [...byDay.values()].map((entry) => ({
    ...entry,
    views: entry.people - entry.crawlerLikeViews,
    visitorDays: entry.visitors - entry.crawlerLikeVisitorDays,
    filteredTotal: FILTER_REASONS.reduce((sum, reason) => sum + entry.filtered[reason], 0)
  }));

  const total = (period) => {
    if (!period) return null;
    const days = daily.filter((entry) => entry.day >= period.start && entry.day <= period.end);
    const sum = (key) => days.reduce((acc, entry) => acc + entry[key], 0);
    const filtered = Object.fromEntries(FILTER_REASONS.map((reason) => [reason, days.reduce((acc, entry) => acc + entry.filtered[reason], 0)]));
    const filteredTotal = sum("filteredTotal");
    const crawlerLikeViews = sum("crawlerLikeViews");
    const views = sum("views");
    const visitorDays = sum("visitorDays");
    const requests = sum("people") + filteredTotal;
    return {
      ...period,
      views,
      visitorDays,
      averageDailyVisitors: visitorDays / period.days,
      pagesPerVisitorDay: ratio(views, visitorDays),
      filtered,
      filteredTotal,
      crawlerLikeViews,
      crawlerLikeVisitorDays: sum("crawlerLikeVisitorDays"),
      removedShare: ratio(filteredTotal + crawlerLikeViews, requests),
      legacyViews: sum("legacy")
    };
  };
  const current = total(periods.current);
  const previous = total(periods.previous);

  const weekdays = Array.from({ length: 7 }, () => ({ views: 0, days: 0 }));
  for (const entry of daily.filter((item) => item.day >= periods.current.start)) {
    weekdays[weekday(entry.day)].views += entry.views;
    weekdays[weekday(entry.day)].days += 1;
  }

  const pageTotals = new Map();
  for (const row of pageRows) {
    const path = sanitizePath(row.path, pages);
    const entry = pageTotals.get(path) ?? { path, views: 0, visitorDays: 0, filtered: 0 };
    if (peopleClass(row.class)) {
      entry.views += finite(row.views);
      entry.visitorDays += finite(row.visitors);
    } else if (FILTER_REASONS.includes(row.class)) {
      entry.filtered += finite(row.views);
    }
    pageTotals.set(path, entry);
  }
  const pageList = [...pageTotals.values()]
    .map((entry) => ({ ...entry, name: pages.get(entry.path)?.name ?? "Other pages", kind: pages.get(entry.path)?.kind ?? "other", filteredShare: ratio(entry.filtered, entry.filtered + entry.views) }))
    .sort((a, b) => b.views - a.views || a.path.localeCompare(b.path));
  const viewed = new Set(pageList.filter((entry) => entry.views > 0).map((entry) => entry.path));
  const zeroViewCategories = [...pages.values()]
    .filter((page) => page.kind === "category" && !viewed.has(page.path))
    .map((page) => ({ path: page.path, name: page.name }));

  return {
    status: "ok",
    current,
    previous,
    change: previous
      ? { views: change(current.views, previous.views), visitorDays: change(current.visitorDays, previous.visitorDays), averageDailyVisitors: change(current.averageDailyVisitors, previous.averageDailyVisitors) }
      : null,
    daily,
    weekdays: weekdays.map((entry, index) => ({ weekday: index, averageViews: entry.days ? entry.views / entry.days : 0 })),
    pages: pageList,
    zeroViewCategories,
    // Only a window that still holds pre-filter rows shows when the new filter went live.
    filterLiveSince: hasLegacy ? firstClassified : null,
    thresholds: { dailyViews: CRAWLER_DAILY_VIEWS, pagesPerMinute: CRAWLER_PAGES_PER_MINUTE }
  };
}

export async function collectTraffic({ env = process.env, days, now = new Date(), pages, dataset = DATASET, fetchImpl = fetch }) {
  const accountId = String(env.CLOUDFLARE_ACCOUNT_ID ?? "").trim();
  const token = String(env.CLOUDFLARE_API_TOKEN ?? "").trim();
  if (!accountId || !token) return { status: "not-configured" };
  try {
    if (!ACCOUNT_ID.test(accountId)) throw new ReportSectionError("CLOUDFLARE_ACCOUNT_ID is not a 32-character hexadecimal account ID.");
    const periods = reportPeriods(days, now, { lagDays: 1, retentionDays: TRAFFIC_RETENTION_DAYS });
    const span = { start: periods.previous?.start ?? periods.current.start, end: periods.current.end };
    const sql = trafficQueries({ span, current: periods.current, dataset });
    const [dailyRows, pageRows, crawlerRows] = await Promise.all(
      [sql.daily, sql.pages, sql.crawlerLike].map((query) => runSql({ accountId, token, sql: query, fetchImpl }))
    );
    return summarizeTraffic({ periods, span, pages, dailyRows, pageRows, crawlerRows });
  } catch (error) {
    return sectionError(error, "Cloudflare traffic could not be collected.");
  }
}
