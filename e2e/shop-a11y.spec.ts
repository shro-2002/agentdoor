import { expect, test, type Page } from "@playwright/test";
import { PERSONA_NOTE } from "../apps/shop/src/views/persona.js";
import { SHOP,ownerLogin, placeOrderViaPages, seriousViolations } from "./shop-helpers.js";

/**
 * A11Y-2 (shop pages S1, S2, S5, S7) and A11Y-3 (the /try pages): zero serious or critical axe
 * violations, at phone and desktop widths. Reduced motion is requested so contrast is measured on
 * the final colours, not mid-animation.
 */
test.use({ reducedMotion: "reduce" });

const WIDTHS = [375, 1280];

async function clean(page: Page, label: string): Promise<void> {
  const found = await seriousViolations(page);
  expect(found, `${label}: ${JSON.stringify(found)}`).toEqual([]);
  console.log(`axe ${label}: ${found.length} serious/critical`);
  await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);
  // Honesty label: footer on bakery pages, intro area on /try, hero of the report and the landing page. Owner pages keep the old footer note.
  await expect(page.getByText(PERSONA_NOTE)).toHaveCount(1);
}

for (const w of WIDTHS) {
  test.describe(`A11Y-2 shop pages at ${w}px`, () => {
    test.use({ viewport: { width: w, height: 900 } });

    test("S1 storefront", async ({ page }) => {
      await page.goto(`${SHOP()}/`);
      await clean(page, `S1 ${w}`);
    });

    test("S2 order form, refusal, quote", async ({ page }) => {
      await page.goto(`${SHOP()}/order`);
      await clean(page, `S2 form ${w}`);
      await page.locator("input.qty__input").first().fill("1");
      await page.locator("#date").evaluate((el: HTMLInputElement) => el.removeAttribute("min"));
      await page.locator("#date").fill(new Date().toISOString().slice(0, 10));
      await page.getByRole("button", { name: "Get my quote" }).click();
      await expect(page.locator("#problems")).toBeVisible();
      await clean(page, `S2 refusal ${w}`);
      await page.goto(`${SHOP()}/order`);
      await page.locator("input.qty__input").first().fill("1");
      await page.getByRole("button", { name: "Get my quote" }).click();
      await expect(page.getByRole("heading", { level: 1, name: "Your quote" })).toBeVisible();
      await clean(page, `S2 quote ${w}`);
    });

    test("S3 status and S4 contact", async ({ page }) => {
      await placeOrderViaPages(page, "Axe Check");
      await clean(page, `S3 ${w}`);
      await page.goto(`${SHOP()}/contact`);
      await clean(page, `S4 ${w}`);
      await page.goto(`${SHOP()}/contact?sent=1`);
      await clean(page, `S4 thanks ${w}`);
    });

    test("404 page", async ({ page }) => {
      const res = await page.goto(`${SHOP()}/no-such-page`);
      expect(res?.status()).toBe(404);
      await clean(page, `404 ${w}`);
    });

    test("S5 launch report", async ({ page }) => {
      await page.goto(`${SHOP()}/launch-report`);
      await clean(page, `S5 ${w}`);
    });

    test("AgentDoor landing page", async ({ page }) => {
      await page.goto(`${SHOP()}/launch`);
      await clean(page, `launch ${w}`);
    });

    test("S7 owner login and dashboard", async ({ page }) => {
      await page.goto(`${SHOP()}/owner/login`);
      await clean(page, `S7 login ${w}`);
      await page.getByLabel("Owner token").fill("wrong");
      await page.getByRole("button", { name: "Sign in" }).click();
      await clean(page, `S7 login error ${w}`);
      await ownerLogin(page);
      await expect(page.locator("table.orders, .empty").first()).toBeVisible();
      await clean(page, `S7 dashboard ${w}`);
      await page.getByRole("link", { name: /^All/ }).click();
      await clean(page, `S7 dashboard all ${w}`);
    });
  });

  test.describe(`A11Y-3 /try pages at ${w}px`, () => {
    test.use({ viewport: { width: w, height: 900 } });
    for (const p of ["/try", "/try/describe", "/try/rules", "/try/rehearse?v=1", "/try/rehearse", "/try/launch"]) {
      test(`${p}`, async ({ page }) => {
        await page.goto(`${SHOP()}${p}`);
        await clean(page, `${p} ${w}`);
      });
    }

    test("mini-form result", async ({ page }) => {
      await page.goto(`${SHOP()}/try/rehearse`);
      await page.getByRole("button", { name: "Ask the rule engine" }).click();
      await expect(page.locator("#quote-result")).toBeVisible();
      await clean(page, `/try quote ${w}`);
    });
  });
}
