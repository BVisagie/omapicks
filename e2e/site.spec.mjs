import { test, expect } from "@playwright/test";

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

test("advertised searches filter both lists and Enter opens the first match", async ({ page }) => {
  await page.goto("/");
  for (const [query, id] of [["spotify", "music"], ["weather", "weather"], ["clipboard", "clipboard"]]) {
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
  await page.goto(`/picks/${contested.id}/`);
  const table = page.getByRole("table", { name: "Marketplace signals by plugin" });
  await expect(table.getByRole("columnheader")).toHaveCount(3);
  await expect(table.getByRole("rowheader", { name: "Copies" })).toBeVisible();
  await expect(table.getByRole("cell")).toHaveCount(10);
  expect(await page.locator('.category-grid a').count()).toBeLessThanOrEqual(6);
  await expect(page.getByRole("link", { name: "Browse all categories" })).toHaveAttribute("href", "/#catalog");
});

test("copy link, install command, email and native sharing use the correct payload", async ({ page, context, request }) => {
  const { id } = (await rankedTypes(request)).find((type) => type.winner);
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
