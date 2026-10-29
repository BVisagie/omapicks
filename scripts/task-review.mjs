import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { prepareTaskReviews, taskMetadataHash } from "../build/task-fit.mjs";
import { checksum } from "../build/classification-audit.mjs";

export function catalogReviewSource(catalog, plugin) {
  const index = catalog.plugins.findIndex((p) => p.id === plugin.id);
  if (index < 0) throw new Error(`Missing captured catalog source: ${plugin.id}`);
  const captured = catalog.plugins[index];
  const field = captured.description ? "description" : "name";
  return { url: `https://plugins.omarchy.org/plugin.html?id=${encodeURIComponent(plugin.id)}`, revision: checksum(catalog), path: "catalog.json",
    evidence: `plugins[${index}].${field} (${plugin.id}): ${captured[field]}` };
}

// The decisions file is the editorial judgment. This helper only binds that judgment to the
// captured metadata and validates it; a score or keyword match can never manufacture approval.
export function reviewProposal(inputs, decisions, { taxonomy = inputs.taxonomy, existing = inputs.taskReviews ?? { schemaVersion: 1, assignments: [] } } = {}) {
  if (!Array.isArray(decisions)) throw new Error("Task decisions must be an array");
  const plugins = new Map(inputs.catalog.body.plugins.map((p) => [p.id, p]));
  const types = new Map(taxonomy.types.map((t) => [t.id, t]));
  const records = new Map(existing.assignments.map((p) => [`${p.pluginId}/${p.typeId}`, p]));
  const seen = new Set();
  for (const decision of decisions) {
    const key = `${decision.pluginId}/${decision.typeId}`;
    if (seen.has(key)) throw new Error(`Duplicate task decision: ${key}`);
    seen.add(key);
    const plugin = plugins.get(decision.pluginId);
    const type = types.get(decision.typeId);
    if (!plugin || !type?.contract) throw new Error(`Unknown captured plugin/task: ${key}`);
    if (decision.provenance === "repository-evidence" && !decision.source) throw new Error(`Repository task decisions need their reviewed source revision: ${key}`);
    const metadataHash = taskMetadataHash(plugin);
    if (decision.metadataHash && decision.metadataHash !== metadataHash) throw new Error(`Decision uses different captured metadata: ${key}`);
    if (decision.contractVersion && decision.contractVersion !== type.contract.version) throw new Error(`Decision uses a different task contract: ${key}`);
    records.set(key, { ...decision, metadataHash, contractVersion: type.contract.version,
      source: decision.source ?? catalogReviewSource(inputs.catalog.body, plugin),
      provenance: decision.provenance ?? "catalog-evidence" });
  }
  const reviews = { schemaVersion: existing.schemaVersion ?? 1, assignments: [...records.values()].sort((a, b) => a.typeId.localeCompare(b.typeId) || a.pluginId.localeCompare(b.pluginId)) };
  prepareTaskReviews(reviews, taxonomy.types);
  return reviews;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const options = {};
  for (let i = 0; i < args.length; i += 2) {
    if (!["--input", "--decisions", "--taxonomy", "--existing", "--output"].includes(args[i]) || !args[i + 1] || args[i + 1].startsWith("--")) throw new Error(`Unknown or incomplete option: ${args[i]}`);
    options[args[i]] = args[i + 1];
  }
  if (!options["--input"] || !options["--decisions"]) throw new Error("Usage: node scripts/task-review.mjs --input <capture.json> --decisions <judgments.json> [--output <proposal.json>]");
  const json = async (file) => JSON.parse(await readFile(file, "utf8"));
  const inputs = await json(options["--input"]);
  const reviews = reviewProposal(inputs, await json(options["--decisions"]), {
    ...(options["--taxonomy"] ? { taxonomy: await json(options["--taxonomy"]) } : {}),
    ...(options["--existing"] ? { existing: await json(options["--existing"]) } : {})
  });
  const output = path.resolve(options["--output"] ?? "tmp/task-review-proposal.json");
  await mkdir(path.dirname(output), { recursive: true });
  await writeFile(output, JSON.stringify(reviews, null, 2) + "\n");
  console.log(`Validated ${reviews.assignments.length} task decisions: ${output}. Review the change in a PR before publication.`);
}
