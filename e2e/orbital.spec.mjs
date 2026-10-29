import { test, expect } from "@playwright/test";

test("collections intersect search, Escape keeps the collection, and reset restores discovery", async ({ page }) => {
  await page.goto("/");
  const collection = page.locator('[data-collection-filter="0"]');
  const expected = await page.locator('[data-catalog-row]').evaluateAll((rows) =>
    rows.filter((row) => row.dataset.collections.split(/\s+/).includes("0")).map((row) => row.getAttribute("href"))
  );
  expect(expected.length).toBeGreaterThan(0);
  await collection.click();
  await expect(collection).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator('[data-collection-filter="all"]')).toHaveAttribute("aria-pressed", "false");
  await expect(page.locator('[data-catalog-row]:visible')).toHaveCount(expected.length);
  await expect(page.locator('[data-finder-item]:visible')).toHaveCount(expected.length);
  await expect(page.locator('[data-filter-jump]')).toHaveText(`View ${expected.length} matching categories ↓`);
  await page.locator('[data-filter-jump]').click();
  await expect(page.locator('#catalog-heading')).toBeInViewport();

  const query = "notes";
  const intersected = await page.locator('[data-catalog-row]').evaluateAll((rows, q) =>
    rows.filter((row) => row.dataset.collections.split(/\s+/).includes("0") && row.dataset.search.includes(q)).map((row) => row.getAttribute("href")), query
  );
  await page.getByRole("searchbox").fill(query);
  expect(await page.locator('[data-catalog-row]:visible').evaluateAll((rows) => rows.map((row) => row.getAttribute("href")))).toEqual(intersected);
  await expect(page.locator('[data-finder-item]:visible')).toHaveCount(intersected.length);

  await page.getByRole("searchbox").fill("no-such-orbital-task");
  await expect(page.locator('[data-filter-empty]')).toBeVisible();
  await expect(page.locator('[data-finder-empty]')).toBeVisible();
  await expect(page.locator('[data-filter-jump]')).toBeHidden();
  await expect(page.locator('[data-filter-status]')).toHaveAttribute("aria-label", /^0 of \d+ categories match$/);
  await page.getByRole("searchbox").press("Escape");
  await expect(page.getByRole("searchbox")).toHaveValue("");
  await expect(collection).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator('[data-catalog-row]:visible')).toHaveCount(expected.length);

  await page.locator('[data-filter-reset]').filter({ visible: true }).first().click();
  await expect(page.getByRole("searchbox")).toBeFocused();
  await expect(page.locator('[data-collection-filter="all"]')).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator('[data-catalog-row]:visible')).toHaveCount(await page.locator('[data-catalog-row]').count());
  await expect(page.locator('[data-finder-item]:visible')).toHaveCount(await page.locator('[data-finder-item][data-suggested]').count());
});

test("keyboard discovery shortcuts preserve typing and leave dialogs alone", async ({ page }) => {
  await page.goto("/");
  await page.keyboard.press("/");
  const search = page.getByRole("searchbox");
  await expect(search).toBeFocused();
  await search.fill("clipboard");
  await search.press("/");
  await expect(search).toHaveValue("clipboard/");
  await search.fill("clipboard");
  await search.press("ArrowDown");
  await expect(page.locator('[data-finder-item]:visible a').first()).toBeFocused();
  await page.keyboard.press("Control+k");
  await expect(search).toBeFocused();

  await page.evaluate(() => {
    const dialog = document.createElement("dialog");
    dialog.id = "shortcut-test-dialog";
    dialog.innerHTML = '<input aria-label="Dialog input">';
    document.body.append(dialog);
    dialog.showModal();
  });
  await page.keyboard.press("Control+k");
  await expect(page.getByRole("textbox", { name: "Dialog input" })).toBeFocused();
  await page.keyboard.press("Escape");
  await page.evaluate(() => document.getElementById("shortcut-test-dialog").remove());
});

test("motion preference persists and OS reduced motion takes precedence", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.goto("/");
  const control = page.locator('[data-motion-toggle]');
  await expect(control).toHaveText("Motion on");
  await control.click();
  await expect(control).toHaveText("Motion off");
  await expect(page.locator('html')).toHaveAttribute("data-motion", "off");
  await page.reload();
  await expect(control).toHaveText("Motion off");
  await page.emulateMedia({ reducedMotion: "reduce" });
  await expect(control).toHaveText("Reduced motion");
  await expect(control).toBeDisabled();
  await expect(control).toHaveAttribute("aria-pressed", "false");
  await expect(page.locator('html')).toHaveAttribute("data-motion", "off");
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await expect(control).toBeEnabled();
  await expect(control).toHaveText("Motion off");
  await control.click();
  await expect(control).toHaveText("Motion on");
  await expect(control).toHaveAttribute("aria-pressed", "true");
  await page.emulateMedia({ reducedMotion: "reduce" });
  await expect(control).toBeDisabled();
  await expect(page.locator('html')).toHaveAttribute("data-motion", "off");
});

test("theme and motion controls remain functional when storage is denied", async ({ page }) => {
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.addInitScript(() => {
    Storage.prototype.getItem = () => { throw new DOMException("Denied", "SecurityError"); };
    Storage.prototype.setItem = () => { throw new DOMException("Denied", "SecurityError"); };
  });
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.goto("/");
  await page.locator('[data-motion-toggle]').click();
  await expect(page.locator('html')).toHaveAttribute("data-motion", "off");
  const before = await page.locator('html').getAttribute('data-theme');
  await page.locator('[data-theme-toggle]').click();
  await expect(page.locator('html')).toHaveAttribute("data-theme", before === "dark" ? "light" : "dark");
  expect(errors).toEqual([]);
});

test("decorative motion pauses offscreen and in background tabs without replaying the entrance", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.goto("/");
  const art = page.locator('.hero-art');
  const orbit = page.locator('.orbit-track');
  await expect(art).toHaveAttribute('data-active', 'true');
  await expect.poll(() => orbit.evaluate(el => getComputedStyle(el).animationPlayState)).toBe('running');
  await expect.poll(() => page.locator('html').getAttribute('data-entrance')).toBeNull();
  await expect(page.getByRole('heading', { level: 1 })).toHaveCSS('opacity', '1');

  await page.locator('#catalog-heading').scrollIntoViewIfNeeded();
  await expect(art).toHaveAttribute('data-active', 'false');
  await expect.poll(() => orbit.evaluate(el => getComputedStyle(el).animationPlayState)).toBe('paused');
  await art.scrollIntoViewIfNeeded();
  await expect(art).toHaveAttribute('data-active', 'true');

  // Deterministically exercise Page Visibility events even in headless test runners.
  await page.evaluate(() => {
    Object.defineProperty(document, 'hidden', { configurable: true, value: true });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await expect(art).toHaveAttribute('data-active', 'false');
  await expect(orbit).toHaveCSS('animation-play-state', 'paused');
  await page.evaluate(() => {
    delete document.hidden;
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await expect(art).toHaveAttribute('data-active', 'true');
  await page.locator('[data-motion-toggle]').click();
  await page.locator('[data-motion-toggle]').click();
  await expect(page.locator('html')).not.toHaveAttribute('data-entrance');
  await expect(page.getByRole('heading', { level: 1 })).toHaveCSS('animation-name', 'none');
});

test("motion opt-out removes spatial hover effects and reduced motion cancels loops", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.goto("/");
  await page.locator('[data-motion-toggle]').click();
  const card = page.locator('[data-catalog-row]').first();
  await card.hover();
  await expect(card).toHaveCSS('transform', 'none');
  await expect(card.locator('img')).toHaveCSS('transform', 'none');
  await card.focus();
  // Enter keyboard modality; programmatic focus after a pointer click is not :focus-visible.
  await page.keyboard.press('Tab');
  await page.keyboard.press('Shift+Tab');
  await expect(card).toBeFocused();
  await expect(card).toHaveCSS('outline-style', 'solid');
  await page.locator('[data-motion-toggle]').click();
  await card.hover();
  await expect.poll(() => card.evaluate(el => getComputedStyle(el).transform)).not.toBe('none');
  await page.emulateMedia({ reducedMotion: "reduce" });
  await expect(card).toHaveCSS('transform', 'none');
  await expect(card.locator('img')).toHaveCSS('transform', 'none');
  for (const selector of ['.orbit-track', '.orbital-tag-top', '.orbital-tag-bottom']) {
    await expect(page.locator(selector)).toHaveCSS('animation-name', 'none');
  }
});

test("missing visibility observer leaves artwork static and discovery functional", async ({ page }) => {
  await page.addInitScript(() => { delete window.IntersectionObserver; });
  await page.goto("/");
  await expect(page.locator('.orbit-track')).toHaveCSS('animation-play-state', 'paused');
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  await page.getByRole('searchbox').fill('clipboard');
  await expect(page.locator('[data-finder-item]:visible a').first()).toBeVisible();
});
