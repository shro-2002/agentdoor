import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { SHOP } from "./shop-helpers.js";

/** Full-page screenshots of the redesigned pages for docs/screens (v2-<page>-<width>.png), 1440 and 375 wide. */
const OUT = path.resolve("docs/screens");
const SIZES = [
  { w: 1440, h: 900 },
  { w: 375, h: 812 },
];

test.use({ reducedMotion: "reduce" });

/** Lazy images below the fold would be blank in a full-page capture, so load them all first. */
async function loadImages(page: Page): Promise<void> {
  await page.evaluate(async () => {
    const imgs = [...document.images];
    imgs.forEach((i) => (i.loading = "eager"));
    await Promise.all(imgs.map((i) => i.decode().catch(() => undefined)));
  });
}

async function shot(page: Page, name: string, w: number): Promise<void> {
  await loadImages(page);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow, `${name} at ${w}px scrolls sideways`).toBeLessThanOrEqual(0);
  await page.screenshot({ path: path.join(OUT, `v2-${name}-${w}.png`), fullPage: true });
}

for (const { w, h } of SIZES) {
  test(`redesign screenshots at ${w}px`, async ({ page }) => {
    await page.setViewportSize({ width: w, height: h });

    await page.goto(`${SHOP()}/`);
    await shot(page, "home", w);

    await page.goto(`${SHOP()}/order`);
    await shot(page, "order-form", w);
    await page.getByRole("button", { name: /^More / }).first().click();
    await page.getByRole("button", { name: "Get my quote" }).click();
    await expect(page.getByRole("heading", { level: 1, name: "Your quote" })).toBeVisible();
    await shot(page, "order", w);

    await page.goto(`${SHOP()}/try`);
    await shot(page, "try", w);
  });
}
