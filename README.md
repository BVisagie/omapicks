# OmaPicks

[OmaPicks](https://omapicks.com) is an independent weekly ranking of Omarchy plugins. It qualifies plugins against focused task contracts, then orders a reviewed shortlist using public adoption, community, maintenance and verification signals. Its leading option is the strongest scored candidate within that reviewed set, not a claim to have tested every plugin.

The site is static. Visitors never call the source APIs, and there are no accounts, votes, comments or cookies. A small Cloudflare Worker serves the pages and counts visits without a browser tracker; the [privacy page](https://omapicks.com/privacy/) explains exactly what it records.

OmaPicks is not affiliated with Omarchy, 37signals or omarchyplugins.com.

## How the ranking works

1. **Eligibility.** A plugin must be installable and point to an HTTPS repository. A failed or unreachable marketplace check excludes it immediately, and built-ins never rank.
2. **Discovery.** Category patterns find research leads. A pattern match alone qualifies nothing.
3. **Qualification.** A source-backed decision in `data/task-reviews.json` must show that the plugin completes the category's task. It needs a pinned repository passage, reviewed setup requirements and a recent matching source observation. Popularity can't make up for a missing capability.
4. **Scoring.** Qualified candidates are scored on install-command copies, hearts, stars, views, copies per view, repository freshness and marketplace verification.
5. **Publication.** The highest-scoring candidate leads and the next is shown beside it. A category can show one option or abstain. Rankings publish every Monday, and install availability updates daily.

A ranking is not an endorsement or a safety review. Repository evidence establishes documented capabilities and setup requirements. It doesn't establish successful installation, security, runtime reliability or suitability for every environment.

The exact weights and tie-breaks live in `build/methodology.mjs` and are published on the [methodology page](https://omapicks.com/methodology/) with each snapshot. For how decisions are made, see [classification and review](docs/classification.md) and the [methodology decision records](docs/README.md#methodology-decision-records).

## Documentation

- [Documentation index](docs/README.md): every guide, decision record and dated report
- [Automation and publication](docs/automation.md): workflows, publishing safeguards and the private site report
- [Classification and review](docs/classification.md): how a plugin qualifies for a category
- [Category discovery](docs/category-discovery.md): how new category leads are found

## Project layout

| Path | Contents |
| --- | --- |
| `build/` | Ranking, classification, the feed refresh and the static site renderer |
| `data/` | Taxonomy, review decisions, published rankings, history and availability |
| `site/` | The stylesheet, script, icons and other static assets |
| `functions/`, `workers/` | The Cloudflare Worker that serves the site and counts visits |
| `scripts/` | Research, review, publication and site report commands |
| `test/`, `e2e/` | Node tests and Playwright browser tests |
| `docs/` | Guides, decision records and dated reports |

## Develop

You need Node.js 24.22.1 or newer. `.nvmrc` and `.node-version` pin the Node 24 LTS release that CI uses.

```sh
npm ci                # install the pinned development dependencies
npm test              # unit and rendering tests
npm run build         # offline render into dist/
npm run check         # tests followed by a production render
npx playwright install chromium
npm run test:e2e      # browser interactions, mobile layouts, contrast
npm run lint:workflows # lint the GitHub Actions workflows
```

`npm run build` reads committed files under `data/` and never accesses the network. Browser tests start their own local server. To use a system Chromium, set `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` to its executable path; CI installs Playwright's pinned Chromium.

These commands fetch public feeds or work with captured inputs. Rendering stays offline either way:

```sh
npm run refresh       # fetch public feeds and source trees; write a weekly snapshot
npm run refresh -- --republish # deliberately recalculate this week's existing snapshot
npm run availability  # update current availability without changing weekly scores
npm run review:evidence # capture shared research inputs and stage candidate pages
npm run audit:classification # capture feeds and explain every classification
npm run compare:task-fit -- --input /path/to/baseline-inputs.json # offline eligibility/selection comparison
npm run review:tasks -- --input /path/to/inputs.json --decisions /path/to/decisions.json # validated review proposal
```

Maintainers can open the private site report with `npm run report:open`. It needs the report key; see [Private site report](docs/automation.md#private-site-report).

### Interface

The interface is one stylesheet (`site/styles.css`, with design tokens at the top) and one script (`site/app.js`). Pages render complete without JavaScript. The script only adds the command palette, the category radar, the headline decode, count-ups and scroll reveals, all of which respect `prefers-reduced-motion`. No web fonts or third-party code are loaded, and `test/assets.test.mjs` fails the build if the gzipped stylesheet or script outgrows its budget. The design record lives in [`docs/ui-proposals/`](docs/ui-proposals/).

Category social preview PNGs are rendered offline during `npm run build`, using `@resvg/resvg-js` and a bundled Liberation Mono font, so no browser or system fonts are needed. The home Open Graph image `site/og-home.jpg` is committed; regenerate it from `site/og-home.svg` when the hero copy changes.

## Data sources and attribution

OmaPicks ranks two public feeds operated by Omarchy Plugins:

- [`plugins.omarchy.org/catalog.json`](https://plugins.omarchy.org/catalog.json): plugin metadata, repositories, licenses, maintenance dates, verification status, install availability, GitHub stars and preview locations
- [`api.omarchyplugins.com/v1/stats`](https://api.omarchyplugins.com/v1/stats): install-command copies, hearts and views by plugin ID

Three other sources support the ranking but don't score it:

- [`omarchy-plugin-marketplace/registry.json`](https://github.com/omacom/omarchy-plugin-marketplace/blob/main/registry.json): retired plugin IDs from the MIT-licensed marketplace source, used only to label why a previous pick left the catalog. A failed fetch never blocks a refresh.
- [`plugins.omarchy.org/explorer-data.json`](https://plugins.omarchy.org/explorer-data.json): keyword clusters and TF-IDF neighbours, used only by the report-only category discovery pilot
- [Omarchy](https://github.com/omacom/omarchy): built-in plugins, read from their catalog listings and shown beside matching categories (`builtIns` in `data/app-types.json`)

The corresponding listings are on the [Omarchy Plugins marketplace](https://plugins.omarchy.org/?sort=copies). OmaPicks classifies and ranks this evidence independently; the source services don't select or sponsor winners.

Preview images under `data/assets/plugins/` remain attributable to their authors and source marketplace.

## Feedback and security

Open an [issue](https://github.com/BVisagie/omapicks/issues/new) for a wrong placement, bad data or a broken page. To report a vulnerability, follow [SECURITY.md](SECURITY.md).

## Support

OmaPicks is free, with no ads or monetization. If it helps you, you can support its upkeep through [GitHub Sponsors](https://github.com/sponsors/BVisagie).

## Licensing

OmaPicks uses split licensing so publishing the source does not claim ownership of upstream material:

- Source code in `build/` (excluding the separately licensed font under `build/fonts/`), `site/` (excluding brand artwork), `test/`, and `.github/` is licensed under [Apache License 2.0](LICENSE).
- The original taxonomy and generated JSON datasets under `data/` are offered under [CC BY 4.0](LICENSE-DATA), only to the extent OmaPicks owns rights in them. Upstream rights remain unaffected.
- Downloaded plugin previews under `data/assets/plugins/` belong to their respective authors or licensors and are not covered by the project licenses.
- The OmaPicks name, logo, icon, and social artwork are reserved brand assets and are not covered by the project licenses.

See [NOTICE](NOTICE) for the concise scope and attribution statement.
