# Implementation plan — Signal + Podium (Proposal 04) across the whole site

Prepared 2026-10-29 against `origin/main` at `8079a59` (after PR #26, "Require reviewed evidence for recommendations and simplify Actions"). One PR, many small commits, each green on `npm run check` and `npm run test:e2e`, reviewed by delegated models at fixed checkpoints before the PR opens.

Design reference: [`04-signal-podium.html`](04-signal-podium.html) and the Proposal 4 section of [`README.md`](README.md).

## 1. Goal and scope

Port the Signal + Podium interface to every rendered page: home, 64 category pages, methodology, changelog, feed, privacy, 404, plus the generated assets that carry the brand (social images, badges, manifest, theme colours). The ranking logic, data files, snapshots, methodology copy and the reviewed-evidence vocabulary from PR #26 do not change. The port is a presentation change to `build/render.mjs` (markup), `site/styles.css`, `site/app.js`, `build/social.mjs`, `site/og-home.*`, and tests.

## 2. Starting point and what PR #26 changed that matters here

Baseline verified in the worktree on `8079a59`: 272 unit tests pass, `npm run build` renders 64 categories and 9 snapshots, 13 Playwright e2e tests pass.

PR #26 was mostly core logic, but four of its changes shape this port:

1. **Vocabulary is methodology-dependent.** `reviewedPresentation(method)` and `pickLabels(method)` in `build/render.mjs` switch between "Champion / Runner-up / Compare champion and runner-up / N plugins competed" (snapshots ≤ 1.2.0) and "Leading reviewed option / Another reviewed option / Compare reviewed options / N qualified options" (1.3.0). The current snapshot is 1.3.0, so the live site shows the reviewed labels. The mockup was written with the old labels; every label in the port must come from `pickLabels()` and the existing copy functions, never from the mockup text.
2. **Hero copy changed.** H1 is now "Find an Omarchy plugin that fits your task." with a new lede; `#home` on the mockup shows the old line. The decode effect applies to whatever the renderer emits.
3. **Availability states were added.** `statusPill()` can emit "Currently unavailable" / "Availability unknown"; cards can replace the install command with an `.install-unavailable` note; catalog rows, finder items and feature tiles append "Currently unavailable". The new components must style these states (the e2e test "unavailable selections stay readable on small screens" renders a fixture through `renderFixtureType`).
4. **Score de-emphasis in the reviewed presentation.** The home showdown hides the score gap when `modern` (`gap && !modern`), the comparison section says the combined score "is not a quality grade, confidence percentage, or measure of task success", and `winningReason` is suppressed for reviewed snapshots. The mockup's signal meter, dials and scoreboard all visualise the combined score, so they must follow the same rule (see decision D3).

Also from PR #26: `site/og-home.svg` still reads "find the best omarchy plugin for the job" and "champion + runner-up per category"; it is stale against the new H1 and is refreshed in commit 9.

## 3. Contracts that must survive

These are relied on by `site/app.js`, `test/*.test.mjs` or `e2e/site.spec.mjs`. New markup adds classes next to them; it does not rename or remove them.

- Data hooks: `data-pick-filter`, `data-finder-item`, `data-suggested`, `data-finder-results`, `data-finder-empty`, `data-filter-status` (+ `data-total`), `data-filter-empty`, `data-catalog-row`, `data-search`, `data-catalog-head`, `data-copy-link`, `data-share-url`/`data-share-text`, `data-share-status`, `data-copy-command`/`data-copy-label`, `data-theme-toggle`, `data-snapshot-at`, `data-availability-at`, `data-feature`, `data-slot`, `data-featured-index`.
- Classes asserted by tests: `.showdown`, `.support`, `.podium`, `.pick-card.champion`, `.catalog-row` (+ `.type`, `.champ`, `.runner`, `.count`, `.field-label`), `.comparison-table` / `.comparison-metric` / `.comparison-row`, `.category-grid` (≤ 6 links), `.starter-card` (exactly 3, first link → Notes), `.task-fit-note`, `.capability-evidence`, `.task-alternatives`, `.availability-summary` (with `<time>`), `.command-row code`, `.share-links`, `.why-won`, `.byline`, `.page-section`, `.page-lede`, `.pct`, `.timeline-subhead`.
- Roles and names: `role="search"` with a `searchbox`; the "Skip to content" link; the first focusable element inside `main` remains the "Browse N categories" link (the e2e test tabs from the skip link to it); `Primary navigation` landmark with "Method", "Changes", "RSS" links; headings "New to Omarchy?", "Weekly selection changes"/"Weekly champion changes", "More choices for this task"; the comparison `<table>` keeps 3 column headers, row headers and `rows × 2` cells.
- Theme: `localStorage["omapicks-theme"]`, `themeBoot()` and `html[data-theme]` are unchanged; the toggle still flips `aria-pressed`/`aria-label`.
- Tokens: `--muted`, `--bg`, `--surface`, `--well` must resolve to **opaque** colours in both themes; the e2e contrast test parses the first three channels of the computed colour, so a translucent `--surface` would be read as white and fail. Glass tiles use a separate `--glass-bg` token.
- No JavaScript: discovery (finder list with suggested items), the starter cards, Email link and copy-link hiding all keep working; nothing that is JS-only may be the only way to reach content.
- Build: content-hashed `styles-*.css` / `app-*.js` URLs, `_headers`, `_routes.json` and the sitemap are untouched. No web fonts, no third-party scripts, no network at build time.

## 4. Design decisions where the port differs from the mockup

Confirm or overrule these before implementation starts.

- **D1 — Finder stays inline; the palette is an overlay of the same element.** The mockup replaces the hero finder with a modal palette. On the real site the inline finder (`role="search"`, searchbox, suggested list) is the no-JS and e2e contract. The port keeps it in the hero aside, restyled as the palette row, and adds `/`, `Ctrl`/`⌘ K` and a header button that *move* the existing `.hero-finder` element into a dialog overlay and move it back on close. One input, one list, no duplicated data; arrow-key selection and `aria-activedescendant` are added. The header button is rendered `hidden` and revealed by JS.
- **D2 — Radar reads the DOM, not inline JSON.** The 64 `[data-finder-item]` entries already carry category name, leading option and href. The radar canvas is a JS-only enhancement in the hero aside (above the finder on desktop, hidden below 720px), draws one static frame under reduced motion, pauses when the tab is hidden, and clicking a node navigates to that item's href. No new data is emitted by the renderer.
- **D3 — Score visuals follow the methodology rule.** Signal meter on the home showdown, dials in the category card labels and the central scoreboard all render the combined score. For reviewed snapshots (`modern`), the home showdown shows no meter (same rule as the hidden delta today); on the category page the dials and scoreboard are kept because the comparison section already prints both scores, but their kicker reads "combined popularity score" and the scoreboard footer reuses the existing sentence "orders this reviewed shortlist; it is not a quality grade". For legacy snapshots the "N% apart" badge and meter appear as in the mockup. Alternative if the owner prefers: drop the dials for `modern` and keep only the scoreboard inside the comparison section.
- **D4 — Decode headline is transient and JS-only.** The renderer emits a plain `<h1>`. On load, JS wraps the text in an `aria-hidden` span, inserts a visually-hidden copy, runs the 0.95 s decode, then restores the plain `<h1>`. Crawlers, no-JS users and screen readers always see the final text; the mockup's doubled H1 text is not reproduced.
- **D5 — Starter cards become chip tiles but keep their class.** The "New to Omarchy?" section becomes the full-width bento tile; each collection keeps `article.starter-card` with the category links rendered as `.chip` pills.
- **D6 — Theme default follows the OS** (unchanged behaviour). Light is Podium's bone palette with teal as the only accent; dark is Signal's. No coral.
- **D7 — Docs in the PR.** `docs/ui-proposals/` (this plan, the README, the four mockups, launcher and previews, ~360 KB of static files) is committed as the design record in the first commit. Alternative: commit only the README, this plan and the 04 mockup.
- **D8 — Badges are frozen artifacts and keep their current design.** `/badges/*` is served `immutable` for a year and re-proxied by GitHub, the badge is a dated weekly certificate embedded in third-party READMEs beside shields.io-style marks, and the new dark palette keeps the badge's ink and accent colours anyway. `badgeSvg()` gets its own `BADGE_PALETTE` constant decoupled from the site `PALETTE`, plus a byte-stability unit test, so this PR and later theme changes cannot alter embedded badges. A future badge redesign would ship under a new path (for example `/badges/v2/…`), never by changing existing URLs. Social images (`/og/*`, day-cached, fetched by crawlers rather than embedded) are refreshed.

Decisions confirmed by the owner on 2026-10-29: D3 (dials kept with popularity labelling), D7 (commit all of `docs/ui-proposals/`), D8 (badges frozen).

## 5. Branch and PR shape

- Branch: rename `feat/futuristic-ui-proposals` → `feat/signal-podium-interface`, based on `origin/main` (already reset to `8079a59`).
- One PR into `main`, titled "Signal + Podium interface: port Proposal 04 to the whole site". Body: summary, before/after screenshots per page (dark and light, desktop and 390 px), the decisions above, budget numbers, and the review log (which model reviewed which range, findings, how each was resolved).
- Every commit builds, passes `npm run check` and `npm run test:e2e`, so the history bisects. Commit messages follow the repository style (imperative, lower-case prefix where used: `docs:`, `style:`, `feat(home):`, `test:`).

## 6. Commit plan

Sizes: S ≈ an hour, M ≈ half a day, L ≈ a day. Each commit lists what changes, what it must keep, and what proves it.

### Commit 1 — `docs: record the Signal + Podium design proposals and implementation plan` (S)
- Add `docs/ui-proposals/` per D7.
- Proves: `npm run check` still green (no code change).

### Commit 2 — `style: introduce the Signal + Podium tokens, rounding system and bone light palette` (M)
- `site/styles.css`: replace the `:root` / `[data-theme]` blocks with the new token set. Mapping from the mockup:

  | token | dark | light | note |
  |---|---|---|---|
  | `--bg` | `#0b0d14` | `#f4f1ea` | page |
  | `--bg-2` | `#121626` | `#ece8df` | media wells, radial base |
  | `--surface` | `#141724` (opaque composite of the 4 % glass) | `#fbfaf7` | opaque, for e2e contrast and no-backdrop fallback |
  | `--surface-2` | `#1c2033` | `#f1eee6` | hover fills, inner panels |
  | `--well` | alias of `--surface-2` | alias of `--surface-2` | kept for the e2e contrast probe |
  | `--glass-bg` | `rgba(255,255,255,.04)` | `rgba(251,250,247,.92)` | translucent tile background |
  | `--ink` / `--muted` | `#c0caf5` / `#8a93b8` | `#15151a` / `#5e5c58` | muted ≥ 4.5:1 on bg, surface, surface-2 in both themes (verified) |
  | `--line` / `--line-strong` | `rgba(192,202,245,.14/.34)` | `rgba(21,21,26,.12/.32)` | |
  | `--accent` / `--accent-text` / `--accent-ink` | `#8bd5ca` / `#8bd5ca` / `#0b0d14` | `#166d67` / `#0f5a55` / `#f4f1ea` | accent-text for small text on light |
  | `--violet`, `--magenta`, `--glow`, `--aurora-a/b/c`, `--aurora-opacity`, `--grain-opacity` | as mockup | as mockup | atmosphere |
  | `--tile-shadow`, `--tile-shadow-hover` | none / soft | soft / lifted | Podium lift |
  | `--r-tile` 20px, `--r-inner` 12px, `--r-pill` 999px; `--radius` → `var(--r-inner)` | | | existing `--radius` users pick up the inner radius |
  | `--ease`, `--ease-out`, `--ease-spring` | | | |

- Base element styles: pills for `.button`, `.text-link` (unchanged underline style), `.status`, `.theme-toggle`, nav links; rounded focus rings; `kbd` style.
- `build/render.mjs`: `PALETTE` → new values (`bg #0b0d14`, `lightBg #f4f1ea`, `ink`, `muted`, `accent`); feeds `theme-color`, the manifest and `badgeSvg`.
- Keep: all existing selectors still render acceptably with the new tokens (this commit is tokens + primitives only; layouts change later).
- Proves: `npm run check`; e2e contrast tests in both themes; an added unit test asserting the `theme-color`/manifest colours come from `PALETTE`.

### Commit 3 — `feat(site): add the atmosphere layer, glass tile primitives and the sticky glass header` (M)
- `shell()`: insert `<div class="atmosphere" aria-hidden="true">` (three aurora blobs, dot grid, grain) before `.page-wrap`; header gets the pill nav, the finder trigger button (`data-open-palette`, `hidden` until JS) and the theme toggle as a pill; brand gets the icon (`site/icon.svg` inline or `<img>`).
- `styles.css`: `.glass`, `.tile`, `.glass::before/::after` (cursor-lit edge and spotlight via `--mx/--my`), tilt variables, `@supports not (backdrop-filter: blur(1px))` fallback to `--surface`, reduced-motion block (aurora off, no tilt, no transitions), a `max-width: 720px` block that shrinks the aurora.
- `app.js`: pointer-move handler setting `--mx/--my`, tilt on `.tilt` for `(pointer: fine)` and no reduced motion, reset on pointer-out.
- New `test/assets.test.mjs`: gzip budgets — `styles.css` ≤ 14 KB gz, `app.js` ≤ 8 KB gz. Measured: today's site is 6.3 KB / 2.1 KB gz; the mockup's CSS is 8.8 KB gz and its JS without the demo data arrays is 6.2 KB gz; naively concatenating site + mockup gives 14.3 KB / 7.7 KB gz before pruning the rules and client-side templating that the port replaces, so the final numbers should land around 11 KB / 6.5 KB.
- Proves: `npm run check`, e2e (no page errors, no overflow at 320/375/1440), budget test.

### Commit 4 — `feat(home): rebuild the hero with the decode headline, finder panel, palette overlay and category radar` (L)
- `homePage()`: hero becomes the two-column grid; `hero-copy` keeps the prompt line, H1, lede, snapshot/availability notices, trust line and actions (Browse button first, then "find a category ⌘K" ghost button rendered `hidden`, then the method link and share links). `hero-aside` holds the radar panel (`<div class="glass radar-panel" hidden data-radar>` with `<canvas>` and readout) above the existing `.hero-finder`, restyled as a glass panel with the palette row.
- Palette overlay per D1: `shell()` adds `<div class="palette" role="dialog" aria-modal="true" aria-labelledby="finder-label" hidden data-palette>` with a backdrop button and an empty panel; `app.js` moves `.hero-finder` in and out, manages focus return, `Escape`, arrow keys, `aria-activedescendant`, and locks body scroll while open. `Enter` keeps the existing "open first visible match" behaviour.
- Radar per D2 in `app.js` (≈ 3 KB): builds nodes from `[data-finder-item]`, four counter-rotating rings, sweep, hover readout written to `aria-live` text, click → `location.assign(href)`, `ResizeObserver`, `visibilitychange` pause, theme change re-reads colours, reduced motion → one static frame. Reveals the panel by removing `hidden`.
- Decode per D4 in `app.js` (≈ 0.6 KB).
- Keep: `role=search`, `#pick-filter` searchbox, `data-filter-status`, suggested/hidden finder items, `finderEmpty`; tab order (skip link → Browse).
- Tests: `render.test.mjs` cases for the hero markup (radar panel `hidden`, palette `hidden`, trigger `hidden`, H1 is plain text); e2e: `/` opens the palette with focus in the searchbox and the finder back in the hero after `Escape` with focus on the trigger; `ArrowDown` + `Enter` opens the selected category; with JS disabled the radar and palette do not appear and the finder is usable; after load the H1 text equals the server-rendered text.

### Commit 5 — `feat(home): turn the weekly summary and starter collections into the bento band` (M)
- `homePage()`: after the hero, `<section class="bento" aria-labelledby="glance-heading">` containing: three `dl.glass.tile.stat` (Categories; Reviewed category entries / Category entries per method; Selection changes = `changes.length` from the same computation `weeklySummary` uses, labelled "leading-option changes" or "champion changes" per `modern`), the `weeklySummary()` output as the `b-changed` tile (keep `.weekly-summary` class and heading; add numbered rows), a links tile (Method, RSS, Changelog), and `starterCollections()` as the full-width `b-newcomer` tile per D5. `hero-meta`'s "Snapshot" date moves to the changed tile's footer; `entry-note` text stays in the stat tile footer.
- `app.js`: `countUp()` on `[data-count]` when revealed; reduced motion → final value. Scroll reveal via `IntersectionObserver` adding `.is-in`.
- Keep: `#getting-started-heading` "New to Omarchy?", three `.starter-card`s with links, `weekly-summary` links to `/changelog/` and `/feed/`, `newListingsNote`.
- Tests: `render.test.mjs` updates where the home fixture is asserted (stat tile values equal the counts; `data-count` attributes present); e2e no-JS test unchanged and passing; reveal does not hide content without JS (`.reveal` only animates when `html.js` is set by `app.js`).

### Commit 6 — `feat(home): restyle the showcase as glass showdown cards and pick tiles, and the catalog as the readout` (L)
- `showdownSection()`/`showdownEntry()`: entries become `article.glass.tilt.card` (`.champion` kept), with `.rank` row (labels from `pickLabels`, `statusPill`), `.media` wrapper around the existing `feature-media` link + image, `card-body` with h3/byline/lede, availability note, `.card-foot` with the competed/qualified label and a `.pill` compare link. `showdown-gap` keeps the delta/competed/compare link; adds the `.meter` only when the delta is rendered (D3).
- `featureArticle()` (`.support` tiles): `.media` with the "Champion"/leading badge (`labels.first`), parallax variables, `.pick-copy` with kicker/h3/meta, `.install-unavailable` kept, `.feature-action` restyled as the slide-in `.pill`.
- Catalog: wrap `.catalog-table` in `.glass.readout-panel`; rows get the hover sweep and rounded hover fill; the `.count::after` caret; mobile collapse (head hidden, runner spans).
- `featuredSlotStyle()` unchanged.
- Keep: `.showdown[data-slot]`, `.support[data-slot][data-feature]`, `.catalog-row` contract, field labels for screen readers.
- Tests: existing `render.test.mjs` showdown/catalog assertions (update only wrapper expectations); e2e searches and width checks; a new e2e check that unavailable rows/tiles render the "Currently unavailable" text within the viewport at 320 px.

### Commit 7 — `feat(picks): port the category page — versus layout, dials, scoreboard, glass cards and comparison bars` (L)
- `typePage()`: `type-intro` two-column with pill share links (`shareLinks()` output restyled; buttons stay `.text-link` for the e2e names "Copy link"/"Share…"/"Email"); `builtInNote` as a glass tile (`> div { min-width: 0 }` so the command truncates); `.podium` becomes the three-column `.versus` with `candidateCard` → `article.glass.tilt.pick-card[.champion]`, a `.dial` in `.card-label .card-flags` (`data-dial`, `aria-label="Combined popularity score 0.933"`), `.preview-frame` rounded, `command-row` pill button, `badge-embed` restyled, and the `.scoreboard` glass panel between the cards per D3 (score pair from `winner.score`/`runnerUp.score`, "apart" badge from `scoreLead` only when the home page would show a delta, footer sentence from `scoreComparison`'s existing copy). Single-candidate categories render the scoreboard with one score and no "VS".
- `scoreComparison()`: keep the `<table>`; style `td` bars as mirrored rounded glowing bars (`direction: rtl` on the first value cell's bar), rows reveal on intersection. The 320 px layout stacks label above bars.
- `moreTaskChoices()`, `categoryNavigation()` (grid tiles ≤ 6, pagination pills), `method-note` as a tile.
- `app.js`: `runDial()` sets `stroke-dashoffset` and counts the label; reduced motion → final state.
- Keep: everything in §3 for cards, evidence `<details>`, availability notes, comparison table roles.
- Tests: `render.test.mjs`/`reviewed-render.test.mjs` updates for the new wrappers; a new unit test that `modern` fixtures carry the popularity kicker and no "apart" badge while a 1.2.0 fixture has both; e2e comparison-table test unchanged; the reviewed-fixture e2e passes at 320/768/1440.

### Commit 8 — `feat(pages): apply the design system to methodology, changelog, feed, privacy and 404` (M)
- `.page-section` becomes a glass panel with rounded corners; `.prose` spacing; `.weight-list` bars as rounded meters with glow; `.timeline` sections as tiles with the week as a kicker; `.first-champions` dl, `.change-list` rows; `.rss-callout` as an accent-edged tile; `.feed-entries` articles as tiles; 404 centred panel.
- Keep: headings and classes asserted in tests (`page-section prose`, `page-lede`, `pct`, `timeline-subhead`); RSS e2e flow.
- Tests: existing; e2e width check extended to `/methodology/` and `/changelog/` (commit 10).

### Commit 9 — `feat(assets): refresh the social images and manifest colours; pin the badge palette` (S)
- `build/social.mjs`: new colours, rounded outer frame (`rx="20"`), kicker colour `--accent`; copy unchanged (tests assert the labels).
- `site/og-home.svg` → redraw with the new palette and the current H1/lede vocabulary ("Find an Omarchy plugin that fits your task." / reviewed shortlist footer); regenerate `site/og-home.jpg` from it (resvg → PNG → JPEG via ImageMagick locally; commit the JPEG).
- `badgeSvg()` per D8: unchanged output; colours move from `PALETTE` to a new frozen `BADGE_PALETTE` with a comment explaining why; a unit test asserts the badge SVG for a fixture is byte-identical to the pre-PR output.
- Proves: `social.test.mjs` (dimensions, escaping, labels) and the badge stability test pass; visual check of the social outputs.

### Commit 10 — `test: extend browser coverage for the palette, radar, reduced motion, no-JS and width sweep` (M)
- `e2e/site.spec.mjs` additions (some already landed with their commits; this commit completes the matrix): reduced-motion emulation → aurora `animation-name: none`, H1 final text immediately, meters at final width; `colorScheme` × widths `320, 390, 768, 1024, 1440` × routes `/`, `/picks/clipboard/`, `/picks/network/`, `/methodology/`, `/changelog/` → `scrollWidth ≤ innerWidth`, zero `pageerror`, zero failed requests, zero non-origin requests; JS-disabled: radar and palette absent, finder and starters usable; keyboard: `Tab` order from skip link unchanged, palette focus trap and return.
- `test/assets.test.mjs` budgets confirmed against final sizes.

### Commit 11 — `docs: describe the interface and update the proposal status` (S)
- `README.md` "Develop": one short paragraph on the interface (tokens in `site/styles.css`, no web fonts, JS is progressive enhancement, reduced-motion support, asset budget test).
- `docs/ui-proposals/README.md`: status line → implemented in this PR; `index.html` footer note.

## 7. Review process with delegated models

Reviewers (confirmed available via `orchestrator_capabilities`):

- **Grok 4.7** — provider `cursor`, model `grok-4.7`, options `contextWindow: "500k"`, `reasoning_effort: "xhigh"`.
- **GPT 6.1 Sol** — provider `codex`, model `gpt-6.1-sol`, options `reasoningEffort: "xhigh"`.

Each review is a fresh `delegate_task` with `isolation: "worktree"` (read-only checkout of the branch at the reviewed commit) and a brief containing: the commit range, the files touched, the design reference (`docs/ui-proposals/04-signal-podium.html` and this plan), the contracts in §3 and decisions in §4, and the request: findings only, each with severity (blocker / should-fix / nit), file:line, the reason, and a concrete fix; plus an explicit list of the §3 contracts checked. Reviewers do not edit; they report.

Checkpoints:

| checkpoint | after commits | reviewers | focus |
|---|---|---|---|
| R1 | 1–3 | Grok 4.7 | token/contrast correctness, CSS architecture, fallback and reduced-motion coverage, budget test |
| R2 | 4–6 | Grok 4.7 and GPT 6.1 Sol | home page: a11y of palette/radar/decode, no-JS path, test contracts, methodology vocabulary, performance of aurora/canvas |
| R3 | 7–9 | GPT 6.1 Sol | category page and secondary pages: D3 compliance, table semantics, availability states, asset outputs |
| R4 | 1–11 (whole PR) | Grok 4.7 and GPT 6.1 Sol | full diff review, PR description accuracy, bisectability, anything missed |

Handling findings: blockers and should-fixes are fixed in a follow-up commit within the same group (or amended into the relevant commit before the group is pushed, to keep history clean); nits are fixed if cheap, otherwise listed in the PR body as declined with a one-line reason. A re-review is requested only when a fix is non-trivial; small fixes are verified by the test suite. A checkpoint is satisfied when both the reviewer's blockers/should-fixes are resolved and `npm run check` + `npm run test:e2e` pass.

The PR opens only after R4 is satisfied and my own final pass (screenshots of every page type in both themes at 1440 and 390, budget numbers, Lighthouse-style sanity on the home page) is clean. Then: push branch, `gh pr create`, link the PR, watch CI.

## 8. Verification at every commit

- `npm run check` (272+ unit tests, full render) and `npm run test:e2e` (13+ browser tests) green.
- Width sweep script (kept outside the repo until commit 10 formalises it): `/`, `/picks/clipboard/`, `/methodology/`, `/changelog/` at 320–1440 px, both themes, both views; `document.documentElement.scrollWidth ≤ innerWidth`; no console errors; no non-origin requests.
- Contrast: the token pairs table from this plan recomputed from `styles.css` (script in `/tmp`), plus the e2e probe.
- Budgets: `test/assets.test.mjs`.
- Manual: keyboard-only pass of home and one category page; screen-reader spot check of the hero (H1 announced once), palette (dialog name, option selection) and dials (aria-labels).

## 9. Risks and mitigations

- **Backdrop blur and large blurred aurora layers on low-end GPUs.** Three `filter: blur(90px)` layers animate slowly via transform only; reduced-motion disables them; a `max-width: 720px` block shrinks them; `@supports not (backdrop-filter)` falls back to opaque `--surface`. If R2 flags CPU use, cap aurora to two layers on narrow screens.
- **Translucent tokens breaking the contrast probe.** Handled by keeping `--surface`/`--well` opaque (§3).
- **Vocabulary drift.** All labels via `pickLabels()`/existing copy; a unit test renders a 1.2.0 fixture and a 1.3.0 fixture through the home and type pages and asserts the right label set appears in the new components (stat tile, showdown rank, scoreboard, dials).
- **Tab order regression** from new header/hero controls: the header trigger is before `main`; the radar canvas has no `tabindex`; e2e asserts skip link → Browse.
- **CSS/JS growth.** Budget test fails the build if exceeded; the mockup's CSS was written for one page and includes dead rules that will be pruned during the port.
- **Fonts.** No web fonts; headings depend on Cascadia/JetBrains/system mono as today; the decode uses glyphs present in any monospace font.
- **Cloudflare caching.** Asset URLs are content-hashed, so the new CSS/JS cannot be served stale; `og/*` is day-cached and the home image path is unchanged, so the refreshed `og-home.jpg` may take a day to appear on social cards.

## 10. Resolved points

1. D3: dials stay on reviewed category pages with the "combined popularity score" labelling.
2. D7: all of `docs/ui-proposals/` is committed.
3. D8: badge SVGs keep their current design and get a pinned palette; nothing else is excluded from the port.

## 11. Sizing

Commits 1–3 ≈ 1 day; 4–6 ≈ 2 days; 7–9 ≈ 1.5 days; 10–11 ≈ 0.5 day; four review checkpoints with fixes ≈ 1 day. About six working days end to end, with the PR open at the end rather than as a draft.
