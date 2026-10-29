# Recommendation evidence audit — 29 October 2026

The published shortlist was mostly in the right task categories. Its weaker parts were the evidence behind those placements, overstated explanations and missing setup requirements. This audit supports keeping the useful categories while making source review a prerequisite for scoring.

This is a documentation and selected-source inspection, **not installation, performance or security testing**. A supported result means the inspected source describes the required workflow. It does not establish that the plugin works on every machine, is maintained well, or is better than an unreviewed alternative.

## What was reviewed

The baseline is the published `2026-W44` snapshot under methodology `1.2.0`, from main commit `bfe5265bdaed101f6946acc8f34bbabb79f1e27b`. The audit used repository revisions observed in the marketplace capture of 29 October. Immutable source URLs, full-file SHA-256 hashes and exact supporting passages are retained in [the evaluation corpus](../data/recommendation-evaluation.json), [task reviews](../data/task-reviews.json) and [shared plugin profiles](../data/plugin-profiles.json).

| Cohort | Assignments | Supported | Unsupported for this task | Unknown |
| --- | ---: | ---: | ---: | ---: |
| Every published leading option and runner-up | 128 | 128 | 0 | 0 |
| Former picks and prospective podium challengers in the priority queue | 10 | 8 | 2 | 0 |
| Additional changed-contract and shared-scope checks | 13 | 11 | 2 | 0 |
| Stratified sample of pending assignments | 29 | 17 | 11 | 1 |
| **Total** | **180** | **164** | **15** | **1** |

Each assignment was judged against the user outcome: does the plugin expose the necessary workflow, is it core or substantial secondary functionality, and are the backend and setup restrictions clear? An incidental mention, a link to another app, or a read-only view does not establish a missing operation. No ranking score, keyword match or existing `qualified` flag supplied the expected label.

The pending sample takes the first two alphabetical plugin IDs from each of 16 specified task strata, excluding plugins already selected for the other cohorts. Color Picker had no remaining pending assignment and Firewall had one, producing 29 cases across 15 populated strata. This is a reproducible diagnostic sample, not a probability sample. The 17 supported pending cases identify useful review work; they do **not** establish a catalog-wide false-negative rate or recall estimate. OMAMPY remains unknown for Music Players: local playback is documented, but the inspected passage does not establish library browsing. It receives no source-based approval for that task.

The labels were written from the inspected passages before generating the migrated ranking. They are a development audit reused to repair the corpus, not an independent held-out benchmark. Future generalization claims need a separately selected, independently adjudicated sample.

## What changed

All 128 previously published assignments have source support for task fit under the clarified contracts. That result should not be presented as a runtime success rate. Checking the old user-facing reasons found **126 supported explanations and two unsupported claims**: OmaStats and Argus exposed computer battery readings, but their shared rationale also promised power controls. Both now describe only the supported battery readings.

Evidence quality changed substantially. Of those 128 baseline assignments, 104 relied on catalog descriptions and 24 cited repository research. None linked directly to an immutable `blob/<commit>/path` passage. All 128 now have immutable source evidence, and every scored plugin has a shared prerequisites profile. Previously only 35 of the 128 assignment records contained any constraint; that count describes field presence, not completeness.

Five task contracts advance to version 2 while retaining their IDs and URLs:

| Task | Required outcome |
| --- | --- |
| Battery | Read the computer battery; power controls are optional extras. |
| Notes | Create notes and retrieve them for reading. |
| Color Picker | Pick a screen color and copy or export its value. |
| Containers | Inspect containers and perform a native operation, with runtime and operation scope disclosed. |
| Firewall | Inspect and manage rules or per-app blocks; a connection map alone is related. |

The source review also prevents plausible but incorrect placements:

- YouTube Music is a browser MPRIS controller, so it is related to Music Players rather than a library-browsing player.
- NetBird, OpenVPN and L2TP clients control VPN tunnels rather than the Network task's Wi-Fi, Ethernet or cellular connections.
- Omaprox explicitly describes a read-only remote Proxmox dashboard. Opening a console does not make it a container manager.
- EZ Docker is an application dock; OmaFloat positions windows; Satellite predicts satellite passes. Their incidental terms do not establish container, mail or weather capability.
- TickTick's inspected panel browses and completes tasks but does not document task creation. Workspace Bands changes tiling geometry without establishing workspace navigation or occupancy display.

Source inspection also avoided unnecessary removals. Snitch documents actual per-app firewall blocks after helper setup. X-Ray documents restart operations for supported container-runtime targets. Color History invokes its own picker and copies saved values. Obsidian Notes supports quick capture as well as retrieval. These judgments use the current source, not older assumptions inferred from a name or description.

## Prerequisites travel with the plugin

There are 163 reviewed shared profiles. They apply to every appearance of the plugin, including related results. For example, Omaltbar replaces the main bar and imports specific shell modules from `/usr/share/omarchy`; that limitation applies to its network, Bluetooth and brightness results. Its Wi-Fi controls were confirmed in the pinned `views/QuickSettingsView.qml`, rather than inferred from the widgets it hosts. Spotlight's clipboard reuse was confirmed in pinned `Spotlight.qml` action handling.

Other material setup requirements include Spotify Premium and OmaSpotify's native playback setup, Google Workspace CLI authentication, Home Assistant credentials, Docker access, native helper compilation or release installation, Polkit setup, compatible keyboard or laptop hardware, and optional system overrides. Docker group membership grants root-level host access even when the CLI runs without sudo, as clarified by [Docker’s documentation](https://docs.docker.com/engine/install/linux-postinstall/). These are documented prerequisites, not confirmation that they have been installed successfully. A reviewed empty requirements list means the inspected source disclosed no additional setup requirement; it is not a guarantee of universal compatibility. Missing profiles remain unknown.

Only 179 explicitly adjudicated decisions are written back: 164 qualified and 15 related or rejected. The unknown case stays unresolved. The other 138 pre-existing decisions retain their original review dates and evidence; they are not silently certified by the migration. Under methodology 1.3, a legacy catalog-only decision cannot enter the scored shortlist.

## Validation and remaining limits

The source corpus contains 165 distinct documents: 163 READMEs and two QML files. Every retained excerpt was checked against its exact lines and full-file hash. Reproduce that read-only check with:

```sh
node scripts/capture-review-evidence.mjs
# With a previously populated cache, without network access:
node scripts/capture-review-evidence.mjs --offline
```

The helper saves text and a manifest under ignored `tmp/review-source-cache`; it never executes upstream code. An unavailable source, hash mismatch or changed passage fails the check. The normal publication process separately observes the current repository tree and decides whether the evidence is still current; this text check does not replace that gate.

The [fixed-input migration comparison](analysis/2026-10-29-migration.md) retained a leading option and runner-up in all 64 categories, with 164 scored assignments. Five leading options and 14 runners-up changed relative to the 1.2 calculation on the same captured feeds. Every resulting replacement has a supported case in this audit. Its compact checked-in capture replays every scored cohort, selection and score offline; unreviewed research-queue totals require the full feed capture. Run `node --test test/migration.test.mjs` to verify the frozen comparison.

The strongest remaining uncertainty is runtime behavior and omission beyond the reviewed sample. Popularity signals measure observed attention and install intent, not successful installations, retention or reliability. Repository documentation can overstate implementation. Hardware-specific behavior, account setup, native binaries and service interactions still need targeted installation tests before OmaPicks can make stronger quality claims. A future evaluation should independently sample new candidates and test complete user workflows on stated Omarchy versions and hardware.
