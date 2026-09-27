# OmaPicks

[OmaPicks](https://omapicks.com) is an independent weekly ranking of Omarchy plugins. It selects a champion and runner-up for focused app types using public adoption, community, maintenance, and verification signals.

The site is static. Visitors never call the source APIs, and there are no accounts, votes, comments, or cookies.

## Develop

Node.js 24.20.0 or newer. Run `npm ci` to install the pinned development dependencies. Category social preview PNGs are rendered offline using `@resvg/resvg-js` and a bundled Liberation Mono font; no browser or system fonts are needed.

```sh
npm ci                # install build dependencies
npm test              # unit and rendering tests
npm run build         # offline render into dist/
npm run refresh       # fetch public feeds and write a new weekly snapshot
npm run refresh -- --republish # deliberately recalculate this week's existing snapshot
npm run audit:classification # capture feeds and explain every classification
npm run compare:methodology -- --input tmp/classification-audit/inputs.json # offline scoring comparison
npm run check         # tests followed by a production render
npx playwright install chromium
npm run test:e2e       # browser interactions, mobile layouts, contrast
```

`npm run build` reads committed files under `data/` and never accesses the network. `npm run refresh` and the audit/discovery research commands fetch public feeds; rendering stays offline.

## Ranking method

Plugins must be installable and point to an HTTPS repository. Listings whose latest marketplace check failed or could not reach the repository are excluded immediately and compete again once a check passes; Omarchy built-ins are never ranked. Only plugins matching at least one focused app type compete; unmatched listings intentionally remain unranked instead of being forced into a catch-all category. The curated taxonomy requires direct task evidence in the name or description. Tags and upstream categories cannot independently qualify a plugin. One plugin can compete in several app types when it directly performs each task. Explicit, documented exceptions preserve capabilities verified in upstream documentation; assignments held for review do not compete. See [classification and audit](docs/classification.md). A ranking is not an endorsement or a safety review of the plugin.

Copies, hearts, stars, and views are transformed with `log1p`. Each signal blends a 70% within-type percentile with a 30% scale capped at the cohort's 95th percentile, then is damped toward the cohort midpoint when evidence is sparse. Since methodology 1.1.0, a small share scores copies per detail view: the capped ratio of two anonymous counters, ranked by the lower bound of its 95% Wilson interval (the marketplace's install-rate formula) and unrated below 20 views. It is an engagement proxy, not a measured installation or conversion rate. Repository freshness uses a 180-day half-life from the latest push; version changes and releases are recorded and shown but do not change the score. Registry verification contributes a small bonus: full credit for a verified snapshot that still matches upstream, 60% when upstream has since moved to unverified code, none otherwise. An eligible incumbent remains champion or runner-up until a challenger scores more than 10% higher. [Methodology 1.1.0 decision record](docs/methodology-1.1.0.md).

The exact weights and tie-breaks live in `build/methodology.mjs` and are published on the [methodology page](https://omapicks.com/methodology/) with each snapshot.

### Methodology versions

Every snapshot records `methodologyVersion`. `build/methodology.mjs` keeps an immutable definition for each published version (weights, decay, evidence damping, eligibility and incumbent selection), and the site always explains the published snapshot with its own definition, so merged ranking changes cannot misdescribe the current week. Rendering fails on an unknown version. A new eligibility, scoring or selection rule needs a new version; it takes effect when the Monday refresh publishes the next snapshot. A methodology change alone does not lift the same-week freeze: run `npm run refresh -- --republish` (or dispatch the weekly workflow with *republish*) for a deliberate midweek publication. Republishing still validates the feeds and keeps the week's earlier changelog events; `--dry-run` never writes.

Before a scoring proposal is activated, `npm run compare:methodology -- --input <inputs.json>` ranks one captured refresh input (the `tmp/classification-audit/inputs.json` written by every refresh and dry run) under the published rules, each proposal on its own and the combined result. It reports changed champions and runner-ups, raw-score leaders, score deltas and hysteresis decisions without network access or changes to published data.

## Data sources and attribution

OmaPicks ranks two public feeds operated by Omarchy Plugins:

- [`plugins.omarchy.org/catalog.json`](https://plugins.omarchy.org/catalog.json) — plugin metadata, repositories, licenses, maintenance dates, verification status, install availability, GitHub stars, and preview locations
- [`api.omarchyplugins.com/v1/stats`](https://api.omarchyplugins.com/v1/stats) — install-command copies, hearts, and views by plugin ID
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

`site/discovery.json` contains category search aliases, three task-oriented starter collections, and related-category groups. These are editorial navigation aids; they do not affect classification or the weekly rankings. The homepage counts category entries, so a plugin competing in several categories is counted in each. Weekly highlights compare the latest ranking with the previous published week.

A refresh rejects engagement feeds covering fewer than 50% of catalog IDs or containing fewer than 75% of the previous stats entry count. These conservative guards allow new listings without engagement while stopping empty, unrelated, or severely truncated responses before any files are written. If the upstream feed legitimately shrinks beyond these limits, investigate and deliberately adjust the guard; do not delete the previous snapshot to bypass it.

Social images are regenerated from each category and its current picks during `npm run build`. Email links work without JavaScript; copying links and native sharing progressively enhance them where supported. No third-party sharing script is loaded.

Browser tests launch their own local server. To use a system Chromium locally, set `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` to its executable path; CI installs Playwright’s pinned Chromium.

Both the midweek pre-check (`--dry-run`) and the weekly refresh explain their outcome in the Actions log and job summary: feed validation and checksum changes, catalog coverage, champion and runner-up changes, and the candidate scores behind each selection. A challenger must beat an available incumbent by strictly more than 10%; runner-up selection excludes the champion. Dry runs do not publish. A same-week refresh with unchanged taxonomy explicitly reports that it skipped fetching and recalculation because the weekly snapshot is frozen. Current-run changes are distinguished from earlier events retained in the weekly changelog.

## Category discovery pilot

The report-only **Weekly category discovery** workflow runs Tuesdays at 06:43 UTC and can be started manually. It scans for possible taxonomy gaps, requires repository diversity and observations at least six days apart, and provides an Actions summary plus a downloadable evidence bundle and LLM follow-up prompt. It uses no model API key and never changes categories or opens PRs. See [the pilot guide](docs/category-discovery.md) for limitations, review decisions, replay instructions, and the four-week evaluation.
