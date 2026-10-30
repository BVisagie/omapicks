# Fixed-input task qualification comparison

Captured 2026-10-30T11:21:19.177Z; inputs 741a7ddb65201cad313a71411e589b5325fad668b38942ff4d97465221d3a4cd. Methodology 1.3.0 → 1.4.0.

12 new categories; 4 retired category IDs; 4 existing champion changes; 170 reviewed assignments compete; 2745 assignments await review.

Before counts are the old eligible cohort; after counts are reviewed candidates. Taxonomy, task evidence and selection change together here; feed, engagement and time are held fixed. Popularity cannot replace task qualification.

| Category | Old candidates → reviewed candidates | Champion before → after | Runner-up before → after |
| --- | --- | --- | --- |
| Media Controls | 1 → 3 | Media Controls + Album Art → Media Controls + Album Art | none → Music Flow |
| Weather Forecasts | 3 → 2 | Weather Radar → Detailed Weather | Detailed Weather → iWeather |
| Weather Radar (new) | 0 → 1 | none → Weather Radar | none → none |
| Network Connections | 3 → 2 | Mobile Hotspot → Network Manager (with Repeater & Hotspot) | Network Manager (with Repeater & Hotspot) → Omaltbar |
| Hotspots & Internet Sharing (new) | 0 → 2 | none → Mobile Hotspot | none → Network Manager (with Repeater & Hotspot) |
| System Audio | 2 → 2 | Advanced Audio Control → Advanced Audio Control | Advanced Bluetooth Audio → omaudiopanel |
| Lock Screen Appearance (new) | 0 → 3 | none → Lock Screen Explorer | none → Lock Designs |
| Idle & Sleep Settings (new) | 0 → 3 | none → Omarchy Power Manager | none → Sandman |
| Keep Awake (new) | 0 → 4 | none → Ristretto | none → Caffeine |
| Desktop Clocks (new) | 0 → 1 | none → OmaClock | none → none |
| World Clocks & Time Zones (new) | 0 → 2 | none → Timezones | none → Omachron World Clock |
| Countdown Timers | 2 → 1 | Omodoro → Clockwork | Clockwork → none |
| Notes | 6 → 5 | Omasticky → Omasticky | Obsidian Daily → Obsidian Notes |
| Agent Monitoring (new) | 0 → 1 | none → Agent Orchestrator | none → none |
| Session History & Resume (new) | 0 → 2 | none → Session Browser | none → Resume AI Session |
| Container Management | 4 → 3 | Omarchy X-Ray → Docker | Docker → Docker Monitor |
| Endpoint & Service Monitoring (new) | 0 → 3 | none → Omastatus | none → Uptime Kuma |
| Service Status & Incidents (new) | 0 → 2 | none → Is It Down? | none → Better Stack Status |
| Firewall Rules | 4 → 3 | Omawall → Omawall | Snitch → Firewall |
| App Network Blocking (new) | 0 → 1 | none → Snitch | none → none |

Retired category IDs retain explanatory pages; their old recommendations are not silently reassigned:

- Lock & Idle (`lock-idle`)
- Clocks & Time Zones (`clock-timer`)
- Agent Sessions (`ai-assistant`)
- Uptime Monitoring (`uptime-monitoring`)

The compressed replay fixture retains every baseline and proposed reviewed plugin. It reproduces all scored cohorts, scores and selections. Discovery/queue totals additionally include unreviewed catalog IDs and are not reproduced by the projection. The JSON report records the original full-input hash and fixture checksum. Run `node --test test/task-coherence-migration.test.mjs` for the offline check.
