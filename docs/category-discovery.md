# Weekly category discovery pilot

The Tuesday 06:43 UTC workflow is a report-only prompt for editorial research. It has read-only repository/Actions permissions, does not call an LLM, and cannot publish categories, push commits, or open PRs. It also supports **Run workflow** on the Actions page.

## What to read

Open **Weekly category discovery → Summary**. The same explanation is printed in the scan step's log. Download `category-discovery-report` for:

- `report.md`: up to three ready probes, a short watchlist, and a copyable LLM prompt.
- `report.json`: full candidate evidence, IDs, repository lists, descriptions, engagement, current category overlaps, suppression decisions, and history.
- `inputs.json`: exact catalog and stats responses, taxonomy, configuration, previous observations, analysis time, and workflow commit. The report records its SHA-256 hash.
- `state.json`: observations used for subsequent runs.

Artifacts are retained for 90 days, subject to repository retention policy. They are evidence, not permanent published site data. The separate `category-discovery-state` artifact lets the next run retrieve history without downloading the entire catalog. Only successful main-branch workflow runs supply history. API/download failures fail visibly; absent or expired history establishes a new baseline instead of claiming persistence.

## How the pilot finds leads

`data/category-discovery.json` contains a small, editable set of focused concepts. The scanner also discovers repeated two-word phrases from the whole eligible catalog, including already-classified plugins. Common presentation and implementation language is excluded from phrase discovery. No externally generated regular expressions or plugin code are executed.

A lead needs at least three distinct unclassified repositories across two repository owners with a matching phrase in the name or first 100 description characters. This lexical prominence reduces incidental matches but **does not establish primary purpose**. Repository aliases ending in `.git` are normalized; repository ownership is a diversity proxy, not verified author independence or fork detection. These checks remain part of the LLM/human probe.

For every lead the report includes all matching eligible listings, even those already classified, with category overlaps. When a majority already matches one category, the report asks to investigate an existing matching gap first. Groups with fewer than three uncovered repositories are omitted: this conservative pilot will miss small niches and some useful subdivisions. Synonymous groups sharing at least 80% of the smaller repository set are collapsed, favoring curated probes. Review full evidence when a broad cluster may hide subcategories.

A lead becomes ready only after at least three of its prominent, unclassified repositories recur in an observation 6–21 days old. First runs show a watchlist. Only the first observation in each ISO week is retained, so repeated manual runs cannot accelerate promotion. Changed taxonomy/configuration, analysis version, or an expired baseline resets persistence. Bump `ALGORITHM_VERSION` when changing clustering or evidence rules. Decisions do not reset history. Suggestions are ordered by the number of prominent unclassified repositories, then stable ID; engagement is supporting evidence, not a popularity gate. Maximum three ready probes and three preliminary watchlist entries are displayed. The JSON contains remaining candidates.

Possible successful outcomes are `ready-for-probe`, `insufficient-history`, and `no-worthwhile-proposals`. The last can mean insufficient evidence, existing coverage, duplicate clusters, or suppressed proposals; counts explain the exclusions. A failed run is explicitly different and does not publish new state.

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

Statuses are `dismissed`, `in-review`, and `accepted`. Each suppresses the same evidence until at least three new repositories match the group; a reopened lead includes the previous reason and new repository count. Remove or edit the entry to deliberately revisit it. Accepted taxonomy changes normally eliminate the uncovered gap and reset comparison history. Unreviewed probes continue to appear as a weekly reminder.

## Local checks and replay

```sh
node --test test/category-discovery.test.mjs
node scripts/category-discovery.mjs
# Optionally compare with a downloaded prior state:
DISCOVERY_PREVIOUS=/path/to/state.json node scripts/category-discovery.mjs
```

The live command writes only `tmp/category-discovery/`. It uses the existing feed validator plus a 75% catalog preservation check, limits each response to 20 MiB, caps catalog/stats entry counts, and uses bounded retries and request timeouts. The workflow has a 10-minute timeout.

For an offline replay, check out the workflow commit recorded in `inputs.json`, then run this from that checkout (adjust the artifact path):

```sh
node --input-type=module <<'JS'
import { readFileSync } from 'node:fs';
import { analyze, renderReport } from './scripts/category-discovery.mjs';
const i = JSON.parse(readFileSync('/path/to/inputs.json', 'utf8'));
console.log(renderReport(analyze({
  catalog: i.catalog.body.plugins, stats: i.stats.body.plugins,
  taxonomy: i.taxonomy, config: i.config, previous: i.previous, now: new Date(i.now)
})));
JS
```

## Four-week evaluation

Review the pilot after four scheduled observations. Record which probes led to a useful category or matching fix, which were irrelevant, and how much review time they required. Success means defensible discoveries with little review effort, not a growing category count. Tighten or disable the workflow if it repeatedly proposes generic groupings. A report-only baseline can later support an LLM-assisted analysis stage, but automatic category publication is outside its scope.
