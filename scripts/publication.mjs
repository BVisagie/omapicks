import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { lstat, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const MAX_BYTES = 64 * 1024 * 1024;
const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");
const git = (root, args) => {
  const result = execFileSync("git", args, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  return args.includes("-z") ? result : result.trim();
};
const fail = (message) => { throw new Error(message); };

function currentWeek(now) {
  const day = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  day.setUTCDate(day.getUTCDate() + 4 - (day.getUTCDay() || 7));
  return `${day.getUTCFullYear()}-W${String(Math.ceil(((day - Date.UTC(day.getUTCFullYear(), 0, 1)) / 86400000 + 1) / 7)).padStart(2, "0")}`;
}

export function allowedPublicationPath(file, mode, week) {
  if (mode === "availability") return file === "data/availability.json";
  if (mode !== "weekly") return false;
  return ["rankings", "changelog", "unclassified-report", "classification-state", "task-review-queue", "availability"].some((name) => file === `data/${name}.json`) ||
    file === `data/history/${week}.json` || /^data\/assets\/plugins\/[a-zA-Z0-9._-]+\.(webp|png|jpg)$/.test(file);
}

export function validatePublication(manifest, { mode, baseSha, week = currentWeek(new Date()) } = {}) {
  if (!manifest || manifest.schemaVersion !== 1 || !["weekly", "availability"].includes(mode) || manifest.mode !== mode) fail("Publication mode/schema mismatch");
  if (!/^[a-f0-9]{40}$/.test(manifest.baseSha) || manifest.baseSha !== baseSha) fail("Publication base SHA mismatch; regenerate and revalidate on the current default branch");
  if (manifest.week !== week) fail("Publication week changed; regenerate before publishing");
  if (!Array.isArray(manifest.changes) || manifest.changes.length > 1000) fail("Invalid publication change count");
  const seen = new Set();
  let size = 0;
  for (const change of manifest.changes) {
    if (!change || !allowedPublicationPath(change.path, mode, week) || seen.has(change.path)) fail(`Unexpected or duplicate publication path: ${change?.path}`);
    seen.add(change.path);
    if (change.deleted === true) {
      if (!change.path.startsWith("data/assets/plugins/") || change.content !== undefined) fail("Only obsolete preview assets may be deleted");
      continue;
    }
    if (typeof change.content !== "string" || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(change.content)) fail("Invalid publication file encoding");
    const bytes = Buffer.from(change.content, "base64");
    size += bytes.length;
    if (size > MAX_BYTES || digest(bytes) !== change.sha256) fail("Publication content checksum or size mismatch");
    if (change.path.endsWith(".json")) JSON.parse(bytes.toString("utf8"));
  }
  return manifest;
}

async function requireRegularPath(root, file) {
  let current = root;
  for (const component of file.split("/")) {
    current = path.join(current, component);
    try {
      const stat = await lstat(current);
      if (stat.isSymbolicLink()) fail(`Publication may not follow symlinks: ${file}`);
    } catch (error) { if (error.code !== "ENOENT") throw error; }
  }
}

export async function packPublication({ root = process.cwd(), mode, output, now = new Date() }) {
  const baseSha = git(root, ["rev-parse", "HEAD"]);
  const week = currentWeek(now);
  const tracked = git(root, ["diff", "--name-only", "-z", "HEAD"]);
  const untracked = git(root, ["ls-files", "--others", "--exclude-standard", "-z", "--", "data"]);
  const paths = [...new Set([tracked, untracked].flatMap((value) => value.split("\0").filter(Boolean)))].sort();
  const changes = [];
  for (const file of paths) {
    if (!allowedPublicationPath(file, mode, week)) fail(`Generated output changed an unauthorized file: ${file}`);
    await requireRegularPath(root, file);
    try {
      const bytes = await readFile(path.join(root, file));
      changes.push({ path: file, content: bytes.toString("base64"), sha256: digest(bytes) });
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
      changes.push({ path: file, deleted: true });
    }
  }
  const manifest = validatePublication({ schemaVersion: 1, mode, baseSha, week, changes }, { mode, baseSha, week });
  await mkdir(path.dirname(output), { recursive: true });
  await writeFile(output, JSON.stringify(manifest) + "\n");
  return manifest;
}

export async function publish({ root = process.cwd(), manifest, mode, branch, now = new Date(), push = true }) {
  if (!branch || !/^[a-zA-Z0-9][a-zA-Z0-9._/-]*$/.test(branch) || branch.includes("..")) fail("Invalid default branch");
  const baseSha = git(root, ["rev-parse", "HEAD"]);
  validatePublication(manifest, { mode, baseSha, week: currentWeek(now) });
  if (git(root, ["status", "--porcelain", "--untracked-files=no"])) fail("Publisher checkout must be clean");
  git(root, ["fetch", "--no-tags", "origin", `refs/heads/${branch}`]);
  if (git(root, ["rev-parse", "FETCH_HEAD"]) !== baseSha) fail("Default branch advanced; rerun generation and validation. Nothing was published");
  if (!manifest.changes.length) return { changed: false, sha: baseSha };
  for (const change of manifest.changes) {
    await requireRegularPath(root, change.path);
    const file = path.join(root, change.path);
    if (change.deleted) await rm(file, { force: true });
    else { await mkdir(path.dirname(file), { recursive: true }); await writeFile(file, Buffer.from(change.content, "base64")); }
  }
  git(root, ["add", "--", ...manifest.changes.map((change) => change.path)]);
  if (!git(root, ["diff", "--cached", "--name-only"])) return { changed: false, sha: baseSha };
  git(root, ["-c", "user.name=github-actions[bot]", "-c", "user.email=41898282+github-actions[bot]@users.noreply.github.com", "commit", "-m",
    mode === "weekly" ? `chore: refresh reviewed recommendations for ${manifest.week}` : "chore: update current recommendation availability"]);
  // A concurrent human push is rejected by ordinary fast-forward push, never rebased or forced.
  if (push) git(root, ["push", "origin", `HEAD:refs/heads/${branch}`]);
  return { changed: true, sha: git(root, ["rev-parse", "HEAD"]) };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [command, mode, file] = process.argv.slice(2);
  Promise.resolve().then(async () => {
    if (!["weekly", "availability"].includes(mode) || !file) throw new Error("Usage: publication.mjs pack|publish weekly|availability <artifact.json>");
    if (command === "pack") {
      const manifest = await packPublication({ mode, output: path.resolve(file) });
      if (process.env.GITHUB_OUTPUT) await writeFile(process.env.GITHUB_OUTPUT, `base_sha=${manifest.baseSha}\nchanged=${manifest.changes.length > 0}\n`, { flag: "a" });
      console.log(`Prepared ${manifest.changes.length} allowlisted file changes against ${manifest.baseSha}`);
    } else if (command === "publish") {
      const manifest = JSON.parse(await readFile(file, "utf8"));
      const result = await publish({ manifest, mode, branch: process.env.DEFAULT_BRANCH });
      const message = result.changed ? `Published validated ${mode} data at ${result.sha}.` : "No generated changes to publish.";
      console.log(message);
      if (process.env.GITHUB_STEP_SUMMARY) await writeFile(process.env.GITHUB_STEP_SUMMARY, `\n### Publication\n\n${message}\n`, { flag: "a" });
    } else throw new Error("Unknown publication command");
  }).catch(async (error) => {
    console.error(error.message);
    if (process.env.GITHUB_STEP_SUMMARY) await writeFile(process.env.GITHUB_STEP_SUMMARY, "\n### Publication failed\n\nInspect the failed step. For an advanced default branch, start a fresh workflow run so generation and validation use the new base; rerunning only the publisher cannot repair a stale artifact.\n", { flag: "a" });
    process.exitCode = 1;
  });
}
