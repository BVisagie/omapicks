import {
  ORIGIN,
  OTHER_PATH,
  ReportSectionError,
  SEARCH_LAG_DAYS,
  boundedText,
  change,
  daysBetween,
  finite,
  isDay,
  pageFromUrl,
  ratio,
  reportPeriods,
  sectionError
} from "./common.mjs";

const PROVIDER = /^projects\/\d+\/locations\/global\/workloadIdentityPools\/[a-z0-9-]{4,32}\/providers\/[a-z0-9-]{4,32}$/;
const SERVICE_ACCOUNT = /^[a-z][a-z0-9-]{4,28}[a-z0-9]@[a-z][a-z0-9-]{4,28}[a-z0-9]\.iam\.gserviceaccount\.com$/;
const PROPERTY = /^(sc-domain:[a-z0-9.-]+|https:\/\/[a-z0-9.-]+\/)$/;
const READ_ONLY_SCOPE = "https://www.googleapis.com/auth/webmasters.readonly";
const TOKEN_LIFETIME = "600s";
const API = "https://searchconsole.googleapis.com";
const DEVICES = new Set(["DESKTOP", "MOBILE", "TABLET"]);
const VERDICTS = new Set(["PASS", "PARTIAL", "FAIL", "NEUTRAL", "VERDICT_UNSPECIFIED"]);
const INSPECTION_CONCURRENCY = 4;

async function googleError(response, service) {
  let status = "";
  try {
    const value = (await response.json())?.error?.status;
    if (typeof value === "string" && /^[A-Z_]{3,40}$/.test(value)) status = ` ${value}`;
  } catch {
    // The body is never echoed.
  }
  return new ReportSectionError(`${service} returned HTTP ${response.status}${status}.`);
}

async function jsonRequest(fetchImpl, url, init, service) {
  const response = await fetchImpl(url, init);
  if (!response.ok) throw await googleError(response, service);
  try {
    return await response.json();
  } catch {
    throw new ReportSectionError(`${service} returned a response that is not JSON.`);
  }
}

// GitHub's short-lived OIDC token is exchanged for a ten-minute, read-only Google token. No
// Google credential is stored anywhere.
export async function googleAccessToken({ env, fetchImpl = fetch }) {
  const provider = env.GOOGLE_WORKLOAD_IDENTITY_PROVIDER;
  const serviceAccount = env.GOOGLE_SERVICE_ACCOUNT;
  const oidcUrl = new URL(env.ACTIONS_ID_TOKEN_REQUEST_URL);
  oidcUrl.searchParams.set("audience", `https://iam.googleapis.com/${provider}`);
  const oidc = await jsonRequest(fetchImpl, oidcUrl, { headers: { authorization: `Bearer ${env.ACTIONS_ID_TOKEN_REQUEST_TOKEN}` } }, "GitHub OIDC");
  if (typeof oidc?.value !== "string") throw new ReportSectionError("GitHub OIDC returned no token.");
  const federated = await jsonRequest(
    fetchImpl,
    "https://sts.googleapis.com/v1/token",
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        grantType: "urn:ietf:params:oauth:grant-type:token-exchange",
        audience: `//iam.googleapis.com/${provider}`,
        scope: "https://www.googleapis.com/auth/cloud-platform",
        requestedTokenType: "urn:ietf:params:oauth:token-type:access_token",
        subjectTokenType: "urn:ietf:params:oauth:token-type:jwt",
        subjectToken: oidc.value
      })
    },
    "Google Security Token Service"
  );
  if (typeof federated?.access_token !== "string") throw new ReportSectionError("Google Security Token Service returned no token.");
  const impersonated = await jsonRequest(
    fetchImpl,
    `https://iamcredentials.googleapis.com/v1/projects/-/serviceAccounts/${encodeURIComponent(serviceAccount)}:generateAccessToken`,
    {
      method: "POST",
      headers: { authorization: `Bearer ${federated.access_token}`, "content-type": "application/json" },
      body: JSON.stringify({ scope: [READ_ONLY_SCOPE], lifetime: TOKEN_LIFETIME })
    },
    "Google IAM Credentials"
  );
  if (typeof impersonated?.accessToken !== "string") throw new ReportSectionError("Google IAM Credentials returned no token.");
  return impersonated.accessToken;
}

function searchClient({ token, property, fetchImpl }) {
  const site = `${API}/webmasters/v3/sites/${encodeURIComponent(property)}`;
  const headers = { authorization: `Bearer ${token}`, "content-type": "application/json" };
  return {
    query: async (body) =>
      (await jsonRequest(fetchImpl, `${site}/searchAnalytics/query`, { method: "POST", headers, body: JSON.stringify({ type: "web", ...body }) }, "Search Console"))?.rows ?? [],
    sitemaps: async () => (await jsonRequest(fetchImpl, `${site}/sitemaps`, { headers }, "Search Console"))?.sitemap ?? [],
    inspect: async (path) =>
      (await jsonRequest(
        fetchImpl,
        `${API}/v1/urlInspection/index:inspect`,
        { method: "POST", headers, body: JSON.stringify({ inspectionUrl: `${ORIGIN}${path}`, siteUrl: property }) },
        "URL Inspection"
      ))?.inspectionResult?.indexStatusResult ?? {}
  };
}

function metrics(row) {
  const clicks = finite(row?.clicks);
  const impressions = finite(row?.impressions);
  return { clicks, impressions, ctr: ratio(clicks, impressions), position: Number.isFinite(Number(row?.position)) ? Number(row.position) : null };
}

function weightedTotals(rows) {
  const clicks = rows.reduce((sum, row) => sum + row.clicks, 0);
  const impressions = rows.reduce((sum, row) => sum + row.impressions, 0);
  const weighted = rows.reduce((sum, row) => sum + (row.position ?? 0) * row.impressions, 0);
  return { clicks, impressions, ctr: ratio(clicks, impressions), position: ratio(weighted, impressions) };
}

function crawlTime(value) {
  return typeof value === "string" && !Number.isNaN(Date.parse(value)) ? new Date(value).toISOString() : null;
}

async function inspectAll(client, paths) {
  const results = [];
  let next = 0;
  const worker = async () => {
    while (next < paths.length) {
      const path = paths[next++];
      try {
        const status = await client.inspect(path);
        results.push({
          path,
          verdict: VERDICTS.has(status.verdict) ? status.verdict : "VERDICT_UNSPECIFIED",
          coverageState: boundedText(status.coverageState, 80),
          lastCrawlTime: crawlTime(status.lastCrawlTime),
          canonicalMismatch: Boolean(status.googleCanonical && status.userCanonical && status.googleCanonical !== status.userCanonical)
        });
      } catch {
        results.push({ path, verdict: "UNAVAILABLE", coverageState: "", lastCrawlTime: null, canonicalMismatch: false });
      }
    }
  };
  await Promise.all(Array.from({ length: INSPECTION_CONCURRENCY }, worker));
  return results.sort((a, b) => a.path.localeCompare(b.path));
}

export function summarizeSearch({ periods, pages, dailyRows, queryRows, pageRows, queryPageRows, deviceRows, countryRows, sitemapRows, inspections }) {
  const byDay = new Map(daysBetween(periods.previous.start, periods.current.end).map((day) => [day, { day, clicks: 0, impressions: 0, ctr: null, position: null }]));
  for (const row of dailyRows) {
    const day = row?.keys?.[0];
    if (isDay(day) && byDay.has(day)) byDay.set(day, { day, ...metrics(row) });
  }
  const daily = [...byDay.values()];
  const inPeriod = (period) => daily.filter((entry) => entry.day >= period.start && entry.day <= period.end);
  const current = { ...periods.current, ...weightedTotals(inPeriod(periods.current)) };
  const previous = { ...periods.previous, ...weightedTotals(inPeriod(periods.previous)) };

  const queries = queryRows
    .map((row) => ({ query: boundedText(row?.keys?.[0]), ...metrics(row) }))
    .filter((row) => row.query)
    .sort((a, b) => b.clicks - a.clicks || b.impressions - a.impressions);

  const pageTotals = new Map();
  for (const row of pageRows) {
    const path = pageFromUrl(row?.keys?.[0], pages);
    const entry = pageTotals.get(path) ?? { path, rows: [] };
    entry.rows.push(metrics(row));
    pageTotals.set(path, entry);
  }
  const pageList = [...pageTotals.values()]
    .map((entry) => ({ path: entry.path, name: pages.get(entry.path)?.name ?? "Other pages", kind: pages.get(entry.path)?.kind ?? "other", ...weightedTotals(entry.rows) }))
    .sort((a, b) => b.clicks - a.clicks || b.impressions - a.impressions);

  const landing = new Map();
  for (const row of queryPageRows) {
    const query = boundedText(row?.keys?.[0]);
    if (!query) continue;
    const path = pageFromUrl(row?.keys?.[1], pages);
    const entry = landing.get(query) ?? { query, category: false, ...metrics({}) };
    const value = metrics(row);
    entry.clicks += value.clicks;
    entry.impressions += value.impressions;
    if (pages.get(path)?.kind === "category") entry.category = true;
    landing.set(query, entry);
  }
  const withoutCategory = [...landing.values()]
    .filter((entry) => !entry.category)
    .map(({ query, clicks, impressions }) => ({ query, clicks, impressions }))
    .sort((a, b) => b.impressions - a.impressions)
    .slice(0, 15);

  const lowClickPages = pageList.filter((entry) => entry.path !== OTHER_PATH && entry.impressions >= 50 && (entry.ctr ?? 0) < 0.02).slice(0, 10);
  const nearFirstPage = queries.filter((entry) => entry.impressions >= 10 && entry.position >= 5 && entry.position <= 20).slice(0, 15);

  const verdicts = {};
  for (const entry of inspections) verdicts[entry.verdict] = (verdicts[entry.verdict] ?? 0) + 1;

  return {
    status: "ok",
    current,
    previous,
    change: { clicks: change(current.clicks, previous.clicks), impressions: change(current.impressions, previous.impressions) },
    daily,
    queries: queries.slice(0, 25),
    pages: pageList,
    quickWins: { lowClickPages, nearFirstPage, withoutCategory },
    devices: deviceRows.map((row) => ({ device: row?.keys?.[0], ...metrics(row) })).filter((row) => DEVICES.has(row.device)),
    countries: countryRows
      .map((row) => ({ country: String(row?.keys?.[0] ?? "").toLowerCase(), ...metrics(row) }))
      .filter((row) => /^[a-z]{3}$/.test(row.country))
      .slice(0, 10),
    sitemaps: sitemapRows.map((entry) => ({
      path: pageFromUrl(entry?.path, new Map([["/sitemap.xml", {}]])) === "/sitemap.xml" ? "/sitemap.xml" : OTHER_PATH,
      lastDownloaded: crawlTime(entry?.lastDownloaded),
      isPending: Boolean(entry?.isPending),
      errors: finite(entry?.errors),
      warnings: finite(entry?.warnings),
      submitted: (entry?.contents ?? []).reduce((sum, item) => sum + finite(item?.submitted), 0)
    })),
    indexing: { verdicts, pages: inspections }
  };
}

export async function collectSearch({ env = process.env, days, now = new Date(), pages, fetchImpl = fetch }) {
  const provider = String(env.GOOGLE_WORKLOAD_IDENTITY_PROVIDER ?? "").trim();
  const serviceAccount = String(env.GOOGLE_SERVICE_ACCOUNT ?? "").trim();
  const property = String(env.GOOGLE_SEARCH_CONSOLE_PROPERTY ?? "").trim();
  if (!provider || !serviceAccount || !property) return { status: "not-configured" };
  if (!env.ACTIONS_ID_TOKEN_REQUEST_URL || !env.ACTIONS_ID_TOKEN_REQUEST_TOKEN) {
    return { status: "not-configured", note: "Search Console is read through GitHub's workflow identity, so it is collected only by the Site report workflow." };
  }
  try {
    if (!PROVIDER.test(provider)) throw new ReportSectionError("GOOGLE_WORKLOAD_IDENTITY_PROVIDER is not a workload identity provider resource name.");
    if (!SERVICE_ACCOUNT.test(serviceAccount)) throw new ReportSectionError("GOOGLE_SERVICE_ACCOUNT is not a service account email.");
    if (!PROPERTY.test(property)) throw new ReportSectionError("GOOGLE_SEARCH_CONSOLE_PROPERTY must be sc-domain:<domain> or an https:// prefix ending in /.");
    const token = await googleAccessToken({ env: { ...env, GOOGLE_WORKLOAD_IDENTITY_PROVIDER: provider, GOOGLE_SERVICE_ACCOUNT: serviceAccount }, fetchImpl });
    const client = searchClient({ token, property, fetchImpl });
    const periods = reportPeriods(days, now, { lagDays: SEARCH_LAG_DAYS });
    const current = { startDate: periods.current.start, endDate: periods.current.end };
    const [dailyRows, queryRows, pageRows, queryPageRows, deviceRows, countryRows, sitemapRows] = await Promise.all([
      client.query({ startDate: periods.previous.start, endDate: periods.current.end, dimensions: ["date"], rowLimit: 500 }),
      client.query({ ...current, dimensions: ["query"], rowLimit: 250 }),
      client.query({ ...current, dimensions: ["page"], rowLimit: 500 }),
      client.query({ ...current, dimensions: ["query", "page"], rowLimit: 1000 }),
      client.query({ ...current, dimensions: ["device"], rowLimit: 10 }),
      client.query({ ...current, dimensions: ["country"], rowLimit: 10 }),
      client.sitemaps()
    ]);
    const inspections = await inspectAll(client, [...pages.keys()]);
    return summarizeSearch({ periods, pages, dailyRows, queryRows, pageRows, queryPageRows, deviceRows, countryRows, sitemapRows, inspections });
  } catch (error) {
    return sectionError(error, "Search Console data could not be collected.");
  }
}
