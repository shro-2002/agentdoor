import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { fixOpenGaps } from "./helpers.js";

const OUT = path.resolve("docs/screens");
const SIZES = [
  { w: 375, h: 812 },
  { w: 1440, h: 900 },
];

/** Waits for the CSS animations (receipt print, banner) to settle so the picture shows the final state. */
const settle = (page: Page): Promise<void> => page.waitForTimeout(2600);
const shot = (page: Page, name: string, w: number): Promise<Buffer> => page.screenshot({ path: path.join(OUT, `${name}-${w}.png`), fullPage: true });

async function noSideScroll(page: Page): Promise<void> {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
}

for (const { w, h } of SIZES) {
  test(`screenshots at ${w}px`, async ({ page }) => {
    await page.setViewportSize({ width: w, height: h });

    // L1: the page with the demo loaded, then with the clarifying questions
    await page.goto("/");
    await page.evaluate(() => localStorage.setItem("agentdoor.lang", "en"));
    await page.goto("/");
    await page.getByRole("button", { name: "Use the demo bakery" }).click();
    await expect(page.locator("#story")).not.toHaveValue("");
    await page.locator("#story").evaluate((el: HTMLTextAreaElement) => el.setSelectionRange(0, 0));
    await page.locator("#story").evaluate((el: HTMLTextAreaElement) => (el.scrollTop = 0));
    await settle(page);
    await noSideScroll(page);
    await shot(page, "l1-describe", w);
    await page.getByRole("button", { name: "Read my rules" }).click();
    await expect(page.getByRole("heading", { name: "A few quick questions" })).toBeVisible();
    for (const group of await page.locator("fieldset.question").all()) await group.locator('input[type="radio"]').first().check({ force: true });
    await noSideScroll(page);
    await shot(page, "l1-describe-questions", w);
    await page.getByRole("button", { name: "Continue" }).click();

    // L2: rules with the owner's words
    await expect(page.locator("article.rule").first()).toBeVisible();
    await noSideScroll(page);
    await shot(page, "l2-rules", w);
    await page.getByRole("button", { name: "Approve all high-confidence" }).click();
    await expect(page.locator("#approved-count")).not.toContainText("0 of");

    // L3: the receipt with red GAP slips, then the clean receipt with the door unlocked
    await page.getByRole("link", { name: "Rehearse my shop" }).click();
    await expect(page.locator("#receipt")).toBeVisible();
    await settle(page);
    await noSideScroll(page);
    await shot(page, "l3-rehearsal", w);
    for (let round = 0; round < 6; round++) {
      await fixOpenGaps(page);
      await page.locator("#run-again").click();
      await expect(page.locator("#receipt")).toBeVisible();
      if ((await page.locator(".door.is-open").count()) > 0) break;
      await page.waitForTimeout(300);
    }
    await expect(page.locator(".door.is-open")).toBeVisible();
    await settle(page);
    await shot(page, "l3-rehearsal-clean", w);

    // L4: gate + the stubbed launch timeline
    await page.getByRole("link", { name: "Go to launch" }).click();
    await page.getByRole("button", { name: "Launch my shop" }).click();
    await expect(page.locator(".banner--clean")).toContainText("every step is done");
    await settle(page);
    await noSideScroll(page);
    await shot(page, "l4-launch", w);
  });
}

test("Hinglish and Hindi headings render at 375px", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto("/");
  await page.evaluate(() => localStorage.setItem("agentdoor.lang", "hi"));
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toContainText("अपनी बेकरी");
  await noSideScroll(page);
  await page.screenshot({ path: path.join(OUT, "l1-describe-hindi-375.png"), fullPage: true });
});
