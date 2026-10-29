# Methodology 1.3.0: a reviewed shortlist with current evidence

OmaPicks should save users the work of determining whether a plugin actually performs a task and what adopting it requires. An engagement score is useful only after those questions have defensible answers. This release strengthens eligibility and the explanation of results; it keeps the 1.2.0 scoring weights, normalization, damping and tie-breaks.

## Qualification before scoring

Every competing assignment needs all of the following:

- A complete capability set from the category's versioned contract, with a native core or substantial secondary role.
- Repository evidence at an immutable GitHub commit, including the file path and supporting passage.
- Reviewed requirements in `data/plugin-profiles.json`, shared across that plugin's category assignments and supported by pinned sources. An empty reviewed requirement list means no additional requirement was identified in those sources; missing review is `unknown`.
- A repository observation bound to the catalog's observed commit and the reviewed source revision, no more than eight days old at ranking time.
- The existing installability, HTTPS repository, built-in exclusion and marketplace health checks.

Legacy catalog-only reviews remain available for research but cannot enter a 1.3.0 shortlist. No minimum popularity, verification tier or arbitrary confidence score can substitute for these gates. A category can abstain when no option qualifies.

The source observer reads GitHub's immutable recursive trees; it never installs or executes plugins. Its fingerprint includes non-media implementation files, manifests, dependency files, submodules, file modes and every cited document. Uncited Markdown/reStructuredText prose and media and `.github/` metadata are ignored. Code beneath documentation directories still participates. Incomplete, malformed, oversized, missing and failed tree observations cannot validate a review. A changed fingerprint suspends qualification until an editor reviews the change; an unchanged fingerprint is a bounded change detector, not proof of runtime equivalence or external service stability.

Name/description edits with the same repository and unchanged relevant source preserve the reviewed capability set and review date. They enter a metadata reconciliation queue. A repository identity change does not inherit evidence. Source observation failures remain in replay inputs; if fewer than 75% of attempted observations succeed, weekly publication stops and preserves the published data. This operational outage guard is separate from per-plugin qualification.

## Task promises and user-facing claims

Five routes keep their URLs while tightening their minimum outcomes: Battery reads the computer's battery; Notes captures and reads notes; Color Picker picks and reuses a color; Containers inspects and performs documented container management; Firewall manages rules. Individual scope limitations remain visible. A bar replacement, privileged helper, external account or runtime dependency is a requirement, even if the plugin performs the category's native task well.

The current site calls its first option the **leading reviewed option**. Cohort coverage, source passages, requirements, review dates and validation dates accompany the recommendation. Sparse engagement and the popularity-heavy ordering remain explicit. Copy/view ratios are anonymous-counter proxies, not measured installs or independent user conversion trials. No installation, compatibility or security test is implied by a repository review.

Daily availability is a separate observation bound to the current weekly snapshot. Current health failures suppress the affected install action while the weekly ranking remains intact; another candidate is not silently promoted. Historical snapshots retain their original methodology and labels. The W44 migration is an explicit same-week republication; earlier weeks are not rewritten.

## Evaluation and operation

The [source audit](recommendation-evaluation.md) identifies the reviewed corpus, counterexamples and stratified sample. Fixed-input comparisons hold the catalog, engagement and clock constant while changing the taxonomy, reviews, shared requirements and methodology. Source observations travel with the capture so replay needs no network. This is an eligibility migration, not evidence that new weights improve recommendation quality.

Use `compare:task-fit` with a baseline input capture plus `--profiles` and `--observations` for the proposed source evidence. The migration report records those input hashes. Older 1.0–1.2 captures continue to use their recorded eligibility rules. The combined research workflow stages the proposed snapshot and tests its rendered pages; only the weekly workflow publishes rankings. Daily availability and weekly publication share a serialized, stale-base-checked publisher. See [automation](automation.md) for validation, recovery and deployment responsibilities.
