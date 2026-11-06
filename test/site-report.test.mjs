import assert from "node:assert/strict";
import test from "node:test";
import { readFile, readdir } from "node:fs/promises";
import { collectTraffic, runSql, summarizeTraffic, trafficQueries } from "../scripts/report/cloudflare.mjs";
import { ReportSectionError, knownPages, parseDays, reportPeriods, TRAFFIC_RETENTION_DAYS } from "../scripts/report/common.mjs";
import { collectAutomation, summarizeRuns } from "../scripts/report/github.mjs";
import { collectSearch, googleAccessToken } from "../scripts/report/google.mjs";
import { parseRecipients } from "../scripts/report/recipients.mjs";
import { escapeHtml, renderReport } from "../scripts/report/render.mjs";
import { summarizeSite } from "../scripts/report/site-data.mjs";
import { buildReport } from "../scripts/site-report.mjs";
import {
  ACCOUNT_ID,
  CLOUDFLARE_TOKEN,
  GOOGLE_ENV,
  GOOGLE_TOKEN,
  HOSTILE_QUERY,
  NOW,
  cloudflareFetch,
  cloudflareRows,
  githubRuns,
  googleFetch,
  searchFixture
} from "./fixtures/site-report.mjs";

const json = async (path) => JSON.parse(await readFile(new URL(`../${path}`, import.meta.url), "utf8"));
const rankings = await json("data/rankings.json");
const pages = knownPages(rankings);
const CLOUDFLARE_ENV = { CLOUDFLARE_ACCOUNT_ID: ACCOUNT_ID, CLOUDFLARE_API_TOKEN: CLOUDFLARE_TOKEN };

async function siteData() {
  const files = (await readdir(new URL("../data/history/", import.meta.url))).filter((name) => name.endsWith(".json"));
  return {
    rankings,
    unclassified: await json("data/unclassified-report.json"),
    availability: await json("data/availability.json"),
    history: await Promise.all(files.map((name) => json(`data/history/${name}`)))
  };
}

async function fullReport() {
  const traffic = await collectTraffic({ env: CLOUDFLARE_ENV, days: 28, now: NOW, pages, fetchImpl: cloudflareFetch(cloudflareRows(28, pages)) });
  const search = await collectSearch({ env: GOOGLE_ENV, days: 28, now: NOW, pages, fetchImpl: googleFetch(searchFixture(28, pages)) });
  const automation = await collectAutomation({
    env: { GITHUB_TOKEN: "ghs_test", GITHUB_REPOSITORY: "BVisagie/omapicks" },
    now: NOW,
    fetchImpl: async (url) => new Response(JSON.stringify(String(url).includes("/actions/runs") ? { workflow_runs: githubRuns() } : { stargazers_count: 6, forks_count: 1, open_issues_count: 2 }))
  });
  return buildReport({ days: 28, now: NOW, data: await siteData(), sections: { traffic, search, automation } });
}

test("report lengths are limited to the offered choices", () => {
  for (const days of [7, 28, 90]) assert.equal(parseDays(String(days)), days);
  for (const value of ["30", "28; DROP", "-1", "1e9", "ninety"]) assert.throws(() => parseDays(value), ReportSectionError);
});

test("traffic periods compare only when Analytics Engine still holds the earlier period", () => {
  const month = reportPeriods(28, NOW, { lagDays: 1, retentionDays: TRAFFIC_RETENTION_DAYS });
  assert.deepEqual(month.current, { start: "2026-10-05", end: "2026-11-01", days: 28 });
  assert.deepEqual(month.previous, { start: "2026-09-07", end: "2026-10-04", days: 28 });
  assert.equal(reportPeriods(90, NOW, { lagDays: 1, retentionDays: TRAFFIC_RETENTION_DAYS }).previous, null);
});

test("traffic queries are fixed, validated, and never return visitor identifiers", () => {
  const span = { start: "2026-09-07", end: "2026-11-01" };
  const sql = trafficQueries({ span, current: { start: "2026-10-05", end: "2026-11-01" } });
  // Analytics Engine answers HTTP 422 to a subquery inside a subquery.
  for (const query of Object.values(sql)) assert.ok((query.match(/\(\s*SELECT\b/gi) ?? []).length <= 1, query);
  assert.match(sql.crawlerLike, /^SELECT day, sum\(minute_views\) AS views, /);
  // A sampled row carries a weight such as 32; only observed events may trip the thresholds.
  assert.match(sql.crawlerLike, /count\(\) AS minute_events/);
  assert.match(sql.crawlerLike, /HAVING events >= 30 OR peak_pages >= 10/);
  assert.doesNotMatch(sql.crawlerLike, /HAVING views/);
  // Distinct counts of identifiers are fine; returning an identifier column is not.
  for (const query of Object.values(sql)) assert.doesNotMatch(query.split("\n")[0].replaceAll("count(DISTINCT blob2)", ""), /blob2|AS visitor\b/);
  assert.throws(() => trafficQueries({ span: { start: "2026-09-07' OR '1'='1", end: span.end }, current: span }), ReportSectionError);
  assert.throws(() => trafficQueries({ span, current: span, dataset: "pages; DROP" }), ReportSectionError);
});

test("Cloudflare failures report the status and error code but never the body or credentials", async () => {
  const fetchImpl = async () => new Response(JSON.stringify({ errors: [{ code: 10000, message: `Authentication error for ${ACCOUNT_ID} using ${CLOUDFLARE_TOKEN}` }] }), { status: 403 });
  const result = await collectTraffic({ env: CLOUDFLARE_ENV, days: 28, now: NOW, pages, fetchImpl });
  assert.deepEqual(result, { status: "error", error: "Cloudflare SQL API returned HTTP 403 (Cloudflare error 10000)." });
  await assert.rejects(runSql({ accountId: ACCOUNT_ID, token: CLOUDFLARE_TOKEN, sql: "SELECT 1", fetchImpl: async () => new Response("<html>oops</html>", { status: 200 }) }), /not JSON/);
  const badId = await collectTraffic({ env: { ...CLOUDFLARE_ENV, CLOUDFLARE_ACCOUNT_ID: "not-an-id-but-maybe-a-secret" }, days: 28, pages });
  assert.equal(badId.status, "error");
  assert.ok(!badId.error.includes("not-an-id"));
  assert.deepEqual(await collectTraffic({ env: {}, days: 28, pages }), { status: "not-configured" });
});

test("traffic totals remove crawler-like visitor-days and keep unknown pages anonymous", async () => {
  const calls = [];
  const rows = cloudflareRows(28, pages);
  const traffic = await collectTraffic({ env: CLOUDFLARE_ENV, days: 28, now: NOW, pages, fetchImpl: cloudflareFetch(rows, calls) });
  assert.equal(calls.length, 3);
  assert.ok(calls.every((call) => call.init.headers.authorization === `Bearer ${CLOUDFLARE_TOKEN}`));
  assert.equal(traffic.status, "ok");
  const peopleViews = rows.daily.filter((row) => row.day >= traffic.current.start && (row.class === "human" || row.class === "")).reduce((sum, row) => sum + row.views, 0);
  assert.equal(traffic.current.crawlerLikeViews, 31 + 11 + 7);
  assert.equal(traffic.current.crawlerLikeVisitorDays, 3);
  assert.equal(traffic.current.views, peopleViews - 49);
  assert.ok(traffic.current.legacyViews > 0);
  assert.equal(traffic.filterLiveSince, "2026-10-08");
  assert.ok(traffic.current.removedShare > 0 && traffic.current.removedShare < 1);
  const paths = traffic.pages.map((entry) => entry.path);
  assert.ok(paths.includes("other"));
  assert.ok(!paths.some((path) => path.includes("script") || path.includes("not-a-real")));
  assert.equal(traffic.pages.find((entry) => entry.path === "/").filtered, 120);
  assert.equal(traffic.zeroViewCategories.length, rankings.types.length - 20);
  assert.equal(traffic.weekdays.length, 7);
});

test("summaries rebuild every field instead of passing API rows through", () => {
  const rows = cloudflareRows(7, pages);
  const span = { start: rows.periods.previous.start, end: rows.periods.current.end };
  const traffic = summarizeTraffic({
    periods: rows.periods,
    span,
    pages,
    dailyRows: rows.daily.map((row) => ({ ...row, injected: "secret-field" })),
    pageRows: rows.pageRows.map((row) => ({ ...row, injected: "secret-field" })),
    crawlerRows: rows.crawlerRows
  });
  assert.ok(!JSON.stringify(traffic).includes("secret-field"));
});

test("the filter go-live marker appears only while the window still holds pre-filter rows", () => {
  const rows = cloudflareRows(7, pages);
  const span = { start: rows.periods.previous.start, end: rows.periods.current.end };
  const summary = (dailyRows) => summarizeTraffic({ periods: rows.periods, span, pages, dailyRows, pageRows: [], crawlerRows: [] });
  assert.equal(summary(rows.daily.map((row) => ({ ...row, class: row.class || "human" }))).filterLiveSince, null);
  assert.equal(summary(rows.daily).filterLiveSince, rows.daily.find((row) => row.class !== "").day);
});

test("Google access uses GitHub's identity, a read-only scope and a ten-minute token", async () => {
  const calls = [];
  const token = await googleAccessToken({ env: GOOGLE_ENV, fetchImpl: googleFetch(searchFixture(28, pages), calls) });
  assert.equal(token, GOOGLE_TOKEN);
  const provider = GOOGLE_ENV.GOOGLE_WORKLOAD_IDENTITY_PROVIDER;
  assert.equal(new URL(calls[0].url).searchParams.get("audience"), `https://iam.googleapis.com/${provider}`);
  assert.equal(calls[0].init.headers.authorization, `Bearer ${GOOGLE_ENV.ACTIONS_ID_TOKEN_REQUEST_TOKEN}`);
  assert.equal(calls[1].body.audience, `//iam.googleapis.com/${provider}`);
  assert.equal(calls[1].body.subjectToken, "github-oidc-jwt");
  assert.deepEqual(calls[2].body, { scope: ["https://www.googleapis.com/auth/webmasters.readonly"], lifetime: "600s" });
  assert.match(calls[2].url, /serviceAccounts\/omapicks-report%40omapicks-report\.iam\.gserviceaccount\.com:generateAccessToken$/);
});

test("Search Console is skipped outside the workflow and validates its settings", async () => {
  const { ACTIONS_ID_TOKEN_REQUEST_URL, ACTIONS_ID_TOKEN_REQUEST_TOKEN, ...local } = GOOGLE_ENV;
  assert.equal((await collectSearch({ env: local, days: 28, pages })).status, "not-configured");
  assert.equal((await collectSearch({ env: {}, days: 28, pages })).status, "not-configured");
  const bad = await collectSearch({ env: { ...GOOGLE_ENV, GOOGLE_SEARCH_CONSOLE_PROPERTY: "javascript:alert(1)" }, days: 28, pages });
  assert.equal(bad.status, "error");
  const denied = await collectSearch({
    env: GOOGLE_ENV,
    days: 28,
    pages,
    fetchImpl: async () => new Response(JSON.stringify({ error: { status: "PERMISSION_DENIED", message: `token ${GOOGLE_TOKEN}` } }), { status: 403 })
  });
  assert.deepEqual(denied, { status: "error", error: "GitHub OIDC returned HTTP 403 PERMISSION_DENIED." });
});

test("search results are summarized with only known pages, bounded text and allowlisted values", async () => {
  const search = await collectSearch({ env: GOOGLE_ENV, days: 28, now: NOW, pages, fetchImpl: googleFetch(searchFixture(28, pages)) });
  assert.equal(search.status, "ok");
  assert.equal(search.current.end, "2026-10-30");
  assert.ok(search.previous.clicks > 0);
  assert.ok(search.pages.some((entry) => entry.path === "other"));
  assert.ok(!JSON.stringify(search).includes("evil.example"));
  assert.deepEqual(search.devices.map((entry) => entry.device), ["DESKTOP", "MOBILE", "TABLET"]);
  assert.deepEqual(search.countries.map((entry) => entry.country), ["usa", "deu"]);
  assert.equal(search.indexing.pages.length, pages.size);
  assert.equal(search.indexing.pages.find((entry) => entry.path === "/changelog/").verdict, "UNAVAILABLE");
  assert.equal(search.indexing.pages.find((entry) => entry.path === "/feed/").verdict, "NEUTRAL");
  assert.deepEqual(search.quickWins.withoutCategory.map((entry) => entry.query), ["omarchy plugins", "omarchy pomodoro"]);
  assert.ok(search.quickWins.lowClickPages.length >= 1);
  assert.ok(search.quickWins.nearFirstPage.some((entry) => entry.query === "omarchy weather widget"));
  assert.equal(search.sitemaps[0].path, "/sitemap.xml");
});

test("workflow history is summarized per workflow", () => {
  const summary = summarizeRuns(githubRuns(), { stars: 6 });
  const availability = summary.workflows.find((entry) => entry.name === "Update availability");
  assert.equal(availability.runs, 3);
  assert.equal(availability.failed, 1);
  assert.equal(availability.lastConclusion, "success");
  assert.equal(Math.round(availability.successRate * 100), 67);
  assert.equal(availability.medianSeconds, 180);
  assert.equal(summary.workflows.find((entry) => entry.name === "Site report").lastConclusion, "in_progress");
});

test("committed site data yields a consistent funnel and history", async () => {
  const site = summarizeSite({ ...(await siteData()), now: NOW });
  assert.equal(site.categories.total, rankings.types.length);
  assert.ok(site.funnel.catalog >= site.funnel.classified);
  assert.ok(site.stability.weeks.length >= 1);
  assert.deepEqual(site.publications, [...site.publications].sort());
  assert.ok(site.stability.longestHeld.every((entry) => entry.weeks >= 1));
});

test("only native age public keys are accepted as report recipients", () => {
  const key = "age1ql3z7hjy54pw3hyww5ayyfg7zqgvc7w3j2elw8zmrj2kg5sfn9aqmcac8p";
  assert.deepEqual(parseRecipients(`# comment\n\n${key}\n`), { recipients: [key], problems: [] });
  assert.deepEqual(parseRecipients("# nothing here\n").problems, ["no public key is listed"]);
  assert.match(parseRecipients(`${key}\n${key}\n`).problems[0], /repeats/);
  for (const bad of ["ssh-ed25519 AAAAC3Nza", "age1yubikey1qwerty", "AGE-SECRET-KEY-1QQQ", `${key}x`, "age1tag1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq"]) {
    assert.equal(parseRecipients(bad).recipients.length, 0, bad);
  }
});

test("the rendered report is self-contained, escaped, and free of identifiers and credentials", async () => {
  const report = await fullReport();
  assert.deepEqual(Object.fromEntries(Object.entries(report.sections).map(([name, section]) => [name, section.status])), {
    traffic: "ok",
    search: "ok",
    site: "ok",
    automation: "ok"
  });
  const html = renderReport(report);
  const data = JSON.stringify(report);
  for (const output of [html, data]) {
    for (const secret of [ACCOUNT_ID, CLOUDFLARE_TOKEN, GOOGLE_TOKEN, GOOGLE_ENV.ACTIONS_ID_TOKEN_REQUEST_TOKEN, "ghs_test", "federated-token", "github-oidc-jwt"]) {
      assert.ok(!output.includes(secret), secret);
    }
    assert.doesNotMatch(output, /\b[0-9a-f]{32}\b/);
  }
  assert.ok(html.includes(escapeHtml(HOSTILE_QUERY)));
  assert.ok(!html.includes(HOSTILE_QUERY));
  assert.doesNotMatch(html, /<(img|link|iframe|object|embed)\b/i);
  assert.doesNotMatch(html, /<[^>]+\s(src|onerror|onload|onclick)=/i);
  assert.doesNotMatch(html, /url\(|@import/i);
  assert.match(html, /<meta http-equiv="Content-Security-Policy" content="default-src 'none';/);
  const external = [...html.matchAll(/\b(?:href|action)="([^"]*)"/g)].map((match) => match[1]).filter((value) => !value.startsWith("#"));
  assert.deepEqual(external, []);
  for (const id of ["traffic", "filtering", "search", "demand", "catalog", "stability", "automation", "definitions"]) assert.match(html, new RegExp(`<section id="${id}">`));
});

test("missing or failed sections render as notices without breaking the report", async () => {
  const report = await buildReport({
    days: 7,
    now: NOW,
    data: await siteData(),
    sections: { traffic: { status: "not-configured" }, search: { status: "error", error: "Search Console returned HTTP 403." }, automation: { status: "not-collected" } }
  });
  const html = renderReport(report);
  assert.match(html, /Cloudflare traffic is not configured yet/);
  assert.match(html, /Search Console failed: Search Console returned HTTP 403\./);
  assert.doesNotMatch(html, /<section id="filtering">/);
});

test("the report workflow keeps secrets in their own steps and pins every action", async () => {
  const workflow = await readFile(new URL("../.github/workflows/site-report.yml", import.meta.url), "utf8");
  assert.match(workflow, /^on:\n {2}workflow_dispatch:\n/m);
  assert.doesNotMatch(workflow, /pull_request|workflow_run|issue_comment|schedule:/);
  assert.match(workflow, /^permissions: \{\}$/m);
  assert.match(workflow, /environment: site-report/);
  for (const line of workflow.split("\n").filter((entry) => entry.trim().startsWith("uses:") || entry.trim().startsWith("- uses:"))) {
    assert.match(line, /uses: actions\/[a-z-]+@[0-9a-f]{40} # v/, line);
  }
  const steps = workflow.split(/\n {6}- /);
  for (const secret of ["CLOUDFLARE_API_TOKEN", "CLOUDFLARE_ACCOUNT_ID"]) {
    assert.deepEqual(steps.filter((step) => step.includes(`secrets.${secret}`)).map((step) => step.split("\n")[0]), ["name: Collect Cloudflare traffic"]);
  }
  for (const secret of ["GOOGLE_WORKLOAD_IDENTITY_PROVIDER", "GOOGLE_SERVICE_ACCOUNT", "GOOGLE_SEARCH_CONSOLE_PROPERTY"]) {
    assert.deepEqual(steps.filter((step) => step.includes(`secrets.${secret}`)).map((step) => step.split("\n")[0]), ["name: Collect Google Search Console"]);
  }
  // The only input reaches scripts through an environment variable, never inside a shell line.
  for (const line of workflow.split("\n").filter((entry) => entry.includes("inputs."))) {
    assert.match(line, /^ {10}REPORT_DAYS: \$\{\{ inputs\.days \}\}$/, line);
  }
  assert.match(workflow, /path: tmp\/site-report-encrypted\/site-report\.tar\.age/);
});
