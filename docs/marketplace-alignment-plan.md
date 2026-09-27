# Marketplace alignment plan (catalog state schema 2)

Status: proposed, not started. Written 2026-09-27 against catalog `generatedAt` 2026-09-27T00:37:45Z (4,250 listings, `stateSchemaVersion: 2`) and the marketplace repository at commit `fec33e6b`.

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

- The marketplace now publishes its own **overall rank** on cards (sum of dense ranks on hearts, copies, views and stars; `engagementRanks` in `site/assets/js/shared.js`).
- It computes an **install rate**: install-command copies per detail view, ranked by the lower bound of the 95% Wilson interval, unrated below 20 views (`installRateScore` in `shared.js`). Hidden Gems and a Just Landed strip (24-hour and 7-day listing counts) use it.
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

1. The 5% `verified` weight in `METHODOLOGY.weights` is now inverted for active maintainers. A push after the verified snapshot drops the effective flag, so the 13% freshness weight rewards the same commit the verification weight punishes.
2. Dead repositories keep competing because `eligibilityReason` only looks at `installAvailable`, `installCommand`, `repo` and a `status` value that never occurs.
3. Freshness measures pushes, not shipping. Version bumps and releases are now visible.
4. Views are pure exposure; install rate captures intent and is exposure-independent.
5. Built-ins, listing dates, retirement and explorer neighbours are unused value.

## 2. Guardrails for every package

- Keep the site static and offline-rendered. `npm run build` must never touch the network. Only `build/refresh.mjs` and the research scripts fetch.
- Do not add runtime dependencies. Node 24 built-ins only.
- Every scoring change bumps `METHODOLOGY.version` in `build/rank.mjs` and updates the methodology page text in `build/render.mjs` (`methodologyPage`) and the short explanation on the home page (the paragraph beginning "This is not a vote").
- Every classification semantics change bumps `CLASSIFICATION_VERSION`. Packages 1 to 6 do **not** change classification; leave it at 2.
- Preserve the split licensing and attribution text. New upstream data (explorer data, registry) needs an attribution line on the methodology page's data sources section (`build/render.mjs`, near "Plugin catalog" in the data sources list) and in `README.md` under "Data sources and attribution".
- Tags, `kind`, `category`, explorer clusters and marketplace filters remain **context only**, never eligibility evidence (`docs/classification.md`).
- Never rank built-ins. They have no marketplace install command and no engagement in the same sense.
- Tests: `npm test` must pass, then `npm run check`. Add fixture-based unit tests beside the existing ones in `test/rank.test.mjs`, `test/refresh.test.mjs` and `test/render.test.mjs`. Do not run `npm run refresh` in tests.
- Do not commit a new weekly snapshot as part of these packages. The Monday workflow (`.github/workflows/weekly-rank.yml`, 06:17 UTC) publishes snapshots. A methodology bump is picked up on the next Monday because `refresh` only freezes a week when the taxonomy hash and classifier version match; a methodology change still recalculates next week. If a mid-week republish of the current week is wanted, run `node build/refresh.mjs` manually and commit, in a separate PR.
- Commit messages: imperative, one logical change per commit, no model identifiers.

## 3. Work packages

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

Purpose: stop ranking plugins whose repository is gone or whose manifest no longer validates, without churning incumbents on a one-day outage.

Files: `build/rank.mjs`, `build/classification-audit.mjs` (only if it echoes eligibility reasons; grep `excluded`), `build/render.mjs` (explanations), `test/rank.test.mjs`, `docs/classification.md` (one paragraph under Boundaries or a new "Eligibility" heading), `README.md` ("Ranking method" paragraph).

Changes:

1. In `eligibilityReason(plugin)` add, after the `not-installable` check and before the `retired` check:
   - `if (plugin.sourceType === "builtin" || plugin.builtIn === true) return "built-in";` (they already fail `not-installable`, but a named reason is clearer in the report).
   - `if (plugin.upstreamCheckStatus === "failed") return "compatibility-failed";`
   - `if (plugin.upstreamCheckStatus === "unreachable") return "repository-unreachable";`
   - Treat an absent `upstreamCheckStatus` on a community plugin as passed (older fixtures and snapshots).
   - Keep the existing `retired`/`delisted` status check; it is harmless.
2. Hysteresis interaction: `pickWithHysteresis` already vacates an incumbent that is no longer in the candidate list. That is the desired behaviour for `failed`. For `unreachable`, add a one-week grace so a transient outage does not vacate a place: in `rankPlugins`, when an excluded plugin is the previous week's winner or runner-up for a type **and** its reason is `repository-unreachable` **and** the previous snapshot did not already record it as unreachable, keep it in that type's cohort but mark the candidate with `held: "repository-unreachable"` and give it no freshness or verification contribution for the week. Record the hold in `decisions[].champion` / `runnerUp` text ("incumbent held one week while its repository is unreachable"). On the second consecutive week it is excluded normally. Implement the "previous snapshot recorded it" check by reading `previous.types[].winner.held` / `runnerUp.held`.
   - If this grace logic makes the package too large, ship the straight exclusion first and open the grace as a follow-up. Note the choice in the commit message.
3. `publicCandidate`: add `upstreamCheckStatus` (string or `null`) and `held` (string or `null`) to the published candidate so the site and the snapshot explain it.
4. `report.excluded` gains the new reason keys automatically. Update `formatValidation` wording in `build/refresh.mjs` if it lists reasons by name.
5. `build/render.mjs`: when a candidate has `held`, render a short muted note under the install command: "Repository unreachable at the last marketplace check; retained for one week." Do not show the copy button for a held candidate.
6. Documentation: explain in `docs/classification.md` and the methodology page that a listing whose repository failed the latest marketplace compatibility check cannot compete, and that an unreachable incumbent is retained for one week.

Tests:

- `eligibilityReason` returns the new reasons for `failed` and `unreachable`, and `null` when the field is absent.
- A cohort where the incumbent turns `unreachable` retains it one week with `held` set and vacates it the following week.
- A `failed` incumbent is vacated immediately and appears in `changesBetween` as `vacated`.
- Snapshot round-trip: `publicCandidate` includes the two new fields, and `render.test.mjs` renders the held note.

Acceptance: with the 2026-09-27 catalog, `quickshell.ytmusic` is reported as `repository-unreachable` in the dry-run summary.

### Package 3: Graded verification signal

Purpose: reward a verified snapshot without punishing maintainers for pushing commits.

Files: `build/rank.mjs`, `build/render.mjs`, `test/rank.test.mjs`, `test/render.test.mjs`, `README.md`.

Changes:

1. Add a helper `verificationCredit(plugin)` in `build/rank.mjs`:
   - `verificationCoverage === "snapshot-verified"` → `1`
   - `verificationCoverage === "update-unverified"` → `0.6`
   - anything else → `0`
   - Backward compatibility: when `verificationCoverage` is absent, fall back to `verificationStatus === "verified" ? 1 : 0`.
   - Do not add extra credit for `verificationMethod === "maintainer-reviewed"`; both methods describe the same exact-commit fact. Mention that decision in the methodology text.
2. In `scoreCohort`, replace `normalized.verified = plugin.verificationStatus === "verified" ? 1 : 0` with `normalized.verified = verificationCredit(plugin)`.
3. Keep `METHODOLOGY.weights.verified` at `0.05`. Bump `METHODOLOGY.version` to `1.1.0` (or the next minor if Package 2 already bumped it; use one bump per PR).
4. `publicCandidate`: add `verificationCoverage` (string, default `"unverified"`) and `verificationMethod` (string or `null`), keep `verificationStatus` as-is for the badge.
5. `build/render.mjs`:
   - `statusPill`: show three states. `snapshot-verified` → "Verified"; `update-unverified` → "Verified snapshot, newer upstream"; otherwise "Community". Keep the CSS class `verified` for the first, add a class `verified-stale` for the second and a matching muted style in `site/styles.css`. Fall back to the old two-state logic when `verificationCoverage` is absent (older snapshots in `data/history/`).
   - `signalDelta` for `verified`: use `contributions` when present (already does); the fallback flag should use `verificationCredit`-like logic on `verificationCoverage`.
   - Methodology page: replace "Verification is a small bonus, not a requirement." with a sentence explaining the three coverage states and that a verified snapshot with newer upstream code keeps most of the bonus, since verification describes the exact listed commit and not later code. Link to `https://github.com/omacom/omarchy-plugin-marketplace/blob/main/VERIFICATION.md`.
   - Add a `title` attribute or visually hidden text on the pill with the marketplace's own wording so screen readers get the distinction.
6. `README.md` "Ranking method": update the verification sentence.

Tests:

- `verificationCredit` table test for the four cases plus the fallback.
- Ranking test: two otherwise identical plugins, one `snapshot-verified` and one `update-unverified`, differ by exactly `0.05 * 0.4` in score (allowing for rounding); one `unverified` differs by `0.05`.
- Render test for the three pill states and the fallback on a snapshot without `verificationCoverage`.

Acceptance: re-running a dry run shows no pick flipping solely because of a stale effective flag; the Actions summary explains the methodology bump.

### Package 4: Install-rate signal replaces raw views

Purpose: use conversion instead of exposure. Mirrors the marketplace's approved derived metric so the definition is public and reproducible.

Files: `build/rank.mjs`, `build/render.mjs`, `site/styles.css` if a new bar is added, `test/rank.test.mjs`, `test/render.test.mjs`, `README.md`.

Changes:

1. Add `installRateLowerBound(copies, views)` to `build/rank.mjs`, identical to the marketplace's `installRateScore`: return `null` when `views < 20`; clamp `copies` to `views`; return `0` when copies is `0`; otherwise the Wilson 95% lower bound (`z = 1.96`) of `copies / views`. Cite the marketplace file in a comment.
2. In `scoreCohort`, add metric `installRate` to the `raw` map (`null` when unrated). Normalize it with the same `normalizedSignalMap` percentile-plus-scale treatment used for counts but **without** `log1p` (it is already a bounded ratio); rated plugins only enter the percentile map, and unrated plugins receive the cohort midpoint `0.5` before reliability damping. Keep the existing reliability damping.
3. Weights: change `views: 0.08` to `views: 0.03` and add `installRate: 0.05`. Total stays `1.0`. Bump `METHODOLOGY.version`.
4. `publicCandidate.metrics` gains `installRate` (rounded to 4 places, or `null`). `normalized` and `contributions` gain `installRate`.
5. Tie-breaks in `scoreCohort` stay as they are.
6. `build/render.mjs`: add `installRate` to `SIGNAL_METRICS` and to the labels map ("Install rate"), with the explanation "more of its listing views turned into install-command copies". In the comparison bars, format it as a percentage of views and show "not rated (under 20 views)" when `null`. Update the home page paragraph and the methodology page with the definition and the 20-view gate. Update the "Data sources" note that these are anonymous marketplace counters, not installs.
7. `README.md` "Ranking method": add one sentence.

Tests:

- `installRateLowerBound` against three hand-checked values (for example 17 copies of 64 views, 0 of 20, 5 of 5) and the `< 20 views` gate.
- Ranking test: a plugin with fewer views but a higher install rate outranks an otherwise identical plugin with many views and few copies when their other signals tie.
- Render test: bars render both a rated and an unrated candidate.

Acceptance: the weight table on the methodology page sums to 100% and names six signals plus verification.

### Package 5: Shipping-aware freshness

Purpose: distinguish "pushed something" from "shipped a version".

Files: `build/rank.mjs`, `build/render.mjs`, tests, `README.md`.

Changes:

1. Add `shippedAt(plugin)` returning the latest finite timestamp among `versionUpdatedAt` and `repositoryRelease.publishedAt`, or `null`.
2. Replace `freshnessScore(plugin.repositoryUpdatedAt, now)` with `freshnessScore(max(repositoryUpdatedAt, shippedAt), now)` for the base decay, and add a small bonus: if `shippedAt` is within 90 days, add `0.15 * decay(shippedAt, halfLife 90 days)` to the freshness normalized value, capped at `1`. Rationale: a release inside the freshness window is stronger evidence than a push, but most plugins have no recorded release, so the bonus must be small.
3. `publicCandidate`: add `shippedAt` (ISO or `null`), `version` (string or `null`) and `releaseTag` (from `repositoryRelease.tag`, or `null`). Render the version and tag in the candidate byline when present, for example `v1.2.2 · MIT`.
4. Methodology text: state the base decay (180-day half-life on the later of last push and last shipped version) and the release bonus.
5. Bump `METHODOLOGY.version`.

Tests:

- `shippedAt` picks the later of the two fields and tolerates a bare tag without `publishedAt`.
- Freshness test: identical push dates, one plugin with a release 30 days ago, verify the bonus and the cap.
- Render test for the byline with and without version.

Acceptance: `npm run check` renders; no candidate exceeds `normalized.freshness` of `1`.

### Package 6: Built-in alternatives and listing age on the site

Purpose: value-add without touching scoring.

Files: `build/rank.mjs` (report only), `build/refresh.mjs`, `build/render.mjs`, `site/styles.css`, `data/app-types.json` (new optional field), tests, `README.md`.

Changes:

1. Taxonomy: allow an optional `builtIns: ["omarchy.weather"]` array per type in `data/app-types.json`. Validate in `prepareTaxonomy` that each ID is a string. Populate it editorially for the categories where a built-in exists: Weather, Battery, Bluetooth, Clipboard, Network, Notifications, Workspaces, Lock & Idle, Power & Session, System Updates, Keyboard Layouts, Audio, Music (media), VPN (tailscale). Use the exact IDs from the catalog (`omarchy.weather`, `omarchy.battery`, `omarchy.bluetooth`, `omarchy.clipboard`, `omarchy.network`, `omarchy.notifications`, `omarchy.workspaces`, `omarchy.idle`, `omarchy.lock`, `omarchy.power`, `omarchy.system-update`, `omarchy.keyboard-layout`, `omarchy.audio`, `omarchy.media`, `omarchy.tailscale`). Confirm each ID exists in the live catalog before adding it.
2. `rankPlugins`: for each type, attach `builtIns: [{ id, name, description, officialCommand, sourceUrl }]` resolved from catalog entries with `sourceType === "builtin"`. Missing IDs produce a warning in the report, not a failure.
3. `render.mjs` category page: a small "Included with Omarchy" box above the picks listing the built-in(s) with the official command in a code block and the note "Built into Omarchy Quattro; not ranked." Home page: no change.
4. Listing age: `publicCandidate` gains `listedAt` (ISO or `null`). Render "Listed N days ago" in the candidate meta when under 60 days. In the weekly highlights (`homePage`), add a line "New in ranked categories this week: N plugins" computed from `listedAt` later than the previous snapshot's `generatedAt`, across all cohorts (count unique IDs). This needs the cohort membership, which `report` does not expose today; add `report.newListings: [{ id, name, typeIds }]` in `rankPlugins` and persist it in `data/unclassified-report.json` alongside the existing fields, or in the rankings snapshot under `rankings.newListings`. Prefer the snapshot so `npm run build` stays offline and single-source.
5. Attribution: add the built-in source URL (`https://github.com/omacom/omarchy`) to the data sources list.

Tests:

- Taxonomy validation accepts `builtIns` and rejects non-string entries.
- `rankPlugins` resolves built-ins and never places them in a cohort.
- Render test for the built-in box and the "Listed N days ago" text.

Acceptance: the Weather category page shows the built-in box; the built-in never appears as a candidate.

### Package 7: Retirement awareness in the changelog

Purpose: say "retired by the marketplace" instead of "no longer available".

Files: `build/refresh.mjs`, `build/rank.mjs` (`leadershipChanges`), `build/render.mjs` (`changelogPage`), tests, `README.md`.

Changes:

1. During `refresh`, fetch `https://raw.githubusercontent.com/omacom/omarchy-plugin-marketplace/main/registry.json` with the existing `fetchJson` (timeout and retries). The file is about 7.5 MB, so read it with a size-bounded fetch (see `boundedFetch` in `scripts/category-discovery.mjs`, or add an equivalent guard to `fetchJson`) and read only `retiredPluginIds`. On any failure, log a warning and continue with an empty list; retirement labelling is best-effort and must never block a refresh.
2. Record `source.registry = { url, sha256 of the retired list, retiredCount }` in the snapshot.
3. `leadershipChanges`: when `kind === "vacated"` or `"displaced"` and the previous pick's ID is in the retired list, add `reason: "retired"`. When the ID is missing from the catalog but not retired, add `reason: "delisted"`. When the ID is present but excluded, add `reason: <eligibility reason>`. Pass the retired set and the exclusion map into `changesBetween` and `runnerUpChangesBetween` via an optional third argument so existing call sites keep working.
4. `changelogPage` and the Actions log: render the reason in plain words.
5. Data licence: the registry is MIT-licensed marketplace source; mention it in `README.md` under data sources.

Tests:

- `changesBetween` labels retired, delisted and excluded vacancies.
- `refresh` continues when the registry fetch fails, and the log says so.

Acceptance: a fixture refresh where the previous champion is retired logs "retired by the marketplace".

### Package 8: Explorer neighbours feed category discovery (research only)

Purpose: give the report-only discovery pilot a second, independent lead source. No taxonomy change.

Files: `scripts/category-discovery.mjs`, `data/category-discovery.json`, `docs/category-discovery.md`, `test/category-discovery.test.mjs`.

Changes:

1. Fetch `https://plugins.omarchy.org/explorer-data.json` with `boundedFetch` (raise `MAX_FEED_BYTES` if needed; the file is about 3.9 MB). Validate `nodes[]` has `id` and `neighbors[]` with `index` and `similarity`.
2. Near-miss probe: for each OmaPicks type, take its current cohort members, collect their neighbours with `similarity >= 0.25`, drop members already classified into that type, and report the top ten by summed similarity with their names and descriptions. Present under a new "Neighbour near-misses" heading in `report.md`, clearly labelled as lexical similarity from the marketplace explorer, not evidence.
3. Cluster gap probe: list explorer clusters whose members are mostly unclassified by OmaPicks (for example `kids` with 80 members). Report cluster label, size, unclassified share and five sample listings. The Kids & Education cluster is the expected first candidate; the existing three-repository, two-owner rule and editorial review still apply before any category is added.
4. Record the explorer `generatedAt` and `method` in `inputs.json`.
5. Docs: add a paragraph to `docs/category-discovery.md` and the attribution line.

Tests: fixture with a tiny explorer graph; near-miss and cluster probes produce deterministic output; the run tolerates a missing or oversized explorer file.

Acceptance: the Tuesday workflow summary shows the two new sections.

### Package 9: Optional consistency checks

Only if time permits. Each is small and independent.

- **Multi-plugin repositories.** In the methodology page, note that stars and push dates are repository-level and shared by plugins in one repository. Optionally add `report.sharedRepositories` listing repositories with more than one eligible plugin.
- **Marketplace VPN identity terms.** Add a unit test in `test/rank.test.mjs` that runs the marketplace's provider list (`airvpn`, `eduvpn`, `expressvpn`, `fortivpn`, `ivpn`, `mullvad`, `multivpn`, `netbird`, `nordvpn`, `nymvpn`, `openvpn`, `protonvpn`, `surfshark`, `tailscale`, `twingate`, `windscribe`, `wireguard`, `zerotier`) through the VPN type's patterns with a minimal description like "Connect and disconnect Mullvad from the bar" and reports which ones fail, so editorial can decide. Tailscale device discovery must still be excluded per `docs/classification.md`.
- **Stats orphan count.** In `formatValidation`, print how many stats IDs are absent from the catalog. Today that is 18 and all are retired; a jump would indicate a feed mismatch.

## 4. Suggested PR split

1. PR A: Packages 1 and 2 (feed shape, eligibility). Methodology version unchanged unless the hold rule is considered scoring; if so bump once.
2. PR B: Package 3 (verification) with a single methodology bump.
3. PR C: Packages 4 and 5 (install rate, shipping freshness) with a single methodology bump.
4. PR D: Package 6 (built-ins, listing age).
5. PR E: Package 7 (retirement).
6. PR F: Package 8 (discovery research).

Each PR: `npm test`, `npm run check`, and `npx playwright test` when the rendered HTML changes. Update `README.md` in the same PR as the behaviour it describes.

## 5. Verification checklist for the implementer

- [ ] `node build/refresh.mjs --dry-run` against the live feeds prints the schema line, warning breakdown, new exclusion reasons and the methodology version.
- [ ] `data/history/*.json` from earlier weeks still render (fields absent → fallbacks).
- [ ] No built-in plugin appears in any cohort, candidate list or `unclassified` list.
- [ ] Every new candidate field is documented in the `rankings.json` description on the methodology page.
- [ ] Attribution lists every upstream file consumed: `catalog.json`, `v1/stats`, `explorer-data.json`, `registry.json`, and the Omarchy repository for built-ins.
