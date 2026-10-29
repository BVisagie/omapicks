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
