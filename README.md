# OmaPicks

[OmaPicks](https://omapicks.com) is an independent weekly ranking of Omarchy plugins. It selects a champion and runner-up for focused app types using public adoption, community, maintenance, and verification signals.

The site is static. Visitors never call the source APIs, and there are no accounts, votes, comments, or cookies.

## Develop

Node.js 24.20.0 or newer. There are no npm packages to install.

```sh
npm test              # unit and rendering tests
npm run build         # offline render into dist/
npm run refresh       # fetch public feeds and write a new weekly snapshot
npm run check          # tests followed by a production render
```

`npm run build` reads committed files under `data/` and never accesses the network. `npm run refresh` is the only networked step.

## Ranking method

Plugins must be installable and point to an HTTPS repository. A curated taxonomy can place one plugin in more than one app type when it genuinely belongs in both. A ranking is not an endorsement or a safety review of the plugin.

Copies, hearts, stars, and views are transformed with `log1p`. Each signal blends a 70% within-type percentile with a 30% scale capped at the cohort's 95th percentile, then is damped toward the cohort midpoint when evidence is sparse. Repository freshness uses a 180-day half-life; registry verification contributes a small bonus. An eligible incumbent remains champion or runner-up until a challenger scores more than 10% higher.

The exact weights and tie-breaks live in `build/rank.mjs` and are published on the [methodology page](https://omapicks.com/methodology/) with each snapshot.

## Data sources and attribution

OmaPicks ranks two public feeds operated by Omarchy Plugins:

- [`plugins.omarchy.org/catalog.json`](https://plugins.omarchy.org/catalog.json) — plugin metadata, repositories, licenses, maintenance dates, verification status, install availability, GitHub stars, and preview locations
- [`api.omarchyplugins.com/v1/stats`](https://api.omarchyplugins.com/v1/stats) — install-command copies, hearts, and views by plugin ID

The corresponding listings are on the [Omarchy Plugins marketplace](https://plugins.omarchy.org/?sort=copies). OmaPicks classifies and ranks this evidence independently; the source services do not select or sponsor winners.

Preview images under `data/assets/plugins/` remain attributable to their authors and source marketplace.

## Independence

OmaPicks is not affiliated with Omarchy, 37signals, or omarchyplugins.com.

## Licensing

OmaPicks uses split licensing so publishing the source does not claim ownership of upstream material:

- Source code in `build/`, `site/` (excluding brand artwork), `test/`, and `.github/` is licensed under [Apache License 2.0](LICENSE).
- The original taxonomy and generated JSON datasets under `data/` are offered under [CC BY 4.0](LICENSE-DATA), only to the extent OmaPicks owns rights in them. Upstream rights remain unaffected.
- Downloaded plugin previews under `data/assets/plugins/` belong to their respective authors or licensors and are not covered by the project licenses.
- The OmaPicks name, logo, icon, and social artwork are reserved brand assets and are not covered by the project licenses.

See [NOTICE](NOTICE) for the concise scope and attribution statement.
