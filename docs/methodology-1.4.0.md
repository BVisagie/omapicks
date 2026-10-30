# Methodology 1.4.0: compare choices for the same task

The October 30 category audit found that source-backed capabilities were not sufficient to make recommendations interchangeable. Lock-screen designs and idle timers satisfied different branches of one contract. Other mismatches hid behind a single broad capability: a hotspot and a network connection manager both counted as managing connections, while a container restart action and a lifecycle manager both counted as container management.

This release changes task boundaries and editorial judgments. It retains 1.3.0's scoring weights, normalization, freshness, tie-breaks, pinned-source requirements, shared prerequisites and eight-day source-observation limit. Earlier methodology definitions remain immutable.

## The common minimum

Define the action, its target and the minimum completed outcome before reviewing candidates. Every ranked choice must complete that outcome. Additional native features may qualify a wider application, but cannot stand in for a missing core operation. A scope disclaimer does not turn a different task into a substitute.

An assignment has two separate questions:

1. Does the cited source establish the claimed capability?
2. Does that capability complete this category's task on the stated target?

The first may be true while the second is false. A process inspector that can restart a container has a supported capability; that does not establish listing, starting and stopping containers. A checklist stored in a note file does not establish free-form note capture. Evidence review remains editorial; schema validation cannot understand arbitrary prose or prove that a plugin works at runtime.

Contracts encode concrete minimum operations. Regression cases include documented near-misses as well as valid multi-purpose tools. The full qualified cohort is checked, including alternatives that could later enter the leading slots. Merely counting shared capability identifiers is insufficient: static and video wallpaper tools can both choose and apply a background, while one vague identifier can hide unrelated targets.

## Category migration

There are 72 task categories after four old IDs retire and twelve successor/additional IDs are introduced.

| Earlier category | Current tasks |
| --- | --- |
| Lock & Idle | Lock Screen Appearance; Idle & Sleep Settings; Keep Awake |
| Clocks & Time Zones | Desktop Clocks; World Clocks & Time Zones |
| Agent Sessions | Agent Monitoring; Session History & Resume |
| Uptime Monitoring | Endpoint & Service Monitoring; Service Status & Incidents |
| Weather | Weather Forecasts; Weather Radar |
| Network Connections | Network Connections; Hotspots & Internet Sharing |
| Firewall | Firewall Rules; App Network Blocking |

The first four old URLs remain explanatory pages linking to all successors. Weather, Network Connections and Firewall retain their existing URLs for their narrower task and gain a separate related category. Current discovery aliases, collections, links and sitemap entries follow the new boundaries. Historical snapshots keep their embedded contracts and methodology; no old week is relabeled using current taxonomy.

Other corrections need no new category. System Monitor requires host CPU and memory visibility; System Audio requires output and microphone volume controls and audio-device selection; Media Controls targets local players; Notes requires free-form capture and retrieval; Container Management requires listing, starting and stopping workloads. Specialist tools remain related where useful, and a different existing category can qualify them independently.

Window Switching, AI Chat, Gaming Mode and Countdown Timers no longer accept unrelated branches such as window-rule editing, model administration, game launching or an alarm without countdown controls. Workspace recommendations require both state and navigation. Narrower labels and descriptions distinguish shared functionality from optional features such as full-text file search, translation capture/OCR, notification-daemon replacement, thesaurus support or a browsable plugin catalog.

Hardware, provider, service and interaction preferences do not automatically justify new categories. Compatibility and requirements remain visible. Shortcut Learning retains lookup and after-action coaching as ways to reveal an action's keyboard shortcut; each recommendation states its mode and does not promise an on-demand shortcut browser. Night Light's common outcome is control of display color temperature, with manual and scheduled modes stated separately. Multipurpose applications may appear in several categories only with separate supporting decisions. Source reviews are not inherited merely because an old category split.

## Sparse results and publication

The normal discovery threshold of three repositories across two owners helps justify expansion. A correction of a misleading existing comparison is different: a new task may initially have one qualified option, or none. Corrective splits are recorded explicitly and never filled with unrelated tools to meet a numeric threshold. An unreviewed candidate remains pending even when its inclusion would make the page look more complete.

Reviewed pages show one card when one option qualifies and an explicit abstention when none qualifies. The changelog records splits and changed task requirements separately from wording clarifications and competitive displacement. Wording edits alone do not invalidate reviews or explain a selection change. A methodology migration starts a new same-week event set and preserves the complete preceding publication under `supersededPublications` in that week's history file. Its contracts, evidence, selections and events retain their original methodology and publication date. Subsequent runs retain that archive without duplicating it.

The homepage uses the current recorded event set and links its comparison baseline. The changelog presents the superseded publication separately, so the migration's immediate before/after comparison and the earlier weekly changes both remain inspectable. Earlier weeks are unchanged, and badges from superseded publications remain available. RSS groups category corrections into one entry per publication and includes leading and second-option changes for this methodology; it retains the latest 100 entries. The deliberate W44 publication includes matching current availability.

The [category audit](analysis/2026-10-30-category-audit.json) records all 64 baseline categories and 164 qualified assignments, including cases that remain coherent. Its dispositions are editorial triage, not a measured false-positive rate. The [discovery audit](analysis/2026-10-30-discovery-recall.json) uses the exact publication catalog and checks 613 plugin/old-category assignments: every baseline lead in the seven splits, initial or newly lost routes, and named regressions. Recall is measured per old category, with each appropriate successor checked separately; a match to one successor cannot hide a missing or unwanted destination in another.

The [independent expectations](../test/fixtures/discovery-expectations.json) began with independent listing-by-listing judgments before comparison with classifier output; subsequent editorial reconciliations of task semantics and metadata drift are recorded explicitly. Each plugin/category pair has an explicit expected target set, a specific rationale, exact listing passages and a metadata hash. The generated report is never its own expected answer. It records 428 expected routes, all discovered, and 223 explicit exclusions, with no unexplained destination mismatches. Those counts describe this targeted editorial inventory, not recall or precision across the whole marketplace. Listing changes require reconsidering the bound judgment. Source-based editorial records remain separate and never turn a metadata match into qualification.

This follow-up recomputes the proposed publication from its existing October 30 capture, holding engagement, source observations and evaluation time fixed. It changes discovery rules, research-queue routing and counts; the 170 qualified assignments, all selected options, availability binding and archived publication events remain unchanged. No new source verification is implied by the replay.

The [fixed-input migration comparison](analysis/2026-10-30-migration.md) and offline replay archive record the final snapshot: 170 assignments qualify across 72 categories, and 64 have a second option. Weather Radar, Desktop Clocks, Countdown Timers, Agent Monitoring, App Network Blocking, Docks, AI API Usage and Phone Integration currently have one option. Among retained category IDs, four leading options and eight second options change under the paired methodology comparison. The final capture observed changed source trees in Dock, OmaDock, Calendar, AI Usage and OmaConnect; their affected assignments remain pending re-review. Re-observing the old methodology against these same catalog revisions leaves 158 qualified baseline assignments, rather than the earlier publication's 164. This separates live source changes from category corrections.

[Supplemental reviews](analysis/2026-10-30-supplemental-reviews.json) distinguish source support from task completion for newly researched candidates. Omodoro remains a Focus Sessions option; its reviewed Pomodoro workflow does not establish a standalone countdown. Auto Cafe's automatic triggers and idle-locking scope are disclosed, as are Better Lock's authentication replacement and locked-screen power controls. Source passages, full-file hashes and requirement profiles can be checked with `node scripts/capture-review-evidence.mjs`; this verifier now includes pinned active task reviews as well as the earlier evaluation corpus and profiles.

## Validation

Validation covers wrong-target and incomplete-workflow counterexamples, legitimate secondary capabilities, immutable source passages, sparse results, retired links, navigation, historical rendering and category-change events. The migration replay holds catalog, engagement and time constant. This verifies the encoded judgments and publication behavior; it does not measure installation success, usability, security or task-specific adoption.
