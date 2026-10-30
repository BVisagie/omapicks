import { test, expect } from "@playwright/test";
import { renderFixtureType } from "../build/render.mjs";

function snapshot({ longNames = false } = {}) {
  const candidate = (id, name, score) => ({
    id, name, score, author: "Example", description: "Shows the computer's battery status.",
    repository: `https://github.com/example/${id}`,
    detailUrl: `https://plugins.omarchy.org/plugin.html?id=${id}`,
    installCommand: `omarchy plugin add https://github.com/example/${id}.git`,
    verificationCoverage: "snapshot-verified",
    metrics: { copies: 12, hearts: 4, stars: 7, views: 40 }, normalized: { freshness: 0.8 },
    taskFit: {
      qualified: true, role: "core", reason: "Reads the computer battery and charging state.",
      provenance: "repository-evidence", reviewedAt: "2026-10-26", constraints: [],
      pluginRequirements: ["Requires a computer battery."], requirementsStatus: "reviewed",
      source: { url: `https://github.com/example/${id}`, revision: "a".repeat(40), path: "README.md", evidence: "Displays battery charge and status." }
    }
  });
  return {
    methodologyVersion: "1.3.0", week: "2026-W44", generatedAt: "2026-10-26T06:00:00Z",
    types: [{
      id: "battery", name: "Battery", description: "Computer battery status", eligibleCount: 3,
      winner: candidate("omastats", longNames ? "OmaStatsWithAnUnusuallyLongUnbrokenPluginName" : "OmaStats", 0.941225),
      runnerUp: candidate("argus", longNames ? "Argus with additional battery and system monitoring capabilities" : "Argus", 0.779321),
      alternatives: [candidate("battery", "Battery", 0.6)]
    }]
  };
}

async function fixture(page, options) {
  const rankings = snapshot(options);
  await page.route("**/popularity-fixture/", (route) => route.fulfill({
    contentType: "text/html", body: renderFixtureType(rankings.types[0], rankings)
  }));
  await page.goto("/popularity-fixture/");
  return rankings;
}

test("popularity explains the ordering with keyboard-accessible exact scores and raw counts", async ({ page }) => {
  await fixture(page);
  const comparison = page.locator(".popularity-comparison");
  await expect(comparison.getByRole("heading", { name: "Popularity among reviewed Battery options" })).toBeVisible();
  await expect(comparison).toContainText("Top 2 of 3 qualified options");
  await expect(comparison).toContainText("2026-W44");
  await expect(comparison.locator(".popularity-name")).toHaveText(["#1 OmaStats", "#2 Argus"]);
  await expect(comparison.locator(".popularity-value")).toHaveText(["94 / 100", "78 / 100"]);
  await expect(page.locator(".dial, .scoreboard")).toHaveCount(0);
  const details = comparison.locator(".popularity-details");
  const table = details.getByRole("table", { name: "Marketplace signals by plugin" });
  await expect(table).toBeHidden();
  await details.locator("summary").focus();
  await page.keyboard.press("Enter");
  await expect(table).toBeVisible();
  await expect(details).toContainText("0.941225");
  await expect(details).toContainText("0.779321");
  await expect(table.getByRole("rowheader", { name: "Install-command copies", exact: true })).toBeVisible();
  await expect(table.getByRole("columnheader")).toHaveText(["Signal", "OmaStats", "Argus"]);
  await page.keyboard.press("Enter");
  await expect(table).toBeHidden();
  await expect(comparison.locator(".popularity-value")).toHaveText(["94 / 100", "78 / 100"]);
});

for (const theme of ["dark", "light"]) {
  test(`${theme} popularity comparison wraps long names and follows requirements on phones and desktop`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: theme, reducedMotion: "reduce" });
    for (const width of [320, 390, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      await fixture(page, { longNames: true });
      const comparison = page.locator(".popularity-comparison");
      await expect(comparison.locator(".popularity-row")).toHaveCount(2);
      const readingOrder = await comparison.evaluate((element) => {
        const prior = [document.querySelector(".podium"), document.querySelector(".task-alternatives")];
        return prior.every((node) => node && Boolean(node.compareDocumentPosition(element) & Node.DOCUMENT_POSITION_FOLLOWING));
      });
      expect(readingOrder).toBe(true);
      for (const row of await comparison.locator(".popularity-row").all()) {
        const track = row.locator(".popularity-track");
        await expect(track).toHaveAttribute("aria-hidden", "true");
        const bounds = await row.evaluate((element) => {
          const rect = element.getBoundingClientRect();
          return [...element.querySelectorAll(".popularity-name, .popularity-value, .popularity-track")].every((child) => {
            const childRect = child.getBoundingClientRect();
            return childRect.left >= rect.left - 1 && childRect.right <= rect.right + 1;
          });
        });
        expect(bounds, `row content at ${width}px`).toBe(true);
      }
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `closed details at ${width}px`).toBe(true);
      await comparison.locator("summary").click();
      await expect(comparison.getByRole("table")).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `open details at ${width}px`).toBe(true);
    }
  });
}

test.describe("popularity without JavaScript", () => {
  test.use({ javaScriptEnabled: false });

  test("renders final values and opens the native disclosure", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 900 });
    await fixture(page);
    const comparison = page.locator(".popularity-comparison");
    await expect(comparison.locator(".popularity-value")).toHaveText(["94 / 100", "78 / 100"]);
    await expect(comparison.locator(".popularity-note")).toBeVisible();
    await expect(comparison.getByRole("table")).toBeHidden();
    await comparison.locator("summary").click();
    await expect(comparison.getByRole("table")).toBeVisible();
    await expect(comparison.locator(".popularity-details")).toContainText("0.941225");
  });
});
