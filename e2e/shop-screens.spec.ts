import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { SHOP, ownerLogin, placeOrderViaPages } from "./shop-helpers.js";

/** Screenshots for docs/screens (375 and 1440), taken from the fixture-mode shop. */
const OUT = path.resolve("docs/screens");
const SIZES = [
  { w: 375, h: 812 },
  { w: 1440, h: 900 },
];

test.use({ reducedMotion: "reduce" });

async function noSideScroll(page: Page): Promise<void> {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow, "horizontal overflow").toBeLessThanOrEqual(0);
}

async function shot(page: Page, name: string, w: number): Promise<void> {
  await noSideScroll(page);
  await page.screenshot({ path: path.join(OUT, `${name}-${w}.png`), fullPage: true });
}

for (const { w, h } of SIZES) {
  test(`shop screenshots at ${w}px`, async ({ page }) => {
    await page.setViewportSize({ width: w, height: h });

    await page.goto(`${SHOP()}/`);
    await shot(page, "s1-storefront", w);

    await page.goto(`${SHOP()}/order`);
    await page.locator("input.qty__input").first().fill("1");
    await shot(page, "s2-order", w);
    await page.getByRole("button", { name: "Get my quote" }).click();
    await expect(page.getByRole("heading", { level: 1, name: "Your quote" })).toBeVisible();
    await shot(page, "s2-quote", w);

    await page.goto(`${SHOP()}/order`);
    await page.locator("input.qty__input").first().fill("1");
    await page.locator("#date").evaluate((el: HTMLInputElement) => el.removeAttribute("min"));
    await page.locator("#date").fill(new Date().toISOString().slice(0, 10));
    await page.getByRole("button", { name: "Get my quote" }).click();
    await expect(page.locator("#problems")).toBeVisible();
    await shot(page, "s2-refused", w);

    await placeOrderViaPages(page, "Asha");
    await shot(page, "s3-status", w);

    await page.goto(`${SHOP()}/contact`);
    await shot(page, "s4-contact", w);

    await page.goto(`${SHOP()}/launch-report`);
    await shot(page, "s5-launch-report", w);

    await page.goto(`${SHOP()}/owner/login`);
    await shot(page, "s7-owner-login", w);
    await ownerLogin(page);
    await shot(page, "s7-owner-dashboard", w);

    await page.goto(`${SHOP()}/try`);
    await shot(page, "s8-try-intro", w);
    await page.goto(`${SHOP()}/try/describe`);
    await shot(page, "s8-try-describe", w);
    await page.goto(`${SHOP()}/try/rules`);
    await shot(page, "s8-try-rules", w);
    await page.goto(`${SHOP()}/try/rehearse`);
    await page.getByRole("button", { name: "Ask the rule engine" }).click();
    await expect(page.locator("#quote-result")).toBeVisible();
    await shot(page, "s8-try-rehearse", w);
    await page.goto(`${SHOP()}/try/launch`);
    await shot(page, "s8-try-launch", w);
  });
}
