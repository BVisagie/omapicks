# OmaPicks

[OmaPicks](https://omapicks.com) is an independent weekly ranking of Omarchy plugins. It qualifies plugins against focused task contracts, then orders a reviewed shortlist using public adoption, community, maintenance, and verification signals. Its leading option is the strongest scored candidate within that reviewed set, not a claim to have tested every plugin.

The site is static. Visitors never call the source APIs, and there are no accounts, votes, comments, or cookies.

## Develop

Node.js 24.22.1 or newer; `.nvmrc` and `.node-version` pin the supported Node 24 LTS release used in CI. Run `npm ci` to install the pinned development dependencies. Category social preview PNGs are rendered offline using `@resvg/resvg-js` and a bundled Liberation Mono font; no browser or system fonts are needed. The home Open Graph image `site/og-home.jpg` is committed; regenerate it from `site/og-home.svg` when the hero copy changes.

The interface is one stylesheet (`site/styles.css`, design tokens at the top: dark Signal palette, bone light palette, 20 px tiles, pills) and one script (`site/app.js`). Pages render complete without JavaScript; the script only adds the command palette, the category radar, the headline decode, count-ups and scroll reveals, all of which respect `prefers-reduced-motion`. No web fonts or third-party code are loaded, and `test/assets.test.mjs` fails the build if the gzipped stylesheet or script outgrows its budget. The design record lives in [`docs/ui-proposals/`](docs/ui-proposals/).

```sh
npm ci                # install build dependencies
npm test              # unit and rendering tests
npm run build         # offline render into dist/
npm run refresh       # fetch public feeds and source trees; write a weekly snapshot
npm run availability  # update current availability without changing weekly scores
npm run review:evidence # capture shared research inputs and stage candidate pages
npm run lint:workflows # lint the four GitHub Actions workflows
npm run refresh -- --republish # deliberately recalculate this week's existing snapshot
npm run audit:classification # capture feeds and explain every classification
npm run compare:task-fit -- --input /path/to/baseline-inputs.json # offline eligibility/selection comparison
npm run review:tasks -- --input /path/to/inputs.json --decisions /path/to/decisions.json # validated review proposal
npm run check         # tests followed by a production render
npx playwright install chromium
npm run test:e2e       # browser interactions, mobile layouts, contrast
```

`npm run build` reads committed files under `data/` and never accesses the network. `npm run refresh` and the audit/discovery research commands fetch public feeds; rendering stays offline.

## Ranking method

Plugins must be installable and point to an HTTPS repository. Failed or unreachable marketplace checks exclude a listing immediately; built-ins never rank. Category patterns discover research leads. A recommendation additionally needs a source-backed decision in `data/task-reviews.json` satisfying the category's versioned minimum capabilities. Under methodology 1.4.0, every ranked choice must complete the same task on the stated target; a documented specialist feature cannot replace a missing core workflow. Native core and substantial secondary capabilities qualify equally; narrower tools appear separately. Immutable repository citations, shared reviewed setup requirements, and a matching recent source-tree observation remain required. Relevant source changes await review and cannot compete. Wording changes with unchanged reviewed source enter metadata reconciliation without granting new capabilities. Cards expose task passages, requirements, scope and review dates; a category can show one option or abstain. See [classification and review](docs/classification.md), the [task-coherence decision record](docs/methodology-1.4.0.md) and the [source-evidence rules](docs/methodology-1.3.0.md). A ranking is not an endorsement or safety review.

Copies, hearts, stars, and views are transformed with `log1p`. Each signal blends a 70% within-type percentile with a 30% scale capped at the cohort's 95th percentile, then is damped toward the cohort midpoint when evidence is sparse. Since methodology 1.1.0, a small share scores copies per detail view: the capped ratio of two anonymous counters, ranked by the lower bound of its 95% Wilson interval (the marketplace's install-rate formula) and unrated below 20 views. It is an engagement proxy, not a measured installation or conversion rate. Repository freshness uses a 180-day half-life from the latest push; version changes and releases are recorded and shown but do not change the score. Registry verification contributes a small bonus: full credit for a verified snapshot that still matches upstream, 60% when upstream has since moved to unverified code, none otherwise. The current highest-scoring qualified candidate leads the reviewed shortlist; the strongest remaining candidate is runner-up. Weekly publication supplies stability. Historical 1.0.0/1.1.0 snapshots retain their original 10% incumbent rules and explanations. [Methodology 1.1.0 decision record](docs/methodology-1.1.0.md).

The exact weights and tie-breaks live in `build/methodology.mjs` and are published on the [methodology page](https://omapicks.com/methodology/) with each snapshot.

### Methodology versions

Every snapshot records `methodologyVersion`. `build/methodology.mjs` keeps an immutable definition for each published version (weights, decay, evidence damping, eligibility and incumbent selection), and the site always explains the published snapshot with its own definition, so merged ranking changes cannot misdescribe the current week. Rendering fails on an unknown version. A new eligibility, scoring or selection rule needs a new version; it takes effect when the Monday refresh publishes the next snapshot. A methodology change alone does not lift the same-week freeze: run `npm run refresh -- --republish` (or dispatch the weekly workflow with *republish*) for a deliberate midweek publication. Republishing still validates the feeds and keeps earlier changelog events only within the same methodology; `--dry-run` writes research artifacts under `tmp/` but never changes published data or assets. Taxonomy, classifier, task-review or shared-requirement changes bypass the same-week freeze.

Before an eligibility or selection change, `npm run compare:task-fit -- --input <baseline-inputs.json>` compares the captured taxonomy, decisions and methodology with the current proposal while holding feeds, engagement and time fixed. `compare:methodology` remains available for signal-only experiments; older captures without task decisions keep their legacy eligibility rather than inventing qualifications. Every refresh/dry run captures replay inputs under `tmp/classification-audit/`.

## Data sources and attribution

OmaPicks ranks two public feeds operated by Omarchy Plugins:

- [`plugins.omarchy.org/catalog.json`](https://plugins.omarchy.org/catalog.json) — plugin metadata, repositories, licenses, maintenance dates, verification status, install availability, GitHub stars, and preview locations
- [`api.omarchyplugins.com/v1/stats`](https://api.omarchyplugins.com/v1/stats) — install-command copies, hearts, and views by plugin ID
- [`omarchy-plugin-marketplace/registry.json`](https://github.com/omacom/omarchy-plugin-marketplace/blob/main/registry.json) — retired plugin IDs from the MIT-licensed marketplace source, used only to label why a previous pick left the catalog; a failed fetch never blocks a refresh
- [`plugins.omarchy.org/explorer-data.json`](https://plugins.omarchy.org/explorer-data.json) — keyword clusters and TF-IDF neighbours, used only by the report-only category discovery pilot
- [Omarchy](https://github.com/omacom/omarchy) — built-in plugins, read from their catalog listings and shown beside matching categories (`builtIns` in `data/app-types.json`); never ranked

The corresponding listings are on the [Omarchy Plugins marketplace](https://plugins.omarchy.org/?sort=copies). OmaPicks classifies and ranks this evidence independently; the source services do not select or sponsor winners.

Preview images under `data/assets/plugins/` remain attributable to their authors and source marketplace.

## Independence

OmaPicks is not affiliated with Omarchy, 37signals, or omarchyplugins.com.

## Support

OmaPicks is free, with no ads or monetization. If it helps you, you can support its upkeep through [GitHub Sponsors](https://github.com/sponsors/BVisagie).

## Licensing

OmaPicks uses split licensing so publishing the source does not claim ownership of upstream material:

- Source code in `build/` (excluding the separately licensed font under `build/fonts/`), `site/` (excluding brand artwork), `test/`, and `.github/` is licensed under [Apache License 2.0](LICENSE).
- The original taxonomy and generated JSON datasets under `data/` are offered under [CC BY 4.0](LICENSE-DATA), only to the extent OmaPicks owns rights in them. Upstream rights remain unaffected.
- Downloaded plugin previews under `data/assets/plugins/` belong to their respective authors or licensors and are not covered by the project licenses.
- The OmaPicks name, logo, icon, and social artwork are reserved brand assets and are not covered by the project licenses.

See [NOTICE](NOTICE) for the concise scope and attribution statement.

## Discovery and feed safeguards

`site/discovery.json` contains category search aliases, three task-oriented starter collections, and related-category groups. These are editorial navigation aids; they do not affect classification or the weekly rankings. The homepage counts reviewed category entries, so a plugin competing in several categories is counted in each. Weekly highlights compare the latest ranking with the previous published week.

A refresh bounds catalog/stats responses to 20 MiB, rejects a catalog below 75% of its prior count, and rejects engagement feeds covering fewer than 50% of catalog IDs or containing fewer than 75% of the previous stats entry count. These conservative guards allow new listings without engagement while stopping empty, unrelated, or severely truncated responses before publication. If the upstream feed legitimately shrinks beyond these limits, investigate and deliberately adjust the guard; do not delete the previous snapshot to bypass it.

Social images are regenerated from each category and its current picks during `npm run build`. Email links work without JavaScript; copying links and native sharing progressively enhance them where supported. No third-party sharing script is loaded.

Browser tests launch their own local server. To use a system Chromium locally, set `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` to its executable path; CI installs Playwright’s pinned Chromium.

Four workflows divide responsibility: **CI** validates pull requests and main pushes; **Publish recommendations** publishes on Mondays; **Update availability** refreshes current install availability daily; **Review evidence** captures one shared research run on Tuesdays and Thursdays. Research stages candidate pages and tests those pages, with no published-data changes. Generation and validation have read-only permissions; a small separate publisher accepts only validated, hashed, allowlisted data tied to the checked base commit. See [automation and rollout](docs/automation.md).

The availability overlay is bound to a specific weekly snapshot. A failed, unreachable, retired or unavailable listing loses its current install action; no other option silently inherits its place. Historical badges and scores remain dated evidence. The page states the availability observation date, and an old weekly snapshot still carries its age notice. Feed outages preserve the last successful data and fail visibly.

## Category discovery and ongoing review

The combined **Review evidence** workflow prioritizes former picks, possible shortlist challengers, missing source reviews and changed evidence before category expansion. Discovery consumes the same catalog, engagement, decisions, requirements and source observations as the proposed rankings, plus optional lexical explorer data. It requires repository diversity and observations at least six days apart. Tuesday runs also record discovery observations; Thursday captures review evidence only. Manual discovery observations less than six days apart cannot establish persistence.

The report and replay inputs are archived for 90 days; no model API key is required and research cannot approve a recommendation or publish a category. `node scripts/category-discovery.mjs --input <inputs.json>` replays a captured discovery run offline. See [the discovery guide](docs/category-discovery.md), [review instructions](docs/classification.md), and the [source audit and evaluation](docs/recommendation-evaluation.md).

Repository evidence establishes documented capabilities and setup requirements. It does not establish successful installation, security, runtime reliability or suitability for every user's environment. Unreviewed catalog claims stay in the research queue.
