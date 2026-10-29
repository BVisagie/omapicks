import { test, expect } from "@playwright/test";
import { renderFixtureType, withAvailability } from "../build/render.mjs";
import { availabilityFor } from "../build/availability.mjs";
import { snapshotMethodology } from "../build/methodology.mjs";

// Rankings change every Monday and search also covers champion and runner-up names, so
// expectations come from the rendered page and its snapshot rather than hard-coded counts.
async function rankedTypes(request) {
  return (await (await request.get("/rankings.json")).json()).types;
}

async function searchMatches(page, query) {
  return page.locator("[data-catalog-row]").evaluateAll(
    (rows, q) => rows.filter((row) => row.dataset.search.includes(q)).map((row) => row.getAttribute("href")),
    query
  );
}

test("RSS navigation opens the HTML feed and keeps the XML subscription link", async ({ page, request }) => {
  const snapshot = await (await request.get("/rankings.json")).json();
  await page.goto("/");
  await page.getByRole("navigation", { name: "Primary navigation" }).getByRole("link", { name: "RSS" }).click();
  await expect(page).toHaveURL(/\/feed\/$/);
  await expect(page.getByRole("heading", { name: snapshotMethodology(snapshot).eligibility.repositoryEvidence ? "Weekly selection changes" : "Weekly champion changes" })).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Primary navigation" }).getByRole("link", { name: "RSS", exact: true })).toHaveAttribute("aria-current", "page");
  const firstEntry = page.locator(".feed-entries article").first().getByRole("link");
  await expect(firstEntry).toHaveAttribute("href", /^\/picks\//);
  const subscription = page.getByRole("link", { name: "https://omapicks.com/feed.xml" });
  await expect(subscription).toHaveAttribute("href", "/feed.xml");
  const response = await request.get("/feed.xml");
  expect(response.ok()).toBe(true);
  expect(response.headers()["content-type"]).toContain("application/xml");
  expect(await response.text()).not.toContain("xml-stylesheet");
  await firstEntry.click();
  await expect(page).toHaveURL(/\/picks\/[^/]+\/$/);
});

test("advertised searches filter both lists and Enter opens the first match", async ({ page }) => {
  await page.goto("/");
  for (const [query, id] of [["spotify", "music-players"], ["weather", "weather"], ["clipboard", "clipboard"]]) {
    const expected = await searchMatches(page, query);
    expect(expected).toContain(`/picks/${id}/`);
    await page.getByRole("searchbox").fill(query);
    await expect(page.locator("[data-catalog-row]:visible")).toHaveCount(expected.length);
    await expect(page.locator("[data-finder-item]:visible")).toHaveCount(expected.length);
    await expect(page.locator(`[data-finder-item]:visible a[href="/picks/${id}/"]`)).toHaveCount(1);
  }
  await page.getByRole("searchbox").fill("spotify");
  const first = await page.locator("[data-finder-item]:visible a").first().getAttribute("href");
  await page.getByRole("searchbox").press("Enter");
  await expect(page).toHaveURL(new RegExp(`${first}$`));
});

test("search handles no results and restores suggestions on clearing", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("searchbox").fill("no-such-category-123");
  await expect(page.locator('[data-finder-empty]')).toBeVisible();
  await expect(page.locator('[data-filter-empty]')).toBeVisible();
  await page.getByRole("searchbox").fill("");
  await expect(page.locator('[data-finder-empty]')).toBeHidden();
  await expect(page.locator('[data-finder-item]:visible')).toHaveCount(await page.locator('[data-finder-item][data-suggested]').count());
  await expect(page.locator('[data-catalog-row]:visible')).toHaveCount(await page.locator('[data-catalog-row]').count());
});

test("comparison tables expose headers and related navigation is bounded", async ({ page, request }) => {
  const contested = (await rankedTypes(request)).find((type) => type.winner && type.runnerUp);
  test.skip(!contested, "No task currently has two qualified reviewed options.");
  await page.goto(`/picks/${contested.id}/`);
  const table = page.getByRole("table", { name: "Marketplace signals by plugin" });
  await expect(table.getByRole("columnheader")).toHaveCount(3);
  await expect(table.getByRole("rowheader", { name: "Copies", exact: true })).toBeVisible();
  // Snapshots from methodology 1.1.0 add a copies-per-view row; every row has one cell per pick.
  const rows = await table.getByRole("rowheader").count();
  expect(rows).toBeGreaterThanOrEqual(5);
  await expect(table.getByRole("cell")).toHaveCount(rows * 2);
  expect(await page.locator('.category-grid a').count()).toBeLessThanOrEqual(6);
  await expect(page.getByRole("link", { name: "Browse all categories" })).toHaveAttribute("href", "/#catalog");
});

test("copy link, install command, email and native sharing use the correct payload", async ({ page, context, request }) => {
  const type = (await rankedTypes(request)).find((entry) => entry.winner);
  test.skip(!type, "No task has a qualified reviewed option in this snapshot.");
  const { id } = type;
  const url = `https://omapicks.com/picks/${id}/`;
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "share", { value: async (data) => { window.shared = data; } });
  });
  await page.goto(`/picks/${id}/`);
  await page.getByRole("button", { name: "Copy link", exact: true }).click();
  await expect(page.getByRole("status")).toHaveText("Link copied.");
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(url);
  const command = await page.locator('.command-row code').first().textContent();
  await page.locator('[data-copy-command]').first().click();
  await expect(page.locator('[data-copy-command]').first()).toHaveText("Copied");
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(command);
  const email = new URL(await page.getByRole("link", { name: "Email", exact: true }).getAttribute("href"));
  expect(email.searchParams.get("body")).toContain(url);
  await page.getByRole("button", { name: "Share…", exact: true }).click();
  expect((await page.evaluate(() => window.shared)).url).toBe(url);
});

test("failed clipboard access and cancelled sharing give useful feedback", async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "clipboard", { value: { writeText: async () => { throw new Error("Denied"); } } });
    document.execCommand = () => false;
    Object.defineProperty(navigator, "share", { value: async () => { throw new DOMException("Cancelled", "AbortError"); } });
  });
  await page.goto("/");
  await page.getByRole("button", { name: "Copy link", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("Could not copy the link");
  await expect(page.getByRole("button", { name: "Copy link", exact: true })).toBeFocused();
  await page.getByRole("button", { name: "Share…", exact: true }).click();
  await expect(page.getByRole("status")).toBeEmpty();
});

test("skip link reaches main content and theme persists", async ({ page }) => {
  await page.goto("/");
  await page.keyboard.press("Tab");
  await expect(page.getByRole("link", { name: "Skip to content" })).toBeFocused();
  await page.keyboard.press("Enter");
  await page.keyboard.press("Tab");
  await expect(page.getByRole("link", { name: /^Browse \d+ categor(?:y|ies)$/ })).toBeFocused();
  const before = await page.locator('html').getAttribute('data-theme');
  await page.locator('[data-theme-toggle]').click();
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-theme', before === 'dark' ? 'light' : 'dark');
});

function contrast(a, b) {
  const luminance = (rgb) => rgb.match(/\d+/g).slice(0, 3).map(Number).map((v) => v / 255)
    .map((v) => v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)
    .reduce((sum, v, i) => sum + v * [0.2126, 0.7152, 0.0722][i], 0);
  const x = luminance(a), y = luminance(b);
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}

for (const theme of ["light", "dark"]) {
  test(`${theme} layouts fit narrow screens and secondary text meets contrast minimum`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: theme });
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    for (const width of [320, 375, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      for (const route of ["/", "/picks/network/", "/picks/screenshots/"]) {
        await page.goto(route);
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${route} at ${width}px`).toBe(true);
        const colors = await page.evaluate(() => {
          const probe = document.createElement("span");
          document.body.append(probe);
          const resolve = (token) => { probe.style.color = `var(${token})`; return getComputedStyle(probe).color; };
          const result = [resolve('--muted'), resolve('--bg'), resolve('--surface'), resolve('--well')];
          probe.remove();
          return result;
        });
        for (const bg of colors.slice(1)) expect(contrast(colors[0], bg)).toBeGreaterThanOrEqual(4.5);
      }
    }
    expect(errors).toEqual([]);
  });
}

test("the hero finder doubles as a command palette and returns to the hero on close", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");
  const palette = page.locator("[data-palette]");
  await expect(page.locator(".hero-aside .hero-finder")).toHaveCount(1);
  await expect(palette).toBeHidden();
  await page.keyboard.press("/");
  await expect(palette).toBeVisible();
  await expect(palette.locator(".hero-finder")).toHaveCount(1);
  await expect(page.getByRole("searchbox")).toBeFocused();
  await page.getByRole("searchbox").fill("clipboard");
  await page.keyboard.press("ArrowDown");
  await expect(page.locator("[data-finder-item]:visible a").first()).toBeFocused();
  await page.keyboard.press("ArrowUp");
  await expect(page.getByRole("searchbox")).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(palette).toBeHidden();
  await expect(page.locator(".hero-aside .hero-finder")).toHaveCount(1);
  const trigger = page.locator(".site-header [data-open-palette]");
  await expect(trigger).toBeVisible();
  await trigger.click();
  await expect(palette).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(trigger).toBeFocused();
  await page.keyboard.press("Control+k");
  await expect(palette).toBeVisible();
  await page.getByRole("searchbox").fill("clipboard");
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/picks\/clipboard\/$/);
});

test("the radar and headline decode are enhancements that leave the content intact", async ({ page, browser, request }) => {
  const html = await (await request.get("/")).text();
  const heading = html.match(/<h1>([^<]+)<\/h1>/)[1];
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");
  await expect(page.locator("[data-radar]")).toBeVisible();
  expect(await page.locator("[data-radar] canvas").evaluate((canvas) => canvas.width > 0)).toBe(true);
  await page.locator("[data-radar] canvas").hover({ position: { x: 145, y: 60 } });
  await expect(page.locator("[data-radar-pick]")).not.toHaveText("—");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(heading, { timeout: 3000 });
  expect(await page.locator(".hero h1 .decode").count()).toBe(0);
  const context = await browser.newContext({ javaScriptEnabled: false });
  const plain = await context.newPage();
  await plain.goto("http://127.0.0.1:4173/");
  await expect(plain.locator("[data-radar]")).toBeHidden();
  await expect(plain.locator("[data-palette]")).toBeHidden();
  await expect(plain.locator("[data-open-palette]")).toHaveCount(3);
  await expect(plain.locator("[data-open-palette]:visible")).toHaveCount(0);
  await expect(plain.getByRole("searchbox")).toBeVisible();
  await context.close();
});

test("discovery and email remain usable without JavaScript", async ({ browser }) => {
  const context = await browser.newContext({ javaScriptEnabled: false });
  const page = await context.newPage();
  await page.goto("http://127.0.0.1:4173/");
  await expect(page.getByRole("heading", { name: "New to Omarchy?" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Email", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Copy link", exact: true })).toBeHidden();
  await expect(page.locator('.starter-card')).toHaveCount(3);
  await page.locator('.starter-card a').first().click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Notes');
  await context.close();
});

test("recommendation cards expose their task evidence and related tools stay outside the podium", async ({ page, request }) => {
  const types = await rankedTypes(request);
  const type = types.find((t) => t.winner?.taskFit?.qualified && t.relatedTools?.length) ?? types.find((t) => t.winner?.taskFit?.qualified);
  test.skip(!type, "No task has a qualified reviewed option in this snapshot.");
  await page.goto(`/picks/${type.id}/`);
  for (const [slot, candidate] of [["champion", type.winner], ["runner-up", type.runnerUp]]) {
    if (!candidate) continue;
    const card = slot === "champion" ? page.locator(".pick-card.champion") : page.locator(".pick-card:not(.champion)");
    await expect(card.locator(".task-fit-note")).toContainText(candidate.taskFit.reason);
    const details = card.locator(".capability-evidence");
    if (await details.count()) {
      await details.locator("summary").click();
      await expect(card.getByRole("link", { name: "Capability evidence" }).first()).toHaveAttribute("href", new RegExp(`/blob/${candidate.taskFit.source.revision}/`));
      for (const requirement of candidate.taskFit.pluginRequirements ?? []) await expect(card.locator(".task-fit-note")).toContainText(requirement);
    } else {
      await expect(card.getByRole("link", { name: "Capability evidence" })).toHaveAttribute("href", candidate.taskFit.source.url);
    }
    for (const constraint of candidate.taskFit.constraints) await expect(card.locator(".task-fit-note")).toContainText(constraint);
  }
  if (type.alternatives?.length || type.relatedTools?.length) await expect(page.getByRole("heading", { name: "More choices for this task" })).toBeVisible();
  for (const candidate of type.relatedTools ?? []) {
    await expect(page.locator(".task-alternatives")).toContainText(candidate.taskFit.reason);
    expect([type.winner.id, type.runnerUp?.id]).not.toContain(candidate.id);
  }
});

test("snapshot age reports the last successful publication when a refresh is overdue", async ({ page, request }) => {
  const snapshot = await (await request.get("/rankings.json")).json();
  const published = Date.parse(snapshot.generatedAt);
  await page.clock.install({ time: new Date(published + 7 * 86400000) });
  await page.goto("/");
  await expect(page.locator("[data-snapshot-at]")).toBeHidden();
  await page.clock.setSystemTime(new Date(published + 10 * 86400000));
  await page.reload();
  await expect(page.locator("[data-snapshot-at]")).toContainText("This snapshot is 10 days old");
  await page.goto("/picks/screenshots/");
  await expect(page.locator("[data-snapshot-at]")).toContainText("last successful publication");
});

test("reviewed evidence opens by keyboard and unavailable selections stay readable on small screens", async ({ page }) => {
  const revision = "a".repeat(40);
  const source = { url: "https://github.com/example/forecast", revision, path: "README.md", evidence: `Shows local weather. ${"source-passage-".repeat(25)}` };
  const winner = {
    id: "forecast", name: "Forecast", description: "Local weather", author: "Example",
    repository: source.url, detailUrl: "https://plugins.omarchy.org/plugin.html?id=forecast",
    installCommand: "omarchy plugin add https://github.com/example/forecast.git", score: 0.8, metrics: { copies: 12, hearts: 3, stars: 4, views: 40 }, normalized: { freshness: 0.8 },
    taskFit: { qualified: true, reason: "Shows local conditions and a forecast.", role: "core", provenance: "repository-evidence",
      reviewedAt: "2026-10-26", lastValidatedAt: "2026-10-28T06:00:00Z", requirementsStatus: "reviewed",
      pluginRequirements: ["Requires an API key."], constraints: [], source, sources: [source], evidenceStatus: "current" }
  };
  const rankings = { methodologyVersion: "1.3.0", week: "2026-W44", generatedAt: "2026-10-26T06:00:00Z",
    types: [{ id: "weather", name: "Weather", description: "Current conditions and forecasts", eligibleCount: 1, pendingCount: 6, winner, runnerUp: null }] };
  const current = withAvailability(rankings, availabilityFor(rankings, { stateSchemaVersion: 2, generatedAt: "2026-10-28T05:00:00Z",
    plugins: [{ id: winner.id, repo: winner.repository, installAvailable: true, installCommand: winner.installCommand, upstreamCheckStatus: "unreachable" }] },
    { now: new Date("2026-10-28T06:00:00Z"), minimumCatalogSize: 0 }));
  await page.route("**/reviewed-fixture/", (route) => route.fulfill({ contentType: "text/html", body: renderFixtureType(current.types[0], current) }));
  await page.clock.install({ time: new Date("2026-10-30T06:00:00Z") });
  for (const width of [320, 768, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/reviewed-fixture/");
    const card = page.locator(".pick-card.champion");
    await expect(card).toContainText("01 Leading reviewed option");
    await expect(card).toContainText("Currently unavailable");
    await expect(card).toContainText("The marketplace could not reach the repository");
    await expect(card.locator('[data-copy-label="install command"]')).toHaveCount(0);
    await expect(page.locator(".availability-summary")).toContainText("2 days ago");
    await expect(page.locator(".availability-summary time")).toHaveText("October 28, 2026");
    await expect(page.locator(".availability-summary time")).toHaveAttribute("datetime", "2026-10-28T06:00:00.000Z");
    const evidence = card.locator(".capability-evidence");
    await expect(evidence.locator("blockquote")).toBeHidden();
    await evidence.locator("summary").focus();
    await page.keyboard.press("Enter");
    await expect(evidence.locator("blockquote")).toBeVisible();
    await expect(evidence.getByRole("link", { name: "Capability evidence" })).toHaveAttribute("href", `https://github.com/example/forecast/blob/${revision}/README.md`);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `reviewed evidence at ${width}px`).toBe(true);
  }
});
