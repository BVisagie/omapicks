// Synthetic API responses for the site report. Deterministic, and shaped like the real
// Cloudflare Analytics Engine, Search Console and GitHub responses.
import { addDays, daysBetween, reportPeriods, TRAFFIC_RETENTION_DAYS, SEARCH_LAG_DAYS } from "../../scripts/report/common.mjs";

export const NOW = new Date("2026-11-02T09:00:00Z");
export const ACCOUNT_ID = "0123456789abcdef0123456789abcdef";
export const CLOUDFLARE_TOKEN = "cf-test-token-value-that-must-never-appear";
export const GOOGLE_TOKEN = "ya29.test-google-token-that-must-never-appear";
export const HOSTILE_QUERY = '<img src=x onerror="alert(1)"> omarchy weather';

function wave(index, base, swing) {
  return Math.round(base + swing * Math.sin(index / 3) + (index % 7 === 0 ? swing : 0));
}

export function cloudflareRows(days = 28, pages) {
  const periods = reportPeriods(days, NOW, { lagDays: 1, retentionDays: TRAFFIC_RETENTION_DAYS });
  const span = daysBetween(periods.previous?.start ?? periods.current.start, periods.current.end);
  const goLive = addDays(periods.current.start, 3);
  const daily = [];
  span.forEach((day, index) => {
    const views = wave(index, 60, 20);
    const visitors = Math.round(views / 2.4);
    daily.push({ day, class: day < goLive ? "" : "human", views, visitors });
    if (day >= goLive) {
      daily.push({ day, class: "crawler-list", views: 10 * (3 + (index % 4)), visitors: 1 });
      daily.push({ day, class: "no-browser-headers", views: 10 * (1 + (index % 3)), visitors: 1 });
      if (index % 5 === 0) daily.push({ day, class: "prefetch", views: 10, visitors: 1 });
      if (index % 2 === 0) daily.push({ day, class: "cloud-network", views: 20, visitors: 1 });
    }
  });
  const categoryPaths = [...pages.values()].filter((page) => page.kind === "category").map((page) => page.path);
  const pageRows = [
    { path: "/", class: "human", views: 400, visitors: 260 },
    { path: "/", class: "crawler-list", views: 120, visitors: 1 },
    { path: "/methodology/", class: "human", views: 90, visitors: 70 },
    { path: "/picks/not-a-real-category/", class: "human", views: 7, visitors: 5 },
    { path: "/<script>alert(1)</script>/", class: "human", views: 3, visitors: 3 },
    ...categoryPaths.slice(0, 20).map((path, index) => ({ path, class: index % 2 ? "human" : "", views: 120 - index * 5, visitors: 80 - index * 3 }))
  ];
  const crawlerRows = [
    { day: addDays(periods.current.end, -2), views: 31 },
    { day: addDays(periods.current.end, -9), views: 11 },
    { day: addDays(periods.current.end, -9), views: 7 }
  ];
  return { periods, daily, pageRows, crawlerRows };
}

// Routes Analytics Engine SQL by the query's shape; records every request for assertions.
export function cloudflareFetch(rows, calls = []) {
  return async (url, init) => {
    calls.push({ url: String(url), init });
    const sql = String(init.body);
    const data = sql.includes("AS peak_pages") ? rows.crawlerRows : sql.includes("blob1 AS path") ? rows.pageRows : rows.daily;
    return new Response(JSON.stringify({ meta: [], data, rows: data.length }), { status: 200, headers: { "content-type": "application/json" } });
  };
}

export function searchFixture(days = 28, pages) {
  const periods = reportPeriods(days, NOW, { lagDays: SEARCH_LAG_DAYS });
  const daily = daysBetween(periods.previous.start, periods.current.end).map((day, index) => ({ keys: [day], clicks: wave(index, 14, 6), impressions: wave(index, 420, 120), ctr: 0.03, position: 9 + (index % 5) }));
  const categories = [...pages.values()].filter((page) => page.kind === "category");
  return {
    daily,
    queries: [
      { keys: ["omarchy plugins"], clicks: 120, impressions: 2400, ctr: 0.05, position: 3.2 },
      { keys: [HOSTILE_QUERY], clicks: 4, impressions: 90, ctr: 0.044, position: 7.5 },
      { keys: ["omarchy weather widget"], clicks: 9, impressions: 300, ctr: 0.03, position: 11.4 },
      { keys: ["omarchy pomodoro"], clicks: 1, impressions: 80, ctr: 0.0125, position: 16 }
    ],
    pages: [
      { keys: ["https://omapicks.com/"], clicks: 150, impressions: 4000, ctr: 0.0375, position: 6 },
      ...categories.slice(0, 8).map((page, index) => ({ keys: [`https://omapicks.com${page.path}`], clicks: 30 - index * 3, impressions: 600 - index * 40, ctr: 0.04, position: 8 + index })),
      { keys: [`https://omapicks.com${categories[9].path}`], clicks: 1, impressions: 400, ctr: 0.0025, position: 14 },
      { keys: ["https://evil.example/phish"], clicks: 2, impressions: 10, ctr: 0.2, position: 1 }
    ],
    queryPages: [
      { keys: ["omarchy plugins", "https://omapicks.com/"], clicks: 120, impressions: 2400 },
      { keys: ["omarchy pomodoro", "https://omapicks.com/"], clicks: 1, impressions: 80 },
      { keys: ["omarchy weather widget", `https://omapicks.com${categories[0].path}`], clicks: 9, impressions: 300 }
    ],
    devices: [
      { keys: ["DESKTOP"], clicks: 140, impressions: 3000 },
      { keys: ["MOBILE"], clicks: 30, impressions: 1100 },
      { keys: ["TABLET"], clicks: 2, impressions: 60 },
      { keys: ["<b>FRIDGE</b>"], clicks: 1, impressions: 1 }
    ],
    countries: [
      { keys: ["usa"], clicks: 60, impressions: 1500 },
      { keys: ["deu"], clicks: 30, impressions: 800 },
      { keys: ["<x>"], clicks: 1, impressions: 1 }
    ],
    sitemaps: [{ path: "https://omapicks.com/sitemap.xml", lastDownloaded: "2026-10-31T04:12:00Z", isPending: false, errors: "0", warnings: "1", contents: [{ type: "web", submitted: "81" }] }],
    inspection: (path) =>
      path === "/feed/"
        ? { verdict: "NEUTRAL", coverageState: "Excluded by ‘noindex’ tag", lastCrawlTime: "2026-10-20T01:00:00Z", googleCanonical: "https://omapicks.com/feed/", userCanonical: "https://omapicks.com/feed/" }
        : path.startsWith("/picks/lock")
          ? { verdict: "FAIL", coverageState: "Crawled - currently not indexed", lastCrawlTime: "2026-10-28T01:00:00Z", googleCanonical: "https://omapicks.com/", userCanonical: `https://omapicks.com${path}` }
          : { verdict: "PASS", coverageState: "Submitted and indexed", lastCrawlTime: "2026-10-30T01:00:00Z" }
  };
}

export const GOOGLE_ENV = {
  GOOGLE_WORKLOAD_IDENTITY_PROVIDER: "projects/123456789012/locations/global/workloadIdentityPools/github-actions/providers/omapicks-report",
  GOOGLE_SERVICE_ACCOUNT: "omapicks-report@omapicks-report.iam.gserviceaccount.com",
  GOOGLE_SEARCH_CONSOLE_PROPERTY: "sc-domain:omapicks.com",
  ACTIONS_ID_TOKEN_REQUEST_URL: "https://pipelines.actions.githubusercontent.com/oidc/token?api-version=2.0",
  ACTIONS_ID_TOKEN_REQUEST_TOKEN: "github-request-token-that-must-never-appear"
};

export function googleFetch(fixture, calls = []) {
  const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  return async (url, init = {}) => {
    const target = String(url);
    const body = init.body ? JSON.parse(init.body) : null;
    calls.push({ url: target, init, body });
    if (target.startsWith("https://pipelines.actions.githubusercontent.com/")) return json({ value: "github-oidc-jwt" });
    if (target === "https://sts.googleapis.com/v1/token") return json({ access_token: "federated-token", token_type: "Bearer" });
    if (target.startsWith("https://iamcredentials.googleapis.com/")) return json({ accessToken: GOOGLE_TOKEN, expireTime: "2026-11-02T09:10:00Z" });
    if (target.endsWith("/searchAnalytics/query")) {
      const dimensions = body.dimensions.join(",");
      const rows = { date: fixture.daily, query: fixture.queries, page: fixture.pages, "query,page": fixture.queryPages, device: fixture.devices, country: fixture.countries }[dimensions];
      return json({ rows });
    }
    if (target.endsWith("/sitemaps")) return json({ sitemap: fixture.sitemaps });
    if (target.endsWith("/v1/urlInspection/index:inspect")) {
      const path = new URL(body.inspectionUrl).pathname;
      if (path === "/changelog/") return json({ error: { status: "RESOURCE_EXHAUSTED", message: "Quota exceeded for " + GOOGLE_TOKEN } }, 429);
      return json({ inspectionResult: { indexStatusResult: fixture.inspection(path) } });
    }
    return json({ error: { status: "NOT_FOUND" } }, 404);
  };
}

export function githubRuns() {
  const run = (name, conclusion, day, minutes = 3) => ({
    name,
    status: "completed",
    conclusion,
    created_at: `2026-${day}T07:47:00Z`,
    run_started_at: `2026-${day}T07:47:10Z`,
    updated_at: `2026-${day}T07:${String(47 + minutes).padStart(2, "0")}:10Z`
  });
  return [
    run("Update availability", "success", "11-01"),
    run("Update availability", "success", "10-31"),
    run("Update availability", "failure", "10-30"),
    run("Publish recommendations", "success", "10-26", 6),
    run("CI", "success", "10-30", 4),
    { name: "Site report", status: "in_progress", conclusion: null, created_at: "2026-11-02T08:59:00Z" }
  ];
}
