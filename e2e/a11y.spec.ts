import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { seedSession } from "./helpers.js";

const TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];

async function serious(page: Page): Promise<{ id: string; impact: string | null | undefined; nodes: string[] }[]> {
  const results = await new AxeBuilder({ page }).withTags(TAGS).analyze();
  return results.violations
    .filter((v) => v.impact === "serious" || v.impact === "critical")
    .map((v) => ({ id: v.id, impact: v.impact, nodes: v.nodes.slice(0, 3).map((n) => `${n.target.join(" ")} :: ${n.failureSummary?.split("\n")[1] ?? ""}`) }));
}

/** A11Y-1: zero serious or critical axe violations on L2 and L3 (and, as a bonus, L1 and L4), in EN and Hinglish. */
for (const lang of ["en", "hinglish"] as const) {
  test.describe(`A11Y-1 (${lang})`, () => {
    test.beforeEach(async ({ page }) => {
      await page.goto("/");
      await page.evaluate((l) => localStorage.setItem("agentdoor.lang", l), lang);
    });

    test("L2 rules", async ({ page }) => {
      await seedSession(page, "/rules");
      await expect(page.locator("article.rule").first()).toBeVisible();
      expect(await serious(page)).toEqual([]);
      await page.locator('button[data-action="edit"]').first().click();
      await expect(page.locator("form.rule__edit:visible")).toBeVisible();
      expect(await serious(page)).toEqual([]);
    });

    test("L3 rehearsal (gaps open)", async ({ page }) => {
      await seedSession(page, "/rehearsal");
      await expect(page.locator("#receipt")).toBeVisible();
      await expect(page.locator("article.gap").first()).toBeVisible();
      await page.waitForTimeout(2500); // let the receipt animation finish so contrast is measured on the final colours
      expect(await serious(page)).toEqual([]);
    });

    test("L1 describe and L4 launch", async ({ page }) => {
      await page.goto("/");
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
      expect(await serious(page)).toEqual([]);
      await seedSession(page, "/launch");
      await expect(page.locator(".door")).toBeVisible();
      expect(await serious(page)).toEqual([]);
    });
  });
}

test("keyboard: language switch is a radiogroup with arrow keys; one h1 per page", async ({ page }) => {
  await page.goto("/");
  await page.evaluate(() => localStorage.setItem("agentdoor.lang", "en"));
  await page.goto("/");
  await page.locator('[data-lang="en"]').focus();
  await page.keyboard.press("ArrowRight");
  await expect(page.locator('[data-lang="hi"]')).toHaveAttribute("aria-checked", "true");
  await expect(page.locator("html")).toHaveAttribute("lang", "hi");
  for (const path of ["/", "/rules", "/rehearsal", "/launch"]) {
    await page.goto(path);
    await expect(page.locator("h1")).toHaveCount(1);
  }
});
