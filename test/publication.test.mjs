import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, readFile, writeFile, rm, symlink } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { allowedPublicationPath, packPublication, publish, validatePublication } from "../scripts/publication.mjs";

const now = new Date("2026-10-29T12:00:00Z");
const sha = "a".repeat(40);
const record = (file, text = "{}") => ({ path: file, content: Buffer.from(text).toString("base64"), sha256: createHash("sha256").update(text).digest("hex") });
const manifest = (changes, mode = "weekly") => ({ schemaVersion: 1, baseSha: sha, week: "2026-W44", mode, changes });
const check = (data, mode = "weekly") => validatePublication(data, { mode, baseSha: sha, week: "2026-W44" });
const git = (root, ...args) => execFileSync("git", args, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();

test("publisher allows only generated files for its explicit mode and week", () => {
  assert.equal(allowedPublicationPath("data/history/2026-W43.json", "weekly", "2026-W44"), false);
  for (const file of ["data/task-reviews.json", "data/plugin-profiles.json", "data/../package.json", ".github/workflows/ci.yml"]) assert.throws(() => check(manifest([record(file)])), /Unexpected/);
  assert.throws(() => check(manifest([record("data/rankings.json")], "availability"), "availability"), /Unexpected/);
  check(manifest([record("data/availability.json")], "availability"), "availability");
  assert.throws(() => check(manifest([{ path: "data/rankings.json", deleted: true }])), /Only obsolete/);
  assert.throws(() => check(manifest([record("data/rankings.json"), record("data/rankings.json")])), /duplicate/);
});

test("publisher rejects tampered artifacts, wrong base, and changed calendar week", () => {
  assert.throws(() => check(manifest([{ ...record("data/rankings.json"), content: Buffer.from('{"changed":true}').toString("base64") }])), /checksum/);
  assert.throws(() => check({ ...manifest([]), baseSha: "b".repeat(40) }), /base SHA/);
  assert.throws(() => check({ ...manifest([]), week: "2026-W43" }), /week changed/);
});

async function repository(t) {
  const directory = await mkdtemp(path.join(os.tmpdir(), "omapicks-publisher-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const root = path.join(directory, "checkout"), origin = path.join(directory, "origin.git");
  await mkdir(root);
  git(directory, "init", "--bare", origin);
  git(root, "init", "-b", "main");
  git(root, "config", "user.name", "Test"); git(root, "config", "user.email", "test@example.invalid");
  await mkdir(path.join(root, "data"));
  await writeFile(path.join(root, "data/rankings.json"), "{}\n");
  git(root, "add", "."); git(root, "commit", "-m", "baseline");
  git(root, "remote", "add", "origin", origin); git(root, "push", "origin", "main");
  return { directory, root, origin, output: path.join(directory, "artifact.json") };
}

test("publisher commits validated bytes; no-op artifacts create no commit", async (t) => {
  const { root, output } = await repository(t);
  const noop = await packPublication({ root, output, mode: "availability", now });
  assert.equal((await publish({ root, manifest: noop, mode: "availability", branch: "main", now })).changed, false);
  await writeFile(path.join(root, "data/availability.json"), '{"checked":true}\n');
  const packed = await packPublication({ root, output, mode: "availability", now });
  await rm(path.join(root, "data/availability.json"));
  const result = await publish({ root, manifest: packed, mode: "availability", branch: "main", now });
  assert.equal(result.changed, true);
  assert.equal(await readFile(path.join(root, "data/availability.json"), "utf8"), '{"checked":true}\n');
  assert.equal(git(root, "rev-parse", "HEAD"), git(root, "rev-parse", "origin/main"));
});

test("a concurrent main update rejects publication before touching generated files", async (t) => {
  const { root, directory, origin, output } = await repository(t);
  await writeFile(path.join(root, "data/availability.json"), "{}\n");
  const packed = await packPublication({ root, output, mode: "availability", now });
  await rm(path.join(root, "data/availability.json"));
  const other = path.join(directory, "other");
  git(directory, "clone", "-b", "main", origin, other);
  await writeFile(path.join(other, "README.md"), "new main\n");
  git(other, "add", "."); git(other, "-c", "user.name=Test", "-c", "user.email=test@example.invalid", "commit", "-m", "advance"); git(other, "push", "origin", "main");
  await assert.rejects(publish({ root, manifest: packed, mode: "availability", branch: "main", now }), /Default branch advanced/);
  await assert.rejects(readFile(path.join(root, "data/availability.json")), { code: "ENOENT" });
});

test("publication cannot write through a checkout symlink", async (t) => {
  const { root, directory, output } = await repository(t);
  await symlink(path.join(directory, "external"), path.join(root, "data/availability.json"));
  await assert.rejects(packPublication({ root, output, mode: "availability", now }), /symlinks/);
});

test("packaging refuses unrelated tracked changes and cross-mode generated changes", async (t) => {
  const { root, output } = await repository(t);
  await writeFile(path.join(root, "README.md"), "original\n");
  git(root, "add", "README.md"); git(root, "commit", "-m", "tracked documentation");
  await writeFile(path.join(root, "README.md"), "changed during generation\n");
  await assert.rejects(packPublication({ root, output, mode: "weekly", now }), /unauthorized file: README.md/);
  git(root, "restore", "README.md");
  await writeFile(path.join(root, "data/rankings.json"), '{"changed":true}\n');
  await assert.rejects(packPublication({ root, output, mode: "availability", now }), /unauthorized file: data\/rankings.json/);
});
