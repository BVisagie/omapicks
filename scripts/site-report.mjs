import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { collectTraffic } from "./report/cloudflare.mjs";
import { ReportSectionError, knownPages, parseDays } from "./report/common.mjs";
import { collectAutomation } from "./report/github.mjs";
import { collectSearch } from "./report/google.mjs";
import { renderReport } from "./report/render.mjs";
import { summarizeSite } from "./report/site-data.mjs";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const COMMANDS = new Set(["collect-traffic", "collect-search", "build", "all"]);

function options(argv) {
  const args = [...argv];
  const command = COMMANDS.has(args[0]) ? args.shift() : "all";
  const parsed = { command, days: process.env.REPORT_DAYS ?? "28", out: path.join(ROOT, "tmp/site-report") };
  while (args.length) {
    const flag = args.shift();
    if (flag === "--days") parsed.days = args.shift();
    else if (flag === "--out") parsed.out = path.resolve(args.shift());
    else throw new ReportSectionError(`Unknown option ${flag}.`);
  }
  return { ...parsed, days: parseDays(parsed.days) };
}

async function json(file) {
  return JSON.parse(await readFile(path.join(ROOT, file), "utf8"));
}

async function loadSiteData() {
  const [rankings, unclassified, availability] = await Promise.all([json("data/rankings.json"), json("data/unclassified-report.json"), json("data/availability.json")]);
  const files = (await readdir(path.join(ROOT, "data/history"))).filter((name) => /^\d{4}-W\d{2}\.json$/.test(name));
  const history = await Promise.all(files.map((name) => json(`data/history/${name}`)));
  return { rankings, unclassified, availability, history };
}

async function readSection(out, name) {
  try {
    return JSON.parse(await readFile(path.join(out, `${name}.json`), "utf8"));
  } catch {
    return { status: "not-collected" };
  }
}

async function writeSection(out, name, section) {
  await mkdir(out, { recursive: true });
  await writeFile(path.join(out, `${name}.json`), `${JSON.stringify(section)}\n`, { mode: 0o600 });
  console.log(`${name}: ${section.status}${section.error ? ` (${section.error})` : ""}`);
}

export async function buildReport({ days, now = new Date(), sections, data }) {
  const site = summarizeSite({ ...data, now });
  return {
    schemaVersion: 1,
    generatedAt: now.toISOString(),
    days,
    sections: { traffic: sections.traffic, search: sections.search, site, automation: sections.automation }
  };
}

async function main() {
  const { command, days, out } = options(process.argv.slice(2));
  const data = await loadSiteData();
  const pages = knownPages(data.rankings);
  if (command === "collect-traffic" || command === "all") await writeSection(out, "traffic", await collectTraffic({ days, pages }));
  if (command === "collect-search" || command === "all") await writeSection(out, "search", await collectSearch({ days, pages }));
  if (command !== "build" && command !== "all") return;
  const report = await buildReport({
    days,
    data,
    sections: { traffic: await readSection(out, "traffic"), search: await readSection(out, "search"), automation: await collectAutomation({}) }
  });
  await mkdir(out, { recursive: true });
  await writeFile(path.join(out, "report.json"), `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
  await writeFile(path.join(out, "report.html"), renderReport(report), { mode: 0o600 });
  const failed = Object.entries(report.sections).filter(([, section]) => section.status === "error");
  for (const [name, section] of Object.entries(report.sections)) console.log(`${name}: ${section.status}${section.error ? ` (${section.error})` : ""}`);
  console.log(`Wrote ${path.relative(ROOT, out) || out}/report.html and report.json.`);
  if (failed.length) {
    console.error(`Report written, but ${failed.map(([name]) => name).join(" and ")} failed.`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((error) => {
    // Collectors return their own sanitized errors; anything reaching here is local data or rendering.
    console.error(error instanceof ReportSectionError ? error.message : (error?.stack ?? String(error)));
    process.exitCode = 1;
  });
}
