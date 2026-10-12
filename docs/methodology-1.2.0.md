# Methodology 1.2.0: qualify the task before ranking

The October 12 investigation found Syncthing winning screen capture because its description mentioned a screenshot of its interface. Other errors included physical night lighting treated as display brightness, wireless radios treated as audio playback, and small status integrations competing against complete tools. Fixing only those matches would still leave incomplete replacements and popularity-driven false recommendations. [The baseline investigation](categorization-investigation-2026-10-12.md) records the evidence and Actions analysis.

## Recommendation eligibility

Every category now has a versioned contract in `data/app-types.json`: a user outcome and alternative sets of minimum capabilities. A plugin must satisfy one complete set to compete. `data/task-reviews.json` stores explicit per-assignment judgments with:

- `qualified`, `related` or `rejected`, and a role of `core`, `substantial-secondary` or `integration`;
- capabilities, requirements, rationale, review date and catalog/repository provenance;
- source URL, revision or captured content hash, and evidence location;
- SHA-256 of the plugin's name, description and repository, plus the contract version.

Core and substantial native secondary capabilities qualify equally. A complete native control panel inside a larger plugin is a practical alternative; hosting another plugin's popup, showing status, or stopping an externally started recording is insufficient. Related tools remain discoverable separately. GoDark, for example, switches all radios/networking off and restores their prior state; it does not satisfy network selection and connection configuration. Explicit taxonomy holds and exclusions take precedence over reviews. Installability, HTTPS repositories, built-in exclusion and current upstream health checks still apply first.

Unreviewed assignments cannot enter recommendations. Changed metadata or contract versions invalidate a review immediately, including an incumbent whose new description no longer matches any discovery pattern. A published recommendation carries its contract and evidence; refresh and render independently reject missing, inconsistent or malformed qualifications. Regex matches and explorer neighbours supply research leads and never manufacture approval.

This is a conservative initial corpus, not a claim that every catalog plugin was manually evaluated. It includes 283 assignment decisions, with at least three qualified repositories per category. Straightforward, explicit task claims use captured catalog evidence; ambiguous and broad plugins use upstream documentation. The remaining claims enter a review queue rather than competing by default. Reviews establish documented capabilities, not successful installation, usability, security, or independent author verification.

Each source record identifies an actual listing passage or a location in the reviewed README, rather than repeating a category capability template. This applies equally to qualified, related and rejected decisions. VPN contract version 2 requires both tunnel status and native connection controls; a status-only indicator cannot qualify. The four reviewed VPN tools document these controls. MultiVPN's OpenVPN/WireGuard controls qualify, while its GlobalProtect connection handoff to an external client is recorded as a requirement beside the recommendation.

The metadata binding intentionally excludes engagement, push dates and version updates, so routine maintenance does not invalidate capability evidence. A README or implementation can change without changing catalog metadata: these changes are **not automatically detected**. Recorded source revisions make the decision inspectable; reviewers must revisit changed capabilities and requirements when found. Automatic source revalidation and task-specific adoption measurement remain future work.

## Focused categories and stable routes

There are 64 categories, including ten additions. Existing IDs and URLs remain available with narrower outcomes:

| Existing category ID | Current task | Separate task |
| --- | --- | --- |
| `brightness` | Screen Brightness | Night Light |
| `network` | Network Connections | Network Traffic & Diagnostics |
| `music` | Media Controls | Music Players |
| `clock-timer` | Clocks & Time Zones | Timers & Alarms |
| `focus` | Focus Sessions | Task Lists |
| `screenshots` | Screen Capture | Screen Recording; Screen Text Extraction |
| `ai-assistant` | Agent Sessions | AI Chat & Models |
| `launcher` | Application search and launch | Application Docks |
| — | — | File Synchronization |

The additions have distinct outcomes and at least three reviewed repositories across two owners. Their decisions are recorded in `data/category-discovery.json`. Repository diversity is a check on the available alternatives, not proof of independent authorship. Search aliases, starter collections and related-category navigation include the new tasks.

The cards explain why each choice fits and show its requirements and evidence link. Reviewed alternatives offer other choices; related integrations have a separate scope explanation. These details let visitors choose between provider-specific, hardware-specific and broader solutions without treating aggregate popularity as compatibility with their setup.

## Selection and scoring

The 1.1.0 signal weights, normalization, sparse-evidence damping, copy/view floor, freshness half-life and verification credits are unchanged. Signals are normalized within each **qualified** cohort. Copies, hearts and stars still describe the whole plugin; they do not measure adoption of its individual capabilities.

The champion is the current highest-scoring qualified candidate. The runner-up is the highest remaining candidate, with the existing copies/hearts/stars/ID tie-breaks. The old 10% incumbent margin is removed: on capped scores it could require an unattainable lead and put the raw leader in neither card. Weekly publication supplies stability. Historical snapshots still use their immutable 1.0.0 or 1.1.0 definitions.

The [fixed-input comparison](task-fit-comparison-2026-10-12.md) holds the October 12 feeds, engagement and time constant while changing taxonomy, qualification and selection together. It produces ten new categories, thirteen existing champion changes and 260 qualified assignments. It is a migration comparison, not an estimate of classification accuracy or an installation evaluation. The PR deliberately republishes W42 under 1.2.0; earlier weeks are retained and earlier W42 changelog events are preserved. The W42 Peripheral Batteries runner-up event now explains that Mouse & Keybind Settings remains a related tool with a narrower scope. Future events distinguish related or unresolved task evidence from a category exit, and those reasons replay from the refresh capture.

## Weekly operation and review handoff

- **Monday 06:17 UTC:** validate bounded feeds, apply reviewed evidence, archive inputs and priority reports, run tests/render and Playwright, then commit the snapshot and durable review queue. The browser checks run inside this workflow because its bot push does not trigger separate push CI.
- **Tuesday 06:43 UTC:** read-only discovery prioritizes capability reviews, including single-category former picks and possible challengers; then reports taxonomy gaps. Curated probes receive priority, and related coding-agent vocabulary shares one highlighted slot. This is lexical report allocation, not semantic adjudication. No model call, approval, category publication or PR happens automatically.
- **Thursday 06:17 UTC:** live dry run reports proposed picks and urgent reviews without publishing. Research inputs and queues may be written under `tmp/`; `data/` stays unchanged.

The committed queue retains first/last seen dates for unchanged evidence and records resolved assignments. Former-pick priority persists until resolution even after replacement snapshots; known related tools are excluded from prospective podium scoring. Monday, Thursday and Tuesday captures include the prior queue so this history replays offline. Captures contain the complete review file and checksums. Review-file changes, taxonomy changes and classifier changes bypass the same-week freeze; methodology-only changes still need `--republish`. Input captures are saved before qualification so malformed reviews leave replayable evidence, and workflow artifacts are uploaded even after a failure when present.

Weekly catalog and stats requests share a 20 MiB streamed response budget. Catalog count must remain at least 75% of the prior count, in addition to the existing stats-count and overlap guards. A visitor sees a snapshot-age notice when publication is more than eight days old; it uses the visitor's clock and makes no network request.

See [classification and review instructions](classification.md) and [discovery guidance](category-discovery.md) for the explicit judgment format and offline replay. Discovery algorithm 5 resets incompatible persistence history; algorithm 4 captures require their recorded workflow commit.
