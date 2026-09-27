# Marketplace alignment plan (catalog state schema 2)

Status: proposed, not started. Written 2026-09-27 against catalog `generatedAt` 2026-09-27T00:37:45Z (4,250 listings, `stateSchemaVersion: 2`) and the marketplace repository at commit `fec33e6b`.

Revised after cross-checking PR head `6703e917`, the ranking/refresh/render code, the live feeds and marketplace commit `fec33e6b14b3ab01e2c31faf36ea8e083965c82e`. Implementation has not started. Decisions from review: exclude unreachable plugins immediately; make published explanations snapshot-versioned before changing ranking behaviour; treat verification credit, install-rate weights and the freshness bonus as proposals that require a fixed-input comparison before activation.

This document is an implementation plan for an LLM or a human contributor. It records what changed upstream, what OmaPicks currently gets wrong because of it, and an ordered set of work packages with file-level instructions, tests and acceptance criteria. Complete the packages in order; each is independently shippable and each later package assumes the earlier ones are merged.

## 1. Background

OmaPicks ranks two public feeds: `https://plugins.omarchy.org/catalog.json` and `https://api.omarchyplugins.com/v1/stats`. The current published snapshot (`data/rankings.json`, week 2026-W39) was built from a 3,697-listing catalog. Since then the Omarchy Plugin Marketplace (`omacom/omarchy-plugin-marketplace`) has shipped several structural changes. The stats feed is unchanged (`schemaVersion: 1`, `views`, `copies`, `hearts` per plugin ID, five-minute edge cache).

### 1.1 New catalog fields and their meaning

All values below were verified against the live catalog and the marketplace source (`scripts/build-catalog.mjs`, `scripts/catalog-verification.mjs`, `VERIFICATION.md`).

| Field | Values seen | Meaning |
| --- | --- | --- |
| `stateSchemaVersion` (top level) | `2` | Catalog state schema. Currently unchecked by OmaPicks. |
| `warnings` (top level) | array of `"<repo>: <code>"` | Sources whose last refresh failed (`repository-unreachable`, `manifest-invalid`, `preview-invalid`). |
| `verificationStatus` | `verified`, `unverified`, absent (built-ins) | **Effective** status. Becomes `unverified` as soon as the observed upstream commit differs from the verified snapshot. |
| `verificationSnapshotStatus` | `verified`, `unverified` | Whether the listed commit (`listingValidatedCommit`) has exact-commit verification evidence. |
| `verificationCoverage` | `snapshot-verified`, `update-unverified`, `unverified` | Relationship between the verified snapshot and the currently observed upstream commit. `update-unverified` means the snapshot is verified but upstream has moved on. |
| `verificationMethod` | `maintainer-reviewed` or absent | Absent means automated baseline pass. |
| `verificationCommit`, `verificationCheckedAt`, `verificationBaselineVersion` | sha, ISO, `"3"` | Evidence identity. |
| `upstreamCheckStatus` | `passed`, `unreachable`, `failed` | Result of the latest daily catalog refresh (04:17 UTC) against upstream HEAD. |
| `upstreamCheckError` | `repository-unreachable`, `manifest-invalid`, `preview-invalid` | Present when the check did not pass. |
| `upstreamObservedCommit`, `upstreamObservedBranch`, `upstreamCheckedAt`, `upstreamValidatedCommit`, `upstreamValidatedAt` | sha / ISO | Observed and last-validated upstream identity. |
| `status` | `Available`, `Manual setup`, `Status unknown`, `Compatibility failed`, `Built in` | Human status. `Status unknown` = unreachable repo; `Compatibility failed` = manifest or preview failure. The catalog **preserves the previous install command and `installAvailable: true`** for unreachable root plugins. |
| `addedAt`, `listedAt` | `YYYY-MM-DD`, ISO | Listing date. |
| `version`, `versionUpdatedAt` | semver-ish, ISO | `versionUpdatedAt` is when the catalog refresh observed a manifest version change. Only recorded since August 2026; absent for most plugins. |
| `repositoryRelease` | `{ tag, url, publishedAt? }` | Latest GitHub release or tag. `publishedAt` is absent for bare tags. |
| `repositoryUpdatedAt` | ISO | GitHub `pushed_at` (falls back to `updated_at`). Counts any push on any branch. |
| `stars` | integer | GitHub `stargazerCount`; repo-level, so plugins sharing a repository share stars. |
| `sourceType`, `builtIn`, `officialCommand`, `officialCommandLabel`, `sourceUrl` | `community` or `builtin` | 36 Omarchy Quattro built-ins are listed with `sourceType: "builtin"`, an empty `installCommand`, no `installAvailable`, and an `officialCommand` such as `omarchy bar plugin add omarchy.weather`. |
| `repositoryLayout` | `root-plugin`, `monorepo`, `suite` | Multi-plugin repositories exist (for example `bjarneo/omarchy-shell-plugins` lists three plugins). |
| `category` | adds `Kids`, plus built-in categories `Bar widgets`, `Services`, `Overlays`, `Panels`, `Bars`, `Menus` | Still not eligibility evidence under `docs/classification.md`. |

Values that OmaPicks checks today but the catalog never emits: `status` of `retired` or `delisted` (see `eligibilityReason` in `build/rank.mjs`). Delisted plugins are removed from the catalog entirely. The retired ID list lives only in the marketplace repository's `registry.json` (`retiredPluginIds`, 23 entries), which is not served on the website.

### 1.2 New marketplace behaviour that matters to OmaPicks

- The marketplace now publishes its own **overall rank** on cards (sum of competition ranks on hearts, copies, views and stars; ties produce ranks such as `1, 1, 3`, not dense ranks `1, 1, 2`; `engagementRanks` in `site/assets/js/shared.js`).
- It computes an **install rate**: install-command copies per detail view, ranked by the lower bound of the 95% Wilson interval, unrated below 20 views (`installRateScore` in `shared.js`). Hidden Gems and a Just Landed strip (24-hour and 7-day listing counts) use it. Copies can originate from cards without a detail view, so this is an aggregate engagement proxy, not a tracked conversion funnel or measured installation rate. The displayed capped ratio and the Wilson score are different values.
- The marketplace's `AGENTS.md` records maintainer approval, dated 2026-09-23, for client-side orderings and selections derived from the anonymous engagement aggregates. This is a useful precedent for OmaPicks deriving the same ratio from the same public feed.
- `https://plugins.omarchy.org/explorer-data.json` (about 3.9 MB) publishes 16 keyword clusters, TF-IDF nearest neighbours and edges for every community plugin, plus a daily listing-growth series since 2026-07-28.
- `site/assets/js/taxonomy.js` in the marketplace defines explicit Kids, VPN and Bar filter rules, including a VPN provider identity-term list.

### 1.3 Measured impact on the current snapshot

Cross-check of the 108 champions and runner-ups in `data/rankings.json` (2026-W39) against the 2026-09-27 catalog:

| Observation | Count |
| --- | --- |
| Picks whose snapshot is verified but effective status is `unverified` (`update-unverified`) | 44 of 108 |
| Picks never verified | 12 of 108 |
| Picks with `upstreamCheckStatus: unreachable` still ranked | 1 (Music runner-up `quickshell.ytmusic`, `status: "Status unknown"`) |
| Eligible cohort plugins with unreachable repos | 32 of 3,668 |
| Eligible plugins with a recorded `versionUpdatedAt` | 855 |
| Eligible plugins with a `repositoryRelease` | about 1,277 catalog-wide |
| Eligible plugins listed in the last 7 / 14 days | 593 / 1,068 |
| Stats IDs not in the catalog (all retired) | 18 |

Conclusions:

1. The binary 5% `verified` weight loses all credit when upstream moves beyond a verified snapshot, while the 13% freshness weight can reward that push. Partial credit is an editorial choice to recognise retained snapshot evidence; it must not imply verification of newer code.
2. Unreachable repositories keep competing because `eligibilityReason` only looks at `installAvailable`, `installCommand`, `repo` and a `status` value that never occurs. An unreachable check is not proof that a repository is permanently gone.
3. Freshness measures pushes, not shipping. Version bumps and releases are now visible.
4. Views measure exposure. Copies per detail view can provide complementary engagement context, but card-copy behaviour affects the ratio and the Wilson lower bound depends on view count. Neither value is exposure-independent.
5. Built-ins, listing dates, retirement and explorer neighbours are unused value.

## 2. Guardrails for every package

- Keep the site static and offline-rendered. `npm run build` must never touch the network. Only `build/refresh.mjs` and the research scripts fetch.
- Do not add runtime dependencies. Node 24 built-ins only.
- Every change to scoring, ranking eligibility or incumbent selection bumps `METHODOLOGY.version` once per implementation PR. Update the matching versioned methodology definition, page text and home-page explanation; published pages must use the saved snapshot's methodology, not the newest code's constants. Package 0 establishes this contract before Package 2 changes eligibility.
- Every classification semantics change bumps `CLASSIFICATION_VERSION`. Packages 1 to 6 do **not** change classification; leave it at 2.
- Preserve the split licensing and attribution text. New upstream data (explorer data, registry) needs an attribution line on the methodology page's data sources section (`build/render.mjs`, near "Plugin catalog" in the data sources list) and in `README.md` under "Data sources and attribution".
- Tags, `kind`, `category`, explorer clusters and marketplace filters remain **context only**, never eligibility evidence (`docs/classification.md`).
- Never rank built-ins. They have no marketplace install command and no engagement in the same sense.
- Tests: use the Node version pinned by `.nvmrc` (currently 24.21.0; the declared minimum is 24.20.0), then run `npm run check` (which already runs `npm test` before building). Add fixture-based unit tests beside the existing ones in `test/rank.test.mjs`, `test/refresh.test.mjs` and `test/render.test.mjs`. Do not run `npm run refresh` in tests. Review baseline: 169 tests and the offline build passed on Node 24.19.0, but this does not replace validation on the supported runtime.
- Do not commit a new weekly snapshot as part of these packages. The Monday workflow (`.github/workflows/weekly-rank.yml`, 06:17 UTC) activates merged ranking changes when it publishes the next snapshot. A methodology bump alone does **not** bypass the existing same-week freeze, and merely running `node build/refresh.mjs` manually does not force recalculation. Package 0 adds an explicit `--republish` option for a deliberate separate midweek publication; normal refresh and workflow dispatch retain the freeze when taxonomy/classifier are unchanged. Until publication, the site must continue explaining the old snapshot's rules. Existing taxonomy/classifier-triggered recalculation remains supported; adding built-in metadata to the taxonomy in Package 6 also changes its hash and must be considered when scheduling a refresh.
- Commit messages: imperative, one logical change per commit, no model identifiers.

## 3. Work packages

### Package 0: Versioned publication and scoring comparison

Purpose: keep published scores, explanations and weights consistent while implementation PRs merge between weekly refreshes, and make scoring choices reviewable before activation.

Files: `build/rank.mjs`, a shared versioned methodology module if useful, `build/refresh.mjs`, `build/render.mjs`, `scripts/compare-methodologies.mjs` (new offline research command), relevant tests, `README.md`.

Changes:

1. Preserve an immutable methodology definition for existing `1.0.0` snapshots, including weights, decay, evidence damping, eligibility and incumbent-selection rules. Add a resolver keyed by `rankings.methodologyVersion`; future definitions are added without changing old ones. Snapshot metadata may embed the definition as well, but older snapshots must resolve correctly without new fields. Unknown versions fail the build clearly rather than silently using current constants.
2. Route the methodology page, home-page explanation, comparison explanations and any fallback contribution calculations through the saved snapshot's definition. Current scoring still uses the current methodology. Fresh calculation logs identify the methodology used; skipped-refresh logs explain that the published version is unchanged. Update `formatRefreshLog`'s hard-coded signal list when new signals are activated.
3. Add an explicit `refresh({ republish: false })` / CLI `--republish` bypass of the same-week freeze. It must run normal feed validation and preserve the existing same-week changelog behaviour. `--dry-run` remains read-only even when combined with `--republish`; neither option bypasses validation. Do not change the scheduled workflow to republish automatically on a methodology-only change.
4. Before activating Packages 3, 4 or 5, capture one catalog, stats feed, taxonomy, previous snapshot, analysis time and code revisions, with hashes. Run an offline comparison against these identical inputs. Report changed champions and runner-ups, raw-score leaders, score/contribution deltas and hysteresis decisions. Compare each proposed scoring change alone against its immediate baseline and then the combined result; never compare separately fetched live feeds or different clocks. Reports are research artifacts, not new weekly snapshots.
5. Compare the proposed `update-unverified` credit of `0.6` with `0` and `1`, the install-rate weight of `0.05` with the existing zero weight, and the proposed freshness bonus with existing push-only freshness. Include sparse cohorts, 19/20-view boundary cases and bonus saturation. Record the chosen parameters and rationale in the implementing PR before merge. Upstream supplies field semantics and a Wilson formula; it does not establish OmaPicks' weights as optimal.

Tests:

- New renderer code plus an unchanged `1.0.0` snapshot still shows the old weights and rules; new snapshots show their own version. Historical snapshots continue rendering.
- A methodology-only change leaves ordinary same-week refresh frozen; explicit republish recalculates, preserves prior weekly events and remains subject to validation; dry-run writes no snapshot/state files.
- The comparison command makes no network requests, changes no published data and produces deterministic results from identical captured inputs.

Acceptance: deployable renderer changes cannot misdescribe the currently published snapshot. No scoring proposal is activated without its fixed-input comparison and recorded parameter decision.

### Package 1: Record and validate the new feed shape

Purpose: make the next upstream change visible immediately and give later packages a tested foundation.

Files: `build/refresh.mjs`, `test/refresh.test.mjs`, `test/fixtures/` (add a small schema-2 catalog fixture if the existing tests build catalogs inline; check how `test/refresh.test.mjs` constructs feeds and follow that pattern).

Changes:

1. In `validateFeeds`, accept `catalogFeed.stateSchemaVersion` of `2` (and, for backward compatibility with older fixtures, `undefined`). Throw on any other value with a message naming the value. Accept `catalogFeed.warnings` as absent or an array of strings.
2. In `refresh`, add to `source.catalog`: `stateSchemaVersion`, `mode` (the catalog's `mode` string, currently `"production"`), `warningCount`, and `builtInCount` (count of `sourceType === "builtin"`).
3. In `formatValidation`, append the warning count and built-in count, for example: `Catalog schema 2; 42 upstream warnings; 36 built-in listings excluded.`
4. In `formatRefreshLog`, when `warningCount > 0`, add one line listing the warning codes with counts (`repository-unreachable 35; manifest-invalid 6; preview-invalid 1`). Parse the code as the text after the last `": "` in each warning string.

Tests:

- `validateFeeds` rejects `stateSchemaVersion: 3` and accepts `2` and `undefined`.
- The dry-run log includes the schema line and the warning breakdown.
- Existing tests keep passing with fixtures that lack the new fields.

Acceptance: `npm test` green; a dry run against the fixture prints the new lines.

### Package 2: Upstream health gates eligibility

Purpose: exclude plugins whose latest marketplace check is failed or unreachable. Use immediate exclusion in this implementation; outage grace is deferred.

Files: `build/rank.mjs`, `build/classification-audit.mjs`, `build/refresh.mjs`, `build/render.mjs` (versioned explanations), `test/rank.test.mjs`, `test/classification-audit.test.mjs`, `test/refresh.test.mjs`, `docs/classification.md`, `README.md`.

Changes:

1. Order `eligibilityReason(plugin)` as follows: validate the plugin ID; check `sourceType === "builtin" || builtIn === true` and return `"built-in"`; check failed/unreachable health and return `"compatibility-failed"` / `"repository-unreachable"`; retain the retired/delisted check; then check installation availability/command and the HTTPS repository. Health and built-in checks must precede `not-installable`: real failed listings have `installAvailable: false` and an empty command, while built-ins lack marketplace installation availability.
2. Treat absent `upstreamCheckStatus` as no health exclusion for legacy inputs, without synthesising a successful upstream check. Exclude both failed and unreachable incumbents immediately. Existing `pickWithHysteresis` selects a replacement when the incumbent is no longer eligible. Do not add a `held` field or hold UI in this package.
3. `publicCandidate`: add `upstreamCheckStatus` (string or `null`). Keep ranker, discovery eligibility and classification audit consistent; excluded plugins cannot appear among ranked picks or accepted task assignments. Verify audit evidence and counts, not merely reason wording.
4. `report.excluded` gains the reason counts. Include their breakdown in refresh logs, plus affected incumbent IDs/names and reasons, so `quickshell.ytmusic` is identifiable in the dry run. Use the same per-ID exclusion information later in Package 7.
5. Explain immediate exclusion in `docs/classification.md`, README and the new versioned methodology definition. Bump `METHODOLOGY.version` once for the eligibility change even though numeric weights are unchanged. Keep `CLASSIFICATION_VERSION` at 2 because task-matching semantics are unchanged.

Deferred grace design: reinserting an unreachable pick with zero freshness/verification is temporary eligibility, not guaranteed retention. A review replay against the current Music cohort gives YouTube Music about `0.812` versus Music Flow about `0.946`, replacing the intended held runner-up immediately. Any future grace proposal must choose guaranteed retention versus temporary eligibility, track the first affected ISO week independently of slot, prevent same-week reruns consuming grace, specify recovery and whether a held runner-up can be promoted, and align audit evidence and installation UI with the exception. It needs a separate methodology bump and tests before adoption.

Tests:

- Fixtures matching upstream output: built-in without `installAvailable`; failed listing with `installAvailable: false` and empty command; unreachable root listing retaining an install command; otherwise eligible legacy listing without health. Assert the precise reason for each.
- Failed and unreachable incumbents leave both places immediately. `changesBetween` / `runnerUpChangesBetween` report `displaced` when a replacement exists and `vacated` only when the slot becomes empty. A recovered plugin competes normally on a subsequent snapshot.
- Ranker/audit agree on exclusions, cohort membership and evidence for remaining picks; refresh logs identify excluded incumbents.
- Snapshot round-trip retains `upstreamCheckStatus`; older snapshots without it still render under their original methodology.

Acceptance: with the 2026-09-27 catalog, `quickshell.ytmusic` is reported as `repository-unreachable` in the dry-run summary.

### Package 3: Graded verification signal

Purpose: give partial credit for verified snapshot evidence while accurately distinguishing newer unverified upstream code.

Files: `build/rank.mjs`, `build/render.mjs`, `test/rank.test.mjs`, `test/render.test.mjs`, `README.md`.

Changes:

1. Add a shared coverage resolver used by `verificationCredit(plugin)`, serialization and rendering. Preserve recognised explicit coverage. Only when coverage is absent, derive `"snapshot-verified"` from legacy `verificationStatus === "verified"`, otherwise `"unverified"`; unknown explicit values receive no credit. `verificationCredit(plugin)` uses this resolved coverage:
   - `verificationCoverage === "snapshot-verified"` → `1`
   - `verificationCoverage === "update-unverified"` → proposed credit `0.6`, subject to the Package 0 fixed-input comparison and recorded decision
   - anything else → `0`
   - Backward compatibility: use the shared resolver, so a legacy verified input earns full credit and serializes/renders consistently.
   - Do not add extra credit for `verificationMethod === "maintainer-reviewed"`; both methods describe the same exact-commit fact. Mention that decision in the methodology text.
2. In `scoreCohort`, replace `normalized.verified = plugin.verificationStatus === "verified" ? 1 : 0` with `normalized.verified = verificationCredit(plugin)`.
3. Keep `METHODOLOGY.weights.verified` at `0.05`. Store the chosen partial credit in the versioned methodology definition and bump to the next minor after Package 2; use one bump per PR.
4. `publicCandidate`: add resolved `verificationCoverage` and `verificationMethod` (string or `null`), preserving `verificationStatus` for compatibility. Do not unconditionally default missing coverage to `"unverified"` after awarding legacy verified credit.
5. `build/render.mjs`:
   - `statusPill`: show three states. `snapshot-verified` → "Snapshot verified"; `update-unverified` → "Verified snapshot; update unverified"; otherwise "Community". Keep the CSS class `verified` for the first, add a class `verified-stale` and a matching muted style in `site/styles.css`. Use the shared legacy resolver when coverage is absent. Badge wording describes evidence; it does not change historical scoring.
   - `signalDelta` for `verified`: use recorded `contributions` when present; any fallback uses the snapshot's methodology, including its binary or graded verification rule, rather than applying today's credit to old scores.
   - The new methodology explanation states all three coverage states and the chosen partial credit. Verification describes an exact listed commit, not later code. Add a visible installation note that the command obtains mutable upstream HEAD and is not bound to the verified snapshot, even when the latest observed commits matched. Link to `https://github.com/omacom/omarchy-plugin-marketplace/blob/main/VERIFICATION.md`.
   - Include the distinction in accessible text; do not rely on a `title` attribute alone.
6. `README.md` "Ranking method": update the verification sentence.

Tests:

- Resolver/credit table tests for recognised states, unknown explicit values and missing coverage with both legacy status values.
- Ranking test: otherwise identical snapshot-verified and update-unverified plugins differ by `0.05 * (1 - chosenCredit)` (allowing for rounding); snapshot-verified versus unverified differs by `0.05`.
- End-to-end unit fixture: rank a legacy verified plugin without coverage, JSON serialize/parse its snapshot, then render it. Its credit and badge must agree. Also cover all three explicit states and an unchanged historical snapshot's fallback contribution logic.

Acceptance: the fixed-input comparison documents the chosen credit and every affected pick. Do not require zero pick changes: partial credit can legitimately change rankings. The Actions summary identifies the new methodology, and installation copy does not imply verification of mutable upstream code.

### Package 4: Copy/view signal reduces raw-view weight

Purpose: add the marketplace's public engagement proxy while retaining a smaller exposure signal. Do not describe it as measured conversion, actual installs or exposure-independent evidence.

Files: `build/rank.mjs`, `build/render.mjs`, `site/styles.css` if a new bar is added, `test/rank.test.mjs`, `test/render.test.mjs`, `README.md`.

Changes:

1. Add `copyViewRatio(copies, views)` and `installRateLowerBound(copies, views)` to `build/rank.mjs`. Sanitize counts consistently with upstream, then use `min(copies, views) / views` for the capped ratio (`null` with zero views). For the scoring helper return `null` below 20 views, exactly `0` for zero copies at or above the gate, otherwise the Wilson 95% lower bound (`z = 1.96`). Its rated numeric formula matches upstream `installRateScore`; OmaPicks uses `null` rather than upstream's `-1` sentinel, and installation eligibility is enforced separately. Cite `site/assets/js/shared.js` at the reviewed upstream commit.
2. In `scoreCohort`, normalize the `installRateLowerBound` values with the existing percentile-plus-scale treatment but **without** `log1p`. Only rated values enter the percentile and scale maps; unrated candidates receive `0.5` before reliability damping. Define empty, singleton and all-zero map behaviour explicitly using existing percentile/scale conventions; never produce `NaN`. Keep existing reliability damping. The neutral prior can outperform a low rated value and creates a transition at 20 views: inspect those effects in the fixed-input comparison before adopting this treatment.
3. Proposed weights: change `views: 0.08` to `views: 0.03` and add `installRateLowerBound: 0.05`; total stays `1.0`. Select and record the final weight after the Package 0 comparison. Store the gate, normalization rule and chosen weight in the new methodology definition and bump its version.
4. `publicCandidate.metrics` gains distinct `copyViewRatio` and `installRateLowerBound` fields (rounded to 4 places, or `null`). `normalized` and `contributions` gain only the scored `installRateLowerBound` key. Calculate using full precision before rounding published values.
5. Tie-breaks in `scoreCohort` stay as they are.
6. `build/render.mjs`: separate display metrics from scoring keys. Show the raw capped `copyViewRatio` in comparison bars as "Copies per detail view (capped)", formatted as a percentage; zero copies is `0%`, zero views is "No detail views". Mark candidates below 20 views as "Not rated (under 20 views)" even when a raw ratio is available. If displaying the Wilson value, label it separately as "Copy/view lower-bound score". Contribution explanations use the scored key and describe stronger copy/view evidence rather than claiming views converted into installs. For example, 17 copies and 64 views display `26.6%`, while the scoring lower bound is about `0.1730`. Keep historical snapshots without these fields free of invented values or contributions.
7. Update snapshot-versioned home/methodology explanations and the data-source note: these are anonymous counters, copies can occur on cards without a detail view, and no installation or user-level conversion is measured. Wilson's view-count adjustment is a ranking heuristic here; it does not establish a measured conversion probability.
8. `README.md` "Ranking method": describe the ratio and its separate scoring adjustment.

Tests:

- Hand-checked ratio and lower-bound values: 17/64, 0/20, 20/20 and copies exceeding views. Verify 5/5 and all 19-view cases are unrated; cover 19/20 transitions, zero views and invalid counts.
- Normalization tests for no rated candidates, one rated candidate, all-zero values and mixed rated/unrated candidates. Verify finite scores and unchanged count normalization.
- Assert the contribution of the new signal in a controlled fixture. Do not require every higher-ratio plugin to win overall: copies, views, reliability and hysteresis can legitimately outweigh it.
- Render tests distinguish raw ratio from lower bound, zero from missing values, rated from unrated candidates, and historical absence from a genuine under-20 observation.

Acceptance: the snapshot's weight table sums to 100%, names six signals plus verification if the proposed signal is adopted, and agrees with stored contributions. The fixed-input comparison records the effect of the gate, neutral prior and selected weight; displayed ratios never masquerade as Wilson scores or measured conversion.

### Package 5: Release metadata and a proposed freshness bonus

Purpose: expose release/version evidence and evaluate a modest addition to push-based freshness. The proposed formula still gives a recent push full credit and can saturate at 1; it does not reliably distinguish shipping from pushing. Do not promise that stronger distinction without a separately evaluated formula.

Files: `build/rank.mjs`, `build/render.mjs`, tests, `README.md`.

Changes:

1. Add `shippedAt(plugin)` returning the latest finite timestamp among `versionUpdatedAt` and `repositoryRelease.publishedAt`, or `null`. Document that a manifest version-change observation and a repository release are proxies, not proof that a particular plugin shipped; repository releases can cover other plugins in a shared repository. A bare tag without `publishedAt` supplies no release date.
2. Evaluate the proposed formula using Package 0 before changing active scoring: use the latest valid push/shipping timestamp for the existing 180-day base decay; if the shipping observation is within 90 days, add `0.15 * decay(shippedAt, halfLife 90 days)`, capped at `1`. Parse dates before comparing and ignore missing/invalid timestamps; retain the existing nonnegative-age convention. Measure how many candidates hit the cap, the actual contribution changes, and the discontinuity when the bonus ends after 90 days. A fresh push already scores 1, so it cannot receive an additional bonus. If the comparison does not justify this addition, ship metadata only and retain the current freshness formula; record the decision instead of silently substituting a different formula.
3. `publicCandidate`: add `shippedAt` (ISO or `null`), `version` (string or `null`) and `releaseTag` (from `repositoryRelease.tag`, or `null`). Render the version and tag in the candidate byline when present, for example `v1.2.2 · MIT`.
4. If adopted, the new versioned methodology states the base decay, shipping-observation proxies, bonus, cutoff and cap. Otherwise leave the scoring explanation unchanged. Candidate metadata distinguishes the last repository push from the shipping observation; do not relabel the existing push-based `freshnessDays` as release age.
5. Bump `METHODOLOGY.version` if the freshness calculation changes. A metadata-only outcome does not require a scoring bump.

Tests:

- `shippedAt` picks the later valid timestamp and tolerates missing/invalid dates and a bare tag without `publishedAt`.
- If adopting the bonus: cover a 30-day release, same-day push saturation, absent push with a valid shipping date, no valid dates, future timestamps under the nonnegative-age convention, and both sides of the 90-day cutoff. Verify the cap and actual weighted contribution.
- Render test for the byline with and without version.

Acceptance: metadata renders with and without a release; the comparison documents either adoption or deferral of the bonus. If adopted, all freshness values are finite and within `[0, 1]`, and published explanations state its limits.

### Package 6: Built-in alternatives and listing age on the site

Purpose: value-add without touching scoring.

Files: `build/rank.mjs` (report only), `build/refresh.mjs`, `build/render.mjs`, `site/styles.css`, `data/app-types.json` (new optional field), tests, `README.md`.

Changes:

1. Taxonomy: allow an optional `builtIns: ["omarchy.weather"]` array per type in `data/app-types.json`. Validate in `prepareTaxonomy` that each ID is a string. Populate it editorially for the categories where a built-in exists: Weather, Battery, Bluetooth, Clipboard, Network, Notifications, Workspaces, Lock & Idle, Power & Session, System Updates, Keyboard Layouts, Audio, Music (media), VPN (tailscale). Use the exact IDs from the catalog (`omarchy.weather`, `omarchy.battery`, `omarchy.bluetooth`, `omarchy.clipboard`, `omarchy.network`, `omarchy.notifications`, `omarchy.workspaces`, `omarchy.idle`, `omarchy.lock`, `omarchy.power`, `omarchy.system-update`, `omarchy.keyboard-layout`, `omarchy.audio`, `omarchy.media`, `omarchy.tailscale`). Confirm each ID exists in the live catalog before adding it.
2. `rankPlugins`: for each type, attach `builtIns: [{ id, name, description, officialCommand, sourceUrl }]` resolved from catalog entries with `sourceType === "builtin"`. Missing IDs produce a warning in the report, not a failure.
3. `render.mjs` category page: a small "Included with Omarchy" box above the picks listing the built-in(s) with the official command in a code block and the note "Built into Omarchy Quattro; not ranked." Home page: no change.
4. Listing age: `publicCandidate` gains `listedAt` (ISO or `null`). Render age relative to the snapshot's `generatedAt`, labelled "Listed N days before this snapshot" when under 60 days, so rebuilds and archived weeks remain reproducible. For weekly highlights, count unique eligible classified IDs with `listedAt` after the latest available snapshot from an earlier ISO week and at or before this snapshot's time. Persist `rankings.newListings: [{ id, name, typeIds }]` plus the counting interval in the snapshot. A same-week republish retains the original interval start rather than resetting it to the last rerun; when no prior-week baseline exists, omit the weekly claim. Use "New listings in ranked categories since the previous snapshot" and show the interval, especially if refreshes skipped a week. No runtime fetch or separate report dependency is needed.
5. Attribution: add the built-in source URL (`https://github.com/omacom/omarchy`) to the data sources list.

Tests:

- Taxonomy validation accepts `builtIns` and rejects non-string entries.
- `rankPlugins` resolves built-ins and never places them in a cohort.
- Render test for the built-in box and snapshot-relative listing age; unique listing counts retain the interval across same-week republishes and tolerate a missing baseline.

Acceptance: the Weather category page shows the built-in box; the built-in never appears as a candidate.

### Package 7: Retirement awareness in the changelog

Purpose: say "retired by the marketplace" instead of "no longer available".

Files: `build/refresh.mjs`, `build/rank.mjs` (`leadershipChanges`), `build/render.mjs` (`changelogPage`), tests, `README.md`.

Changes:

1. During `refresh`, fetch `https://raw.githubusercontent.com/omacom/omarchy-plugin-marketplace/main/registry.json` with the existing `fetchJson` (timeout and retries). The file is about 7.5 MB, so bound streamed bytes (see `boundedFetch` in `scripts/category-discovery.mjs`) and consume only `retiredPluginIds`, validated as an array of strings. On failure, log a warning and continue with unavailable retirement evidence; do not confuse failure with a successfully fetched empty list. Retirement labelling must never block a refresh.
2. Record `source.registry` with URL, availability status, SHA-256 of the canonical sorted retired list and count (hash/count absent or null on failure). Retain the exact consumed list and response provenance in refresh replay inputs. A checksum alone cannot reproduce retirement decisions from a mutable URL.
3. `leadershipChanges`: for both `vacated` and `displaced`, use `reason: "retired"` if the old pick is absent from the catalog and confirmed retired; `reason: "delisted"` if absent and successfully checked against the registry; otherwise use a neutral `"missing-from-catalog"` reason when retirement evidence is unavailable. A present but excluded pick receives its eligibility reason; a present eligible pick displaced on score receives no removal reason. Treat an ID simultaneously live and retired as conflicting evidence, warn, and use current catalog eligibility rather than claiming retirement. Pass catalog IDs, retirement availability/set and the per-ID exclusion map into `changesBetween` and `runnerUpChangesBetween` via an optional third argument so existing call sites remain valid.
4. `changelogPage` and the Actions log: render the reason in plain words.
5. Data licence: the registry is MIT-licensed marketplace source; mention it in `README.md` under data sources.

Tests:

- Champion and runner-up changes label retirement, delisting and eligibility exclusions for both `displaced` and `vacated`; ordinary score replacement has no removal reason.
- `refresh` continues when the registry fetch fails or has invalid shape, logs the failure and uses neutral missing-listing wording; replay with captured retirement inputs reproduces reasons. Cover conflicting live/retired IDs.

Acceptance: a fixture refresh where the previous champion is retired logs "retired by the marketplace".

### Package 8: Explorer neighbours feed category discovery (research only)

Purpose: give the report-only discovery pilot another lexical lead source. It uses related catalog text, so it is not independent evidence of task fit. No taxonomy change.

Files: `scripts/category-discovery.mjs`, `data/category-discovery.json`, `docs/category-discovery.md`, `test/category-discovery.test.mjs`.

Changes:

1. Fetch `https://plugins.omarchy.org/explorer-data.json` using `fetchJson` with the existing streamed-byte-bounded fetch wrapper. Its roughly 3.9 MB fits the current 20 MiB limit; do not raise that limit without evidence. Validate unique non-empty node IDs; `node.index` matching its array position; neighbour indices as integers within the original node array; finite similarities in `[0, 1]`; and valid cluster IDs/membership. Reject a malformed optional graph with a warning and continue existing discovery.
2. Resolve neighbour indices against the original, unfiltered explorer nodes **before** joining by plugin ID to the current catalog. Only current eligible community plugins can seed or enter suggestions; exclude missing, built-in, failed and unreachable entries. Record catalog/explorer timestamp mismatches and skipped IDs; do not assume identical ordering or coverage.
3. Near-miss probe: for each OmaPicks type, recompute its current cohort from the captured catalog/taxonomy, collect eligible neighbours with `similarity >= 0.25`, deduplicate source-neighbour pairs, drop members already classified into that type, and report the top ten by summed similarity (plugin ID breaks ties). Use current catalog names/descriptions. Present under "Neighbour near-misses", explicitly labelled as lexical leads, never eligibility evidence.
4. Cluster gap probe: list clusters with more than half of their joined eligible members unclassified. Report both upstream cluster size and eligible joined size, calculate the unclassified share over eligible joined members, and give five deterministic samples. Kids & Education has 80 upstream members in the reviewed feed, but it is not a mandated outcome. Preserve existing three-repository/two-owner, persistence, dismissal and editorial rules before any proposal can progress to a new category.
5. Retain the full consumed explorer response in `inputs.json`, with source URL, checksum, `generatedAt`, `method` and availability/warning state, and include it in the report's input hash. Add an offline replay path (for example `--input <inputs.json>`) that uses all captured inputs without fetching. Timestamp and method alone are insufficient to replay an evolving graph. Bump discovery's `ALGORITHM_VERSION` when analysis semantics change so incompatible observations are not reused as persistence evidence.
6. Docs: explain graph joining, optional-feed failure, replay and the lexical limits in `docs/category-discovery.md`; add attribution.

Tests: a tiny graph produces deterministic near-miss and cluster output; indices remain correct after eligibility filtering; reject invalid/out-of-range indices, duplicate IDs and nonfinite similarities; tolerate missing, malformed or oversized explorer data while preserving the existing discovery report. Cover timestamp/ID mismatches, zero eligible cluster members, and byte-for-byte equivalent report output from offline replay of captured inputs.

Acceptance: the Tuesday workflow summary shows both sections, or explicitly explains why optional explorer analysis was unavailable. Captured inputs reproduce the report offline without changing taxonomy or rankings.

### Package 9: Optional consistency checks

Only if time permits. Each is small and independent.

- **Multi-plugin repositories.** In the methodology page, note that stars and push dates are repository-level and shared by plugins in one repository. Optionally add `report.sharedRepositories` listing repositories with more than one eligible plugin.
- **Marketplace VPN identity terms.** Add a unit test in `test/rank.test.mjs` that runs the marketplace's provider list (`airvpn`, `eduvpn`, `expressvpn`, `fortivpn`, `ivpn`, `mullvad`, `multivpn`, `netbird`, `nordvpn`, `nymvpn`, `openvpn`, `protonvpn`, `surfshark`, `tailscale`, `twingate`, `windscribe`, `wireguard`, `zerotier`) through the VPN type's patterns with a minimal description like "Connect and disconnect Mullvad from the bar" and reports which ones fail, so editorial can decide. Tailscale device discovery must still be excluded per `docs/classification.md`.
- **Stats orphan count.** In `formatValidation`, print how many stats IDs are absent from the catalog. Today that is 18 and all are retired; a jump would indicate a feed mismatch.

## 4. Suggested PR split

1. PR A: Package 0 (versioned publication, deliberate republish and offline scoring comparison) plus Package 1 (feed validation). No ranking-policy change yet.
2. PR B: Package 2 (immediate health exclusion), with a mandatory methodology bump even though weights are unchanged.
3. PR C: Package 3 (verification), including its fixed-input comparison and chosen credit, with one methodology bump.
4. PR D: Package 4 (copy/view signal), including its isolated comparison and chosen weight, with one methodology bump if adopted.
5. PR E: Package 5 (release metadata and evaluated freshness proposal), including an isolated and cumulative comparison. Bump methodology only if freshness scoring changes; metadata-only delivery is valid.
6. PR F: Package 6 (built-ins, listing age).
7. PR G: Package 7 (retirement).
8. PR H: Package 8 (discovery research).

Each implementation PR: run `npm run check` on the pinned Node runtime, and `npx playwright test` when rendered HTML changes. Update README and the corresponding versioned explanation in the same PR as the behaviour. Keep public wording about the currently published snapshot accurate until the next refresh. Do not combine verification, copy/view and freshness changes in one unanalysed score adjustment.

## 5. Verification checklist for the implementer

- [ ] `node build/refresh.mjs --dry-run` against the live feeds prints the schema line, warning breakdown, new exclusion reasons and the methodology version.
- [ ] Newly deployed code still renders the existing snapshot with its original weights, eligibility and incumbent-selection rules; unknown methodology versions fail clearly.
- [ ] Normal same-week refresh remains frozen after a methodology-only change; explicit `--republish` recalculates with validation and preserves weekly events; `--dry-run` never publishes.
- [ ] `data/history/*.json` from earlier weeks still render with their own methodology (fields absent → appropriate legacy fallbacks).
- [ ] Every eligibility/scoring/selection change receives a methodology bump. Task-matching changes alone govern `CLASSIFICATION_VERSION`.
- [ ] No built-in plugin appears in any cohort, candidate list or `unclassified` list.
- [ ] Failed and unreachable picks are excluded immediately, ranker/audit evidence agrees, and replacement versus vacancy events use the correct kind.
- [ ] Legacy verified inputs survive rank → JSON → render with consistent credit and badge wording; current-upstream commands are not described as verified-snapshot installs.
- [ ] Fixed-input comparisons document individual and combined scoring effects, final parameters, the 20-view boundary and freshness saturation/cutoff. No zero-change outcome is assumed.
- [ ] Raw copy/view ratios and Wilson lower-bound scores have separate fields and labels; historical missing data is not invented.
- [ ] Retirement and explorer replay inputs retain the exact consumed evidence; optional-feed failures are visible and do not masquerade as empty findings.
- [ ] Every new candidate field is documented in the `rankings.json` description on the methodology page.
- [ ] Attribution lists every upstream file consumed: `catalog.json`, `v1/stats`, `explorer-data.json`, `registry.json`, and the Omarchy repository for built-ins.
