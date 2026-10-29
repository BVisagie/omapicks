# Fixed-input task qualification comparison

Captured 2026-10-29T18:24:18.075Z; inputs 714a5b2bac128f191dcaf4fded9597999f16d2a3d7f76c2a5c0152707c6d8075. Methodology 1.2.0 → 1.3.0.

0 new categories; 5 existing champion changes; 164 reviewed assignments compete; 2640 assignments await review.

Before counts are the old eligible cohort; after counts are reviewed candidates. Taxonomy, task evidence and selection change together here; feed, engagement and time are held fixed. Popularity cannot replace task qualification.

| Category | Old candidates → reviewed candidates | Champion before → after | Runner-up before → after |
| --- | --- | --- | --- |
| Battery | 3 → 5 | Argus → OmaStats | Power + Battery Health → Argus |
| Clipboard | 4 → 2 | Spotlight → Spotlight | Clipbasket → Clipboard Manager |
| Application Docks | 3 → 3 | Dock → Dock | Arc Dock → Dock (OmaDock) |
| Network Connections | 4 → 3 | Network Manager (with Repeater & Hotspot) → Mobile Hotspot | Omaltbar → Network Manager (with Repeater & Hotspot) |
| Network Traffic & Diagnostics | 3 → 2 | Vitals → OmaStats | OmaControl → Vitals |
| Night Light | 5 → 3 | Omarchy Lacquer → Omarchy Lacquer | Night Light → Display Settings |
| Display & Monitors | 3 → 3 | hyprmoncfg: Multi-Monitor Manager for Omarchy → hyprmoncfg: Multi-Monitor Manager for Omarchy | Omarchy Display Manager → Screens |
| Notifications | 2 → 5 | Notification Center → Notification Center | Notification Center → Omapager |
| Task Lists | 3 → 4 | Todoist → Todoist | Omado → OmaTasks for Todoist |
| Screen Recording | 7 → 2 | OmaSwiss → Easy Capture | Easy Capture → OmaSwiss |
| Mini-Games | 4 → 3 | Omagotchi → Omagotchi | Omasweeper → Blow off some steam |
| Shortcut Guides | 4 → 3 | Which Key → Omarchy Key Promoter | Keyarchy → Which Key |
| Keyboard Layouts | 4 → 2 | Keyboard Layout Switcher → Keyboard Layout Switcher | Language & Input → Keyboard Layout Pulse |
| RSS & News Readers | 4 → 2 | RSS-Reeder → RSS-Reeder | RSS news → News |

The checked-in compressed replay fixture retains all baseline and proposed reviewed plugin IDs. It exactly reproduces scored cohorts and ordering; the full-feed queue count above also includes unreviewed IDs and is not reproduced by that compact projection. `node --test test/migration.test.mjs` checks the fixed result offline. JSON report records capture and proposal hashes.
