# Classification cleanup — 2026-09-21

This audit compares the old and revised category rules against the same captured public catalog, engagement statistics, analysis time, and original published incumbents. Popularity weights and the 10% incumbent retention rule are unchanged. Disqualified incumbents leave immediately.

## Scope and outcome

- 3,697 catalog listings evaluated; 3,170 eligible for ranking.
- 664 listings changed category membership.
- 1,465 eligible listings classified into 1,697 assignments across 54 categories.
- 1,705 eligible listings remain unranked; zero assignments are explicitly held for review.
- Phone Integration and Peripheral Batteries are new editorially verified categories.

These totals describe deterministic rule evaluation. They do not claim manual verification of every repository. Targeted upstream documentation checks informed exceptions and new categories; regression fixtures cover misleading matches and valid secondary capabilities.

## Changed picks

| Category | Champion before → after | Runner-up before → after |
| --- | --- | --- |
| VPN | OmaProton VPN → OmaProton VPN | OmaConnect → VPN |
| Battery | OmaConnect → OmaStats | Argus → Argus |
| Clipboard | OmaConnect → Clipboard Manager | Clipboard Manager → Clipbasket |
| Bluetooth | Advanced Audio Control → Advanced Bluetooth Audio | Advanced Bluetooth Audio → Omaltbar |
| Audio | Advanced Audio Control → Advanced Audio Control | OmaVibes → Nothing Audio |
| Brightness | Omaltbar → Omarchy Lacquer | Night Light → Omaltbar |
| Workspaces | Exposé → Mirador | Decent Workspaces → Decent Workspaces |
| Window Management | Alt-tab switcher → Alt-tab switcher | omadock → Exposé |
| Gaming | Game Mode Switcher → Game Mode Switcher | Blow off some steam → OmaSwiss |
| Phone Integration | — → OmaConnect | — → OmaKDEConnect |
| Peripheral Batteries | — → Nothing Audio | — → Mouse & Keybind Settings |

OmaConnect provides phone integration; phone battery and clipboard transport no longer qualify it for computer Battery, Clipboard management, or VPN. Advanced Audio Control stays in Audio; Bluetooth eligibility requires device discovery, pairing, connection, or adapter controls. Verified multipurpose capabilities remain eligible, including Lacquer’s documented night-light controls.

## Reproduction and verification

Captured analysis time: `2026-09-21T12:33:38.452Z`. Baseline: commit `a0e9388`, classifier version 1. Revised classifier: version 2.
Full replay input SHA-256: `db5725d0acfdec55fe34d1504bed86b42b7b171a89de56be41495c1c0201ff24`.
Taxonomy SHA-256: `0ba804edd61b4e0f3c1f7369a8923c974dc6ff7c49e327f247c7bf0e174a0c82`.
Catalog plugin-array SHA-256: `458213fed45f384fef5ff7dd71fd8e481c839d2bc5e11543e2fd612c5caa4995`.

The working audit bundle is in `tmp/classification-audit/review/`: `inputs.json`, `report.json`, `report.md`, and `state.json`. The report contains all membership changes, rule evidence, category counts, and champion/runner-up eligibility. See [audit instructions](classification.md#reproducible-audit) for replay and workflow artifacts.

The final snapshot’s picks, scores, category counts, taxonomy, and membership state match the frozen replay. Only the current week (2026-W39) was regenerated; older weekly history is unchanged. All required preview images were fetched successfully.

Validation: 167 Node tests and all nine Playwright browser tests passed; `npm run check` rendered 54 categories and four weekly snapshots. `git diff --check` passed.
