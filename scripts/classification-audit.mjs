import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { auditClassifications, checksum, renderClassificationAudit } from "../build/classification-audit.mjs";
import { CLASSIFICATION_VERSION } from "../build/rank.mjs";
import { fetchJson, validateFeeds } from "../build/refresh.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
async function json(file, fallback) {
  try { return JSON.parse(await readFile(file, "utf8")); }
  catch (e) { if (e.code === "ENOENT" && fallback !== undefined) return fallback; throw e; }
}

export async function runAudit({ root = ROOT, inputFile, baselineFile, baselineVersion = CLASSIFICATION_VERSION, output = path.join(root, "tmp", "classification-audit"), fetchImpl = fetch } = {}) {
  let inputs;
  if (inputFile) {
    inputs = await json(inputFile);
    if (inputs.classificationVersion !== CLASSIFICATION_VERSION) throw new Error("Replay requires the classifier version recorded in inputs.json");
  } else {
    const [catalog, stats, taxonomy, previous, previousState] = await Promise.all([
      fetchJson("https://plugins.omarchy.org/catalog.json", { fetchImpl }),
      fetchJson("https://api.omarchyplugins.com/v1/stats", { fetchImpl }),
      json(path.join(root, "data", "app-types.json")),
      json(path.join(root, "data", "rankings.json")),
      json(path.join(root, "data", "classification-state.json"), null)
    ]);
    inputs = { schemaVersion: 1, classificationVersion: CLASSIFICATION_VERSION, now: new Date().toISOString(), catalog, stats, taxonomy, previous, previousState,
      baselineTaxonomy: baselineFile ? await json(baselineFile) : null, baselineVersion };
  }
  validateFeeds(inputs.catalog.body, inputs.stats.body, 1000, inputs.previous);
  const report = auditClassifications({ ...inputs, catalog: inputs.catalog.body.plugins, stats: inputs.stats.body.plugins, now: new Date(inputs.now) });
  report.inputsHash = checksum(inputs);
  await mkdir(output, { recursive: true });
  for (const [name, value] of Object.entries({ "inputs.json": inputs, "report.json": report, "state.json": report.state })) await writeFile(path.join(output, name), JSON.stringify(value, null, 2) + "\n");
  await writeFile(path.join(output, "report.md"), renderClassificationAudit(report));
  console.log(`Category audit: ${report.counts.changed} changed listings, ${report.counts.unresolved} held assignments. ${output}/report.md`);
  return report;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const allowed = new Set(["--input", "--baseline", "--baseline-version", "--output"]);
  const options = {};
  for (let i = 0; i < args.length; i += 2) {
    if (!allowed.has(args[i]) || !args[i + 1] || args[i + 1].startsWith("--")) throw new Error(`Unknown or incomplete option: ${args[i]}`);
    options[args[i]] = args[i + 1];
  }
  const baselineVersion = Number(options["--baseline-version"] ?? CLASSIFICATION_VERSION);
  if (![1, CLASSIFICATION_VERSION].includes(baselineVersion)) throw new Error("Unsupported baseline classifier version");
  await runAudit({ inputFile: options["--input"], baselineFile: options["--baseline"], baselineVersion, output: options["--output"] });
}
