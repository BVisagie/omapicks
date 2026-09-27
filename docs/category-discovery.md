# Weekly category discovery pilot

The Tuesday 06:43 UTC workflow is a report-only prompt for editorial research. It has read-only repository/Actions permissions, does not call an LLM, and cannot publish categories, push commits, or open PRs. It also supports **Run workflow** on the Actions page.

## What to read

Open **Weekly category discovery → Summary**. The same explanation is printed in the scan step's log. Download `category-discovery-report` for:

- `report.md`: up to three ready probes, a short watchlist, and a copyable LLM prompt.
- `report.json`: full candidate evidence, IDs, repository lists, descriptions, engagement, current category overlaps, suppression decisions, and history.
- `inputs.json`: exact catalog, stats and explorer responses (explorer with URL, checksum, `generatedAt`, `method` and availability or warning), taxonomy, configuration, feed-validation baseline, previous observations, analysis time, and workflow commit. The report records its SHA-256 hash.
- `state.json`: observations used for subsequent runs.

The Summary contains only the live-catalog report; integration-test fixtures explicitly suppress summary output. History text states how many comparable observations exist, how many satisfy the 6–21-day window, and the earliest eligibility time when the baseline is still too recent. Displayed listings put prominent unclassified evidence first and label already-classified overlap or additional lexical matches separately.

Artifacts are retained for 90 days, subject to repository retention policy. They are evidence, not permanent published site data. The separate `category-discovery-state` artifact lets the next run retrieve history without downloading the entire catalog. Only successful main-branch workflow runs supply history. API/download failures fail visibly; a downloaded artifact is searched recursively for `state.json`, so flat and nested layouts both work. Missing files establish a baseline, while multiple matching files fail as ambiguous. Absent or expired history establishes a new baseline instead of claiming persistence.

## How the pilot finds leads

`data/category-discovery.json` contains a small, editable set of focused concepts. The scanner also discovers repeated two-word phrases from the whole eligible catalog, including already-classified plugins. Common presentation and implementation language is excluded from phrase discovery. No externally generated regular expressions or plugin code are executed.

A lead needs at least three distinct unclassified repositories across two repository owners with a matching phrase in the name or first 100 description characters. This lexical prominence reduces incidental matches but **does not establish primary purpose**. Repository aliases ending in `.git` and GitHub tree/blob subpaths are normalized; repository ownership is a diversity proxy, not verified author independence or fork detection. These checks remain part of the LLM/human probe.

For every lead the report includes all matching eligible listings, even those already classified, with category overlaps. When a majority already matches one category, the report asks to investigate an existing matching gap first. Groups with fewer than three uncovered repositories are omitted: this conservative pilot will miss small niches and some useful subdivisions. Synonymous groups sharing at least 80% of the smaller repository set are collapsed, favoring curated probes. The `collapsedGroups` array in `report.json` preserves their complete evidence and a `collapsedInto` parent ID so reviewers can inspect hidden subdivisions.

A lead becomes ready only after at least three of its prominent, unclassified repositories recur in an observation 6–21 days old. First runs show a watchlist. Only the first observation in each ISO week is retained, so repeated manual runs cannot accelerate promotion. Changed taxonomy/configuration, analysis version, or an expired baseline resets persistence. Bump `ALGORITHM_VERSION` when changing clustering or evidence rules. Decisions do not reset history. Suggestions are ordered by the number of prominent unclassified repositories, then stable ID; engagement is supporting evidence, not a popularity gate. Maximum three ready probes and three preliminary watchlist entries are displayed. The JSON contains remaining candidates.

Possible successful outcomes are `ready-for-probe`, `insufficient-history`, and `no-worthwhile-proposals`. The last can mean insufficient evidence, existing coverage, duplicate clusters, or suppressed proposals; counts explain the exclusions. A failed run is explicitly different and does not publish new state.

## Explorer neighbours and clusters

The run also reads the marketplace's [explorer data](https://plugins.omarchy.org/explorer-data.json) (about 4 MB, within the same 20 MiB streamed budget): keyword clusters and TF-IDF nearest neighbours for every community plugin. Two report-only sections use it:

- **Neighbour near-misses.** For each category, the eligible plugins that current members list as neighbours with similarity of at least 0.25 but which the category does not include, ranked by summed similarity (plugin ID breaks ties; each member–neighbour pair counts once). The top ten per category are in `report.json`; the summary shows the strongest few.
- **Explorer cluster gaps.** Clusters in which more than half of the members that join to eligible plugins are unclassified, with upstream and joined sizes and five samples sorted by ID.

Neighbour indices are resolved against the original, unfiltered node array before joining to the current catalog by plugin ID. Only eligible community plugins can seed or become leads, so built-ins, failed or unreachable listings and plugins missing from the catalog are skipped and counted; a different catalog and graph timestamp is reported. Names and descriptions come from the current catalog. Neighbours come from related catalog text, so they are **lexical leads, never eligibility evidence** or independent proof of task fit, and a cluster label is not a task definition. Both sections leave taxonomy, rankings and the persistence rules above untouched; a cluster such as Kids & Education still needs three repositories across two owners, a separate weekly observation and an editorial decision before it can become a category.

The graph is optional. A failed or oversized download, or a graph with duplicate IDs, misplaced indices, out-of-range neighbours, non-finite similarities or unknown clusters, is rejected whole with a warning in the report; the rest of the discovery report is unchanged and the report says the explorer analysis was unavailable rather than that it found nothing.

## Engage an LLM

Attach the report artifact and use its included prompt. Ask the LLM to verify actual primary purposes against source listings and repositories, examine counterexamples and existing categories, and only then propose taxonomy rules. It should evaluate the full catalog, show resulting matches and leadership changes, add regression tests, update relevant navigation, and open a PR only when justified. Model-generated rules must be reviewed and tested before publication. An unchanged or rejected result is useful too.

This pilot deliberately stops before semantic adjudication, generating matching rules, and simulating rankings for hypothetical categories. Those belong in the prompted LLM probe, where the category definition can first be justified. No API secret or model subscription is required by the workflow.

## Remember review decisions

Add an entry to `decisions` in `data/category-discovery.json` through the investigation PR, copying the **exact ID and full repositories array** from `report.json`:

```json
{
  "id": "concept:translation",
  "status": "dismissed",
  "reason": "Explain why the proposed grouping is not a useful comparison.",
  "repositories": ["github.com/example/first", "github.com/another/second", "github.com/third/third"]
}
```

Statuses are `dismissed`, `in-review`, and `accepted`. Each suppresses the same evidence until at least three new prominent, unclassified repositories match the group; newly classified or incidental matches do not reopen it; a reopened lead includes the previous reason and new repository count. Remove or edit the entry to deliberately revisit it. Accepted taxonomy changes normally eliminate the uncovered gap and reset comparison history. Unreviewed probes continue to appear as a weekly reminder.

## Local checks and replay

```sh
node --test test/category-discovery.test.mjs
node scripts/category-discovery.mjs
# Optionally compare with a downloaded prior state:
DISCOVERY_PREVIOUS=/path/to/state.json node scripts/category-discovery.mjs
```

The live command writes only `tmp/category-discovery/`. It uses the existing feed validator plus a 75% catalog preservation check, limits each response to 20 MiB, caps catalog/stats entry counts, and uses bounded retries and request timeouts. The workflow has a 10-minute timeout.

For an offline replay, check out the workflow commit recorded in `inputs.json`, then run from that checkout (adjust the artifact path):

```sh
node scripts/category-discovery.mjs --input /path/to/inputs.json --output tmp/category-discovery-replay
```

Replay uses only the captured inputs, including the explorer response and feed-validation baseline: it makes no network requests, does not read `data/`, and reproduces `report.json`, `report.md` and `state.json` byte for byte. Timestamps and a checksum alone could not replay an evolving graph, which is why the full response is kept. `ALGORITHM_VERSION` 4 marks the first analysis with explorer probes and health-aware eligibility, so earlier observations are not reused as persistence evidence.

## Four-week evaluation

Review the pilot after four scheduled observations. Record which probes led to a useful category or matching fix, which were irrelevant, and how much review time they required. Success means defensible discoveries with little review effort, not a growing category count. Tighten or disable the workflow if it repeatedly proposes generic groupings. A report-only baseline can later support an LLM-assisted analysis stage, but automatic category publication is outside its scope.

## Existing assignments

The report also lists broad overlaps (three or more categories) and assignments explicitly held in `overrides.review`, with the same evidence used by ranking. This is a research queue, not a rule that rejects multipurpose plugins. Check direct task fit before proposing new categories; follow [category eligibility and audit](classification.md). Algorithm version 3 resets discovery observations so old keyword-only assignments are not treated as comparable evidence.
