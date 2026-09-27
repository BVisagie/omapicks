# Methodology 1.1.0 decision record

Methodology 1.1.0 aligns OmaPicks with catalog state schema 2 (see the [marketplace alignment plan](marketplace-alignment-plan.md), Packages 2–5). It takes effect with the first snapshot published by the merged code; every earlier snapshot keeps rendering under 1.0.0. This record gives the fixed-input comparison behind each parameter and the resulting decision.

## Inputs

All variants ranked one capture, produced by `node build/refresh.mjs --dry-run` and replayed with `npm run compare:methodology -- --input tmp/classification-audit/inputs.json`:

| Input | Value |
| --- | --- |
| Inputs hash | `689c2b9bb0120968148ea1dc1a84b07b4438af8606b04035dc944c6fe3435f95` |
| Analysis time | 2026-09-27T06:47:30.110Z |
| Capture revision | `58043cb967e84c11dff5677d5d5afe1f514ea457` |
| Catalog | generated 2026-09-27T00:37:45.351Z, 4,250 listings, schema 2, SHA-256 `ccf59e30…b85e` |
| Stats | 4,268 entries, SHA-256 `966ab9ff…399c` |
| Taxonomy | SHA-256 `0ba804ed…0c82` (classification version 2) |
| Previous snapshot | 2026-W39, methodology 1.0.0 |

Each proposal was applied alone to the published rules plus health eligibility (its immediate baseline), then all adopted changes were compared together. Hysteresis runs against the published W39 incumbents in every variant.

## Health eligibility (adopted)

Failed and unreachable listings are excluded immediately. Against 1.0.0: 11 candidates and 11 category assignments leave nine cohorts; no champion changes; one runner-up changes (Music: `quickshell.ytmusic`, `repository-unreachable`). Mean absolute score change 0.0006. An outage grace period is deferred; see `docs/classification.md`.

## Graded verification (adopted, partial credit 0.6)

Of 1,680 eligible candidates, 1,217 are `snapshot-verified`, 387 `update-unverified` and 76 `unverified`.

| `update-unverified` credit | Champion changes | Runner-up changes | Raw-leader changes | Mean / max score change |
| --- | --- | --- | --- | --- |
| 0 | 0 | 0 | 0 | 0 / 0 |
| 0.6 | 0 | 1 (Music: OmaConnect over Music Flow) | 12 | 0.0069 / 0.030 |
| 1 | 0 | 2 (Music; Radio incumbent retained) | 20 | 0.0115 / 0.050 |

Credit 0 reproduces the old binary rule exactly, so it would keep removing all credit whenever upstream moves past a verified snapshot, while the 13% freshness weight rewards that same push. Credit 1 would equate newer unverified code with verified code, which the badge must not imply. **Decision: 0.6.** A verified snapshot whose upstream has moved on keeps most of the 5% weight but stays 0.02 behind a snapshot that still matches upstream. Maintainer review earns no extra credit because both verification methods attest the same exact-commit fact.

## Copy/view lower bound (adopted, weight 5%, views 8% → 3%)

The signal is the lower bound of the 95% Wilson interval for install-command copies per detail view, capped at 100% and unrated below 20 views, matching the rated values of the marketplace's `installRateScore` (`site/assets/js/shared.js` at `fec33e6b`). Rated values are normalized without `log1p`; unrated candidates sit at the neutral midpoint before the usual reliability damping.

- 1,671 of 1,680 candidates are rated. Nine are unrated, three at 19 views and none at exactly 20. No category has fewer than three rated candidates.
- 869 rated candidates normalize below the neutral 0.5 that unrated candidates receive. Because reliability damping already pulls sparse evidence toward 0.5, the largest step observed just above the gate (21–29 views) is about 0.13 normalized, or 0.0066 of total score.
- Alone against its baseline: no champion changes; two runner-up changes, both incumbents now retained by the 10% stability rule (Clipboard: Clipbasket; Smart Home: Omarchy Hue), and two raw-leader changes. Mean absolute score change 0.0083, max 0.043.

**Decision: adopt at 5%, taking 5 points from raw views.** Views stay as a smaller exposure signal. Pages label the displayed capped ratio and the Wilson score separately and describe neither as a measured install or conversion rate.

## Shipping freshness bonus (evaluated, deferred)

The proposal added `0.15 × decay(shippedAt, 90-day half-life)` for version-change or release observations within 90 days, capped at 1.

- 718 candidates would receive it, and 645 of them (90%) would hit the cap: for most recipients the bonus only fills the gap to a full score that a recent push nearly earned already.
- Every candidate with any shipping observation falls inside the 90-day window, because the catalog only started recording `versionUpdatedAt` in August 2026. The bonus would therefore reward the availability of a new field more than shipping cadence.
- The cutoff at 90 days drops 0.075 freshness, about 0.0097 of total score, in one day.
- Alone: no champion changes, one runner-up change (Smart Home incumbent retained), four raw-leader changes.

**Decision: ship the metadata only.** Snapshots record `version`, `releaseTag` and `shippedAt`, pick bylines show the version and a distinct release tag, and freshness stays push-based with a 180-day half-life. A future proposal needs a formula that does not saturate, and should be evaluated once shipping observations cover more than one quarter.

## Combined effect (1.1.0 against 1.0.0)

No champion changes. Three runner-up changes: Music (OmaConnect replaces the unreachable YouTube Music), and Smart Home and Radio, where this week's data under 1.0.0 would have replaced the W39 runner-ups but 1.1.0 retains them under the stability rule. Thirteen raw-score leaders change. 1,372 of 1,966 comparable assignments move within their category; mean absolute score change 0.0119, max 0.056.

Pick changes were not required to be zero: partial verification credit and the copy/view signal legitimately reorder close races. The first 1.1.0 snapshot will be calculated from that week's feeds, so its picks can differ from this capture.
