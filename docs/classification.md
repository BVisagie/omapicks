# Category eligibility and audit

A category is a task someone wants to accomplish. A plugin qualifies when its name or description establishes that it directly performs that task. A substantial secondary capability can qualify too. Popularity is scored only after category eligibility; it cannot compensate for an unrelated feature.

## Boundaries

Every type in `data/app-types.json` has a task contract. `include` patterns match the name or description separately; `nameInclude` supplies category-specific name rules. Tags, kind and the marketplace category are never eligibility evidence. Matching does not join fields into synthetic phrases.

Some important distinctions:

| Category | Direct fit | Insufficient evidence |
| --- | --- | --- |
| Battery | Computer charge, health, consumption, power profiles | Phone/peripheral battery, reacting to unplug events |
| Peripheral Batteries | Mouse, keyboard, headset and controller battery readouts | Computer battery or merely connecting a device |
| Phone Integration | Pair/status/control phones, exchange messages, clipboard or files | A phone mentioned as a compatible client |
| Bluetooth | Scan, pair, connect/disconnect, adapter controls | Codecs, battery readouts, using Bluetooth as transport |
| Audio | System volume, microphone processing, routing, headset settings | A player's own volume, typing sounds, recording/visualization using PipeWire |
| Clipboard | History, reusable snippets, paste management | Reading/copying clipboard content, cross-device transport |
| VPN | Tunnel status, connect/disconnect and configuration | Tailscale discovery, reachable peers, using a VPN |
| Notifications | Desktop notification history, management, DND | Sending alerts, app-specific notification preferences |
| System Monitor | Hardware resource measurements and inspection | Agent memory, CPU opponents, RAM requirements |
| Workspaces | Virtual-desktop indicators, selection and organization | Project workspaces or a window merely residing on a desktop |
| Notes | Reading, writing and capturing text notes | Hyprland window scratchpads, release notes |
| Weather | Atmospheric observations and forecasts | Financial forecasts, decorative rain |

The other categories use their stated task contracts and regression fixtures. In particular, a plugin hosting another plugin's popup does not automatically inherit its categories. Native controls implemented inside a multipurpose plugin can qualify: Omaltbar's README documents real brightness, audio, Wi-Fi, Bluetooth and notification controls. X-Ray's README documents actual container inspection/restart and process resource inspection.

## Editorial decisions

`overrides.include` preserves verified capabilities that compact catalog descriptions omit. `overrides.exclude` rejects misleading matches. `overrides.review` holds an uncertain assignment out of rankings until evidence resolves it. Each production override must have a reason in `overrides.reasons`, with an upstream URL when documentation was needed.

Precedence is **review → explicit exclusion → explicit inclusion → category exclusion → positive task evidence**. Holds are per assignment, not blanket plugin bans. A plugin may still compete in other categories for which evidence is sufficient.

The classifier remains deterministic; there is no runtime LLM or requirement to approve every new listing. An automatic rule decision is not a claim that somebody manually reviewed that repository. New ambiguous cases should be held explicitly, researched and covered by a regression fixture. No heuristic can guarantee that future prose will be interpreted perfectly.

## Reproducible audit

```sh
npm run audit:classification
npm run audit:classification -- --input tmp/classification-audit/inputs.json --output tmp/classification-replay
# Compare an older taxonomy using identical feeds, statistics, incumbents and time:
npm run audit:classification -- --baseline /path/to/old-taxonomy.json --baseline-version 1
```

The audit writes only its output directory (default `tmp/classification-audit/`):

- `inputs.json`: catalog and statistics responses, taxonomy, previous rankings/membership state and analysis time.
- `report.json`: a decision for every listing; accepted and rejected rule evidence; old/new assignments; new or removed listings; metadata changes; held assignments; category counts; and evidence for every champion and runner-up.
- `report.md`: readable category/pick comparison and membership changes.
- `state.json`: compact membership/metadata baseline for later comparisons.

Every record defaults unmentioned categories to `no-task-evidence`. Ineligible listings are recorded separately and cannot compete. A baseline-taxonomy replay isolates classification changes; comparison to a previous published snapshot also reflects feed and engagement changes. Reports record input hashes. Use the code revision that produced the inputs; increment `CLASSIFICATION_VERSION` whenever matching semantics change. Replay refuses a different classification version.

Refresh builds the same report from its own feeds, saves `data/classification-state.json` with the published snapshot, and includes classification counts in its Actions summary. Weekly and midweek workflows retain the complete report and replay inputs as artifacts for 90 days. Dry runs do not alter committed snapshot/state files. An already-refreshed week skips publication only when both taxonomy hash and classifier version match. Existing category discovery also highlights broad overlaps and explicitly held assignments for editorial investigation; it remains report-only.

## New categories

New categories require a distinct task and at least three eligible repositories across at least two owners. Owner diversity is not proof of independently authored code. Check upstream documentation and record the decision in `data/category-discovery.json`; lexical discovery alone does not authorize publication.

The 2026-09-21 cleanup added:

- **Phone Integration:** [OmaConnect](https://github.com/jitendradara12/omaconnect), [Phone](https://github.com/krongggggg/omarchy-phone), [OmaKDEConnect](https://github.com/mintisan/OmaKDEConnect), and [OMAConnect](https://github.com/ekollof/omaconnect) document phone pairing/status and cross-device actions.
- **Peripheral Batteries:** [Device Battery Stats](https://github.com/Deoxizn/devicebattstats), [Peripheral Battery Indicator](https://github.com/hlasensky/omarchy-peripheral-battery), and [Nothing Audio](https://github.com/r-witz/omarchy-nothing-ear) document peripheral battery monitoring. These are distinct repositories owned by different accounts, all eligible in the captured catalog.

These were explicit editorial additions from upstream research, not automatic promotions from the discovery pilot. Smaller or unverified gaps remain unranked and available to discovery.

See the [cleanup audit summary](classification-audit-2026-09-21.md) for counts, changed picks, input hashes and validation.

## Verification

`npm test` includes real catalog positive/negative fixtures, metadata-only and cross-field false matches, override precedence, held assignments, immediate removal of disqualified incumbents, empty/single-candidate categories, deterministic audits, and feed/refresh safeguards. `npm run check` renders the published snapshot offline; `npm run test:e2e` exercises the browser. Prior published weeks are retained when correcting the current week.
