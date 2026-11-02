// Quick terminal view of recent traffic. The full private report is `npm run report`.
import { collectTraffic } from "./report/cloudflare.mjs";
import { knownPages } from "./report/common.mjs";
import { readFile } from "node:fs/promises";

const requested = Math.trunc(Number(process.env.ANALYTICS_DAYS || 7));
const days = Number.isFinite(requested) && requested >= 1 ? Math.min(requested, 90) : 7;
const rankings = JSON.parse(await readFile(new URL("../data/rankings.json", import.meta.url), "utf8"));
const traffic = await collectTraffic({ days, pages: knownPages(rankings), dataset: process.env.ANALYTICS_DATASET || undefined });

if (traffic.status === "not-configured") {
  console.error("Set CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN to query traffic.");
  process.exitCode = 1;
} else if (traffic.status !== "ok") {
  console.error(traffic.error);
  process.exitCode = 1;
} else {
  const { current } = traffic;
  console.log(`Traffic ${current.start} to ${current.end} (${days} days; people only, crawlers and other automated requests removed)\n`);
  console.log(`  page views ${current.views} · visitor-days ${current.visitorDays} · average daily visitors ${current.averageDailyVisitors.toFixed(1)}`);
  console.log(`  removed as automated ${current.filteredTotal + current.crawlerLikeViews} requests\n`);
  for (const page of traffic.pages.filter((entry) => entry.views > 0)) {
    console.log(`  ${page.path.padEnd(32)} views ${page.views} · visitor-days ${page.visitorDays}`);
  }
}
