# OmaPicks

[OmaPicks](https://omapicks.com) is an independent weekly ranking of Omarchy plugins. It selects a champion and runner-up for focused app types using public adoption, community, maintenance, and verification signals.

The project is fully static. Visitors never call the source APIs, and there are no accounts, votes, comments, cookies, or per-request backend costs.

## Requirements

- Node.js 24.20.0 or newer (current LTS)
- Network access only when refreshing weekly data

There are no npm dependencies to install.

## Commands

```sh
npm test              # unit and rendering tests
npm run build         # deterministic, offline render into dist/
npm run refresh       # fetch and publish a new ISO-week snapshot
npm run check          # tests followed by a production render
```

`build/index.mjs` reads committed files under `data/` and never accesses the network. `build/refresh.mjs` is the only networked build step. It validates both feeds, rejects duplicate IDs and unexpectedly small catalogs, computes rankings, downloads selected preview images, and atomically writes:

- `data/rankings.json` — current public ranking
- `data/history/YYYY-Www.json` — immutable weekly history without local-image coupling
- `data/changelog.json` — current champion changes
- `data/unclassified-report.json` — taxonomy curation report

## Ranking method

Plugins must be installable and point to an HTTPS repository. A curated taxonomy can place one plugin in multiple legitimate app types.

Copies, hearts, stars, and views are transformed with `log1p`. Each signal blends a 70% within-type percentile with a 30% scale capped at the cohort's 95th percentile, then is damped toward the cohort midpoint when evidence is sparse. Repository freshness uses a 180-day half-life; registry verification contributes a small bonus. An eligible incumbent remains champion or runner-up until a challenger scores more than 10% higher.

The exact weights and tie-breaks live in `build/rank.mjs` and are published on the methodology page with each snapshot's methodology version and source checksums.

## Data sources and attribution

The weekly refresh reads two public feeds operated by Omarchy Plugins:

- [`plugins.omarchy.org/catalog.json`](https://plugins.omarchy.org/catalog.json) — plugin metadata, repositories, licenses, maintenance dates, verification status, install availability, GitHub stars, and preview locations
- [`api.omarchyplugins.com/v1/stats`](https://api.omarchyplugins.com/v1/stats) — install-command copies, hearts, and views by plugin ID

The corresponding human-readable listings are available in the [Omarchy Plugins marketplace](https://plugins.omarchy.org/?sort=copies). OmaPicks independently classifies and ranks this evidence; the source services do not select or sponsor winners.

Each snapshot records source timestamps and SHA-256 checksums in `data/rankings.json`. Downloaded plugin preview images under `data/assets/plugins/` remain attributable to their respective authors and source marketplace.

## Deployment

1. Create a public GitHub repository.
2. Connect it to Cloudflare Pages.
3. Set the build command to `node build/index.mjs` and output directory to `dist`. Cloudflare Pages will use Node.js 24.20.0 from `.nvmrc`.
4. Attach `omapicks.com`.
5. Allow the scheduled workflow minimal `contents: write` access so it can commit validated weekly snapshots.

Cloudflare's Git integration deploys the bot commit. The refresh workflow has concurrency protection and does not recursively trigger itself.

The Monday workflow publishes the immutable weekly snapshot. A separate Thursday workflow fetches and validates the live feeds with `--dry-run`, calculates candidate changes, and runs the full test/render check without committing or changing the published ranking. Both workflows share a concurrency group so they cannot overlap.

## Independence

OmaPicks is not affiliated with Omarchy, 37signals, or omarchyplugins.com. Marketplace data and plugin previews remain attributable to their respective sources and authors.

## Licensing

OmaPicks uses split licensing so publishing the source does not claim ownership of upstream material:

- Source code in `build/`, `site/` (excluding brand artwork), `test/`, and `.github/` is licensed under [Apache License 2.0](LICENSE).
- The original taxonomy and generated JSON datasets under `data/` are offered under [CC BY 4.0](LICENSE-DATA), only to the extent OmaPicks owns rights in them. Upstream rights remain unaffected.
- Downloaded plugin previews under `data/assets/plugins/` belong to their respective authors or licensors and are not covered by the project licenses.
- The OmaPicks name, logo, icon, and social artwork are reserved brand assets and are not covered by the project licenses.

See [NOTICE](NOTICE) for the concise scope and attribution statement. The `"private": true` package setting only prevents accidental publication to npm; it does not make the repository closed source.
