const ACCOUNT_ID = process.env.CLOUDFLARE_ACCOUNT_ID;
const TOKEN = process.env.CLOUDFLARE_API_TOKEN;
const DATASET = process.env.ANALYTICS_DATASET || "omapicks_pages";
const DAYS = Number(process.env.ANALYTICS_DAYS || 7);

if (!ACCOUNT_ID || !TOKEN) {
  console.error("Set CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN to query traffic.");
  process.exitCode = 1;
  process.exit();
}

if (!/^[A-Za-z0-9_]+$/.test(DATASET)) {
  console.error("ANALYTICS_DATASET must be a simple identifier.");
  process.exitCode = 1;
  process.exit();
}

const query = `SELECT
  blob1 AS path,
  SUM(_sample_interval) AS page_views,
  COUNT(DISTINCT blob2) AS approx_daily_visitors
FROM ${DATASET}
WHERE timestamp > NOW() - INTERVAL '${Number.isFinite(DAYS) && DAYS > 0 ? DAYS : 7}' DAY
GROUP BY blob1
ORDER BY page_views DESC`;

const response = await fetch(`https://api.cloudflare.com/client/v4/accounts/${ACCOUNT_ID}/analytics_engine/sql`, {
  method: "POST",
  headers: {
    authorization: `Bearer ${TOKEN}`,
    "content-type": "text/plain"
  },
  body: query
});

const text = await response.text();
if (!response.ok) {
  console.error(`Cloudflare SQL API returned HTTP ${response.status}`);
  console.error(text);
  process.exitCode = 1;
  process.exit();
}

let payload;
try {
  payload = JSON.parse(text);
} catch {
  console.log(text);
  process.exit();
}

const rows = payload.data ?? payload.result ?? [];
const picks = rows.filter((row) => String(row.path || "").startsWith("/picks/"));
console.log(`Traffic for the last ${DAYS} days (approximate daily visitors, not unique people across days)\n`);
printTable("All pages", rows);
printTable("Category pages", picks);

function printTable(title, entries) {
  console.log(title);
  if (!entries.length) {
    console.log("  no rows yet\n");
    return;
  }
  for (const row of entries) {
    console.log(
      `  ${String(row.path).padEnd(28)} views ${Number(row.page_views)} · approx daily visitors ${Number(row.approx_daily_visitors)}`
    );
  }
  console.log("");
}
