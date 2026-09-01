# OmaPicks

[OmaPicks](https://omapicks.com) is an independent weekly ranking of Omarchy plugins. It selects a champion and runner-up for focused app types using public adoption, community, maintenance, and verification signals.

The project is fully static. Visitors never call the source APIs, and there are no accounts, votes, comments, cookies, or per-request backend costs.

## Requirements

- Node.js 20 or newer
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

## Deployment

1. Create a public GitHub repository.
2. Connect it to Cloudflare Pages.
3. Set the build command to `node build/index.mjs` and output directory to `dist`.
4. Attach `omapicks.com`.
5. Allow the scheduled workflow minimal `contents: write` access so it can commit validated weekly snapshots.

Cloudflare's Git integration deploys the bot commit. The refresh workflow has concurrency protection and does not recursively trigger itself.

## Independence

OmaPicks is not affiliated with Omarchy, 37signals, or omarchyplugins.com. Marketplace data and plugin previews remain attributable to their respective sources and authors.
