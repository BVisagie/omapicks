#!/usr/bin/env node
// Fetch cited text only. Never clone, import, build, install or execute plugin code.
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { pinnedSource } from "../build/evidence.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
let cache = path.join(root, "tmp", "review-source-cache");
let offline = false;
for (let i = 0; i < args.length; i++) {
  if (args[i] === "--offline") offline = true;
  else if (args[i] === "--cache" && args[i + 1]) cache = path.resolve(args[++i]);
  else throw new Error("Usage: node scripts/capture-review-evidence.mjs [--cache DIR] [--offline]");
}
const hash = (value) => createHash("sha256").update(value).digest("hex");
const readJson = async (name) => JSON.parse(await readFile(path.join(root, "data", name), "utf8"));
const [evaluation, profiles] = await Promise.all([
  readJson("recommendation-evaluation.json"), readJson("plugin-profiles.json"),
]);
const citations = [
  ...evaluation.cases.map((entry) => entry.source),
  ...Object.values(profiles.plugins).flatMap((profile) => profile.sources),
];
const documents = new Map();
for (const source of citations) {
  if (!pinnedSource(source) || !/^[a-f0-9]{64}$/.test(source.sha256 ?? "")) {
    throw new Error(`Expected an immutable source and content hash: ${source?.url}`);
  }
  const existing = documents.get(source.url);
  if (existing && existing.sha256 !== source.sha256) throw new Error(`Conflicting source hashes: ${source.url}`);
  documents.set(source.url, { ...source, excerpts: [...(existing?.excerpts ?? []), source.evidence] });
}

function verifyExcerpts(document, body) {
  const lines = body.toString("utf8").split(/\r?\n/);
  for (const evidence of document.excerpts) {
    for (const passage of evidence.split(/\n\n(?=[^\n]+ lines \d+-\d+:\n)/)) {
      const match = /^([^\n]+) lines (\d+)-(\d+):\n([\s\S]+)$/.exec(passage);
      if (!match || match[1] !== document.path) throw new Error(`Invalid passage format: ${document.url}`);
      const [, , first, last, text] = match;
      if (+first < 1 || +last < +first || lines.slice(+first - 1, +last).join("\n") !== text) {
        throw new Error(`Source passage differs: ${document.url}, lines ${first}-${last}`);
      }
    }
  }
}

async function fetchText(document) {
  const url = new URL(document.url);
  const parts = url.pathname.split("/").filter(Boolean);
  const raw = `https://raw.githubusercontent.com/${parts[0]}/${parts[1]}/${document.revision}/${document.path.split("/").map(encodeURIComponent).join("/")}`;
  const response = await fetch(raw, { redirect: "error", signal: AbortSignal.timeout(20000) });
  if (!response.ok) throw new Error(`Source fetch failed (${response.status}): ${document.url}`);
  const chunks = []; let bytes = 0;
  const reader = response.body.getReader();
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.length;
      if (bytes > 2 * 1024 * 1024) throw new Error(`Source exceeds 2 MiB limit: ${document.url}`);
      chunks.push(value);
    }
  } finally { await reader.cancel(); }
  return Buffer.concat(chunks);
}

await mkdir(cache, { recursive: true });
const pending = [...documents.values()];
const manifest = []; const errors = [];
await Promise.all(Array.from({ length: Math.min(6, pending.length) }, async () => {
  while (pending.length) {
    const document = pending.shift();
    try {
      const filename = `${hash(document.url)}.txt`;
      const target = path.join(cache, filename);
      let body;
      try { body = await readFile(target); } catch (error) {
        if (error.code !== "ENOENT" || offline) throw error;
        body = await fetchText(document);
      }
      if (hash(body) !== document.sha256) throw new Error(`Content hash differs: ${document.url}`);
      verifyExcerpts(document, body);
      if (!offline) await writeFile(target, body);
      manifest.push({ url: document.url, revision: document.revision, path: document.path, sha256: document.sha256, file: filename });
    } catch (error) { errors.push({ url: document.url, error: error.message }); }
  }
}));
manifest.sort((a, b) => a.url.localeCompare(b.url));
errors.sort((a, b) => a.url.localeCompare(b.url));
await writeFile(path.join(cache, "manifest.json"), `${JSON.stringify({ schemaVersion: 1, documents: manifest, errors }, null, 2)}\n`);
console.log(JSON.stringify({ documents: documents.size, verified: manifest.length, citations: citations.length, errors }, null, 2));
if (errors.length) process.exitCode = 1;
