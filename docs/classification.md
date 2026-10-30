# Category eligibility, evidence and review

A category is a task someone wants to accomplish. Under methodology 1.4.0, define its action, target and minimum completed outcome before reviewing candidates. A recommendation needs an explicit capability review satisfying that shared task contract, pinned repository evidence, reviewed shared requirements and a recent matching source observation. Popularity is scored only after qualification; it cannot compensate for an unrelated or incomplete feature. See the [task-coherence decision record](methodology-1.4.0.md), [source-evidence rules](methodology-1.3.0.md) and [baseline investigation](categorization-investigation-2026-10-12.md).

## Discovery versus recommendations

Each type in `data/app-types.json` has a versioned `contract` with an outcome and `capabilitySets`. One complete capability set is the minimum for qualification. `include` and `nameInclude` patterns search names and descriptions separately for research leads. Tags, kind and upstream categories cannot qualify an assignment. Classifier 3 ignores explicit negation and matches contained in caption wording such as “the screenshot shows”. A real task claim elsewhere in that sentence still enters review: “the image shows a weather radar widget” supplies Weather Radar evidence, while the word “image” alone supplies no screen-capture evidence. Selected exclusions apply within matched clauses so unrelated capabilities do not cancel each other. Generic clauses must not cancel a real secondary feature. These checks reduce known errors; they do not establish semantic accuracy for arbitrary new prose.

Listing-specific judgments use `overrides.discoveryExclude` or `overrides.discoveryInclude`, keyed by plugin, category and exact name/description hash. They suppress or add a research lead for that captured listing and expire when its wording changes. They cannot veto a source-qualified or related assignment, bypass an explicit hold/rejection, or qualify a recommendation. The routine classification report and research-check summary identify expired records for cleanup or renewed review. Reviewers should remove redundant records when general rules correctly handle the listing.

`data/task-reviews.json` supplies the deterministic editorial decision. `qualified` core or substantial native secondary capabilities can compete equally. `related` integrations appear separately with their narrower scope; `rejected` assignments are excluded. Missing reviews and changed contracts or relevant sources enter the queue and cannot qualify. Metadata wording changes enter reconciliation; unchanged reviewed source can preserve only the existing capability judgment. Explicit `overrides.review` holds and `overrides.exclude` take precedence; an inclusion override alone cannot authorize a recommendation.

| Task | Direct fit | Insufficient scope |
| --- | --- | --- |
| Screen Capture | Create and export a screen image | A screenshot of the plugin's own interface |
| Screen Recording | Start, stop and save a recording | Recording status or a stop button for another recorder |
| Screen Brightness | Read and adjust display brightness | Physical lights; night light alone |
| Night Light | Adjust or schedule display colour temperature | A baby camera's night light |
| Network Connections | Operate network connections or adapters | Traffic measurements alone |
| VPN | Inspect tunnel state and operate VPN connections | A status-only tunnel indicator |
| Radio | Find and play radio stations | Wi-Fi/cellular radio hardware; song mixes |
| Peripheral Batteries | Identify a peripheral and expose its charge | A small mouse battery indicator inside unrelated settings |
| Battery | Read the computer battery charge or state | Phone/peripheral batteries or unplug-triggered behaviour |
| Notifications | Desktop notification history, management or DND | Sending app-specific alerts |
| Clipboard | Browse/reuse clipboard history or manage snippets | Reading/copying clipboard content; cross-device transport |
| Plugin Manager | Discover/install/update/remove plugins | Merely mentioning the plugin ecosystem |

Other boundaries are expressed by their contracts and fixtures. Hosting another plugin's popup does not inherit its task. A wider plugin with complete native controls can qualify; category-specific limitations belong in `constraints`; installation requirements belong in the shared `data/plugin-profiles.json` profile and are shown beside every recommendation for that plugin.

## Review a queued assignment

Read the latest Monday `recommendation-evidence` artifact or Tuesday/Thursday `review-evidence` artifact. Former picks with changed evidence and possible podium challengers receive priority, including single-category plugins. Former-pick priority survives replacement snapshots and later metadata edits until that assignment leaves the unresolved queue. Research cohorts exclude known related/rejected assignments, so tools that cannot compete cannot consume prospective podium positions. Scores prioritize research only. The committed `data/task-review-queue.json` preserves first/last seen dates and queue-departure counts (departures are not necessarily completed editorial reviews); reports show the original queue date and retained priority. Complete lexical evidence is in the artifact.

For each assignment, inspect the captured listing, contract, upstream documentation and plausible counterexamples. Record separately whether the source supports the capability and whether that capability completes the category's outcome on the stated target. Check the full qualified cohort, not only the current leading pair. Do not relax a task definition to retain an incumbent or fill a second card. Record provider, hardware, setup and scope requirements. Use immutable repository passages for every recommendation. Catalog evidence can support research triage, related scope or rejection but cannot qualify a source-reviewed recommendation. Do not claim an installation test unless one was performed.

Create an explicit JSON decision array:

```json
[
  {
    "pluginId": "example.capture",
    "typeId": "screenshots",
    "decision": "qualified",
    "role": "core",
    "capabilities": ["capture-image", "export-image"],
    "constraints": ["Requires the documented native capture utilities."],
    "reason": "Creates a region screenshot and saves the image for reuse.",
    "reviewedAt": "2026-10-29",
    "provenance": "repository-evidence",
    "source": {
      "url": "https://github.com/example/capture/blob/0123456789abcdef0123456789abcdef01234567/README.md",
      "revision": "0123456789abcdef0123456789abcdef01234567",
      "path": "README.md",
      "evidence": "The exact supporting passage from the reviewed README."
    }
  }
]
```

Use the exact capability names from the task contract. The helper binds explicit judgments to captured metadata and the contract version; it cannot invent approvals:

```sh
npm run review:tasks -- --input /path/to/inputs.json --decisions /path/to/decisions.json \
  --taxonomy data/app-types.json --existing data/task-reviews.json --output tmp/task-review-proposal.json
# Inspect the proposal, then incorporate reviewed decisions in data/task-reviews.json.
npm run compare:task-fit -- --input /path/to/inputs.json
npm run refresh -- --dry-run
npm run check
npm run test:e2e
```

Record shared requirements with `requirementsStatus: "reviewed"`, a review date and pinned `sources` in `data/plugin-profiles.json`; use `unknown` when they have not been reviewed. All task and requirement sources for a plugin must refer to the same reviewed commit so source comparison is coherent. A new qualification alone cannot bypass a missing requirements review.

A contract version identifies qualification requirements. Change the version whenever the required action, target or completed outcome changes meaning, even if the capability identifiers could be reused. A wording clarification that preserves those requirements does not invalidate existing reviews; its publication event must say so explicitly.

The default proposal output is research only. Omitting a source records the captured catalog checksum, listing URL, and the actual description (or name) with its catalog index and plugin ID. Evidence must point to the passage supporting that assignment's decision, including related or rejected scope; a category's capability template or the reviewer's rationale is not a source passage. Repository judgments must include their actual source revision and passage location. Metadata hashes bind name, description and repository, not maintenance dates or engagement. Source-tree observations automatically detect changes to relevant implementation files, manifests, dependencies and cited documents even when metadata stays unchanged. Changes need explicit re-review. Trees do not prove runtime behavior or detect changes in external services.

## Capture and replay

```sh
npm run audit:classification
npm run audit:classification -- --input /path/to/inputs.json --output tmp/classification-replay
npm run compare:task-fit -- --input /path/to/baseline-inputs.json
```

The audit writes inputs, JSON/Markdown reports and compact membership state under its output directory. Refresh also writes a priority queue and persists state/queue only on publication. Captures include full feeds, taxonomy, reviews, shared requirements, source observations (including failures), prior rankings/state/review queue, clock, classifier/methodology versions and code revision. Classifier 2 and 3 replay under their recorded methodologies; unknown versions fail. The task migration comparison preserves baseline taxonomy, reviews and selection as well as identical feeds/time. A taxonomy-only `--baseline` comparison remains supported for legacy methods; current eligibility migrations require `compare:task-fit` rather than silently reusing new decisions for the old taxonomy.

Dry runs write research artifacts but never change `data/` or published assets. Same-week publication skips fetching only when taxonomy, classifier, review and shared-requirement hashes match. A methodology-only change requires the next week or explicit `--republish`; deliberate republishes keep earlier events under the same methodology; a methodology migration starts its own event set and archives the superseded publication in the week's history file. The event set records its immediate publication baseline, and the changelog retains each publication's dates and methodology. Monday and Tuesday/Thursday artifacts are retained for 90 days and uploaded on failures when present. Validated inputs are written before qualification so malformed reviews can be investigated without publishing them.

## Global eligibility and new categories

All recommendation and discovery paths share installability, HTTPS repository and health checks. Failed/unreachable marketplace checks exclude the plugin immediately; successful later checks restore eligibility. Omarchy built-ins are shown separately and never ranked. A missing health result is not inferred as a failure. The optional retirement registry labels departures without blocking refresh.

Changelog reasons distinguish a related tool's narrower scope, an assignment awaiting qualification, and a real category exit. Pending, stale or held evidence removes recommendation eligibility immediately, but does not establish that the plugin stopped matching the task. Global health and retirement reasons take precedence. Refresh captures include the decisions needed to replay these reasons offline; historical events keep their recorded reasons across later republishes.

Category expansion normally needs a distinct task and at least three eligible repositories across two owners. Correcting an existing incoherent comparison may instead produce a sparse shortlist: record the corrective split and its evidence, show one option or abstain, and keep unreviewed replacements pending. This exception never waives per-assignment qualification. Check direct capability evidence, record the editorial decision in `data/category-discovery.json`, and update search/navigation. Lexical probes never authorize publication; owner diversity is not proof of independent authorship. The October 12 additions and stable route mapping are documented in [methodology 1.2.0](methodology-1.2.0.md); the October 30 corrective migration is documented in [methodology 1.4.0](methodology-1.4.0.md).

Tests include real catalog positive/negative fixtures, source-backed missed purposes, negation/preview references, native secondary versus integration scope, invalid/stale decisions, immediate incumbent removal, canonical selection, queue aging, legacy replay and feed/refresh safeguards. Browser checks cover evidence/requirements, related choices, snapshot age, navigation, accessibility and mobile layouts. This verifies encoded behavior, not the accuracy of all unreviewed catalog prose.

For category migrations, also run `node scripts/audit-discovery-recall.mjs`. Its frozen publication catalog retains baseline classifier, queue and shortlist assignments. Independently authored expectations in `test/fixtures/discovery-expectations.json` specify each appropriate destination, exact listing evidence and a metadata hash. The audit checks every split candidate reached by baseline rules, the initial proposal, preserved intermediate proposal routes or current rules with and without per-plugin overrides, including candidates introduced only after the split. It also checks changed routes in retained categories and named regressions. Missing and unexpected destinations are checked even when another successor matches. Source-reviewed membership is reported separately. Update judgments through editorial review; never generate expected targets from classifier output. `--write` regenerates only the report. A narrow new contract must not hide valid candidates through spelling or wording regressions.

The curated destination check includes explicit editorial exceptions, some based on the same judgments as its expectations. Zero curated mismatches therefore verifies that those judgments are implemented; it is not independent evidence of lexical precision. The separate `rulesOnly` totals remove every per-plugin override and source decision, reporting missing and unexpected routes and precision within this reviewed inventory. Neither measure estimates recall or precision across the full catalog. Fresh-ID regression tests also remove all overrides so known exceptions cannot hide rule defects.
