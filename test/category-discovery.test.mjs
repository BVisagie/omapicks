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
  const replay = analyze({ catalog: archived.catalog.body.plugins, stats: archived.stats.body.plugins, taxonomy: archived.taxonomy, config: archived.config, previous: archived.previous, now: new Date(archived.now), explorer: archived.explorer });
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

test("discovery surfaces broad overlap and held assignments without publishing them", () => {
  const types = ["music", "weather", "clock"].map((id) => ({ id, name: id, include: [id] }));
  const t = { schemaVersion: 1, types, overrides: { review: { held: ["music"] }, reasons: { held: { music: "Verify actual playback controls" } } } };
  const report = analyze({ ...input, taxonomy: t, catalog: [plugin("multi", "music weather clock"), plugin("held", "music")] });
  assert.equal(report.classificationReview.length, 2);
  const held = report.classificationReview.find((p) => p.id === "held");
  assert.deepEqual(held.types, []);
  assert.equal(held.evidence[0].decision, "review");
  assert.match(renderReport(report), /Existing-category eligibility checks/);
});

// A tiny explorer graph shaped like https://plugins.omarchy.org/explorer-data.json.
function graph(overrides = {}) {
  const node = (index, id, cluster, neighbors = []) => ({ index, id, name: id, cluster, neighbors });
  return {
    generatedAt: "2026-09-27T00:37:45.351Z",
    method: "Local TF-IDF similarity",
    clusters: [{ id: "media", label: "Media & Audio" }, { id: "kids", label: "Kids & Education" }, { id: "empty", label: "Empty" }],
    nodes: [
      node(0, "player", "media", [{ index: 2, similarity: 0.6 }, { index: 3, similarity: 0.3 }, { index: 2, similarity: 0.6 }, { index: 4, similarity: 0.9 }]),
      node(1, "radio", "media", [{ index: 2, similarity: 0.5 }, { index: 3, similarity: 0.2 }, { index: 5, similarity: 0.9 }]),
      node(2, "tuner", "media", [{ index: 0, similarity: 0.6 }]),
      node(3, "lyrics", "media"),
      node(4, "gone", "media"),
      node(5, "broken", "media"),
      node(6, "abc", "kids"),
      node(7, "math", "kids"),
      node(8, "spelling", "kids"),
      node(9, "stale", "empty")
    ],
    ...overrides
  };
}

function explorerInput(body, extra = {}) {
  const musicTaxonomy = { schemaVersion: 1, types: [{ id: "music", name: "Music", include: ["\\bmusic\\b"] }] };
  const entries = [
    plugin("player", "Music player"), plugin("radio", "Internet music radio"), plugin("tuner", "Station tuner"),
    plugin("lyrics", "Song lyrics"), { ...plugin("broken", "Station tuner"), upstreamCheckStatus: "failed" },
    plugin("abc", "Alphabet game"), plugin("math", "Arithmetic drills"), plugin("spelling", "Spelling practice")
  ];
  return { ...input, taxonomy: musicTaxonomy, catalog: entries, catalogGeneratedAt: "2026-09-27T00:37:45.351Z",
    explorer: { status: "fetched", url: "https://plugins.omarchy.org/explorer-data.json", sha256: "fixture", body }, ...extra };
}

test("explorer neighbours give deterministic near-misses from eligible plugins only", () => {
  const first = analyze(explorerInput(graph()));
  assert.deepEqual(first, analyze(explorerInput(graph())));
  const explorer = first.explorer;
  assert.equal(explorer.status, "available");
  const music = explorer.nearMisses.find((type) => type.typeId === "music");
  // Duplicate pairs count once; the 0.2 and 0.3 neighbours fall on either side of the threshold;
  // gone is missing from the catalog and broken fails upstream health, so neither can be a lead.
  assert.deepEqual(music.leads.map(({ id, summedSimilarity, sources }) => ({ id, summedSimilarity, sources })), [
    { id: "tuner", summedSimilarity: 1.1, sources: ["player", "radio"] },
    { id: "lyrics", summedSimilarity: 0.3, sources: ["player"] }
  ]);
  assert.equal(music.seedsInGraph, 2);
  assert.deepEqual(explorer.skipped, { notInCatalog: 2, ineligible: 1, eligibleMissingFromGraph: 0 });
  assert.equal(explorer.timestampMismatch, false);
  const kids = explorer.clusters.find((cluster) => cluster.id === "kids");
  assert.deepEqual({ upstream: kids.upstreamMembers, joined: kids.eligibleJoined, share: kids.unclassifiedShare }, { upstream: 3, joined: 3, share: 1 });
  assert.deepEqual(kids.samples.map((p) => p.id), ["abc", "math", "spelling"]);
  assert.equal(explorer.clusters.find((cluster) => cluster.id === "empty").unclassifiedShare, null);
  // Media joins four eligible members (gone and broken are skipped), two unclassified: not more than half.
  const media = explorer.clusters.find((cluster) => cluster.id === "media");
  assert.deepEqual({ upstream: media.upstreamMembers, joined: media.eligibleJoined, share: media.unclassifiedShare }, { upstream: 6, joined: 4, share: 0.5 });
  assert.deepEqual(explorer.clusterGaps.map((cluster) => cluster.id), ["kids"]);
  const markdown = renderReport(first);
  assert.match(markdown, /## Neighbour near-misses/);
  assert.match(markdown, /Lexical leads, never eligibility evidence/);
  assert.match(markdown, /\[tuner\]\(https:\/\/plugins\.omarchy\.org\/plugin\.html\?id=tuner\) — summed similarity 1\.1 from 2 members; unclassified/);
  assert.match(markdown, /## Explorer cluster gaps/);
  assert.match(markdown, /\| Kids &amp; Education \| 3 \| 3 \| 3 \| 100\.0% \|/);
  const shifted = analyze(explorerInput(graph({ generatedAt: "2026-09-26T00:00:00Z" })));
  assert.equal(shifted.explorer.timestampMismatch, true);
  assert.match(renderReport(shifted), /graph and catalog timestamps differ/);
});

test("malformed, missing or oversized explorer data leaves the existing discovery report intact", async () => {
  const baseline = analyze(explorerInput(null, { explorer: null }));
  const invalid = [
    graph({ nodes: graph().nodes.map((node, i) => (i === 1 ? { ...node, index: 7 } : node)) }),
    graph({ nodes: graph().nodes.map((node, i) => (i === 0 ? { ...node, neighbors: [{ index: 99, similarity: 0.5 }] } : node)) }),
    graph({ nodes: graph().nodes.map((node, i) => (i === 0 ? { ...node, neighbors: [{ index: 1.5, similarity: 0.5 }] } : node)) }),
    graph({ nodes: graph().nodes.map((node, i) => (i === 0 ? { ...node, neighbors: [{ index: 1, similarity: Number.NaN }] } : node)) }),
    graph({ nodes: graph().nodes.map((node, i) => (i === 0 ? { ...node, neighbors: [{ index: 1, similarity: 1.5 }] } : node)) }),
    graph({ nodes: graph().nodes.map((node, i) => (i === 1 ? { ...node, id: "player" } : node)) }),
    graph({ nodes: graph().nodes.map((node, i) => (i === 1 ? { ...node, cluster: "nowhere" } : node)) }),
    graph({ clusters: [{ id: "media" }, { id: "media" }] }),
    { nodes: "none" }
  ];
  for (const body of invalid) {
    const report = analyze(explorerInput(body));
    assert.equal(report.explorer.status, "unavailable");
    assert.match(report.explorer.warning, /rejected/);
    for (const key of ["outcome", "coverage", "counts", "suggestions", "watchlist", "candidates", "classificationReview", "state"]) assert.deepEqual(report[key], baseline[key]);
    assert.match(renderReport(report), /Explorer analysis was unavailable: Explorer data was rejected/);
  }
  const missing = analyze(explorerInput(null, { explorer: { status: "unavailable", warning: "Explorer data could not be fetched: Feed exceeds 20 MiB budget" } }));
  assert.match(renderReport(missing), /could not be fetched: Feed exceeds 20 MiB budget/);
  assert.match(renderReport(missing), /this is not a finding of no near-misses/);
});

test("offline replay of captured inputs reproduces the report byte for byte without fetching", async (context) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "omapicks-discovery-replay-"));
  context.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(path.join(root, "data"));
  const ranking = { source: { catalog: { count: 1000 }, stats: { count: 1000 } } };
  for (const [name, value] of Object.entries({ "app-types": taxonomy, "category-discovery": config, rankings: ranking })) await writeFile(path.join(root, `data/${name}.json`), JSON.stringify(value));
  const feed = [...catalog, ...Array.from({ length: 997 }, (_, i) => ({ ...plugin(`filler${i}`, "Nothing related"), installAvailable: false }))];
  const metrics = Object.fromEntries(feed.map((p) => [p.id, { views: 1, copies: 0, hearts: 0 }]));
  const explorer = graph({ nodes: [{ index: 0, id: "alpha", cluster: "media", neighbors: [{ index: 1, similarity: 0.4 }] }, { index: 1, id: "beta", cluster: "media", neighbors: [] }] });
  const fetchImpl = async (url) => new Response(JSON.stringify(url.includes("/stats") ? { schemaVersion: 1, plugins: metrics } : url.includes("explorer-data") ? explorer : { generatedAt: "2026-09-27T00:37:45.351Z", plugins: feed }));
  const live = await run({ root, now: firstDate, summaryFile: null, fetchImpl, output: path.join(root, "live") });
  assert.equal(live.explorer.status, "available");
  const inputs = JSON.parse(await readFile(path.join(root, "live/inputs.json"), "utf8"));
  assert.equal(inputs.explorer.url, "https://plugins.omarchy.org/explorer-data.json");
  assert.equal(inputs.explorer.generatedAt, "2026-09-27T00:37:45.351Z");
  assert.equal(inputs.explorer.method, "Local TF-IDF similarity");
  assert.equal(inputs.explorer.sha256.length, 64);
  assert.deepEqual(inputs.explorer.body, explorer);
  // Replay must not touch the network or the repository's data files.
  await rm(path.join(root, "data"), { recursive: true });
  await run({ inputFile: path.join(root, "live/inputs.json"), root, summaryFile: null, output: path.join(root, "replay"), fetchImpl: () => { throw new Error("replay fetched"); } });
  for (const file of ["report.json", "report.md", "state.json", "inputs.json"]) {
    assert.equal(await readFile(path.join(root, "replay", file), "utf8"), await readFile(path.join(root, "live", file), "utf8"), file);
  }
});
