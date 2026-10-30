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

Hardware, provider, service and interaction preferences do not automatically justify new categories. Compatibility and requirements remain visible. Multipurpose applications may appear in several categories only with separate supporting decisions. Source reviews are not inherited merely because an old category split.

## Sparse results and publication

The normal discovery threshold of three repositories across two owners helps justify expansion. A correction of a misleading existing comparison is different: a new task may initially have one qualified option, or none. Corrective splits are recorded explicitly and never filled with unrelated tools to meet a numeric threshold. An unreviewed candidate remains pending even when its inclusion would make the page look more complete.

Reviewed pages show one card when one option qualifies and an explicit abstention when none qualifies. The changelog records splits and changed task definitions separately from competitive displacement. A methodology migration starts a new same-week event set; subsequent same-week runs retain that migration notice. Earlier weekly snapshots are preserved. The deliberate W44 publication includes matching current availability.

The [category audit](analysis/2026-10-30-category-audit.json) records all 64 baseline categories and 164 qualified assignments, including cases that remain coherent. Its dispositions are editorial triage, not a measured false-positive rate. The [fixed-input migration comparison](analysis/2026-10-30-migration.md) and offline replay archive record actual qualification and selection changes: 176 assignments qualify across 72 categories, 68 have a second option, and the four single-option tasks are Weather Radar, Desktop Clocks, Agent Monitoring and App Network Blocking. Among retained category IDs, three leading options and seven second options change. [Supplemental reviews](analysis/2026-10-30-supplemental-reviews.json) distinguish source support from task completion for newly researched candidates. Source passages, full-file hashes and requirement profiles can be checked with `node scripts/capture-review-evidence.mjs`; this verifier now includes pinned active task reviews as well as the earlier evaluation corpus and profiles.

## Validation

Validation covers wrong-target and incomplete-workflow counterexamples, legitimate secondary capabilities, immutable source passages, sparse results, retired links, navigation, historical rendering and category-change events. The migration replay holds catalog, engagement and time constant. This verifies the encoded judgments and publication behavior; it does not measure installation success, usability, security or task-specific adoption.
