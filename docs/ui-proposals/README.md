# OmaPicks UI refresh — design proposals

Prepared 2026-10-29 on branch `feat/futuristic-ui-proposals`, cut from `origin/main` at `bfe5265` (2026-W44 snapshot). This folder holds the research notes, three initial directions, a fourth proposal that blends two of them after the first review, and one interactive HTML mockup per proposal. Nothing in `site/` or `build/` has been changed; the mockups are standalone pages that reuse this week's real data and plugin previews.

**Status after review:** Signal is the base concept, Podium's rounding, tile system and light palette are the parts to carry over, and Blueprint is set aside for this site. [Proposal 4](#proposal-4--signal--podium-the-blend) is that blend and is the recommended direction.

## View the mockups

Open [`index.html`](index.html) for a launcher, or each page directly:

| # | Direction | File | Primary theme |
|---|-----------|------|---------------|
| 1 | **Signal** — terminal HUD, cinematic dark | [`01-signal.html`](01-signal.html) | dark (light "paper HUD" via toggle) |
| 2 | **Podium** — editorial bento issue | [`02-podium.html`](02-podium.html) | dark (bone light via toggle) |
| 3 | **Blueprint** — technical drawing with a printed receipt | [`03-blueprint.html`](03-blueprint.html) | light (inverted blueprint via toggle) |
| 4 | **Signal + Podium** — Signal's concept on Podium's rounded tile system and bone light palette | [`04-signal-podium.html`](04-signal-podium.html) | follows the OS (dark Signal / bone light via toggle) |

They work from `file://` or from any static server at the repository root, for example:

```sh
python3 -m http.server 4187      # from the repo root
# http://127.0.0.1:4187/docs/ui-proposals/
```

Each mockup has two views, switched by a tiny hash router: `#home` and `#category` (the Clipboard page). Every category link opens the Clipboard example. There are no network requests, no third-party scripts, and no web fonts: pages use CaskaydiaMono or JetBrains Mono if installed (Omarchy ships both) and fall back to the system monospace and sans fonts.

Things to try:

- **Signal**: press `/` or `Ctrl`/`⌘ K` for the command palette; hover the radar; move the cursor over the glass cards; scroll to fill the signal meter; toggle the light theme.
- **Podium**: scroll past the masthead and watch the outlined "44" drift; hover a pick tile; use the shelf arrows; open the category view for the diagonal versus split and score dials.
- **Blueprint**: reload to watch the receipt print and the stamp land; hover the category map nodes; hover a dithered preview to resolve it; toggle dark for the inverted blueprint.
- **Signal + Podium**: toggle light for the bone palette; hover the pick tiles (cursor parallax and the sliding "Compare →" pill) and the showdown cards (tilt and luminous edge); press `/` for the palette; open the category view for the score dials and the central scoreboard.

All four honour `prefers-reduced-motion` (final states are shown without animation), keep AA contrast for text, keep focus rings, and lay out down to 390 px.

## What the research says

I looked at [designeer.xyz](https://designeer.xyz/) and [motionsites.ai](https://motionsites.ai/) and at the pieces they feature (screenshots were taken with Playwright and reviewed; the sites are gallery grids, so the examples carry the signal). Seven motifs recur:

1. **Dark cinematic canvases with a single glow.** Motionsites is pure black with one gradient-glow word in the headline; Velaris, Agent Wave and Anchor AI pair near-black with teal or violet light. Designeer is `#121212` with white text, 1 px `rgba(255,255,255,.05–.18)` borders and no border radius on the shell.
2. **Art generated in code, not stock imagery.** Particle figures (Particle Self, Velaris' sphere, Anchor AI's particle tree), ASCII and dither pieces (an ASCII ship, a dot-matrix "COFFEE", a pixel shield, a dithered silhouette), wireframe outline digits. These feel futuristic because they are computed, and they are cheap to ship.
3. **Oversized kinetic typography.** Ink-reveal masks (Craftline), particle text ("Hello I'm Kin"), huge outlined numerals used as background furniture.
4. **Glass, facets and luminous edges.** "Designed in glass" (Facet Glass), frosted cards with a 1 px edge that brightens toward the cursor.
5. **Tactile skeuomorphic details.** A crumpled receipt, a scratch-to-reveal gift card, postage stamps, a soft weather widget, a "Thinking" pill, button loading states, an easing-curve comparison. Small, physical, memorable.
6. **Dense curated grids with chip filters and hover-to-play previews.** Both sites are built on this; the delight is in the tiles, not the chrome.
7. **Diagrams as decoration.** A radial node graph ("Your tools. A shared understanding.") turns product structure into the hero visual.

### Where the current site stands

Strengths worth keeping: an authentic terminal identity (Tokyo Night palette, lowercase monospace headings, the `$ omapicks rank --week` prompt, square corners), honest copy ("no votes, no sponsorships"), fast static pages, light and dark themes, and good accessibility. Gaps against the research: everything sits on one flat plane; nothing moves except a cursor blink; plugin previews are plain rectangles; the category finder is visually small for the most important action; the 64-row table reads like a spreadsheet; and the first paint has no moment that makes a visitor stop.

### Constraints carried into every proposal

From the README and the existing build: static output only, no third-party scripts or fonts, no cookies, light and dark themes, reduced-motion support, AA contrast, keyboard operability, the existing Playwright end-to-end suite (contrast and mobile layouts), and no change to the methodology or the disclaimer copy. Rankings remain the content; the interface may not imply endorsement.

## Proposal 1 — Signal (terminal HUD)

**Concept.** OmaPicks as a live instrument reading the signal from the Omarchy plugin ecosystem. It keeps the terminal DNA and adds depth, atmosphere and motion. This is the smallest identity change of the three and the most "futuristic" at first paint.

**What is new**

- Background: three slowly drifting aurora blobs (teal, violet, magenta) in CSS, a dot grid, and an SVG grain layer; no per-frame JavaScript.
- Hero: the headline decodes from scrambled glyphs (about 0.9 s), the prompt line keeps its blinking cursor, and three stat tiles count up.
- Radar: a 64-node canvas (one node per category) on counter-rotating rings with a sweep; hovering reads "category → champion", clicking opens the category. Pauses when the tab is hidden; draws a single static frame under reduced motion.
- Command palette: replaces the hero finder; opens with `/`, `Ctrl`/`⌘ K`, or the button; substring filter, arrow keys, Enter, Esc; dialog semantics with focus return.
- Glass cards: backdrop blur, a 1 px edge that glows toward the cursor, a radial spotlight, up to 4° tilt on fine pointers, and a pulsing "live" dot on the champion.
- Score delta as a signal meter that fills when scrolled into view; a pausable change ticker; a readout table with hover sweep and staggered reveal.
- Category page: champion and runner-up either side of a central scoreboard (0.933 vs 0.606 counting up), mirrored comparison bars, copy buttons, and the full disclaimer.

**Palette and type.** Dark `#0b0d14`, ink `#c0caf5`, accent `#8bd5ca`, glow `#7aa2f7`/`#bb9af7`; the light "paper HUD" uses `#eef0f6` with `#166d67`. Monospace for everything structural, sans for running copy.

**Effort.** Medium. CSS tokens and the background are a day; palette and glass cards two days; the radar is progressive enhancement that reads the category list already in the page (one small inline JSON block from `build/render.mjs`). Most templates keep their markup, so the e2e suite needs small updates rather than rewrites.

**Risks.** `backdrop-filter`, `mask-composite` and `createConicGradient` need modern browsers; every effect has a plain fallback. Watch idle CPU with the aurora on low-end laptops; the mockup uses three transformed layers and no filters on the moving parts.

## Proposal 2 — Podium (editorial bento issue)

**Concept.** Each Monday snapshot is an "issue" of a magazine. The homepage becomes a bento dashboard of the week with mixed-case display type and rich tiles. This is the biggest visual departure and the most conventional "modern web" look of the three.

**What is new**

- Masthead: "Issue W44 · Published Monday, October 26, 2026", a 6.5 rem display headline with one coral word, and a giant outlined "44 · ISSUE 2026" that drifts and rotates with scroll.
- A slow, pausable marquee of category names.
- A 12-column bento grid: featured showdown (8×3), live finder, three count-up stat tiles, "what changed", a full-width "New to Omarchy?" tile with the starter collections as chips, four pick tiles with cursor parallax, image zoom and a sliding "Compare →" pill, and a method/RSS tile.
- Browse: a scroll-snapping category shelf with arrow buttons, followed by a 3-column alphabetical list.
- Category page: a diagonal versus split (clip-path) with coral champion side, SVG score dials animating to each combined score, a "53.9% apart" badge, tug-of-war comparison bars.

**Palette and type.** Charcoal `#121214`, ink `#f2efe9`, coral `#ff6a3d`, teal `#8bd5ca`; light bone `#f4f1ea` with `#e2501f` (small text uses a darker `#c43d10` for AA). Sans display (Inter or system) with tight tracking, monospace for metadata.

**Effort.** High. Most homepage markup changes (the bento needs new sections and explicit grid placement), the catalog becomes two components, and the category page layout changes. The e2e mobile tests would need revisiting because the grid collapses differently.

**Risks.** Moves away from the terminal identity that matches Omarchy; coral is a new brand colour. Display sizes depend on the installed sans font (no web font is loaded), so headlines will look different on machines without Inter.

## Proposal 3 — Blueprint (technical drawing with a printed receipt)

**Concept.** A reproducible weekly snapshot deserves to look like a printed, auditable artifact. Dot-grid paper, monoline SVG that draws itself in, figure captions ("FIG. 1 — weekly ranking, 2026-W44"), registration marks, a rubber stamp, and a thermal receipt that prints this week's result with a barcode. Witty, tactile, and the most distinctive of the three.

**What is new**

- Background: dot grid with major rules every 120 px and corner registration marks on the page frame.
- Hero: a hand-drawn underline that draws in, a dimension line reading "64 categories ⟷ 255 reviewed entries", and the receipt (serrated edges, prints top-to-bottom, barcode `2026W44-BFE5265`, "SNAPSHOT VERIFIED" stamp that lands with a small overshoot). Receipt scores are labelled as illustrative; real cards show marketplace counts.
- A drafting-style finder with index-card results.
- "FIG. 1B — category map": an inline SVG node graph (OmaPicks → four task clusters → 20 categories) that draws in on scroll, with hover tooltips; "FIG. 2": a sparkline of champion changes per week (illustrative).
- Technical cards with ① ② callouts and dimension lines; previews shown as blue-tinted halftone that resolves to the clean image on hover or focus.
- A change-log ledger, a numbered spec-sheet table, and a drawing title block in the footer (drawn by, sheet, rev, methodology, scale, source).
- Category page: spec cards (the champion gets the stamp), comparison as hatched scales with ticks, and the combined scores plotted on a 0–1 scale.

**Palette and type.** Paper `#f6f4ee`, ink `#1c1f2b`, blueprint blue `#2456e6`, teal `#166d67`, stamp red `#d33a2c`; dark mode inverts to navy `#0f1a3a` with cyan `#7cc4ff` lines. Monospace for captions, numbers and the receipt; a bold sans for headlines.

**Effort.** Medium to high. The receipt, map and halftone are self-contained components, but the page is light-first, so the dark theme must be designed as the inverted blueprint rather than inherited from today's Tokyo Night values. The SVG map needs data from the related-category groups in `site/discovery.json`.

**Risks.** The halftone treatment trades preview legibility for atmosphere (the mockup resolves on hover; the overlay opacity is a single CSS value). A light-first default is a change for an audience that mostly runs dark desktops.

**Review outcome.** Set aside. The drawing-and-receipt metaphor did not fit the site; its ideas are not carried into Proposal 4.

## Proposal 4 — Signal + Podium (the blend)

**Concept.** Signal's instrument-reading-the-ecosystem idea, with its atmosphere and effects intact, rebuilt on Podium's physical system: generous rounding, pill controls, bento tiles with soft lift, and the warm bone light palette. The result keeps the terminal identity (monospace lowercase headings, the `$ omapicks rank --week` prompt, Tokyo Night lineage in dark) while reading as a current, tactile product rather than a flat page.

**From Signal (kept as-is)**

- Drifting aurora, dot grid and grain; the decoding headline and blinking prompt cursor.
- The 64-node category radar with sweep, hover readout and click-to-open.
- The command palette (`/`, `Ctrl`/`⌘ K`, button), with the same keyboard model and focus return.
- Glass cards with the cursor-lit 1 px edge, radial spotlight and up to 4° tilt on fine pointers.
- The scrolling change ticker, the signal meter that fills on scroll, and the readout table with hover sweep.
- Category page: champion and runner-up either side of a central scoreboard, mirrored comparison bars.

**From Podium (adopted)**

- Rounding system: 20 px tiles, 12 px inner media and panels, 14 px pick media, 999 px pills. Focus rings follow the corner radius.
- Pill buttons, chips and status badges everywhere a square control used to be, including the header's finder trigger and theme toggle.
- A bento band under the hero: three count-up stat tiles, a "what changed" tile with numbered rows, a links tile with sliding arrows, and the full-width "New to Omarchy?" tile with starter collections as chips.
- Pick tiles with cursor parallax on the preview, image zoom on hover, a badge over the media and a "Compare →" pill that slides in.
- Score dials in the category card labels, animating to each combined score, next to the "apart" badge on the scoreboard.
- Soft tile shadows with a lift on hover, and the light palette: bone `#f4f1ea`, ink `#15151a`, surfaces `#fbfaf7`, teal `#166d67` (text `#0f5a55` for AA). Light mode drifts peach and teal aurora tints over the paper rather than the cold "paper HUD" of Signal.

**Changed relative to both.** Coral is not used; teal stays the single brand colour in both themes so the identity stays continuous with today's site. The default theme follows the OS instead of forcing dark.

**Effort.** Medium, similar to Signal. The rounding, pills and shadows are token changes; the bento band replaces the current `hero-meta` definition list with four to six tiles and reuses existing data; pick tiles and dials are additive. The category page layout changes the same way Signal's does. The e2e suite needs updated selectors for the hero and small changes to the mobile tests where the bento collapses.

**Risks.** The same browser requirements as Signal (`backdrop-filter`, `mask-composite`, `createConicGradient`, all with plain fallbacks). Rounded glass over a moving aurora shows banding on some low-end displays; the grain layer masks most of it. Light mode now carries a shadow system, so contrast checks need to run against the bone surfaces as well as the dark ones (the mockup passes AA on both).

## Comparison

| | Signal | Podium | Blueprint | Signal + Podium |
|---|---|---|---|---|
| Brand continuity with today's site | High | Low | Medium | High |
| First-paint excitement | High | High | High | High |
| "Futuristic" reading | Strongest | Modern editorial | Retro-technical | Strong, warmer |
| Fit with Omarchy's terminal culture | Strongest | Weakest | Good | Strong |
| Light mode quality | Functional | Best | Primary theme | Podium's, adapted |
| Implementation effort | Medium | High | Medium–high | Medium |
| Markup churn in `build/render.mjs` | Small | Large | Medium | Small–medium |
| Performance risk | Aurora + canvas (bounded) | Parallax + marquee (low) | SVG draw-in (low) | Aurora + canvas (bounded) |
| Mobile fit | Good (radar hides) | Good (grid collapses) | Good (receipt stacks) | Good (bento collapses to 2 + 1) |
| Reduced-motion story | Complete | Complete | Complete | Complete |
| Unique asset | Radar, command palette | Bento issue, dials | Receipt, stamp, map | Radar, palette, bento, dials |

## Recommendation

Build **Proposal 4 (Signal + Podium)**. It is Signal's identity and motion on Podium's rounding, tile system and light palette, which is what the first review asked for. Blueprint is set aside; the receipt idea from the first recommendation is dropped with it, and the "stat tiles and New to Omarchy? chips from Podium" are now part of the design rather than a borrow.

### Suggested implementation path

1. **Tokens.** Add surface, glow, line-strong, grain, tile-shadow and radius variables to `site/styles.css` (`--r-tile: 20px`, `--r-inner: 12px`, `--r-pill: 999px`); replace the light palette with the bone values above and keep teal as the only accent.
2. **Atmosphere.** Fixed aurora layer, dot grid and SVG grain behind `.page-wrap`, with the peach/teal tints in light; disabled under `prefers-reduced-motion`.
3. **Controls.** Convert buttons, chips and status badges to pills; round focus rings.
4. **Hero and bento.** Decode effect on the H1 (the final text stays in the DOM for assistive tech), the radar aside, and a bento band built from the existing `hero-meta`, changes and starter-collection data.
5. **Command palette.** Reuse the current `[data-finder-item]` list and `data-search` attributes so filtering logic and e2e selectors survive; add the overlay, keyboard handling and focus management in `site/app.js`.
6. **Cards.** Glass treatment for `.showdown-entry`, `.support` and `.pick-card`; cursor spotlight and tilt via CSS variables; pick-tile parallax and the sliding compare pill; signal meter fill on intersection.
7. **Radar.** Inline a small JSON of category slugs, names and champions from `build/render.mjs`; the canvas is optional enhancement and renders nothing without JavaScript.
8. **Category page.** Dials in the card labels, central scoreboard, animated comparison bars; the table remains for screen readers.
9. **Tests.** Extend `e2e/` with reduced-motion and palette keyboard cases; run the contrast checks against both palettes; add a budget check (CSS under 60 KB, JS under 15 KB gzipped).

## Mockup limitations

- The demo data array holds 27 of the 64 categories; the radar fills to 64 with the remaining names. Counts shown are the real snapshot counts.
- Only the Clipboard category page exists; every category link opens it.
- Receipt scores (0.941 / 0.929) and the sparkline values in Blueprint are illustrative and labelled as such.
- Method, Changes, RSS and share links show a toast or point at the live site rather than navigating inside the prototype.
- Theme choices persist per mockup under `omapicks-proposal-{1,2,3,4}-theme` in localStorage.

## Files

- `index.html` — launcher with previews and links
- `01-signal.html`, `02-podium.html`, `03-blueprint.html` — the three initial mockups
- `04-signal-podium.html` — the blend, built after the first review
- `previews/` — screenshots used by the launcher and this document
