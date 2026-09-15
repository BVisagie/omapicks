import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { analyze, renderReport, repositoryIdentity, run } from "../scripts/category-discovery.mjs";

const taxonomy = { schemaVersion: 1, types: [{ id: "music", name: "Music", include: ["\\bmusic\\b"] }] };
const config = { schemaVersion: 1, minimumRepositories: 3, minimumOwners: 2, maximumSuggestions: 3, concepts: [{ id: "translation", name: "Translation", terms: ["translate", "translation"] }], decisions: [] };
const plugin = (id, description = "Translate text") => ({ id, name: id, description, installAvailable: true, installCommand: "never execute", repo: `https://github.com/${id}/repo` });
const catalog = [plugin("alpha"), plugin("beta"), plugin("gamma")];
const firstDate = new Date("2026-09-15T06:43:00Z");
const laterDate = new Date("2026-09-22T06:43:00Z");
const input = { catalog, stats: {}, taxonomy, config, now: firstDate };

test("discovery requires distinct repositories, owners and a separate weekly observation", () => {
  const first = analyze(input);
  assert.equal(first.suggestions.length, 0);
  assert.equal(first.watchlist.length, 1);
  const rerun = analyze({ ...input, previous: first.state, now: new Date("2026-09-16T06:43:00Z") });
  assert.equal(rerun.suggestions.length, 0);
  assert.deepEqual(rerun.state, first.state);
  assert.match(rerun.history, /1 comparable observation is available; none is old enough yet \(requires 6–21 days; earliest eligibility 2026-09-21T06:43:00\.000Z\)/);
  const next = analyze({ ...input, previous: rerun.state, now: laterDate });
  assert.equal(next.suggestions.length, 1);
  assert.equal(next.suggestions[0].id, "concept:translation");
  assert.match(next.history, /1 comparable observation is available; 1 falls within the required 6–21-day comparison window/);
  assert.equal(analyze({ ...input, catalog: catalog.map((p) => ({ ...p, repo: "https://github.com/one/repo.git" })) }).watchlist.length, 0);
  assert.equal(analyze({ ...input, catalog: catalog.map((p) => ({ ...p, repo: `https://github.com/one/${p.id}` })) }).watchlist.length, 0);
});

test("history expires or resets for changed settings; bad state fails visibly", () => {
  const first = analyze(input);
  assert.equal(analyze({ ...input, previous: first.state, now: new Date("2026-10-15") }).suggestions.length, 0);
  assert.equal(analyze({ ...input, previous: first.state, now: laterDate, taxonomy: { ...taxonomy, types: [] } }).suggestions.length, 0);
  assert.throws(() => analyze({ ...input, previous: { schemaVersion: 1, observations: [{}] } }), /Invalid prior/);
});

test("existing category matches, unavailable plugins and duplicate phrases do not inflate proposals", () => {
  assert.equal(analyze({ ...input, catalog: catalog.map((p) => ({ ...p, description: "Translate music" })) }).watchlist.length, 0);
  assert.equal(analyze({ ...input, catalog: [catalog[0], catalog[1], { ...catalog[2], installAvailable: false }] }).watchlist.length, 0);
  const result = analyze({ ...input, catalog: catalog.map((p) => ({ ...p, description: "Translate foreign language" })) });
  assert.equal(result.watchlist.length, 1);
  assert.ok(result.counts.duplicate > 0);
});

test("open-ended phrases discover unseeded clusters and show existing category overlap", () => {
  const result = analyze({ ...input, catalog: [...catalog.map((p) => ({ ...p, description: "Monitor garden irrigation" })), plugin("delta", "Garden irrigation music")] });
  assert.equal(result.watchlist[0].origin, "discovered phrase");
  assert.ok(result.watchlist[0].overlap.some((type) => type.id === "music"));
  assert.ok(result.watchlist[0].members.some((p) => p.types.includes("music")));
});

test("dismissed probes stay suppressed until three new repositories appear", () => {
  const baseline = analyze(input);
  const decision = { id: "concept:translation", status: "dismissed", reason: "Too broad", repositories: baseline.watchlist[0].repositories };
  const decided = { ...config, decisions: [decision] };
  const suppressed = analyze({ ...input, config: decided, previous: baseline.state, now: laterDate });
  assert.equal(suppressed.suggestions.length, 0);
  assert.equal(suppressed.candidates[0].status, "suppressed");
  const reopened = analyze({ ...input, config: decided, previous: baseline.state, now: laterDate, catalog: [...catalog, plugin("delta"), plugin("epsilon"), plugin("zeta")] });
  assert.equal(reopened.suggestions.length, 1);
  assert.equal(reopened.suggestions[0].newRepositories.length, 3);
});

test("report escapes catalog markup and includes a bounded, explicit human handoff", () => {
  const result = analyze({ ...input, catalog: catalog.map((p) => ({ ...p, name: "<script>bad</script> [link](https://evil.test)" })) });
  const markdown = renderReport(result);
  assert.ok(!markdown.includes("<script>"));
  assert.match(markdown, /No LLM was called/);
  assert.match(markdown, /Do not merge automatically/);
  assert.match(markdown, /not yet established/);
});

test("report prioritizes counted evidence and labels contextual matches", () => {
  const incidental = plugin("aardvark", `${"Incidental wording. ".repeat(8)} Translate text`);
  const covered = plugin("covered", "Translate music");
  const result = analyze({ ...input, catalog: [incidental, covered, ...catalog] });
  const markdown = renderReport(result);
  assert.ok(markdown.indexOf("alpha") < markdown.indexOf("aardvark"));
  assert.match(markdown, /prominent unclassified evidence/);
  assert.match(markdown, /overlap context; currently classified as Music/);
  assert.match(markdown, /additional lexical match; not counted as prominent evidence/);
});

test("repository identities normalize GitHub URLs and reject credentials or non-HTTPS", () => {
  assert.deepEqual(repositoryIdentity("https://GitHub.com/A/B.git/"), repositoryIdentity("https://github.com/a/b"));
  assert.equal(repositoryIdentity("https://user:pass@github.com/a/b"), null);
  assert.equal(repositoryIdentity("http://github.com/a/b"), null);
});

test("failed live validation leaves outputs and published snapshots untouched", async (context) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "omapicks-discovery-"));
  context.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(path.join(root, "data"));
  const ranking = { source: { catalog: { count: 3000 }, stats: { count: 3000 } } };
  for (const [name, value] of Object.entries({ "app-types": taxonomy, "category-discovery": config, rankings: ranking })) await writeFile(path.join(root, `data/${name}.json`), JSON.stringify(value));
  await assert.rejects(run({ root, fetchImpl: async (url) => new Response(JSON.stringify(url.includes("/stats") ? { schemaVersion: 1, plugins: {} } : { plugins: catalog })) }), /Catalog contains/);
  await assert.rejects(readFile(path.join(root, "tmp/category-discovery/report.json")), /ENOENT/);
  assert.deepEqual(JSON.parse(await readFile(path.join(root, "data/rankings.json"))), ranking);
});

test("repository churn cannot establish persistence and presentation phrases stay out", () => {
  const first = analyze(input);
  const replaced = analyze({ ...input, previous: first.state, now: laterDate, catalog: [plugin("delta"), plugin("epsilon"), plugin("zeta")] });
  assert.equal(replaced.suggestions.length, 0);
  assert.equal(analyze({ ...input, catalog: catalog.map((p) => ({ ...p, description: "Theme-aware read-only native widget" })) }).watchlist.length, 0);
});

test("response size is bounded even without a Content-Length header", async () => {
  const { boundedFetch } = await import("../scripts/category-discovery.mjs");
  await assert.rejects(boundedFetch(async () => new Response(new Uint8Array(20 * 1024 * 1024 + 1)), "https://example.test", {}), /20 MiB/);
});

test("successful scan archives replayable evidence without changing published data", async (context) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "omapicks-discovery-success-"));
  context.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(path.join(root, "data"));
  const ranking = { source: { catalog: { count: 1000 }, stats: { count: 1000 } } };
  for (const [name, value] of Object.entries({ "app-types": taxonomy, "category-discovery": config, rankings: ranking })) await writeFile(path.join(root, `data/${name}.json`), JSON.stringify(value));
  const feed = [...catalog, ...Array.from({ length: 997 }, (_, i) => ({ ...plugin(`filler${i}`, "Nothing related"), installAvailable: false }))];
  const metrics = Object.fromEntries(feed.map((p) => [p.id, { views: 1, copies: 0, hearts: 0 }]));
  const defaultSummary = path.join(root, "fixture-summary.md");
  const originalSummary = process.env.GITHUB_STEP_SUMMARY;
  process.env.GITHUB_STEP_SUMMARY = defaultSummary;
  let report;
  try {
    report = await run({ root, now: firstDate, summaryFile: null, fetchImpl: async (url) => new Response(JSON.stringify(url.includes("/stats") ? { schemaVersion: 1, plugins: metrics } : { plugins: feed })) });
  } finally {
    if (originalSummary === undefined) delete process.env.GITHUB_STEP_SUMMARY;
    else process.env.GITHUB_STEP_SUMMARY = originalSummary;
  }
  await assert.rejects(readFile(defaultSummary), /ENOENT/);
  const archived = JSON.parse(await readFile(path.join(root, "tmp/category-discovery/inputs.json")));
  const replay = analyze({ catalog: archived.catalog.body.plugins, stats: archived.stats.body.plugins, taxonomy: archived.taxonomy, config: archived.config, previous: archived.previous, now: new Date(archived.now) });
  assert.equal(renderReport(report), renderReport(replay));
  assert.deepEqual(JSON.parse(await readFile(path.join(root, "data/rankings.json"))), ranking);
  assert.deepEqual(JSON.parse(await readFile(path.join(root, "tmp/category-discovery/state.json"))), report.state);
});

test("artifact restore supports flat/nested layouts and missing files without masking ambiguity", async (context) => {
  const { restoreState } = await import("../scripts/restore-category-state.mjs");
  const root = await mkdtemp(path.join(os.tmpdir(), "omapicks-restore-"));
  context.after(() => rm(root, { recursive: true, force: true }));
  const directory = path.join(root, "download");
  const destination = path.join(root, "restored/state.json");
  const envFile = path.join(root, "env");
  assert.equal(await restoreState({ directory, destination, envFile }), false);
  await assert.rejects(readFile(envFile), /ENOENT/);
  await mkdir(directory);
  assert.equal(await restoreState({ directory, destination, envFile }), false);
  const state = JSON.stringify(analyze(input).state);
  await writeFile(path.join(directory, "state.json"), state);
  assert.equal(await restoreState({ directory, destination, envFile }), true);
  assert.equal(await readFile(destination, "utf8"), state);
  await rm(path.join(directory, "state.json"));
  await mkdir(path.join(directory, "nested"));
  await writeFile(path.join(directory, "nested/state.json"), state);
  assert.equal(await restoreState({ directory, destination, envFile }), true);
  assert.match(await readFile(envFile, "utf8"), /DISCOVERY_PREVIOUS=/);
  const restored = JSON.parse(await readFile(destination));
  assert.equal(analyze({ ...input, previous: restored, now: laterDate }).suggestions.length, 1);
  await writeFile(path.join(directory, "state.json"), state);
  await assert.rejects(restoreState({ directory, destination, envFile }), /multiple state.json/);
});

test("collapsed groups retain full evidence and identify the parent group", () => {
  const result = analyze({ ...input, catalog: catalog.map((p) => ({ ...p, description: "Translate foreign language" })) });
  assert.equal(result.collapsedGroups.length, result.counts.duplicate);
  const hidden = result.collapsedGroups.find((g) => g.id === "phrase:foreign-language");
  assert.equal(hidden.collapsedInto, "concept:translation");
  assert.equal(hidden.members.length, 3);
  assert.deepEqual(hidden.evidenceRepositories, result.watchlist[0].evidenceRepositories);
});

test("new classified or incidental repositories cannot reopen a dismissed gap", () => {
  const baseline = analyze(input);
  const decided = { ...config, decisions: [{ id: "concept:translation", status: "dismissed", reason: "Reviewed", repositories: baseline.watchlist[0].repositories }] };
  for (const description of ["Translate music", `${"Incidental text. ".repeat(10)} Translate text`]) {
    const result = analyze({ ...input, config: decided, previous: baseline.state, now: laterDate, catalog: [...catalog, ...["delta", "epsilon", "zeta"].map((id) => plugin(id, description))] });
    assert.equal(result.suggestions.length, 0);
    assert.equal(result.candidates.find((g) => g.id === "concept:translation").newRepositories.length, 0);
  }
});

test("GitHub subpaths cannot inflate repository diversity; nested namespaces remain intact", () => {
  const root = repositoryIdentity("https://github.com/a/b");
  for (const suffix of ["/tree/main", "/blob/main/README.md", ".git/tree/main"]) assert.deepEqual(repositoryIdentity(`https://github.com/a/b${suffix}`), root);
  const result = analyze({ ...input, catalog: catalog.map((p, i) => ({ ...p, repo: `https://github.com/a/b/tree/branch${i}` })) });
  assert.equal(result.watchlist.length, 0);
  assert.equal(repositoryIdentity("https://gitlab.com/a/subgroup/repo").repository, "gitlab.com/a/subgroup/repo");
});

test("bounded response strips stale transport headers and preserves source metadata", async () => {
  const { boundedFetch } = await import("../scripts/category-discovery.mjs");
  const response = await boundedFetch(async () => new Response('{"ok":true}', { headers: { "content-encoding": "gzip", "content-length": "99", etag: '"source"', "last-modified": "Mon, 14 Sep 2026 00:00:00 GMT" } }), "https://example.test", {});
  assert.equal(response.headers.get("content-encoding"), null);
  assert.equal(response.headers.get("content-length"), null);
  assert.equal(response.headers.get("etag"), '"source"');
  assert.ok(response.headers.get("last-modified"));
  assert.deepEqual(await response.json(), { ok: true });
});
